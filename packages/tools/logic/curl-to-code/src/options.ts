/**
 * The options of curl 8.7.1 (`curl --help all` on the machine the tool was written on): which take a value, and which
 * of them the tool translates, leaves out on purpose or only names (docs/tools/specs/curl-to-code.md §5, «Параметры
 * `curl`»). An option outside these lists is unknown to curl itself, which refuses the command.
 */

/** Long options that take a value. */
const LONG_VALUE =
  'abstract-unix-socket alt-svc aws-sigv4 cacert capath cert cert-type ciphers config connect-timeout connect-to ' +
  'continue-at cookie cookie-jar create-file-mode crlfile curves data data-ascii data-binary data-raw data-urlencode ' +
  'delegation dns-interface dns-ipv4-addr dns-ipv6-addr dns-servers doh-url dump-header egd-file engine etag-compare ' +
  'etag-save expect100-timeout form form-string ftp-account ftp-alternative-to-user ftp-method ftp-port ' +
  'ftp-ssl-ccc-mode happy-eyeballs-timeout-ms haproxy-clientip header hostpubmd5 hostpubsha256 hsts interface ' +
  'ipfs-gateway json keepalive-time key key-type krb libcurl limit-rate local-port login-options mail-auth mail-from ' +
  'mail-rcpt max-filesize max-redirs max-time netrc-file noproxy oauth2-bearer output output-dir parallel-max pass ' +
  'pinnedpubkey preproxy proto proto-default proto-redir proxy proxy-cacert proxy-capath proxy-cert proxy-cert-type ' +
  'proxy-ciphers proxy-crlfile proxy-header proxy-key proxy-key-type proxy-pass proxy-pinnedpubkey ' +
  'proxy-service-name proxy-tls13-ciphers proxy-tlsauthtype proxy-tlspassword proxy-tlsuser proxy-user proxy1.0 ' +
  'pubkey quote random-file range rate referer request request-target resolve retry retry-delay retry-max-time ' +
  'sasl-authzid service-name socks4 socks4a socks5 socks5-gssapi-service socks5-hostname speed-limit speed-time ' +
  'stderr telnet-option tftp-blksize time-cond tls-max tls13-ciphers tlsauthtype tlspassword tlsuser trace ' +
  'trace-ascii trace-config unix-socket upload-file url url-query user user-agent variable write-out';

/** Long options that take none. */
const LONG_FLAG =
  'anyauth append basic ca-native cert-status compressed compressed-ssh create-dirs crlf digest disable disable-eprt ' +
  'disable-epsv disallow-username-in-url doh-cert-status doh-insecure fail fail-early fail-with-body false-start ' +
  'form-escape ftp-create-dirs ftp-pasv ftp-pret ftp-skip-pasv-ip ftp-ssl-ccc ftp-ssl-control get globoff ' +
  'haproxy-protocol head help http0.9 http1.0 http1.1 http2 http2-prior-knowledge http3 http3-only ' +
  'ignore-content-length include insecure ipv4 ipv6 junk-session-cookies list-only location location-trusted ' +
  'mail-rcpt-allowfails manual metalink negotiate netrc netrc-optional next no-alpn no-buffer no-clobber ' +
  'no-keepalive no-npn no-progress-meter no-sessionid ntlm ntlm-wb parallel parallel-immediate path-as-is post301 ' +
  'post302 post303 progress-bar proxy-anyauth proxy-basic proxy-ca-native proxy-digest proxy-http2 proxy-insecure ' +
  'proxy-negotiate proxy-ntlm proxy-ssl-allow-beast proxy-ssl-auto-client-cert proxy-tlsv1 proxytunnel raw ' +
  'remote-header-name remote-name remote-name-all remote-time remove-on-error retry-all-errors retry-connrefused ' +
  'sasl-ir show-error silent socks5-basic socks5-gssapi socks5-gssapi-nec ssl ssl-allow-beast ' +
  'ssl-auto-client-cert ssl-no-revoke ssl-reqd ssl-revoke-best-effort sslv2 sslv3 styled-output ' +
  'suppress-connect-headers tcp-fastopen tcp-nodelay tftp-no-options tlsv1 tlsv1.0 tlsv1.1 tlsv1.2 tlsv1.3 ' +
  'tr-encoding trace-ids trace-time use-ascii verbose version xattr';

/** Short options and their long names. */
const SHORT: Readonly<Record<string, string>> = {
  A: 'user-agent',
  b: 'cookie',
  c: 'cookie-jar',
  C: 'continue-at',
  d: 'data',
  D: 'dump-header',
  e: 'referer',
  E: 'cert',
  F: 'form',
  H: 'header',
  K: 'config',
  m: 'max-time',
  o: 'output',
  P: 'ftp-port',
  Q: 'quote',
  r: 'range',
  t: 'telnet-option',
  T: 'upload-file',
  u: 'user',
  U: 'proxy-user',
  w: 'write-out',
  x: 'proxy',
  X: 'request',
  y: 'speed-time',
  Y: 'speed-limit',
  z: 'time-cond',
  '#': 'progress-bar',
  '0': 'http1.0',
  '1': 'tlsv1',
  '2': 'sslv2',
  '3': 'sslv3',
  '4': 'ipv4',
  '6': 'ipv6',
  ':': 'next',
  B: 'use-ascii',
  G: 'get',
  I: 'head',
  J: 'remote-header-name',
  L: 'location',
  M: 'manual',
  N: 'no-buffer',
  O: 'remote-name',
  R: 'remote-time',
  S: 'show-error',
  V: 'version',
  Z: 'parallel',
  a: 'append',
  f: 'fail',
  g: 'globoff',
  h: 'help',
  i: 'include',
  j: 'junk-session-cookies',
  k: 'insecure',
  l: 'list-only',
  n: 'netrc',
  p: 'proxytunnel',
  q: 'disable',
  s: 'silent',
  v: 'verbose',
};

const VALUE = new Set(LONG_VALUE.split(' '));
const FLAG = new Set(LONG_FLAG.split(' '));

/**
 * No code and no warning (§5): they change only what curl itself prints or how it talks, or what every client does
 * anyway — decompressing (`--compressed`) and following redirects (`-L`).
 */
const SILENT = new Set(
  (
    'silent show-error verbose include remote-name fail fail-with-body progress-bar no-progress-meter http1.0 ' +
    'http1.1 http2 globoff no-buffer raw compressed-ssh output write-out dump-header trace trace-ascii stderr ' +
    'compressed location location-trusted basic disable'
  ).split(' '),
);

/** The options the tool translates (parse.ts). */
export const TRANSLATED = new Set(
  (
    'url request header data data-ascii data-binary data-raw data-urlencode json form form-string get head user ' +
    'oauth2-bearer cookie user-agent referer insecure max-time upload-file'
  ).split(' '),
);

export interface OptionInfo {
  /** The long name, without dashes. */
  name: string;
  value: boolean;
  /** 'translated' — parse.ts handles it; 'silent' — no code, no warning; 'ignored' — named in a warning. */
  role: 'translated' | 'silent' | 'ignored';
}

const roleOf = (name: string): OptionInfo['role'] =>
  TRANSLATED.has(name) ? 'translated' : SILENT.has(name) ? 'silent' : 'ignored';

/** A long option by its name (without the dashes), or undefined when curl does not know it. */
export const longOption = (name: string): OptionInfo | undefined => {
  // Every `--no-…` (§5): turns a flag off (`--no-silent`) or is a flag of its own (`--no-keepalive`); no code.
  if (name.startsWith('no-') && (FLAG.has(name) || FLAG.has(name.slice(3))))
    return { name, value: false, role: 'silent' };
  if (VALUE.has(name) || FLAG.has(name)) return { name, value: VALUE.has(name), role: roleOf(name) };
  // curl 8.3+ also reads `--expand-<option>` (variables in its value).
  if (name.startsWith('expand-') && (VALUE.has(name.slice(7)) || FLAG.has(name.slice(7))))
    return { name, value: VALUE.has(name.slice(7)), role: 'ignored' };
  return undefined;
};

/** A short option by its letter, or undefined when curl does not know it. */
export const shortOption = (letter: string): OptionInfo | undefined => {
  const name = SHORT[letter];
  return name === undefined ? undefined : longOption(name);
};
