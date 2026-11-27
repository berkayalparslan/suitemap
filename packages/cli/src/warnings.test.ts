import { describe, expect, it } from 'vitest';
import { reportWarnings, type Io } from './cli.js';

const capture = () => {
  const err: string[] = [];
  const io = { stdout: () => {}, stderr: (t: string) => err.push(t) } as unknown as Io;
  return { io, text: () => err.join('') };
};

const warnings = [
  { code: 'internal-field-unavailable', message: 'a', where: '_tags' },
  { code: 'internal-field-unavailable', message: 'b', where: '_only' },
  { code: 'no-config-file', message: 'c' },
];

describe('reportWarnings', () => {
  it('prints nothing without warnings', () => {
    const { io, text } = capture();
    reportWarnings([], true, io);
    reportWarnings([], false, io);
    expect(text()).toBe('');
  });

  it('prints a per-kind summary by default', () => {
    const { io, text } = capture();
    reportWarnings(warnings, false, io);
    expect(text()).toBe(
      'suitemap: 3 warning(s): 2 internal-field-unavailable, 1 no-config-file (use --verbose to list)\n',
    );
  });

  it('lists every warning with --verbose, including where', () => {
    const { io, text } = capture();
    reportWarnings(warnings, true, io);
    expect(text()).toBe(
      'suitemap: 3 warning(s)\n  [internal-field-unavailable] a (_tags)\n  [internal-field-unavailable] b (_only)\n  [no-config-file] c\n',
    );
  });
});
