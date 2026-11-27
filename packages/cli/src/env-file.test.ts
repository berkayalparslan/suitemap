import { describe, expect, it } from 'vitest';
import { parseEnvFile } from './env-file.js';

describe('parseEnvFile', () => {
  it('parses plain, exported, quoted and commented lines', () => {
    const env = parseEnvFile(
      ['# comment', '', 'A=1', 'export B = two # trailing', 'C="x y\\n#z"', "D='$A'"].join('\n'),
    );
    expect(env).toEqual({ A: '1', B: 'two', C: 'x y\n#z', D: '$A' });
  });

  it('names the line but never echoes its content', () => {
    expect(() => parseEnvFile('A=1\nsecret-without-equals')).toThrow(/line 2/);
    expect(() => parseEnvFile('A=1\nsecret-without-equals')).not.toThrow(/secret/);
    expect(() => parseEnvFile('K="hunter2')).toThrow(/unterminated/);
    expect(() => parseEnvFile('K="hunter2')).not.toThrow(/hunter2/);
  });
});
