/**
 * Does pasted text look like an image's data (docs/tools/specs/base64-image.md §7)? Cheap and strict — it decides on
 * its own whether a paste into the start page's field opens this tool: a data: URI of an `image/…` type, or Base64 that
 * starts with the Base64 of an image signature (PNG, JPEG, GIF, WebP, SVG). Anchored patterns, a length bound checked
 * first, and one linear pass over the text.
 */
import { MAX_INPUT_CHARS } from './limits';

const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+(;[^,]*)?,/i;
const SIGNATURE = /^(?:iVBORw0KGgo|\/9j\/|R0lGOD[dl]h|UklGR[A-Za-z0-9+/]{6}XRUJQ|PHN2Zy)/;
const BASE64_AND_SPACES = /^[A-Za-z0-9+/=\s]+$/;

export const detectBase64Image = (text: string): boolean => {
  if (text.length > MAX_INPUT_CHARS) return false;
  const t = text.trim();
  if (DATA_IMAGE.test(t.slice(0, 1024))) return true;
  return t.length >= 16 && SIGNATURE.test(t) && BASE64_AND_SPACES.test(t);
};
