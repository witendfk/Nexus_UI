/**
 * @nexus-ui/core/action —— action 事件构造。
 *
 * 对齐需求文档内核盒子的 **Event** 模块。职责：把组件 action 定义 + 数据模型，
 * 解析成已就绪的 `ActionEvent`（context 经 `resolveContext` 解析为真值），供
 * `runtime.triggerAction` 经 `onAction` 吐出。纯函数，可独立测试。
 *
 * 这是 action 出口 seam 的"构造"半边；"回调"半边在 runtime.triggerAction。
 * context 在 core 解析（模型在 core），故此函数留在内核，宿主/渲染层不碰。
 */
import { resolveContext } from '../dataModel';
import type { ActionEvent, Component } from '../protocol/types';

/**
 * [seam] 由组件 action + 数据模型构造已解析的 ActionEvent；无服务端 action 返回 null。
 */
export function buildActionEvent(
  component: Component,
  surfaceId: string,
  model: unknown,
): ActionEvent | null {
  const action = component.action;
  if (!action?.event) return null;
  return {
    name: action.event.name,
    surfaceId,
    sourceComponentId: component.id,
    context: resolveContext(action.event.context, model),
  };
}
