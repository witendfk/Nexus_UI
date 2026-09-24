/**
 * @nexus-ui/react —— React 渲染层。
 *
 * 把内核 onRender(VNode) 经 ReactRenderer + renderMap 映射成 React 元素并挂载；
 * 组件 action 经 ctx.triggerAction → runtime.triggerAction → onAction 出口（范式无关）。
 * mount/update/unmount 全交 React，不自研 reconciler。
 *
 * 本文件仅为 barrel（聚合导出）；实现见 renderer / components / provider。
 */
import './style'; // 副作用：注入挂载淡入样式

export {
  CORE_VERSION,
  PROTOCOL_VERSION,
  REACT_RENDERER_VERSION,
  REACT_API_VERSION,
  SUPPORTED_CORE_API_VERSION,
  SUPPORTED_CORE_VERSION_RANGE,
  getReactCoreCompatibility,
} from './version';
export type { ReactCoreCompatibility } from './version';
export type { RenderContext, RenderFn, RenderMap } from './types';
export { ReactRenderer } from './renderer';
export {
  standardRenderMap,
  Text,
  TextField,
  CheckBox,
  ChoicePicker,
  DateTimeInput,
  Slider,
  Button,
  Column,
  Row,
  List,
  Tabs,
  Image,
  Card,
  Icon,
  Divider,
} from './components';
export { A2UIProvider, useA2UI } from './provider';
export type { A2UIProviderProps } from './provider';
export type { ActionEvent, VNode } from '@nexus-ui/core';
