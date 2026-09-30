/**
 * 有界正则求值引擎 —— Nexus Profile 的 regex 求值唯一实现。
 *
 * 背景：灾难性回溯启发式（hasNestedQuantifierRisk）只能覆盖已知危险形态，
 * `(a|aa)+$`、`(a+){1,}$` 等歧义 pattern 仍可让 `RegExp.test()` 在长失败输入上
 * 挂起主线程——pattern 长度上限与编译缓存都不限制匹配耗时。
 *
 * 方案：Thompson NFA 构造 + 逐字符状态集模拟，匹配耗时 O(输入长度 × NFA 状态数)，
 * 与输入内容无关，不存在回溯路径。代价是兼容范围收窄为无反向引用、无环视的
 * 正则子集（这两类构造无法多项式时间模拟，含之即拒）——这是 Profile 的明确
 * 兼容范围声明，属于与完整 JS 正则语义的已知偏差。
 *
 * 输入侧再设两道硬上限：pattern 编译出的 NFA 状态数、待匹配字符串长度，
 * 超限一律按「不受支持」处理，保证最坏情况耗时也有界。
 */

/** 待匹配字符串长度上限：线性匹配下最坏耗时 = 该值 × NFA 状态数。 */
export const MAX_REGEX_INPUT_LENGTH = 10_000;
/** NFA 状态数上限：超限 pattern 过于复杂，直接拒绝。 */
export const MAX_NFA_STATES = 5_000;
/** 有界量词展开上限：`{n,m}` 的 n/m 不得超过此值。 */
export const MAX_REPEAT_COUNT = 1_000;

/** pattern 语法检查结论：ok 可用；syntax 非法 JS 正则；unsupported 合法但 Profile 不支持。 */
export type RegexSyntaxStatus = 'ok' | 'syntax' | 'unsupported';

export interface SafeRegExp {
  readonly source: string;
  /** 线性时间匹配；超过 MAX_REGEX_INPUT_LENGTH 的输入直接返回 false。 */
  test(value: string): boolean;
}

/* ───────────────────────── 字符区间 ───────────────────────── */

type Ranges = ReadonlyArray<readonly [number, number]>;

const DIGIT_RANGES: Ranges = [[0x30, 0x39]];
const WORD_RANGES: Ranges = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
];
// \s：JSON/ECMAScript 空白 + 行终止符
const SPACE_RANGES: Ranges = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];
// `.`（无 s 标志）：除行终止符外任意字符
const DOT_RANGES: Ranges = [[0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2028], [0x2029, 0x2029]];

function negateRanges(ranges: Ranges): Ranges {
  const out: Array<[number, number]> = [];
  let next = 0;
  for (const [from, to] of ranges) {
    if (from > next) out.push([next, from - 1]);
    next = Math.max(next, to + 1);
  }
  if (next <= 0xffff) out.push([next, 0xffff]);
  return out;
}

/** 排序并合并重叠/相邻区间：inRanges 依赖二分查找，必须保证有序。 */
function normalizeRanges(ranges: Array<[number, number]>): Ranges {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [from, to] of ranges) {
    const last = out[out.length - 1] as [number, number] | undefined;
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

function inRanges(code: number, ranges: Ranges): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [from, to] = ranges[mid] as readonly [number, number];
    if (code < from) hi = mid - 1;
    else if (code > to) lo = mid + 1;
    else return true;
  }
  return false;
}

/* ───────────────────────── AST ───────────────────────── */

type Ast =
  | { t: 'empty' }
  | { t: 'char'; ranges: Ranges; negated: boolean }
  | { t: 'assert'; kind: AssertKind }
  | { t: 'seq'; parts: Ast[] }
  | { t: 'alt'; branches: Ast[] }
  | { t: 'rep'; min: number; max: number; body: Ast };

const enum AssertKind {
  Start = 0,
  End = 1,
  WordBoundary = 2,
  NotWordBoundary = 3,
}

class RegexSyntaxError extends Error {
  constructor(readonly status: Exclude<RegexSyntaxStatus, 'ok'>, message: string) {
    super(message);
  }
}

/* ───────────────────────── 解析 ───────────────────────── */

const IDENTITY_ESCAPE_CHARS = /^[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]$/;

class Parser {
  private pos = 0;
  constructor(private readonly pattern: string) {}

  parse(): Ast {
    const ast = this.parseAlternative();
    if (this.pos < this.pattern.length) {
      // 只可能是多余的 ')'
      throw new RegexSyntaxError('syntax', '正则括号不匹配');
    }
    return ast;
  }

  private peek(offset = 0): string {
    return this.pattern[this.pos + offset] ?? '';
  }

  private next(): string {
    const ch = this.pattern[this.pos] ?? '';
    this.pos += 1;
    return ch;
  }

  private parseAlternative(): Ast {
    const branches: Ast[] = [this.parseSequence()];
    while (this.peek() === '|') {
      this.next();
      branches.push(this.parseSequence());
    }
    return branches.length === 1 ? branches[0]! : { t: 'alt', branches };
  }

  private parseSequence(): Ast {
    const parts: Ast[] = [];
    while (this.pos < this.pattern.length && this.peek() !== '|' && this.peek() !== ')') {
      parts.push(this.parseTerm());
    }
    if (parts.length === 0) return { t: 'empty' };
    if (parts.length === 1) return parts[0]!;
    return { t: 'seq', parts };
  }

  private parseTerm(): Ast {
    const ch = this.peek();
    if (
      ch === '*' ||
      ch === '+' ||
      ch === '?' ||
      (ch === '{' && this.looksLikeCountedQuantifier())
    ) {
      throw new RegexSyntaxError('syntax', '量词缺少作用对象');
    }
    const atom = this.parseAtom();
    const quantifier = this.tryParseQuantifier();
    if (quantifier === null) return atom;
    if (atom.t === 'assert') {
      // `^*` 等量化断言不影响匹配结论，但属于未定义兼容面——按不支持处理
      throw new RegexSyntaxError('unsupported', '断言不支持量词修饰');
    }
    return { t: 'rep', min: quantifier.min, max: quantifier.max, body: atom };
  }

  /** 返回 null 表示无量化；解析后若紧邻又一个量词（`a**`）→ 非法。 */
  private tryParseQuantifier(): { min: number; max: number } | null {
    const ch = this.peek();
    if (ch === '*') {
      this.next();
      this.consumeLazyMarker();
      this.rejectDoubleQuantifier();
      return { min: 0, max: Infinity };
    }
    if (ch === '+') {
      this.next();
      this.consumeLazyMarker();
      this.rejectDoubleQuantifier();
      return { min: 1, max: Infinity };
    }
    if (ch === '?') {
      this.next();
      this.consumeLazyMarker();
      this.rejectDoubleQuantifier();
      return { min: 0, max: 1 };
    }
    if (ch === '{') {
      const save = this.pos;
      const counted = this.tryParseCountedQuantifier();
      if (counted === null) {
        this.pos = save; // `{` 未构成量词 → 回退，按字面量处理（与非 u 模式 JS 一致）
        return null;
      }
      this.consumeLazyMarker();
      this.rejectDoubleQuantifier();
      return counted;
    }
    return null;
  }

  private tryParseCountedQuantifier(): { min: number; max: number } | null {
    this.next(); // '{'
    const min = this.parseDigits();
    if (min === null) return null;
    if (this.peek() === '}') {
      this.next();
      return { min, max: min };
    }
    if (this.peek() !== ',') return null;
    this.next();
    const max = this.parseDigits();
    if (this.peek() !== '}') return null;
    this.next();
    return { min, max: max ?? Infinity };
  }

  private parseDigits(): number | null {
    let digits = '';
    while (/[0-9]/.test(this.peek())) digits += this.next();
    if (!digits) return null;
    return Number(digits);
  }

  private consumeLazyMarker(): void {
    if (this.peek() === '?') this.next();
  }

  private rejectDoubleQuantifier(): void {
    const ch = this.peek();
    if (ch === '*' || ch === '+' || ch === '?') {
      throw new RegexSyntaxError('syntax', '连续量词');
    }
    if (ch === '{' && this.looksLikeCountedQuantifier()) {
      throw new RegexSyntaxError('syntax', '连续量词');
    }
  }

  private looksLikeCountedQuantifier(): boolean {
    const save = this.pos;
    try {
      return this.tryParseCountedQuantifier() !== null;
    } finally {
      this.pos = save;
    }
  }

  private parseAtom(): Ast {
    const ch = this.next();
    switch (ch) {
      case '^':
        return { t: 'assert', kind: AssertKind.Start };
      case '$':
        return { t: 'assert', kind: AssertKind.End };
      case '.':
        return { t: 'char', ranges: DOT_RANGES, negated: true };
      case '[':
        return this.parseClass();
      case '(':
        return this.parseGroup();
      case ')':
        throw new RegexSyntaxError('syntax', '正则括号不匹配');
      case '\\':
        return this.parseEscape();
      case '\0':
        throw new RegexSyntaxError('unsupported', 'pattern 含原始 NUL 字符');
      default:
        return { t: 'char', ranges: [[ch.codePointAt(0) as number, ch.codePointAt(0) as number]], negated: false };
    }
  }

  private parseGroup(): Ast {
    if (this.peek() === '?') {
      const marker = this.peek(1);
      if (marker === ':') {
        this.next();
        this.next();
        const body = this.parseAlternative();
        this.expect(')');
        return body;
      }
      // (?= (?! (?<= (?<! (?<name> (?i) 等一律不在 Profile 兼容范围
      throw new RegexSyntaxError('unsupported', 'Group 语法不受支持（环视/命名组/内联 flag）');
    }
    const body = this.parseAlternative();
    this.expect(')');
    return body;
  }

  private expect(ch: string): void {
    if (this.next() !== ch) throw new RegexSyntaxError('syntax', `正则期望 ${ch}`);
  }

  private parseEscape(): Ast {
    const ch = this.next();
    switch (ch) {
      case 'd':
        return { t: 'char', ranges: DIGIT_RANGES, negated: false };
      case 'D':
        return { t: 'char', ranges: DIGIT_RANGES, negated: true };
      case 'w':
        return { t: 'char', ranges: WORD_RANGES, negated: false };
      case 'W':
        return { t: 'char', ranges: WORD_RANGES, negated: true };
      case 's':
        return { t: 'char', ranges: SPACE_RANGES, negated: false };
      case 'S':
        return { t: 'char', ranges: SPACE_RANGES, negated: true };
      case 'b':
        return { t: 'assert', kind: AssertKind.WordBoundary };
      case 'B':
        return { t: 'assert', kind: AssertKind.NotWordBoundary };
      case 'n':
        return this.literal(0x0a);
      case 'r':
        return this.literal(0x0d);
      case 't':
        return this.literal(0x09);
      case 'f':
        return this.literal(0x0c);
      case 'v':
        return this.literal(0x0b);
      case '0':
        if (!/[0-9]/.test(this.peek())) return this.literal(0x00);
        throw new RegexSyntaxError('syntax', 'legacy 八进制转义不受支持');
      case 'x': {
        return this.literal(this.parseHex(2));
      }
      case 'u': {
        if (this.peek() === '{') {
          throw new RegexSyntaxError('unsupported', '\\u{...} 码点转义不受支持');
        }
        return this.literal(this.parseHex(4));
      }
      case 'c':
        throw new RegexSyntaxError('unsupported', '\\c 控制转义不受支持');
      case 'p':
      case 'P':
        throw new RegexSyntaxError('unsupported', '\\p Unicode 属性转义不受支持');
      case 'k':
        throw new RegexSyntaxError('unsupported', '命名反向引用不受支持');
      default:
        if (/[1-9]/.test(ch)) {
          throw new RegexSyntaxError('unsupported', '反向引用不受支持');
        }
        if (IDENTITY_ESCAPE_CHARS.test(ch)) {
          return this.literal(ch.codePointAt(0) as number);
        }
        throw new RegexSyntaxError('syntax', `未知转义 \\${ch}`);
    }
  }

  private literal(code: number): Ast {
    return { t: 'char', ranges: [[code, code]], negated: false };
  }

  private parseHex(length: number): number {
    let text = '';
    for (let i = 0; i < length; i++) {
      if (!/[0-9a-fA-F]/.test(this.peek())) {
        throw new RegexSyntaxError('syntax', `\\x/\\u 需要 ${length} 位十六进制`);
      }
      text += this.next();
    }
    return parseInt(text, 16);
  }

  /* ── 字符类 ── */

  private parseClass(): Ast {
    let negated = false;
    if (this.peek() === '^') {
      this.next();
      negated = true;
    }
    const ranges: Array<[number, number]> = [];
    const addRanges = (added: Ranges, negate: boolean): void => {
      if (negate) {
        for (const [from, to] of negateRanges(added)) ranges.push([from, to]);
      } else {
        for (const [from, to] of added) ranges.push([from, to]);
      }
    };

    while (this.peek() !== ']') {
      if (this.pos >= this.pattern.length) {
        throw new RegexSyntaxError('syntax', '字符类未闭合');
      }
      const lo = this.parseClassAtom();
      if (typeof lo === 'object') {
        addRanges(lo.ranges, lo.negated);
        continue;
      }
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== '') {
        this.next(); // '-'
        const hi = this.parseClassAtom();
        if (typeof hi === 'object') {
          throw new RegexSyntaxError('syntax', '类区间端点不能是字符集转义');
        }
        if (hi < lo) throw new RegexSyntaxError('syntax', '类区间上下界颠倒');
        ranges.push([lo, hi]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    this.next(); // ']'
    if (ranges.length === 0) {
      // JS `[]` 不匹配任何字符、`[^]` 匹配一切
      return negated
        ? { t: 'char', ranges: [[0, 0xffff]], negated: false }
        : { t: 'char', ranges: [], negated: false };
    }
    return { t: 'char', ranges: normalizeRanges(ranges), negated };
  }

  /** 返回 number（单个码元）或 { ranges }（\d 等类转义）。 */
  private parseClassAtom(): number | { ranges: Ranges; negated: boolean } {
    const ch = this.next();
    if (ch === '\\') {
      const esc = this.next();
      switch (esc) {
        case 'd':
          return { ranges: DIGIT_RANGES, negated: false };
        case 'D':
          return { ranges: DIGIT_RANGES, negated: true };
        case 'w':
          return { ranges: WORD_RANGES, negated: false };
        case 'W':
          return { ranges: WORD_RANGES, negated: true };
        case 's':
          return { ranges: SPACE_RANGES, negated: false };
        case 'S':
          return { ranges: SPACE_RANGES, negated: true };
        case 'b':
          return 0x08; // 类内 \b 是退格符
        case 'n':
          return 0x0a;
        case 'r':
          return 0x0d;
        case 't':
          return 0x09;
        case 'f':
          return 0x0c;
        case 'v':
          return 0x0b;
        case '0':
          if (!/[0-9]/.test(this.peek())) return 0x00;
          throw new RegexSyntaxError('syntax', 'legacy 八进制转义不受支持');
        case 'x':
          return this.parseHex(2);
        case 'u':
          if (this.peek() === '{') {
            throw new RegexSyntaxError('unsupported', '\\u{...} 码点转义不受支持');
          }
          return this.parseHex(4);
        case 'c':
        case 'p':
        case 'P':
        case 'k':
          throw new RegexSyntaxError('unsupported', `类内 \\${esc} 不受支持`);
        case '':
          throw new RegexSyntaxError('syntax', '模式以反斜杠结尾');
        default:
          if (/[1-9]/.test(esc)) throw new RegexSyntaxError('unsupported', '反向引用不受支持');
          if (IDENTITY_ESCAPE_CHARS.test(esc)) return esc.codePointAt(0) as number;
          throw new RegexSyntaxError('syntax', `类内未知转义 \\${esc}`);
      }
    }
    return ch.codePointAt(0) as number;
  }
}

/* ───────────────────────── NFA ───────────────────────── */

interface NfaTransition {
  ranges: Ranges;
  negated: boolean;
  next: number;
}

interface NfaAssertion {
  kind: AssertKind;
  next: number;
}

interface NfaState {
  eps: number[];
  asserts: NfaAssertion[];
  trans: NfaTransition[];
}

interface Nfa {
  states: NfaState[];
  start: number;
  accept: number;
}

interface Fragment {
  start: number;
  accept: number;
}

function buildNfa(ast: Ast): Nfa {
  const states: NfaState[] = [];
  const createState = (): number => {
    states.push({ eps: [], asserts: [], trans: [] });
    return states.length - 1;
  };

  const build = (node: Ast): Fragment => {
    switch (node.t) {
      case 'empty': {
        const s = createState();
        return { start: s, accept: s };
      }
      case 'char': {
        const s = createState();
        const e = createState();
        states[s]!.trans.push({ ranges: node.ranges, negated: node.negated, next: e });
        return { start: s, accept: e };
      }
      case 'assert': {
        const s = createState();
        const e = createState();
        states[s]!.asserts.push({ kind: node.kind, next: e });
        return { start: s, accept: e };
      }
      case 'seq': {
        let frag = build(node.parts[0]!);
        for (let i = 1; i < node.parts.length; i++) {
          const nextFrag = build(node.parts[i]!);
          states[frag.accept]!.eps.push(nextFrag.start);
          frag = { start: frag.start, accept: nextFrag.accept };
        }
        return frag;
      }
      case 'alt': {
        const s = createState();
        const e = createState();
        for (const branch of node.branches) {
          const frag = build(branch);
          states[s]!.eps.push(frag.start);
          states[frag.accept]!.eps.push(e);
        }
        return { start: s, accept: e };
      }
      case 'rep': {
        if (node.min > node.max) {
          throw new RegexSyntaxError('syntax', '量词 min 大于 max');
        }
        if (node.min > MAX_REPEAT_COUNT || (node.max !== Infinity && node.max > MAX_REPEAT_COUNT)) {
          throw new RegexSyntaxError('unsupported', `量词次数超过上限 ${MAX_REPEAT_COUNT}`);
        }
        // min 次必现串联；随后 Infinity → star（含跳过边），有限 → 可选副本链
        const startState = createState();
        let cursor = startState;
        for (let i = 0; i < node.min; i++) {
          const frag = build(node.body);
          states[cursor]!.eps.push(frag.start);
          cursor = frag.accept;
        }
        const exit = createState();
        if (node.max === Infinity) {
          const loop = build(node.body);
          states[cursor]!.eps.push(loop.start); // 至少再走一次
          states[cursor]!.eps.push(exit); // 跳过（min 可为 0）
          states[loop.accept]!.eps.push(loop.start); // 重复
          states[loop.accept]!.eps.push(exit);
        } else {
          states[cursor]!.eps.push(exit); // 跳过全部可选副本
          for (let i = node.min; i < node.max; i++) {
            const frag = build(node.body);
            const bridge = createState();
            states[cursor]!.eps.push(frag.start);
            states[frag.accept]!.eps.push(bridge);
            states[bridge]!.eps.push(exit);
            cursor = bridge;
          }
        }
        return { start: startState, accept: exit };
      }
    }
  };

  // 搜索语义（与 JS `RegExp.test()` 一致）：隐式前缀 `.*` 使 pattern 可在任意
  // 起始位置命中；pattern 自带的 ^/$ 断言仍按原语义收窄（无 m 标志）。
  const searchPrefix: Ast = {
    t: 'rep',
    min: 0,
    max: Infinity,
    body: { t: 'char', ranges: DOT_RANGES, negated: true },
  };
  const root = build({ t: 'seq', parts: [searchPrefix, ast] });
  const nfa: Nfa = { states, start: root.start, accept: root.accept };
  if (states.length > MAX_NFA_STATES) {
    throw new RegexSyntaxError('unsupported', `NFA 状态数超过上限 ${MAX_NFA_STATES}`);
  }
  return nfa;
}

/* ───────────────────────── 模拟 ───────────────────────── */

function isWordCharCode(code: number): boolean {
  return inRanges(code, WORD_RANGES);
}

function matchNfa(nfa: Nfa, input: string): boolean {
  const { states, start, accept } = nfa;
  const len = input.length;
  const marks = new Int32Array(states.length);
  let generation = 0;
  let members: number[] = [];
  let work: number[] = [];

  const add = (state: number): void => {
    if (marks[state] === generation) return;
    marks[state] = generation;
    members.push(state);
    work.push(state);
  };

  /** 计算 epsilon/断言闭包（迭代，避免深 epsilon 链爆栈）。 */
  const closure = (seeds: number[], pos: number): void => {
    for (const s of seeds) add(s);
    while (work.length > 0) {
      const state = work.pop() as number;
      for (const next of states[state]!.eps) add(next);
      for (const assertion of states[state]!.asserts) {
        if (assertionHolds(assertion.kind, pos)) add(assertion.next);
      }
    }
  };

  const assertionHolds = (kind: AssertKind, pos: number): boolean => {
    switch (kind) {
      case AssertKind.Start:
        return pos === 0;
      case AssertKind.End:
        return pos === len;
      case AssertKind.WordBoundary:
      case AssertKind.NotWordBoundary: {
        const before = pos > 0 && isWordCharCode(input.charCodeAt(pos - 1));
        const after = pos < len && isWordCharCode(input.charCodeAt(pos));
        return kind === AssertKind.WordBoundary ? before !== after : before === after;
      }
    }
  };

  if (len > MAX_REGEX_INPUT_LENGTH) return false;

  generation += 1;
  members = [];
  work = [];
  closure([start], 0);
  if (marks[accept] === generation) return true;

  for (let pos = 0; pos < len; pos++) {
    const code = input.charCodeAt(pos);
    const seeds: number[] = [];
    for (const state of members) {
      for (const trans of states[state]!.trans) {
        if (inRanges(code, trans.ranges) !== trans.negated) seeds.push(trans.next);
      }
    }
    if (seeds.length === 0) return false;
    generation += 1;
    members = [];
    work = [];
    closure(seeds, pos + 1);
    if (marks[accept] === generation) return true;
  }
  return false;
}

/* ───────────────────────── 对外入口 ───────────────────────── */

/** 只做语法/支持面/复杂度检查，不产出可执行对象。 */
export function checkRegexSyntax(pattern: string): RegexSyntaxStatus {
  try {
    buildNfa(parseTopLevel(pattern));
    return 'ok';
  } catch (error) {
    if (error instanceof RegexSyntaxError) return error.status;
    return 'syntax';
  }
}

function parseTopLevel(pattern: string): Ast {
  return new Parser(pattern).parse();
}

/** 编译为线性时间 SafeRegExp；语法非法/不受支持/过于复杂返回 null。 */
export function compileBoundedRegExp(pattern: string): SafeRegExp | null {
  if (typeof pattern !== 'string') return null;
  try {
    const ast = parseTopLevel(pattern);
    const nfa = buildNfa(ast);
    return { source: pattern, test: (value: string) => matchNfa(nfa, value) };
  } catch {
    return null;
  }
}
