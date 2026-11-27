// Static scan of the function sources Playwright holds (test bodies, hooks and suite-level modifier
// callbacks; read by internals.ts) for conditional modifiers and runtime annotations (ADR 0004, ADR 0008).
//
// Pure: source text in, findings out. It never evaluates anything and never reads environment values.
// The sources are Babel-transformed (`test` is usually `_test.test`), so calls are matched by shape:
// a member call named skip/fixme/fail/slow whose receiver looks like the test object or a TestInfo.
import { parse } from 'acorn';

export type Confidence = 'static' | 'inferred' | 'opaque';

/** Reserved `Conditional.type` for a type that is computed at runtime (ADR 0008). */
export const UNKNOWN_TYPE = 'unknown';

export interface Finding {
  /** 'skip' | 'fixme' | 'fail' | 'slow' | a literal annotation type | UNKNOWN_TYPE. */
  type: string;
  /** `runtime-push` for `annotations.push(...)`, `call` for a modifier call, `helper` for an opaque helper call. */
  via: 'call' | 'runtime-push' | 'helper';
  condition?: string;
  refs: string[];
  reason?: string;
  confidence: Confidence;
  /** Set for a plain `project.name === 'x'` / `!==` condition (the only form resolved to projects). */
  projectCompare?: { value: string; negated: boolean };
}

export type ScanResult = { ok: true; findings: Finding[] } | { ok: false; error: string };

export const MAX_EXCERPT = 200;
const MODIFIERS = new Set(['skip', 'fixme', 'fail', 'slow']);
const RANK: Record<Confidence, number> = { static: 0, inferred: 1, opaque: 2 };
const worst = (a: Confidence, b: Confidence): Confidence => (RANK[a] >= RANK[b] ? a : b);

// Loose ESTree node: acorn's own types do not describe node fields.
interface N {
  type: string;
  start: number;
  end: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Parses a function's `toString()` (arrow, function expression or async variants) as an expression. */
function parseFunction(source: string): { wrapped: string; fn: N } {
  const wrapped = `(${source}\n)`;
  const program = parse(wrapped, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as N;
  const stmt = program.body[0] as N | undefined;
  const expr = stmt?.type === 'ExpressionStatement' ? (stmt.expression as N) : undefined;
  if (
    !expr ||
    (expr.type !== 'ArrowFunctionExpression' && expr.type !== 'FunctionExpression') ||
    program.body.length !== 1
  )
    throw new Error('source is not a single function expression');
  return { wrapped, fn: expr };
}

/** Trimmed, whitespace-collapsed, length-limited source excerpt. */
export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_EXCERPT ? `${flat.slice(0, MAX_EXCERPT - 1)}…` : flat;
}

const isNode = (v: unknown): v is N =>
  typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

function children(node: N): N[] {
  const out: N[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) for (const v of value) if (isNode(v)) out.push(v);
    if (isNode(value)) out.push(value);
  }
  return out;
}

const isFunction = (n: N) =>
  n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression';

/** Dotted path of a plain identifier / non-computed member chain, else undefined. */
function dotted(n: N): string[] | undefined {
  if (n.type === 'Identifier') return [n.name as string];
  if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
    const base = dotted(n.object as N);
    return base && [...base, n.property.name as string];
  }
  return undefined;
}

/** What the root function's parameters make known. */
interface Env {
  fixtures: Set<string>;
  /** Name of the TestInfo parameter (2nd parameter of a test or hook function). */
  testInfo?: string;
}

function envOf(fn: N): Env {
  const params = fn.params as N[];
  const fixtures = new Set<string>();
  const first = params[0];
  if (first?.type === 'ObjectPattern')
    for (const p of first.properties as N[]) {
      if (p.type === 'Property' && !p.computed && p.key.type === 'Identifier')
        fixtures.add(p.key.name as string);
      else if (p.type === 'Property' && p.key.type === 'Literal') fixtures.add(String(p.key.value));
    }
  const second = params[1];
  return {
    fixtures,
    ...(second?.type === 'Identifier' ? { testInfo: second.name as string } : {}),
  };
}

interface Analysis {
  refs: string[];
  confidence: Confidence;
}

/**
 * Identifiers a condition depends on, and how well they are understood. Fixtures (destructured
 * callback parameters) and `testInfo.project.*` are known (static); `process.env.*`, other TestInfo
 * fields and any other free identifier are values outside the code (inferred); calls to anything but
 * a method of a fixture or TestInfo, `await`, and nested functions are not understood (opaque).
 */
function analyse(root: N, env: Env): Analysis {
  const refs: string[] = [];
  let confidence: Confidence = 'static';
  const add = (ref: string, c: Confidence) => {
    if (!refs.includes(ref)) refs.push(ref);
    confidence = worst(confidence, c);
  };

  const ref = (path: string[]): void => {
    const [head, ...rest] = path as [string, ...string[]];
    if (env.testInfo !== undefined && head === env.testInfo) {
      if (rest[0] === 'project') add(rest.length > 1 ? `project.${rest[1]}` : 'project', 'static');
      else add(rest.length > 0 ? rest.join('.') : head, 'inferred');
    } else if (env.fixtures.has(head)) add(head, 'static');
    else if (head === 'process' && rest[0] === 'env')
      add(rest.length > 1 ? `process.env.${rest[1]}` : 'process.env', 'inferred');
    else if (head !== 'undefined') add(path.join('.'), 'inferred');
  };

  const visit = (n: N): void => {
    switch (n.type) {
      case 'Identifier':
        ref([n.name as string]);
        return;
      case 'MemberExpression': {
        const path = dotted(n);
        if (path) return ref(path);
        // computed access: depend on the object (and on the key expression)
        const objectPath = dotted(n.object as N);
        if (objectPath) ref(objectPath);
        else visit(n.object as N);
        if (n.computed) visit(n.property as N);
        return;
      }
      case 'CallExpression': {
        const callee = n.callee as N;
        const path = callee.type === 'MemberExpression' ? dotted(callee.object as N) : undefined;
        const methodOfKnown =
          path !== undefined &&
          (env.fixtures.has(path[0]!) || (env.testInfo !== undefined && path[0] === env.testInfo));
        if (methodOfKnown) ref(path);
        else add(dotted(callee)?.join('.') ?? '<call>', 'opaque');
        for (const a of n.arguments as N[]) visit(a);
        return;
      }
      case 'AwaitExpression':
      case 'YieldExpression':
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
      case 'NewExpression':
      case 'TaggedTemplateExpression':
        add('<expression>', 'opaque');
        return;
      case 'Property':
        if (n.computed) visit(n.key as N);
        visit(n.value as N);
        return;
      default:
        for (const c of children(n)) visit(c);
    }
  };
  visit(root);
  return { refs, confidence };
}

/** `<testInfo>.project.name === 'literal'` (either side, `===`/`==`/`!==`/`!=`). */
function projectCompare(n: N, env: Env): Finding['projectCompare'] {
  if (n.type !== 'BinaryExpression' || !['===', '==', '!==', '!='].includes(n.operator as string))
    return undefined;
  const isName = (m: N) => {
    const path = m.type === 'MemberExpression' ? dotted(m) : undefined;
    return (
      path !== undefined &&
      env.testInfo !== undefined &&
      path.length === 3 &&
      path[0] === env.testInfo &&
      path[1] === 'project' &&
      path[2] === 'name'
    );
  };
  const lit = (m: N) => (m.type === 'Literal' && typeof m.value === 'string' ? m.value : undefined);
  const [l, r] = [n.left as N, n.right as N];
  const value = isName(l) ? lit(r) : isName(r) ? lit(l) : undefined;
  return value === undefined
    ? undefined
    : { value, negated: (n.operator as string).startsWith('!') };
}

/** String value of a literal or an interpolation-free template, else undefined. */
const literalString = (n: N | undefined): string | undefined => {
  if (!n) return undefined;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && (n.expressions as N[]).length === 0)
    return (n.quasis as N[]).map((q) => q.value.cooked as string).join('');
  return undefined;
};

const reasonOf = (n: N | undefined): string | undefined => {
  const s = literalString(n);
  return s === undefined ? undefined : excerpt(s);
};

/** Body expression of a modifier callback (`({ x }) => x === 1` or `{ return x === 1 }`). */
function callbackExpression(fn: N): N | undefined {
  const body = fn.body as N;
  if (body.type !== 'BlockStatement') return body;
  const stmts = body.body as N[];
  return stmts.length === 1 && stmts[0]!.type === 'ReturnStatement'
    ? ((stmts[0]!.argument as N | null) ?? undefined)
    : undefined;
}

/**
 * Condition of a describe- or file-level callback modifier. The modifier's
 * type, reason and location come from Playwright; only the condition is read here. A callback that is
 * not a single expression is opaque, with no condition excerpt.
 */
export function scanModifierCallback(source: string): ScanResult {
  let parsed;
  try {
    parsed = parseFunction(source);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { wrapped, fn } = parsed;
  const expr = callbackExpression(fn);
  if (!expr)
    return { ok: true, findings: [{ type: '', via: 'call', refs: [], confidence: 'opaque' }] };
  const a = analyse(expr, envOf(fn));
  return {
    ok: true,
    findings: [
      {
        type: '',
        via: 'call',
        condition: excerpt(wrapped.slice(expr.start, expr.end)),
        refs: a.refs,
        confidence: a.confidence,
      },
    ],
  };
}

/** Receiver that looks like the test object: `test`, or `<anything>.test` (Babel: `_test.test`). */
function isTestLike(n: N): boolean {
  if (n.type === 'Identifier') return n.name === 'test';
  return n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier'
    ? n.property.name === 'test'
    : false;
}

interface Frame {
  /** Positions of return/throw statements directly in this function (not in nested functions). */
  exits: number[];
}

/** Collects return/throw start positions of `fn` itself, skipping nested functions. */
function exitsOf(fn: N): number[] {
  const out: number[] = [];
  const visit = (n: N) => {
    if (n !== fn && isFunction(n)) return;
    if (n.type === 'ReturnStatement' || n.type === 'ThrowStatement') out.push(n.start);
    for (const c of children(n)) visit(c);
  };
  visit(fn);
  return out;
}

/**
 * Conditionals and runtime annotations inside a test body or hook function (a test's body
 * or a hook's function). Every function parameter beyond the fixtures object is treated as a TestInfo
 * handle only when it is the second parameter of the root function.
 */
export function scanFunctionBody(source: string): ScanResult {
  let parsed;
  try {
    parsed = parseFunction(source);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { wrapped, fn } = parsed;
  const env = envOf(fn);
  const findings: Finding[] = [];

  const isInfoHandle = (n: N): boolean =>
    (n.type === 'Identifier' && env.testInfo !== undefined && n.name === env.testInfo) ||
    // test.info()
    (n.type === 'CallExpression' &&
      (n.arguments as N[]).length === 0 &&
      n.callee.type === 'MemberExpression' &&
      !n.callee.computed &&
      n.callee.property.name === 'info' &&
      isTestLike(n.callee.object as N));

  /** Enclosing branch conditions of the node being visited, with how each is `negated`. */
  type Guard = { expr: N; negated: boolean };

  const guardCondition = (guards: Guard[]): { text?: string; analysis: Analysis } => {
    const parts: string[] = [];
    const refs: string[] = [];
    let confidence: Confidence = 'static';
    for (const g of guards) {
      const a = analyse(g.expr, env);
      for (const r of a.refs) if (!refs.includes(r)) refs.push(r);
      confidence = worst(confidence, a.confidence);
      const text = excerpt(wrapped.slice(g.expr.start, g.expr.end));
      parts.push(g.negated ? `!(${text})` : text);
    }
    return {
      ...(parts.length ? { text: parts.join(' && ') } : {}),
      analysis: { refs, confidence },
    };
  };

  const walk = (n: N, frame: Frame, guards: Guard[], opaqueCtx: boolean): void => {
    switch (n.type) {
      case 'IfStatement':
        walk(n.test, frame, guards, opaqueCtx);
        walk(n.consequent, frame, [...guards, { expr: n.test, negated: false }], opaqueCtx);
        if (n.alternate)
          walk(n.alternate, frame, [...guards, { expr: n.test, negated: true }], opaqueCtx);
        return;
      case 'ConditionalExpression':
        walk(n.test, frame, guards, opaqueCtx);
        walk(n.consequent, frame, [...guards, { expr: n.test, negated: false }], opaqueCtx);
        walk(n.alternate, frame, [...guards, { expr: n.test, negated: true }], opaqueCtx);
        return;
      case 'LogicalExpression':
        walk(n.left, frame, guards, opaqueCtx);
        if (n.operator === '&&')
          walk(n.right, frame, [...guards, { expr: n.left, negated: false }], opaqueCtx);
        else if (n.operator === '||')
          walk(n.right, frame, [...guards, { expr: n.left, negated: true }], opaqueCtx);
        else walk(n.right, frame, guards, true);
        return;
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'SwitchStatement':
      case 'TryStatement':
        for (const c of children(n)) walk(c, frame, guards, true);
        return;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        const inner: Frame = { exits: n === fn ? frame.exits : exitsOf(n) };
        for (const c of children(n)) walk(c, inner, guards, opaqueCtx);
        return;
      }
      case 'CallExpression':
        inspectCall(n, frame, guards, opaqueCtx);
        for (const c of children(n)) walk(c, frame, guards, opaqueCtx);
        return;
      default:
        for (const c of children(n)) walk(c, frame, guards, opaqueCtx);
    }
  };

  /** Extra confidence and condition from the surrounding control flow. */
  const context = (call: N, frame: Frame, guards: Guard[], opaqueCtx: boolean) => {
    const g = guardCondition(guards);
    let confidence = g.analysis.confidence;
    // Something earlier in the same function may already have left it: never reached on some paths.
    if (opaqueCtx || frame.exits.some((pos) => pos < call.start)) confidence = 'opaque';
    return { text: g.text, refs: g.analysis.refs, confidence };
  };

  const join = (a: string | undefined, b: string | undefined) =>
    a !== undefined && b !== undefined ? `${a} && ${b}` : (a ?? b);

  const inspectCall = (call: N, frame: Frame, guards: Guard[], opaqueCtx: boolean): void => {
    const callee = call.callee as N;
    const args = call.arguments as N[];

    // test.skip(...) / testInfo.fixme(...) / ...
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.property.type === 'Identifier' &&
      MODIFIERS.has(callee.property.name as string) &&
      (isTestLike(callee.object as N) || isInfoHandle(callee.object as N))
    ) {
      const ctx = context(call, frame, guards, opaqueCtx);
      const first = args[0];
      // (title, fn) is a declaration, not a conditional; it cannot appear in a body.
      if (first && literalString(first) !== undefined && args[1] && isFunction(args[1])) return;
      let condition = ctx.text;
      let refs = ctx.refs;
      let confidence = ctx.confidence;
      let reasonArg = args[1];
      if (first) {
        const own = isFunction(first) ? callbackExpression(first) : first;
        if (own) {
          const a = analyse(own, isFunction(first) ? envOf(first) : env);
          condition = join(ctx.text, excerpt(wrapped.slice(own.start, own.end)));
          refs = [...refs, ...a.refs.filter((r) => !refs.includes(r))];
          confidence = worst(confidence, a.confidence);
        } else confidence = 'opaque';
      }
      // test.skip('reason') with a lone string: the string is the description, not a condition.
      if (first && args.length === 1 && literalString(first) !== undefined) {
        condition = ctx.text;
        reasonArg = first;
      }
      const reason = reasonOf(reasonArg);
      const compare =
        first && !isFunction(first) && ctx.text === undefined && confidence === 'static'
          ? projectCompare(first, env)
          : undefined;
      findings.push({
        ...(compare ? { projectCompare: compare } : {}),
        type: callee.property.name as string,
        via: 'call',
        ...(condition === undefined ? {} : { condition }),
        refs,
        ...(reason === undefined ? {} : { reason }),
        confidence,
      });
      return;
    }

    // testInfo.annotations.push({ type, description })  /  test.info().annotations.push(...)
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.property.name === 'push' &&
      callee.object.type === 'MemberExpression' &&
      !callee.object.computed &&
      callee.object.property.name === 'annotations' &&
      isInfoHandle(callee.object.object as N)
    ) {
      const ctx = context(call, frame, guards, opaqueCtx);
      const obj = args[0];
      const props = obj?.type === 'ObjectExpression' ? (obj.properties as N[]) : [];
      const prop = (name: string) =>
        props.find(
          (p) =>
            p.type === 'Property' && !p.computed && (p.key.name === name || p.key.value === name),
        )?.value as N | undefined;
      const typeNode = prop('type');
      const type = literalString(typeNode);
      const reason = reasonOf(prop('description'));
      let confidence = ctx.confidence;
      const refs = [...ctx.refs];
      if (type === undefined) {
        confidence = 'opaque'; // computed type (or an argument that is not an object literal)
        if (typeNode)
          for (const r of analyse(typeNode, env).refs) if (!refs.includes(r)) refs.push(r);
      }
      findings.push({
        type: type ?? UNKNOWN_TYPE,
        via: 'runtime-push',
        ...(ctx.text === undefined ? {} : { condition: ctx.text }),
        refs,
        ...(reason === undefined ? {} : { reason }),
        confidence,
      });
      return;
    }

    // helper(test): the call is visible, its effect is not. (helper(testInfo) is not flagged: passing
    // testInfo to helpers is far too common to be a signal.)
    if (
      args.some((a) => isTestLike(a)) &&
      !(callee.type === 'MemberExpression' && isTestLike(callee.object as N))
    ) {
      const ctx = context(call, frame, guards, opaqueCtx);
      const name = dotted(callee)?.join('.');
      findings.push({
        type: UNKNOWN_TYPE,
        via: 'helper',
        condition: join(ctx.text, excerpt(wrapped.slice(call.start, call.end)))!,
        refs: [...ctx.refs, ...(name !== undefined && !ctx.refs.includes(name) ? [name] : [])],
        confidence: 'opaque',
      });
    }
  };

  walk(fn, { exits: exitsOf(fn) }, [], false);
  return { ok: true, findings };
}
