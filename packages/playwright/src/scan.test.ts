import { describe, expect, it } from 'vitest';
import { MAX_EXCERPT, scanFunctionBody, scanModifierCallback, type Finding } from './scan.js';

const body = (src: string): Finding[] => {
  const r = scanFunctionBody(src);
  if (!r.ok) throw new Error(r.error);
  return r.findings;
};
const cb = (src: string): Finding => {
  const r = scanModifierCallback(src);
  if (!r.ok) throw new Error(r.error);
  return r.findings[0]!;
};

describe('scanFunctionBody: what counts as a conditional', () => {
  it('matches by shape: Babel member receivers, plain `test`, any module alias', () => {
    for (const recv of ['test', '_test.test', '_fixtures.test', '_a.b.test'])
      expect(body(`async () => { ${recv}.skip(); }`)).toMatchObject([
        { type: 'skip', via: 'call' },
      ]);
  });

  it('ignores calls on other receivers and non-modifier members', () => {
    expect(
      body(
        `async () => { assert.fail('x'); expect.skip(); _test.test.step('s', async () => {}); array.slow(); }`,
      ),
    ).toEqual([]);
  });

  it('reads all four types, unconditional and conditional', () => {
    const f = body(`async ({ browserName }) => {
      test.skip(); test.fixme(); test.fail(); test.slow();
      test.skip(browserName === 'webkit', 'why');
    }`);
    expect(f.map((x) => x.type)).toEqual(['skip', 'fixme', 'fail', 'slow', 'skip']);
    expect(f.slice(0, 4).every((x) => x.confidence === 'static' && x.condition === undefined)).toBe(
      true,
    );
    expect(f[4]).toMatchObject({
      condition: "browserName === 'webkit'",
      refs: ['browserName'],
      reason: 'why',
    });
  });

  it('treats a lone string argument as the reason, not a condition', () => {
    expect(body(`async () => { test.skip('not ready'); }`)).toMatchObject([
      { reason: 'not ready', confidence: 'static' },
    ]);
    expect(body(`async () => { test.skip('not ready'); }`)[0]!.condition).toBeUndefined();
  });

  it('ignores the (title, fn) declaration shape', () => {
    expect(body(`async () => { test.skip('title', async () => {}); }`)).toEqual([]);
  });

  it('reads testInfo.<modifier> and test.info().<modifier>', () => {
    const f = body(`async ({}, testInfo) => { testInfo.skip(true); test.info().fixme(); }`);
    expect(f.map((x) => [x.type, x.confidence])).toEqual([
      ['skip', 'static'],
      ['fixme', 'static'],
    ]);
  });

  it('does not treat other receivers or helper(testInfo) as conditionals', () => {
    expect(body(`async ({}, testInfo) => { other.skip(); }`)).toEqual([]);
    expect(body(`async ({}, testInfo) => { attachLogs(testInfo); }`)).toEqual([]);
  });

  it('finds calls inside nested functions (test.step)', () => {
    expect(
      body(`async () => { await _test.test.step('s', async () => { _test.test.slow(); }); }`),
    ).toMatchObject([{ type: 'slow', confidence: 'static' }]);
  });
});

describe('scanFunctionBody: confidence', () => {
  it('static: literal, fixtures and testInfo.project.*', () => {
    expect(body(`async () => { test.skip(true); }`)[0]).toMatchObject({
      confidence: 'static',
      condition: 'true',
    });
    expect(
      body(
        `async ({ isMobile, browserName }) => { test.skip(isMobile && browserName === 'x'); }`,
      )[0],
    ).toMatchObject({
      confidence: 'static',
      refs: ['isMobile', 'browserName'],
    });
    expect(body(`async ({}, t) => { test.slow(t.project.name === 'a'); }`)[0]).toMatchObject({
      confidence: 'static',
      refs: ['project.name'],
      projectCompare: { value: 'a', negated: false },
    });
  });

  it('inferred: env vars, other testInfo fields, free identifiers', () => {
    expect(body(`async () => { test.skip(process.env.CI === 'true'); }`)[0]).toMatchObject({
      confidence: 'inferred',
      refs: ['process.env.CI'],
    });
    expect(body(`async () => { test.skip(process.env[name]); }`)[0]).toMatchObject({
      confidence: 'inferred',
      refs: ['process.env', 'name'],
    });
    expect(body(`async ({}, t) => { test.skip(t.retry > 0); }`)[0]).toMatchObject({
      confidence: 'inferred',
      refs: ['retry'],
    });
    expect(body(`async () => { test.skip(_cfg.isCI); }`)[0]).toMatchObject({
      confidence: 'inferred',
      refs: ['_cfg.isCI'],
    });
  });

  it('opaque: helper calls, awaits, nested functions, and a call inside the condition', () => {
    expect(body(`async () => { test.skip(isCI()); }`)[0]).toMatchObject({
      confidence: 'opaque',
      refs: ['isCI'],
    });
    expect(body(`async () => { test.skip(await flag()); }`)[0]!.confidence).toBe('opaque');
    expect(body(`async () => { test.skip(list.some((x) => x)); }`)[0]!.confidence).toBe('opaque');
  });

  it('a method of a fixture is understood', () => {
    expect(
      body(`async ({ browserName }) => { test.skip(browserName.startsWith('c')); }`)[0],
    ).toMatchObject({
      confidence: 'static',
      refs: ['browserName'],
    });
  });

  it('helper(test) is opaque, type unknown, with the call as excerpt', () => {
    expect(body(`async () => { skipOnCI(_test.test); }`)).toEqual([
      {
        type: 'unknown',
        via: 'helper',
        condition: 'skipOnCI(_test.test)',
        refs: ['skipOnCI'],
        confidence: 'opaque',
      },
    ]);
  });

  it('early return or throw before the call makes it opaque, but not one after it', () => {
    expect(body(`async ({ b }) => { if (b) return; test.skip(true); }`)[0]!.confidence).toBe(
      'opaque',
    );
    expect(
      body(`async ({ b }) => { if (b) throw new Error('x'); test.skip(true); }`)[0]!.confidence,
    ).toBe('opaque');
    expect(body(`async ({ b }) => { test.skip(true); if (b) return; }`)[0]!.confidence).toBe(
      'static',
    );
  });

  it('a return inside a nested function does not count', () => {
    expect(
      body(`async () => { [1].forEach(() => { return; }); test.skip(true); }`)[0]!.confidence,
    ).toBe('static');
  });

  it('guards: if / else / ternary / && are folded into the condition', () => {
    expect(
      body(`async ({ b }) => { if (b === 1) { test.skip(); } else { test.fixme(); } }`).map(
        (f) => f.condition,
      ),
    ).toEqual(['b === 1', '!(b === 1)']);
    expect(body(`async ({ b }) => { b && test.skip(); }`)[0]).toMatchObject({
      condition: 'b',
      confidence: 'static',
    });
    expect(body(`async () => { if (process.env.A) { test.skip(); } }`)[0]).toMatchObject({
      condition: 'process.env.A',
      confidence: 'inferred',
    });
    expect(body(`async ({ b }) => { if (b) { test.skip(b === 2); } }`)[0]).toMatchObject({
      condition: 'b && b === 2',
    });
  });

  it('loops, switch and try make the call opaque', () => {
    expect(body(`async () => { for (const x of xs) { test.skip(); } }`)[0]!.confidence).toBe(
      'opaque',
    );
    expect(body(`async () => { try { test.skip(); } catch {} }`)[0]!.confidence).toBe('opaque');
  });

  it('only projectCompare for a plain, unguarded project.name comparison', () => {
    expect(
      body(`async ({}, t) => { test.skip(t.project.name !== 'a'); }`)[0]!.projectCompare,
    ).toEqual({ value: 'a', negated: true });
    expect(
      body(`async ({}, t) => { test.skip('a' === t.project.name); }`)[0]!.projectCompare,
    ).toEqual({ value: 'a', negated: false });
    expect(
      body(`async ({}, t) => { if (x) { test.skip(t.project.name === 'a'); } }`)[0]!.projectCompare,
    ).toBeUndefined();
    expect(
      body(`async ({}, t) => { test.skip(t.project.name === 'a' || y); }`)[0]!.projectCompare,
    ).toBeUndefined();
  });
});

describe('scanFunctionBody: runtime annotations', () => {
  it('literal type: static, with description as reason', () => {
    expect(
      body(
        `async () => { _test.test.info().annotations.push({ type: 'issue', description: 'X-1' }); }`,
      ),
    ).toEqual([
      { type: 'issue', via: 'runtime-push', refs: [], reason: 'X-1', confidence: 'static' },
    ]);
  });

  it('works through a testInfo parameter and a template literal type', () => {
    expect(body('async ({}, ti) => { ti.annotations.push({ type: `owner` }); }')[0]).toMatchObject({
      type: 'owner',
      confidence: 'static',
    });
  });

  it('computed type, or a non-literal argument: type unknown, opaque', () => {
    expect(body(`async () => { test.info().annotations.push({ type: kind }); }`)[0]).toMatchObject({
      type: 'unknown',
      refs: ['kind'],
      confidence: 'opaque',
    });
    expect(body(`async () => { test.info().annotations.push(annotation); }`)[0]).toMatchObject({
      type: 'unknown',
      confidence: 'opaque',
    });
  });

  it('inside a condition it carries the condition', () => {
    expect(
      body(`async () => { if (process.env.CI) test.info().annotations.push({ type: 'ci' }); }`)[0],
    ).toMatchObject({ type: 'ci', condition: 'process.env.CI', confidence: 'inferred' });
  });

  it('push on other arrays is ignored', () => {
    expect(body(`async () => { other.annotations.push({ type: 'a' }); list.push(1); }`)).toEqual(
      [],
    );
  });
});

describe('scanModifierCallback', () => {
  it('reads an expression body', () => {
    expect(cb(`({\n  browserName\n}) => browserName === 'firefox'`)).toMatchObject({
      condition: "browserName === 'firefox'",
      refs: ['browserName'],
      confidence: 'static',
    });
  });

  it('reads a single return statement', () => {
    expect(cb(`function ({ isMobile }) { return !isMobile; }`)).toMatchObject({
      condition: '!isMobile',
      confidence: 'static',
    });
  });

  it('is opaque, without a condition, for a multi-statement body', () => {
    expect(cb(`({ a }) => { const x = a; return x; }`)).toMatchObject({ confidence: 'opaque' });
    expect(cb(`({ a }) => { const x = a; return x; }`).condition).toBeUndefined();
  });

  it('env var and free identifier conditions are inferred', () => {
    expect(cb(`() => !!process.env.CI`)).toMatchObject({
      confidence: 'inferred',
      refs: ['process.env.CI'],
    });
    expect(cb(`() => isCI`)).toMatchObject({ confidence: 'inferred', refs: ['isCI'] });
  });
});

describe('excerpts and parse failures', () => {
  it('collapses whitespace and limits length', () => {
    const long = `'${'x'.repeat(500)}'`;
    const f = body(`async () => { test.skip(  a   ===\n ${long}); }`)[0]!;
    expect(f.condition!.length).toBe(MAX_EXCERPT);
    expect(f.condition!.endsWith('…')).toBe(true);
    expect(f.condition!.startsWith('a === ')).toBe(true);
  });

  it('never evaluates: a source with side effects is only parsed', () => {
    (globalThis as { __ran?: boolean }).__ran = false;
    body(`async () => { globalThis.__ran = true; test.skip(globalThis.__ran); }`);
    expect((globalThis as { __ran?: boolean }).__ran).toBe(false);
  });

  it.each(['not javascript {{', 'async () => {', 'a; b', '1 + 1'])(
    'reports an error for %j',
    (src) => {
      expect(scanFunctionBody(src).ok).toBe(false);
      expect(scanModifierCallback(src).ok).toBe(false);
    },
  );
});
