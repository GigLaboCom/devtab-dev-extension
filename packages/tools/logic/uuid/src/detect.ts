/**
 * `detectUuid` (docs/tools/specs/uuid.md §7) in a module of its own: the tool's definition imports it into every host
 * page that lists the tools, so it carries nothing else of the logic (which loads with the tool's component).
 */

const UUID_BODY = '(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})';
const UUID_RE = new RegExp(`^(?:urn:uuid:${UUID_BODY}|\\{${UUID_BODY}\\}|${UUID_BODY})$`, 'i');
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
const UUID_LENGTHS = new Set([32, 34, 36, 38, 41, 45]);

/**
 * Does pasted text look like one UUID or ULID (§7)? The whole text after trimming: a UUID in any notation of §5.6
 * (nil and max too) or a ULID with at least one letter and one digit — so a 26-digit number is not one. Length first,
 * then one regular expression. 32 hex digits (an MD5) count: they cannot be told from a UUID without hyphens.
 */
export const detectUuid = (text: string): boolean => {
  const t = text.trim();
  if (t.length === 26) return ULID_RE.test(t) && /[a-z]/i.test(t) && /\d/.test(t);
  return UUID_LENGTHS.has(t.length) && UUID_RE.test(t);
};
