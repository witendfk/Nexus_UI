import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { buildConformanceReport, CONFORMANCE_CASES_URL } from './conformance/classify';
import { A2UIRuntime } from '../src/runtime';

/**
 * A2UI v0.9 官方 conformance 基线（Layer 0.1/0.2 门禁）。
 *
 * 数据源：官方规范仓 9 份用例（specification/v0_9/test/cases，8 份 JSON Schema 套件
 * + 1 份完整示例流）。每条用例过本仓两层校验（协议层 = 官方结构对齐面，Profile 层 =
 * 支持边界），归类 pass / known-deviation / fail 后与 conformance-baseline.json
 * 逐条比对。校验器行为变化若改变 conformance 面，测试即失败——必须显式重新生成
 * 基线并在 docs/conformance-baseline.md 记录偏差决策，不允许静默漂移。
 */
describe('official conformance baseline (v0.9 cases)', () => {
  const report = buildConformanceReport();

  it('用例源完整：9 份用例、80 条判定，与官方目录一致', () => {
    expect(report.suites).to.have.lengthOf(9);
    const total = report.suites.reduce((sum, s) => sum + s.total, 0);
    expect(total).to.equal(80);
    expect(report.entries).to.have.lengthOf(total);
    expect(CONFORMANCE_CASES_URL.href).to.contain('specification/v0_9/test/cases');
  });

  it('零 fail：不存在「官方合法但协议层拒绝」的分层回归', () => {
    const fails = report.entries.filter((entry) => entry.verdict === 'fail');
    expect(fails, JSON.stringify(fails.map((f) => f.description))).to.have.lengthOf(0);
  });

  it('分类结果与基线快照逐条一致（漂移即失败，需显式再生基线）', () => {
    const baseline = JSON.parse(
      readFileSync(new URL('./conformance-baseline.json', import.meta.url), 'utf8'),
    ) as unknown;
    expect(report).to.deep.equal(baseline);
  });

  it('基线数字：33 pass + 47 已决策偏差（16 Profile 不支持 / 23 Profile 兜底 / 5 值级降级 / 3 方向不适用）', () => {
    expect(report.totals).to.deep.equal({
      pass: 33,
      'deviation/profile-unsupported': 16,
      'deviation/profile-catches-protocol-loose': 23,
      'deviation/degraded-value-constraint': 5,
      'deviation/scope-client-to-server': 3,
    });
  });

  it('contact form 官方示例流端到端：FunctionCall 消息被 Profile 可预测拒绝，流不断', () => {
    const runtime = new A2UIRuntime({ onRender: () => undefined });
    const lines = readFileSync(new URL('contact_form_example.jsonl', CONFORMANCE_CASES_URL), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(() => runtime.push(`${lines.join('\n')}\n`)).to.not.throw();

    const state = runtime.store.getState();
    // 4 行全部被消费：createSurface + updateDataModel 接受，updateComponents 因
    // action.context 内嵌 FunctionCall 被 Profile 拒绝（官方合法 → known-deviation），
    // deleteSurface 正常收尾——坏消息不中断流。
    expect(state.errors).to.have.lengthOf(1);
    const error = state.errors[0] as { code?: string; message?: string };
    expect(error.code).to.equal('FEATURE_UNSUPPORTED');
    // 拒绝点在 action.context 的动态值契约（内嵌 formatDate FunctionCall 不受支持）
    expect(error.message).to.contain('不支持的动态值');
    expect(state.surfaces.contact_form_1).to.equal(undefined); // 已被 deleteSurface 清理
    expect(state.dataModelBySurface.contact_form_1).to.equal(undefined); // 级联清理
  });
});
