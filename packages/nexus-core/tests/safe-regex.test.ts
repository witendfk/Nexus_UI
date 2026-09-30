import { expect } from 'chai';
import {
  MAX_REGEX_INPUT_LENGTH,
  checkRegexSyntax,
  compileBoundedRegExp,
} from '../src/checks/safe-regex';
import {
  compileSafeRegExp,
  getFirstFailedCheck,
  getRegexPatternRejection,
} from '../src/checks';

/**
 * L0-02 证伪基线：
 * - 受支持子集与 JS RegExp.test()（搜索语义）对同一组 (pattern, input) 结论一致；
 * - 歧义分支 / 外层花括号量词等「启发式放行」的灾难性 pattern，求值走线性引擎，
 *   在会让回溯引擎指数爆炸的输入长度上即时返回——旧实现执行到此会挂起超时。
 */
describe('safe-regex · 受支持子集与 JS RegExp.test() 语义一致', () => {
  const cases: Array<[string, string, boolean]> = [
    // 搜索语义（非锚定）
    ['abc', 'xx-abc-xx', true],
    ['abc', 'ab', false],
    ['^abc$', 'abc', true],
    ['^abc$', 'xabc', false],
    // 类与量词
    ['[0-9]+', 'a-1234-b', true],
    ['^[0-9]+$', '123a', false],
    ['\\d{2,4}', 'x123x', true],
    ['^\\d{4}-\\d{2}-\\d{2}$', '2026-09-30', true],
    ['^\\d{4}-\\d{2}-\\d{2}$', '2026-9-30', false],
    ['a{2,}', 'xa', false],
    ['a{2,}', 'xaa', true],
    ['a{3}', 'aaaa', true],
    ['x{0}', 'anything', true],
    // 分支与分组
    ['a|bb', 'zbbz', true],
    ['^(a|b)+c$', 'ababc', true],
    ['^(?:ab|cd)e', 'cde', true],
    ['^(a|aa)+$', 'a'.repeat(4), true],
    // 5 = a + aa + aa，与 JS 一致判 true
    ['^(a|aa)+$', 'a'.repeat(5), true],
    // dot 不匹配行终止符（无 s 标志）
    ['a.c', 'axc', true],
    ['a.c', 'a\nc', false],
    // 空类 / 否定空类
    ['[]', 'a', false],
    ['[^]', 'a', true],
    ['[^]', '', false],
    // 类内转义与区间
    ['[a\\-z]+', 'b', false],
    ['[a\\-z]+', '-', true],
    ['[a\\-z]+', 'a-z', true],
    ['[a-]', '-', true],
    ['[^a-z]', 'A', true],
    ['[^a-z]', 'q', false],
    ['[\\d]+', '42', true],
    // 断言
    ['\\bword\\b', 'a word here', true],
    ['\\bword\\b', 'keyword here', false],
    ['\\B', 'ab', true],
    // 转义字面量
    ['\\$\\{x\\}', 'cost ${x} ok', true],
    ['a\\/b', 'a/b', true],
    ['\\u0041+', 'xAy', true],
    ['\\x41\\x42', 'ZAB!', true],
    // 空分支与空 pattern
    ['(a|)', 'b', true],
    ['', 'non-empty', true],
  ];

  for (const [pattern, input, expected] of cases) {
    it(`/${pattern.replace(/\n/g, '\\n')}/ vs ${JSON.stringify(input)} → ${expected}`, () => {
      const compiled = compileSafeRegExp(pattern);
      expect(compiled, `pattern ${pattern} 应可编译`).to.not.equal(null);
      expect(compiled!.test(input)).to.equal(new RegExp(pattern).test(input));
      expect(compiled!.test(input)).to.equal(expected);
    });
  }
});

describe('safe-regex · L0-02 线性耗时（回溯实现会在此挂起）', () => {
  // `(a|aa)+$`、`(a|aa){1,}$` 均可穿过嵌套量词启发式；老实现 new RegExp(...).test
  // 在 ~60 个 'a' 的失败输入上即需指数级回溯，此处输入远超该阈值。
  const ambiguousBranch = `(a|aa)+$`;
  const outerBrace = `(a|aa){1,}$`;

  const adversarial = `${'a'.repeat(150)}!`;
  const satisfiable = 'a'.repeat(150);

  for (const pattern of [ambiguousBranch, outerBrace]) {
    it(`/${pattern}/ 失败输入即时返回 false`, () => {
      const compiled = compileSafeRegExp(pattern);
      expect(compiled).to.not.equal(null);
      expect(compiled!.test(adversarial)).to.equal(false);
    });
    it(`/${pattern}/ 满足输入结论正确`, () => {
      const compiled = compileSafeRegExp(pattern);
      expect(compiled).to.not.equal(null);
      expect(compiled!.test(satisfiable)).to.equal(true);
    });
  }

  it('嵌套星歧义 ((a*)*)*b 同样线性（准入面启发式已拒，此处验证引擎层兜底）', () => {
    const compiled = compileBoundedRegExp('((a*)*)*b');
    expect(compiled).to.not.equal(null);
    expect(compiled!.test(`${'a'.repeat(120)}c`)).to.equal(false);
    expect(compiled!.test(`${'a'.repeat(120)}b`)).to.equal(true);
  });

  it('超上限输入直接拒绝匹配', () => {
    const compiled = compileSafeRegExp('a'.repeat(50));
    expect(compiled).to.not.equal(null);
    expect(compiled!.test('a'.repeat(MAX_REGEX_INPUT_LENGTH + 1))).to.equal(false);
    expect(compiled!.test('a'.repeat(MAX_REGEX_INPUT_LENGTH))).to.equal(true);
  });
});

describe('safe-regex · 校验/求值统一口径', () => {
  it('启发式拒绝的嵌套量词 pattern 返回 null（求值侧兜底之前先在准入面拒绝）', () => {
    expect(compileSafeRegExp('(a+)+$')).to.equal(null);
    expect(getRegexPatternRejection('(a+)+$')).to.include('嵌套量词');
  });

  it('非法语法：syntax 结论与可读原因', () => {
    expect(checkRegexSyntax('[unclosed')).to.equal('syntax');
    expect(getRegexPatternRejection('[unclosed')).to.include('合法正则');
    expect(checkRegexSyntax('a)')).to.equal('syntax');
    expect(checkRegexSyntax('*a')).to.equal('syntax');
    expect(checkRegexSyntax('a{2,1}')).to.equal('syntax');
    expect(checkRegexSyntax('\\')).to.equal('syntax');
    expect(checkRegexSyntax('a**')).to.equal('syntax');
  });

  it('合法但 Profile 不支持：反向引用 / 环视 / 命名组 / \\p', () => {
    for (const pattern of ['(a)\\1', '(?=x)a', '(?!x)a', '(?<=x)a', '(?<name>x)', '\\p{L}+', 'a\\ck']) {
      expect(checkRegexSyntax(pattern), pattern).to.equal('unsupported');
      expect(getRegexPatternRejection(pattern), pattern).to.include('不支持');
      expect(compileSafeRegExp(pattern), pattern).to.equal(null);
    }
  });

  it('超长 pattern 与量词上限', () => {
    expect(getRegexPatternRejection('a'.repeat(201))).to.include('长度');
    expect(checkRegexSyntax('a{1001}')).to.equal('unsupported');
    expect(checkRegexSyntax('a{1000}')).to.equal('ok');
  });

  it('合法 pattern 的原因为 null', () => {
    expect(getRegexPatternRejection('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')).to.equal(null);
    expect(getRegexPatternRejection('(a|aa)+$')).to.equal(null);
  });

  it('checks 求值：歧义分支 pattern 在长文本上线性完成且结论正确', () => {
    const rule = {
      condition: { call: 'regex', args: { value: { path: '/v' }, pattern: '(a|aa)+$' } },
      message: '格式不符',
    };
    const model = { v: `${'a'.repeat(150)}!` };
    expect(getFirstFailedCheck([rule], model)).to.not.equal(null); // 失败（以 ! 结尾）
    const okModel = { v: 'a'.repeat(150) };
    expect(getFirstFailedCheck([rule], okModel)).to.equal(null); // 通过
  });

  it('compileSafeRegExp 按同 pattern 返回同一缓存实例，checks 与 safe-regex 入口一致', () => {
    expect(compileSafeRegExp('^ab+c$')).to.equal(compileSafeRegExp('^ab+c$'));
    expect(compileSafeRegExp('^ab+c$')!.test('abbbc')).to.equal(true);
    expect(compileSafeRegExp('^ab+c$')!.test('abbb')).to.equal(false);
  });
});
