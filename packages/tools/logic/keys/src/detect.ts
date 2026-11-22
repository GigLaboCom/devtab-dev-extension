/**
 * Does pasted text look like a key (docs/tools/specs/keys.md §7)? Cheap and strict, run on a paste into the start
 * page's field: a PEM block whose label ends in KEY (and no certificate — that is the X.509 tool's), an RFC 4716 block,
 * OpenSSH public key lines, or a JSON object with a "kty" member. No parsing beyond line splitting, no regular
 * expression over the whole text, at most DETECT_MAX characters. A private key is recognised too: the start page hands
 * text over in memory (the host's app/handoff.ts) and the tool keeps only public keys.
 */
export const DETECT_MAX = 65_536;

const PEM_KEY = /-----BEGIN [A-Z0-9 ]{0,40}KEY-----/;
const SSH_LINE =
  /^(?:ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-nistp(?:256|384|521)|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)[ \t]+AAAA[A-Za-z0-9+/]+={0,2}(?:[ \t][^\n]*)?$/;

export const detectKeys = (input: string): boolean => {
  if (input.length > DETECT_MAX) return false;
  const text = input.trim();
  if (text === '') return false;
  if (text.includes('-----BEGIN ')) return PEM_KEY.test(text) && !text.includes('-----BEGIN CERTIFICATE-----');
  if (text.startsWith('---- BEGIN SSH2 PUBLIC KEY ----')) return true;
  if (text.startsWith('{')) {
    if (!text.endsWith('}')) return false;
    return /"kty"\s*:/.test(text);
  }
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim() !== '' && !l.trim().startsWith('#'));
  return lines.length > 0 && lines.length <= 1000 && lines.every(l => l.length <= 16_384 && SSH_LINE.test(l.trim()));
};
