/**
 * Reading a parsed document that came from someone else's markup. Markup can name elements over built-in properties:
 * inside `<form>`, `<input name="firstChild">` makes `form.firstChild` that input, and `<img name="body">` can stand
 * for `document.body` (DOM clobbering — forms and documents expose named elements over their own properties). So
 * nothing here reads a property of a node directly: each is looked up on the node's prototype chain, past anything the
 * node itself carries, and the getter is called on the node. Lookups are cached per prototype. The DOM comes in as
 * nodes (D14): no global of a page is used, and nothing here changes a node or reads `style` through the CSSOM.
 */

const cache = new WeakMap<object, Map<string, PropertyDescriptor | null>>();

const descriptor = (node: object, name: string): PropertyDescriptor | null => {
  const proto = Object.getPrototypeOf(node) as object | null;
  if (proto === null) return null;
  let names = cache.get(proto);
  if (!names) {
    names = new Map();
    cache.set(proto, names);
  }
  let found = names.get(name);
  if (found === undefined) {
    found = null;
    for (let p: object | null = proto; p; p = Object.getPrototypeOf(p) as object | null) {
      const own = Object.getOwnPropertyDescriptor(p, name);
      if (own) {
        found = own;
        break;
      }
    }
    names.set(name, found);
  }
  return found;
};

/** The built-in property `name` of `node` — never a named element standing in for it. */
const read = <T>(node: object, name: string): T => {
  const found = descriptor(node, name);
  return (found?.get ? found.get.call(node) : found?.value) as T;
};

export const ELEMENT = 1;
export const TEXT = 3;
export const CDATA = 4;
export const COMMENT = 8;

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const nodeType = (node: Node): number => read<number>(node, 'nodeType');
export const firstChild = (node: Node): Node | null => read<Node | null>(node, 'firstChild');
export const nextSibling = (node: Node): Node | null => read<Node | null>(node, 'nextSibling');
export const localName = (element: Element): string => read<string>(element, 'localName');
export const namespaceOf = (element: Element): string | null => read<string | null>(element, 'namespaceURI');
/** A text node's or a comment's characters. */
export const dataOf = (node: Node): string => read<string>(node, 'data');
/** Every text inside, in order (script and style contents, an option's label, a textarea's value). */
export const textContentOf = (node: Node): string => read<string | null>(node, 'textContent') ?? '';
export const templateContent = (element: Element): DocumentFragment | null =>
  read<DocumentFragment | null>(element, 'content') ?? null;
export const bodyOf = (document: Document): HTMLElement | null => read<HTMLElement | null>(document, 'body');
export const documentElementOf = (document: Document): Element | null =>
  read<Element | null>(document, 'documentElement');

/** The element's attributes in source order, as `[name, value]` (qualified names: `xlink:href`). */
export const attributesOf = (element: Element): Array<[string, string]> => {
  const map = read<NamedNodeMap>(element, 'attributes');
  const length = read<number>(map, 'length');
  const out: Array<[string, string]> = [];
  for (let i = 0; i < length; i++) {
    const attribute = map[i]!;
    out.push([read<string>(attribute, 'name'), read<string>(attribute, 'value')]);
  }
  return out;
};
