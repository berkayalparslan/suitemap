import { describe, expect, it } from 'vitest';
import { parseEnvFile } from './env-file.js';

describe('parseEnvFile', () => {
  it('parses plain, exported, quoted and commented lines', () => {
    const env = parseEnvFile(
      ['# comment', '', 'A=1', 'export B = two # trailing', 'C="x y\\n#z"', "D='$A'"].join('\n'),
    );
    expect(env).toEqual({ A: '1', B: 'two', C: 'x y\n#z', D: '$A' });
  });

  it('decodes escapes in one pass and treats a leading # as a comment', () => {
    expect(parseEnvFile('P="C:\\\\new"\nQ=   # fill me in\nR="a\\"b" # note')).toEqual({
      P: 'C:\\new',
      Q: '',
      R: 'a"b',
    });
  });

  it('keeps __proto__ as a plain own key', () => {
    const env = parseEnvFile('__proto__=x');
    expect(Object.keys(env)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(env)).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('rejects text after a closing quote without echoing it', () => {
    expect(() => parseEnvFile('A="ab"hunter2')).toThrow(/line 1 has text after/);
    expect(() => parseEnvFile('A="ab"hunter2')).not.toThrow(/hunter2/);
  });

  it('names the line but never echoes its content', () => {
    expect(() => parseEnvFile('A=1\nsecret-without-equals')).toThrow(/line 2/);
    expect(() => parseEnvFile('A=1\nsecret-without-equals')).not.toThrow(/secret/);
    expect(() => parseEnvFile('K="hunter2')).toThrow(/unterminated/);
    expect(() => parseEnvFile('K="hunter2')).not.toThrow(/hunter2/);
  });
});
