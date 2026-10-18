import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { standardCatalogComponentDeclarations } from '../../src/catalog/standard';

describe('standardCatalogComponentDeclarations', () => {
  it('17 个标准组件齐备', () => {
    const declarations = standardCatalogComponentDeclarations();
    assert.equal(Object.keys(declarations).length, 17);
    for (const name of ['Text', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'Button']) {
      assert.ok(name in declarations, `${name} 缺失`);
    }
  });

  it('每次调用返回深拷贝：修改返回值不泄漏到 SDK 与后续调用（证伪：浅拷贝共享嵌套对象）', () => {
    const first = standardCatalogComponentDeclarations();
    // 深改 first 的嵌套 schema
    const firstTextProps = first.Text.schema.properties as unknown as Record<
      string,
      { maxLength?: number }
    >;
    firstTextProps.text.maxLength = 1;

    const second = standardCatalogComponentDeclarations();
    const secondTextProps = second.Text.schema.properties as unknown as Record<
      string,
      { maxLength?: number }
    >;
    assert.notEqual(secondTextProps.text.maxLength, 1, '修改一次调用的返回值不得影响后续调用');

    // 已用返回值注册的 Catalog 与新返回值互不影响
    const third = standardCatalogComponentDeclarations();
    assert.notEqual(first.Text.schema, third.Text.schema);
    assert.notEqual(
      (first.TextField.schema as { properties?: unknown }).properties,
      (third.TextField.schema as { properties?: unknown }).properties,
    );
  });
});
