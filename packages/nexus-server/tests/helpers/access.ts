import type { AgentAccessHooks } from '../../src/agent/adapter';

/**
 * 测试装配的显式放行（SPEC §6.5：SDK 缺省拒绝，宿主/demo 自行放行）。
 * 访问准入相关测试必须注入自己的钩子，不得复用本常量。
 */
export const allowAllAccess: AgentAccessHooks = {
  read: () => true,
  generate: () => true,
  action: () => true,
};

/** 只放行写入路径的测试装配：read 保持缺省拒绝，供查询准入反例使用。 */
export const generateActionAccess: AgentAccessHooks = {
  generate: () => true,
  action: () => true,
};
