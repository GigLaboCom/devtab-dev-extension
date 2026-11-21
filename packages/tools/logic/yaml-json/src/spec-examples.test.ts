/**
 * Examples of the YAML 1.2.2 specification (chapter 2, "Language Overview", and §10.3, the core schema) through
 * YAML → JSON: what the tool makes of the specification's own documents, including the ones JSON cannot hold.
 */
import { yamlToJson } from './convert';
import { describe, expect, it } from 'vitest';
import type { ConvertResult } from './types';

const y2j = (text: string, version: '1.1' | '1.2' = '1.2'): ConvertResult =>
  yamlToJson(text, { version, layout: 'minify' });
const text = (r: ConvertResult): string => (r.ok ? r.text : `${r.error.line}:${r.error.column} ${r.error.message}`);

describe('YAML 1.2.2, chapter 2', () => {
  it('Example 2.1 sequence of scalars', () => {
    expect(text(y2j('- Mark McGwire\n- Sammy Sosa\n- Ken Griffey\n'))).toBe(
      '["Mark McGwire","Sammy Sosa","Ken Griffey"]',
    );
  });

  it('Example 2.2 mapping scalars to scalars (comments dropped)', () => {
    expect(text(y2j('hr:  65    # Home runs\navg: 0.278 # Batting average\nrbi: 147   # Runs Batted In\n'))).toBe(
      '{"hr":65,"avg":0.278,"rbi":147}',
    );
  });

  it('Example 2.4 sequence of mappings', () => {
    expect(
      text(
        y2j('-\n  name: Mark McGwire\n  hr:   65\n  avg:  0.278\n-\n  name: Sammy Sosa\n  hr:   63\n  avg:  0.288\n'),
      ),
    ).toBe('[{"name":"Mark McGwire","hr":65,"avg":0.278},{"name":"Sammy Sosa","hr":63,"avg":0.288}]');
  });

  it('Example 2.6 mapping of mappings (flow)', () => {
    expect(text(y2j('Mark McGwire: {hr: 65, avg: 0.278}\nSammy Sosa: {\n    hr: 63,\n    avg: 0.288,\n }\n'))).toBe(
      '{"Mark McGwire":{"hr":65,"avg":0.278},"Sammy Sosa":{"hr":63,"avg":0.288}}',
    );
  });

  it('Example 2.7 two documents in a stream', () => {
    const r = y2j(
      '# Ranking of 1998 home runs\n---\n- Mark McGwire\n- Sammy Sosa\n- Ken Griffey\n\n# Team ranking\n---\n- Chicago Cubs\n- St Louis Cardinals\n',
    );
    expect(text(r)).toBe('[["Mark McGwire","Sammy Sosa","Ken Griffey"],["Chicago Cubs","St Louis Cardinals"]]');
  });

  it('Example 2.10 a node appears twice (anchor and alias)', () => {
    expect(
      text(
        y2j(
          '---\nhr:\n- Mark McGwire\n# Following node labeled SS\n- &SS Sammy Sosa\nrbi:\n- *SS # Subsequent occurrence\n- Ken Griffey\n',
        ),
      ),
    ).toBe('{"hr":["Mark McGwire","Sammy Sosa"],"rbi":["Sammy Sosa","Ken Griffey"]}');
  });

  it('Example 2.11 mapping between sequences: keys JSON cannot have', () => {
    expect(
      text(
        y2j(
          '? - Detroit Tigers\n  - Chicago cubs\n: - 2001-07-23\n\n? [ New York Yankees,\n    Atlanta Braves ]\n: [ 2001-07-02, 2001-08-12,\n    2001-08-14 ]\n',
        ),
      ),
    ).toBe('1:3 a key that is a mapping or a sequence has no JSON equivalent');
  });

  it('Example 2.12 compact nested mapping', () => {
    expect(
      text(
        y2j(
          '---\n# Products purchased\n- item    : Super Hoop\n  quantity: 1\n- item    : Basketball\n  quantity: 4\n',
        ),
      ),
    ).toBe('[{"item":"Super Hoop","quantity":1},{"item":"Basketball","quantity":4}]');
  });

  it('Example 2.13–2.16 block scalars', () => {
    expect(text(y2j('# ASCII Art\n--- |\n  \\//||\\/||\n  // ||  ||__\n'))).toBe('"\\\\//||\\\\/||\\n// ||  ||__\\n"');
    expect(text(y2j(">\n Mark McGwire's\n year was crippled\n by a knee injury.\n"))).toBe(
      '"Mark McGwire\'s year was crippled by a knee injury.\\n"',
    );
  });

  it('Example 2.17 quoted scalars', () => {
    expect(
      text(
        y2j(
          "unicode: \"Sosa did fine.\\u263A\"\ncontrol: \"\\b1998\\t1999\\t2000\\n\"\nhex esc: \"\\x0d\\x0a is \\r\\n\"\n\nsingle: '\"Howdy!\" he cried.'\nquoted: ' # Not a ''comment''.'\ntie-fighter: '|\\-*-/|'\n",
        ),
      ),
    ).toBe(
      '{"unicode":"Sosa did fine.☺","control":"\\b1998\\t1999\\t2000\\n","hex esc":"\\r\\n is \\r\\n","single":"\\"Howdy!\\" he cried.","quoted":" # Not a \'comment\'.","tie-fighter":"|\\\\-*-/|"}',
    );
  });

  it('Example 2.19 integers', () => {
    expect(text(y2j('canonical: 12345\ndecimal: +12345\noctal: 0o14\nhexadecimal: 0xC\n'))).toBe(
      '{"canonical":12345,"decimal":12345,"octal":12,"hexadecimal":12}',
    );
  });

  it('Example 2.20 floating point: JSON has no -.inf', () => {
    expect(
      text(
        y2j(
          'canonical: 1.23015e+3\nexponential: 12.3015e+02\nfixed: 1230.15\nnegative infinity: -.inf\nnot a number: .nan\n',
        ),
      ),
    ).toBe('4:20 -.inf has no JSON equivalent: JSON numbers are finite (RFC 8259 §6)');
    expect(text(y2j('canonical: 1.23015e+3\nexponential: 12.3015e+02\nfixed: 1230.15\n'))).toBe(
      '{"canonical":1.23015e+3,"exponential":12.3015e+02,"fixed":1230.15}',
    );
  });

  it('Example 2.21 miscellaneous', () => {
    expect(text(y2j("null:\nbooleans: [ true, false ]\nstring: '012345'\n"))).toBe(
      '{"null":null,"booleans":[true,false],"string":"012345"}',
    );
  });

  it('Example 2.22 timestamps stay as written', () => {
    expect(
      text(
        y2j(
          'canonical: 2001-12-15T02:59:43.1Z\niso8601: 2001-12-14t21:59:43.10-05:00\nspaced: 2001-12-14 21:59:43.10 -5\ndate: 2002-12-14\n',
          '1.1',
        ),
      ),
    ).toBe(
      '{"canonical":"2001-12-15T02:59:43.1Z","iso8601":"2001-12-14t21:59:43.10-05:00","spaced":"2001-12-14 21:59:43.10 -5","date":"2002-12-14"}',
    );
  });

  it('Example 2.23 various explicit tags', () => {
    const r = y2j(
      '---\nnot-date: !!str 2002-04-28\n\npicture: !!binary |\n R0lGODlhDAAMAIQAAP//9/X\n 17unp5WZmZgAAAOfn515eXv\n\napplication specific tag: !something |\n The semantics of the tag\n above may be different for\n different documents.\n',
    );
    expect(text(r)).toBe(
      '{"not-date":"2002-04-28","picture":"R0lGODlhDAAMAIQAAP//9/X17unp5WZmZgAAAOfn515eXv","application specific tag":"The semantics of the tag\\nabove may be different for\\ndifferent documents.\\n"}',
    );
    expect(r.ok && r.notes.unknownTags.map(t => `${t.line}:${t.column} ${t.message}`)).toEqual(['8:27 !something']);
  });

  it('Example 2.25 unordered sets (1.1)', () => {
    expect(
      text(
        y2j(
          '# Sets are represented as a\n# Mapping where each key is\n# associated with a null value\n--- !!set\n? Mark McGwire\n? Sammy Sosa\n? Ken Griffey\n',
          '1.1',
        ),
      ),
    ).toBe('{"Mark McGwire":null,"Sammy Sosa":null,"Ken Griffey":null}');
  });

  it('Example 2.26 ordered mappings (1.1)', () => {
    expect(text(y2j('--- !!omap\n- Mark McGwire: 65\n- Sammy Sosa: 63\n- Ken Griffey: 58\n', '1.1'))).toBe(
      '[{"Mark McGwire":65},{"Sammy Sosa":63},{"Ken Griffey":58}]',
    );
  });
});

describe('YAML 1.2.2 §10.3.2, core schema tag resolution', () => {
  it('Example 10.9', () => {
    expect(
      text(
        y2j(
          'A null: null\nAlso a null: # Empty\nNot a null: ""\nBooleans: [ true, True, false, FALSE ]\nIntegers: [ 0, 0o7, 0x3A, -19 ]\nFloats: [ 0., -0.0, .5, +12e03, -2E+05 ]\nAlso floats: [ .inf, -.Inf, +.INF, .NAN ]\n',
        ),
      ),
    ).toBe('7:16 .inf has no JSON equivalent: JSON numbers are finite (RFC 8259 §6)');
    expect(
      text(
        y2j(
          'A null: null\nAlso a null: # Empty\nNot a null: ""\nBooleans: [ true, True, false, FALSE ]\nIntegers: [ 0, 0o7, 0x3A, -19 ]\nFloats: [ 0., -0.0, .5, +12e03, -2E+05 ]\n',
        ),
      ),
    ).toBe(
      '{"A null":null,"Also a null":null,"Not a null":"","Booleans":[true,true,false,false],"Integers":[0,7,58,-19],"Floats":[0.0,-0.0,0.5,12e03,-2E+05]}',
    );
  });
});

describe('YAML 1.2.2 §6.1 and §3.2.1.3', () => {
  it('tabs are not indentation; duplicate keys are an error', () => {
    expect(text(y2j('a:\n\tb: 1'))).toBe('2:1 Tabs are not allowed as indentation');
    expect(text(y2j('{a: 1, a: 2}'))).toBe('1:8 Map keys must be unique');
  });
});
