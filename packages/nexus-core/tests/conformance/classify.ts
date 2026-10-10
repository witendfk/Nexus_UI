/**
 * 官方 A2UI v0.9 conformance 分类器（数据源：specification/v0_9/test/cases 的 9 份用例）。
 *
 * 官方用例以 JSON Schema 判 valid/invalid；本模块把每条用例过本仓两层校验并归类：
 *   - validateProtocolMessage  = 官方结构层（对齐官方 schema 的结论面）
 *   - validateNexusProfileMessage = Nexus Runtime Profile 支持边界
 *
 * 结论口径（与 docs/SPEC.md 的 conformance 决策一致）：
 *   pass        官方与我们的两层结论一致
 *   deviation   已决策的已知偏差（kind 标注），决策记录在基线文档
 *   fail        官方合法但协议层拒绝（分层回归，禁止出现）等未决策分歧
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateNexusProfileMessage, validateProtocolMessage } from '../../src/protocol/validator';

/** 用例目录（相对本文件定位，勿在别处重新拼接相对路径——直接复用 CASES_URL）。 */
export const CONFORMANCE_CASES_DIR = '../../../../specification/v0_9/test/cases';
/** 已解析的用例目录 URL：其他文件读取用例时一律基于它，避免相对深度耦合。 */
export const CONFORMANCE_CASES_URL = new URL(`${CONFORMANCE_CASES_DIR}/`, import.meta.url);

export type ConformanceVerdict = 'pass' | 'deviation' | 'fail';

export type DeviationKind =
  /** client_to_server 方向：core 校验器契约是 server→client 流入边界，c2s 由宿主侧处理 */
  | 'scope-client-to-server'
  /** 官方合法、协议层放行、Profile 明确不支持（FunctionCall / and-or-not / 非核心组件 checks） */
  | 'profile-unsupported'
  /** 官方非法、协议层按结构子集放行、Profile 的契约校验兜住 */
  | 'profile-catches-protocol-loose'
  /** 官方非法的值级约束（deprecated 字段/颜色格式/variant 拼写），协议与 Profile 均放行，渲染层降级 */
  | 'degraded-value-constraint';

export interface ConformanceEntry {
  file: string;
  description: string;
  officialValid: boolean;
  protocolOk: boolean;
  profileOk: boolean;
  verdict: ConformanceVerdict;
  deviationKind?: DeviationKind;
  /** Profile 拒绝时的诊断消息（供基线审阅，不参与断言）。 */
  profileMessage?: string;
}

interface OfficialCase {
  description: string;
  valid: boolean;
  data: unknown;
}

function classifyCase(file: string, isClientToServer: boolean, testCase: OfficialCase): ConformanceEntry {
  const protocol = validateProtocolMessage(testCase.data);
  const protocolOk = protocol.ok;
  const profileError = protocolOk
    ? validateNexusProfileMessage((protocol as { message: unknown }).message)
    : null;
  const profileOk = protocolOk && profileError === null;
  const base: ConformanceEntry = {
    file,
    description: testCase.description,
    officialValid: testCase.valid,
    protocolOk,
    profileOk,
    verdict: 'pass',
  };
  if (profileError) base.profileMessage = profileError.message;

  if (isClientToServer) {
    return { ...base, verdict: 'deviation', deviationKind: 'scope-client-to-server' };
  }
  if (testCase.valid && protocolOk && profileOk) return base;
  if (testCase.valid && protocolOk) {
    return { ...base, verdict: 'deviation', deviationKind: 'profile-unsupported' };
  }
  if (testCase.valid && !protocolOk) {
    // 官方合法被协议层拒绝 = 分层回归，不允许静默归入偏差
    return { ...base, verdict: 'fail' };
  }
  if (!testCase.valid && !protocolOk) return base;
  if (profileError) {
    return { ...base, verdict: 'deviation', deviationKind: 'profile-catches-protocol-loose' };
  }
  return { ...base, verdict: 'deviation', deviationKind: 'degraded-value-constraint' };
}

function classifyJsonlLine(file: string, line: string, index: number): ConformanceEntry {
  const data = JSON.parse(line) as Record<string, unknown>;
  const payloadKey = Object.keys(data).find((key) => key !== 'version') ?? 'unknown';
  // contact_form_example.jsonl 是官方给出的合法示例流，逐行视为官方合法
  return classifyCase(file, false, {
    description: `contact form stream #${index} (${payloadKey})`,
    valid: true,
    data,
  });
}

export interface ConformanceReport {
  source: string;
  suites: Array<{ file: string; schema: string | 'jsonl-stream'; total: number }>;
  entries: ConformanceEntry[];
  totals: Record<string, number>;
}

/** 读取官方 9 份用例并产出完整分类报告。 */
export function buildConformanceReport(): ConformanceReport {
  const dir = fileURLToPath(CONFORMANCE_CASES_URL);
  const files = readdirSyncSafe(dir);

  const entries: ConformanceEntry[] = [];
  const suites: ConformanceReport['suites'] = [];
  for (const file of files) {
    if (file.endsWith('.json')) {
      const suite = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as {
        schema: string;
        tests: OfficialCase[];
      };
      const isC2S = suite.schema === 'client_to_server.json';
      const classified = suite.tests.map((t) => classifyCase(file, isC2S, t));
      entries.push(...classified);
      suites.push({ file, schema: suite.schema, total: classified.length });
    } else if (file.endsWith('.jsonl')) {
      const lines = readFileSync(`${dir}/${file}`, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const classified = lines.map((line, index) => classifyJsonlLine(file, line, index));
      entries.push(...classified);
      suites.push({ file, schema: 'jsonl-stream', total: classified.length });
    }
  }

  const totals: Record<string, number> = {};
  for (const entry of entries) {
    const key = entry.verdict === 'deviation' ? `deviation/${entry.deviationKind}` : entry.verdict;
    totals[key] = (totals[key] ?? 0) + 1;
  }
  return { source: 'specification/v0_9/test/cases', suites, entries, totals };
}

import { readdirSync } from 'node:fs';
function readdirSyncSafe(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json') || f.endsWith('.jsonl')).sort();
}
