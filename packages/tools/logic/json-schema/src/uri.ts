/**
 * URI references (RFC 3986 §5.2), our own: `$id` and `$ref` are resolved against a base that may be a `urn:` or a
 * `tag:` URI, which the browser's `URL` refuses as a base for a relative path (docs/tools/specs/json-schema.md §5 п. 7).
 * Nothing here fetches.
 */

interface Parts {
  scheme: string | null;
  authority: string | null;
  path: string;
  query: string | null;
  fragment: string | null;
}

// RFC 3986 appendix B: no nested repetition, linear.
const PARTS = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

const parse = (uri: string): Parts => {
  const m = PARTS.exec(uri)!;
  return {
    scheme: m[1] ?? null,
    authority: m[2] ?? null,
    path: m[3] ?? '',
    query: m[4] ?? null,
    fragment: m[5] ?? null,
  };
};

/** RFC 3986 §5.2.4. */
const removeDotSegments = (path: string): string => {
  let input = path;
  let out = '';
  const dropLast = (): void => {
    out = out.slice(0, Math.max(0, out.lastIndexOf('/')));
  };
  while (input.length > 0) {
    if (input.startsWith('../')) input = input.slice(3);
    else if (input.startsWith('./')) input = input.slice(2);
    else if (input.startsWith('/./')) input = input.slice(2);
    else if (input === '/.') input = '/';
    else if (input.startsWith('/../')) {
      input = input.slice(3);
      dropLast();
    } else if (input === '/..') {
      input = '/';
      dropLast();
    } else if (input === '.' || input === '..') input = '';
    else {
      let j = input.indexOf('/', input.startsWith('/') ? 1 : 0);
      if (j < 0) j = input.length;
      out += input.slice(0, j);
      input = input.slice(j);
    }
  }
  return out;
};

const recompose = (p: Parts): string =>
  (p.scheme !== null ? `${p.scheme}:` : '') +
  (p.authority !== null ? `//${p.authority}` : '') +
  p.path +
  (p.query !== null ? `?${p.query}` : '') +
  (p.fragment !== null ? `#${p.fragment}` : '');

/** The target URI of `ref` against `base` (RFC 3986 §5.2.2, strict). */
export const resolveUri = (ref: string, base: string): string => {
  const r = parse(ref);
  if (r.scheme !== null) return recompose({ ...r, path: removeDotSegments(r.path) });
  const b = parse(base);
  const t: Parts = { scheme: b.scheme, authority: null, path: '', query: null, fragment: r.fragment };
  if (r.authority !== null) {
    t.authority = r.authority;
    t.path = removeDotSegments(r.path);
    t.query = r.query;
  } else {
    t.authority = b.authority;
    if (r.path === '') {
      t.path = b.path;
      t.query = r.query ?? b.query;
    } else {
      if (r.path.startsWith('/')) t.path = removeDotSegments(r.path);
      else {
        // §5.2.3 merge
        const merged =
          b.authority !== null && b.path === '' ? `/${r.path}` : b.path.slice(0, b.path.lastIndexOf('/') + 1) + r.path;
        t.path = removeDotSegments(merged);
      }
      t.query = r.query;
    }
  }
  return recompose(t);
};

/** `base#fragment` → its parts; no `#` → fragment null. */
export const splitFragment = (uri: string): { base: string; fragment: string | null } => {
  const i = uri.indexOf('#');
  return i < 0 ? { base: uri, fragment: null } : { base: uri.slice(0, i), fragment: uri.slice(i + 1) };
};

/** The base every schema without `$id` has: hierarchical, so relative references resolve as file names do. */
export const DEFAULT_BASE = 'file:///schema.json';

/** For people: a URI under the default base is shown as the relative reference it came from. */
export const showUri = (uri: string): string => (uri.startsWith('file:///') ? uri.slice(8) : uri);
