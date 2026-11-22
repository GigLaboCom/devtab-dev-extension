/** docs/tools/specs/qr.md §5.3 and its rows of §10: the `WIFI:` string, its escaping, and parsing it back. */
import { escapeWifi, maskWifiPassword, parseWifi, wifiNotes, wifiString } from './index';
import { describe, expect, it } from 'vitest';
import type { WifiDetails } from './index';

const wifi = (d: Partial<WifiDetails>): WifiDetails => ({
  ssid: '',
  password: '',
  security: 'wpa',
  hidden: false,
  ...d,
});

describe('§10: the Wi-Fi string', () => {
  it.each([
    [wifi({ ssid: 'Home', password: 'secret123' }), 'WIFI:T:WPA;S:Home;P:secret123;;'],
    [
      wifi({ ssid: 'my;net', password: 'p@ss:word\\1', hidden: true }),
      'WIFI:T:WPA;S:my\\;net;P:p@ss\\:word\\\\1;H:true;;',
    ],
    [wifi({ ssid: 'Cafe "Free"', security: 'none', password: 'ignored' }), 'WIFI:T:nopass;S:Cafe \\"Free\\";;'],
    [wifi({ ssid: 'Old,One', password: 'abc', security: 'wep' }), 'WIFI:T:WEP;S:Old\\,One;P:abc;;'],
  ])('%o → %s', (details, expected) => {
    expect(wifiString(details)).toBe(expected);
  });

  it('parseWifi gives the fields back (security as written: WPA, nopass, WEP)', () => {
    expect(parseWifi('WIFI:T:WPA;S:Home;P:secret123;;')).toEqual({
      ssid: 'Home',
      security: 'WPA',
      password: 'secret123',
      hidden: false,
    });
    expect(parseWifi('WIFI:T:WPA;S:my\\;net;P:p@ss\\:word\\\\1;H:true;;')).toEqual({
      ssid: 'my;net',
      security: 'WPA',
      password: 'p@ss:word\\1',
      hidden: true,
    });
    expect(parseWifi('WIFI:T:nopass;S:Cafe \\"Free\\";;')).toEqual({
      ssid: 'Cafe "Free"',
      security: 'nopass',
      password: '',
      hidden: false,
    });
    expect(parseWifi('WIFI:T:WEP;S:Old\\,One;P:abc;;')).toEqual({
      ssid: 'Old,One',
      security: 'WEP',
      password: 'abc',
      hidden: false,
    });
  });

  it('parseWifi of the odd rows: no T is nopass; no S, unterminated or not Wi-Fi is null', () => {
    expect(parseWifi('WIFI:S:x;')).toEqual({ ssid: 'x', security: 'nopass', password: '', hidden: false });
    expect(parseWifi('WIFI:T:WPA;P:x;;')).toBeNull();
    expect(parseWifi('WIFI:T:WPA;S:unterminated')).toBeNull();
    expect(parseWifi('https://example.com/')).toBeNull();
  });
});

describe('§5.3 beyond the rows', () => {
  it('escapes \\ ; , : " — the backslash first', () => {
    expect(escapeWifi('a\\b;c,d:e"f')).toBe('a\\\\b\\;c\\,d\\:e\\"f');
    expect(escapeWifi('\\;')).toBe('\\\\\\;');
  });

  it('an empty password with WPA or WEP keeps an empty P (no field only for None) and says so', () => {
    expect(wifiString(wifi({ ssid: 'Lab' }))).toBe('WIFI:T:WPA;S:Lab;P:;;');
    expect(wifiNotes(wifi({ ssid: 'Lab' }))).toEqual(['No password: choose None if the network is open.']);
    expect(wifiNotes(wifi({ ssid: 'Lab', security: 'none' }))).toEqual([]);
    expect(parseWifi('WIFI:T:WPA;S:Lab;P:;;')).toMatchObject({ password: '' });
  });

  it('a password that looks like hexadecimal: phones take a key-length one as the raw key — said, not changed', () => {
    const psk = 'a'.repeat(32) + '0123456789ABCDEF0123456789abcdef';
    expect(wifiNotes(wifi({ ssid: 'x', password: psk }))).toEqual([
      '64 hexadecimal digits: phones use them as the network’s raw key, not as a passphrase.',
    ]);
    expect(wifiNotes(wifi({ ssid: 'x', password: '0123456789', security: 'wep' }))).toEqual([
      '10 hexadecimal digits: phones use them as the WEP key in hex.',
    ]);
    expect(wifiNotes(wifi({ ssid: 'x', password: 'deadbeef12' }))).toEqual([]);
    // Written as typed: no quotes are added (they would be part of the password for a reader that does not strip them).
    expect(wifiString(wifi({ ssid: 'x', password: psk }))).toBe(`WIFI:T:WPA;S:x;P:${psk};;`);
  });

  it('a WPA passphrase outside 8–63 characters is noted', () => {
    expect(wifiNotes(wifi({ ssid: 'x', password: 'short' }))).toEqual([
      'A WPA passphrase has 8 to 63 characters; phones may refuse to join with this one.',
    ]);
    expect(wifiNotes(wifi({ ssid: 'x', password: 'long enough' }))).toEqual([]);
    expect(wifiNotes(wifi({ ssid: 'x', password: 'x'.repeat(64) }))).toHaveLength(1);
  });

  it('reads a code made elsewhere: fields in any order, ZXing’s quotes, unknown fields, H:false', () => {
    expect(parseWifi('WIFI:S:"ABCD";T:WPA;P:"1234";H:false;;')).toEqual({
      ssid: 'ABCD',
      security: 'WPA',
      password: '1234',
      hidden: false,
    });
    expect(parseWifi('WIFI:T:WPA2-EAP;S:corp;E:PEAP;I:user;P:pw;;')).toMatchObject({
      ssid: 'corp',
      security: 'WPA2-EAP',
      password: 'pw',
    });
    expect(parseWifi('WIFI:T:SAE;S:new;P:longpassword;H:TRUE;;')).toMatchObject({ security: 'SAE', hidden: true });
    // An escaped quote is the name's own character, not ZXing's quoting.
    expect(parseWifi('WIFI:S:\\"q\\";;')).toMatchObject({ ssid: '"q"' });
    expect(parseWifi('WIFI:')).toBeNull();
    expect(parseWifi('WIFI:S:x;garbage')).toBeNull();
    expect(parseWifi('wifi:S:x;;')).toBeNull();
  });
});

describe('masking the password for showing', () => {
  it('masks every P value, escapes and all; leaves the rest and an empty password', () => {
    expect(maskWifiPassword('WIFI:T:WPA;S:my\\;net;P:p@ss\\:word\\\\1;H:true;;')).toBe(
      'WIFI:T:WPA;S:my\\;net;P:••••••••;H:true;;',
    );
    expect(maskWifiPassword('WIFI:T:WPA;S:Lab;P:;;')).toBe('WIFI:T:WPA;S:Lab;P:;;');
    expect(maskWifiPassword('WIFI:T:nopass;S:Cafe;;')).toBe('WIFI:T:nopass;S:Cafe;;');
    expect(maskWifiPassword('WIFI:P:x\\;y;S:a;')).toBe('WIFI:P:••••••••;S:a;');
    expect(maskWifiPassword('https://example.com/')).toBe('https://example.com/');
  });

  it('never leaves the password in what it shows (any password the form can make)', () => {
    for (const password of ['a;b', 'x\\', ':::', '"q"', 'p@ss:word\\1', 'secret123']) {
      const shown = maskWifiPassword(wifiString(wifi({ ssid: 'n', password })));
      expect(shown).toBe('WIFI:T:WPA;S:n;P:••••••••;;');
    }
  });
});
