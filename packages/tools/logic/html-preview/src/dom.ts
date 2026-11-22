/**
 * Reading and changing someone else's DOM without trusting it. Pasted markup names elements: `<form name="body">` makes
 * `document.body` that form, `<input name="attributes">` inside a form makes `form.attributes` that input (a document
 * and a form expose named elements as their own properties, over the built-in ones — DOM clobbering). So nothing here
 * reads a property of a node of the pasted document directly: each property and method is looked up on the node's
 * prototype chain, past anything the node itself carries, and called on the node. The DOM comes in as the nodes
 * themselves (D14): no global of a page is used.
 */

type Descriptor = PropertyDescriptor | undefined;

const lookup = (node: object, name: string): Descriptor => {
  for (let proto = Object.getPrototypeOf(node); proto; proto = Object.getPrototypeOf(proto)) {
    const found = Object.getOwnPropertyDescriptor(proto, name);
    if (found) return found;
  }
  return undefined;
};

/** The built-in property `name` of `node` (a getter's value, or a method unbound), never a named element. */
export const prop = <T>(node: object, name: string): T => {
  const found = lookup(node, name);
  if (!found) return undefined as T;
  return (found.get ? found.get.call(node) : found.value) as T;
};

/** Sets the built-in property `name` of `node` through its setter. */
export const assign = (node: object, name: string, value: unknown): void => {
  const found = lookup(node, name);
  if (!found?.set) throw new TypeError(`${name} has no setter`);
  found.set.call(node, value);
};

/** Calls the built-in method `name` of `node`. */
export const call = <T>(node: object, name: string, ...args: unknown[]): T => {
  const method = prop<(...a: unknown[]) => T>(node, name);
  return method.apply(node, args);
};

export const HTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS = 'http://www.w3.org/2000/svg';

export const localName = (el: Element): string => prop<string>(el, 'localName');
export const namespace = (el: Element): string | null => prop<string | null>(el, 'namespaceURI');
export const attr = (el: Element, name: string): string | null => call<string | null>(el, 'getAttribute', name);
export const setAttr = (el: Element, name: string, value: string): void => call(el, 'setAttribute', name, value);
export const removeAttr = (el: Element, name: string): void => call(el, 'removeAttribute', name);
export const attributes = (el: Element): Attr[] => Array.from(prop<NamedNodeMap>(el, 'attributes'));
export const parentOf = (node: Node): Node | null => prop<Node | null>(node, 'parentNode');
export const childNodes = (node: Node): ChildNode[] => Array.from(prop<NodeListOf<ChildNode>>(node, 'childNodes'));
export const textOf = (node: Node): string => prop<string | null>(node, 'textContent') ?? '';
export const remove = (node: ChildNode): void => call(node, 'remove');
export const isConnected = (node: Node): boolean => prop<boolean>(node, 'isConnected');
