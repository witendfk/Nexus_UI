/**
 * Catalog Contract v2 注册闸门 × 共享 fixture 对测。
 *
 * fixture 数据源：仓库根 fixtures/catalog-v2/（S2.1 定稿，业务中立）。
 * accept 夹具必须注册成功；reject-registration 夹具必须抛错且命中
 * 对应契约条款的关键词。server 准入端（S2.4）消费同一份 request 夹具，
 * 双端对测结论必须一致（fixtures/catalog-v2/README.md）。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'mocha';
import { CatalogRegistry } from '../../src/catalog';

const fixturesDir = fileURLToPath(new URL('../../../../fixtures/catalog-v2/', import.meta.url));

/** reject 夹具 id → 注册闸门错误消息必须命中的关键词（对齐 SPEC §4.2 条款）。 */
const REJECT_PATTERNS: Record<string, RegExp> = {
  'v1-shape-missing-actions': /components 必须是组件声明表/,
  'unknown-schema-keyword': /不支持的 schema 关键字: format/,
  'inputs-on-forbidden-binding': /绑定能力为 forbidden，不支持 \{ path \} 绑定/,
  'action-required-without-source': /action\.required 但不在任何 action 的 sources 中/,
  'unsupported-pattern': /pattern 含不受支持的语法，无法求值/,
  'unknown-declaration-key': /含未知键: sourcez/,
  'legacy-fields-binding': /含未知键: binding/,
};

function loadFixtures(): Array<Record<string, unknown>> {
  return readdirSync(fixturesDir)
    .filter((name) => name.startsWith('catalog-') && name.endsWith('.json'))
    .sort()
    .map(
      (name) =>
        JSON.parse(readFileSync(`${fixturesDir}${name}`, 'utf8')) as Record<string, unknown>,
    );
}

describe('Catalog Contract v2 注册闸门（共享 fixture 对测）', () => {
  const fixtures = loadFixtures();

  it('夹具清单完整：2 份正常 + 7 份非法注册', () => {
    assert.equal(fixtures.length, 9);
    const accepts = fixtures.filter((fx) => fx.expect === 'accept');
    const rejects = fixtures.filter((fx) => fx.expect === 'reject-registration');
    assert.equal(accepts.length, 2);
    assert.equal(rejects.length, 7);
    for (const fx of rejects) {
      const id = fx.id as string;
      assert.ok(id in REJECT_PATTERNS, `夹具 ${id} 缺少拒绝关键词映射`);
    }
  });

  for (const fixture of fixtures) {
    const id = fixture.id as string;
    if (fixture.expect === 'accept') {
      it(`接受 ${id}`, () => {
        const registry = new CatalogRegistry([fixture.catalog as never]);
        const catalogId = (fixture.catalog as { catalogId: string }).catalogId;
        assert.equal(registry.has(catalogId), true);
      });
    } else if (fixture.expect === 'reject-registration') {
      it(`拒绝 ${id}（SPEC §4.2）`, () => {
        assert.throws(() => new CatalogRegistry([fixture.catalog as never]), REJECT_PATTERNS[id]);
      });
    }
  }

  it('非法夹具的偏差与原因可对账：accept 与 reject 两两不同目录', () => {
    const ids = new Set(fixtures.map((fx) => fx.id));
    assert.equal(ids.size, fixtures.length);
  });
});
