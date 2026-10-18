import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { isDataBinding, validateInputValueDiagnostics } from '../../src/catalog';

function firstMessage(value: unknown, schema: Parameters<typeof validateInputValueDiagnostics>[1]) {
  return validateInputValueDiagnostics(value, schema, 'v')[0]?.message ?? '';
}

describe('isDataBinding（{ path } 绑定形状）', () => {
  it('仅接受单键非空字符串路径；空路径、多键、原型键均不是绑定', () => {
    assert.equal(isDataBinding({ path: '/a/b' }), true);
    assert.equal(isDataBinding({ path: '' }), false);
    assert.equal(isDataBinding({ path: '/x', extra: 1 }), false);
    assert.equal(isDataBinding({ path: 1 }), false);
    assert.equal(isDataBinding('path'), false);
  });
});

describe('validateInputValueDiagnostics（输入值字面校验）', () => {
  it('合法字面值零诊断：类型、enum、范围、长度、数组项', () => {
    assert.deepEqual(
      validateInputValueDiagnostics(7, { type: 'integer', minimum: 0, maximum: 10 }, 'v'),
      [],
    );
    assert.deepEqual(validateInputValueDiagnostics('a', { enum: ['a', 'b'] }, 'v'), []);
    assert.deepEqual(
      validateInputValueDiagnostics('hi', { type: 'string', minLength: 2 }, 'v'),
      [],
    );
    assert.deepEqual(
      validateInputValueDiagnostics(
        ['a'],
        { type: 'array', minItems: 1, items: { type: 'string' } },
        'v',
      ),
      [],
    );
  });

  it('类型、范围、枚举、长度、pattern 违规产生诊断', () => {
    assert.match(firstMessage(3.5, { type: 'integer' }), /必须是 integer/);
    assert.match(firstMessage(11, { type: 'integer', maximum: 10 }), /不能超过 10/);
    assert.match(firstMessage('c', { enum: ['a', 'b'] }), /只支持 "a"\/"b"/);
    assert.match(firstMessage('a', { type: 'string', minLength: 2 }), /长度不能小于 2/);
    assert.match(
      firstMessage('abc', { type: 'string', pattern: '^x+$' }),
      /不符合 schema\.pattern/,
    );
  });

  it('{ path } 形状的值按绑定拒绝：输入值必须是字面值', () => {
    assert.match(firstMessage({ path: '/x' }, { type: 'string' }), /不支持 \{ path \} 绑定/);
    assert.match(
      firstMessage({ path: '/x' }, { type: 'object', properties: { path: { type: 'string' } } }),
      /不支持 \{ path \} 绑定/,
    );
  });

  it('数组项递归校验：违规项带索引定位', () => {
    assert.match(
      firstMessage(['a', 1], { type: 'array', items: { type: 'string' } }),
      /v\[1\] 必须是 string/,
    );
  });

  it('嵌套对象按 properties 校验且 additionalProperties:false 拒绝未知字段', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string' } },
    } as const;
    assert.match(firstMessage({}, schema), /v\.name 是必填字段/);
    assert.match(firstMessage({ name: 'n', extra: 1 }, schema), /v\.extra 不是允许的字段/);
    assert.deepEqual(validateInputValueDiagnostics({ name: 'n' }, schema, 'v'), []);
  });
});
