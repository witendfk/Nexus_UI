/**
 * @nexus-ui/core/state —— 多 Surface 隔离的状态中心（zustand vanilla）。
 *
 * 状态：surfaces / 每 surface 扁平组件表 / 每 surface 数据模型 / 错误。全框架无关。
 * 关键设计：
 *   - 按 surfaceId 全维度隔离；deleteSurface 级联清理该 surface 的组件表与数据。
 *   - 数据模型两条写入路径：`applyDataModel`（消费 updateDataModel 消息）、
 *     `setDataModelValueAtPath`（two-way binding：输入组件即时写本地模型），
 *     均复用 dataModel 纯函数。
 */
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { applyDataModelUpdate, setValueAtPath } from '../dataModel';
import type {
  A2UIError,
  Component,
  DataPath,
  Surface,
  UpdateDataModelPayload,
} from '../protocol/types';

/** 内核错误记录。 */
export type A2UIErrorRecord = A2UIError;

/** `[契约]` 内核 store 状态形状 + 动作。 */
export interface CoreState {
  surfaces: Record<string, Surface>;
  componentsBySurface: Record<string, Record<string, Component>>;
  dataModelBySurface: Record<string, unknown>;
  errors: A2UIErrorRecord[];

  createSurface(surface: Surface): void;
  upsertComponents(surfaceId: string, components: Component[]): void;
  applyDataModel(payload: UpdateDataModelPayload): void;
  /** [seam] 双向绑定写路径：输入组件即时写本地模型（范式 1 表单预留）。 */
  setDataModelValueAtPath(surfaceId: string, path: DataPath, value: unknown): void;
  deleteSurface(surfaceId: string): void;
  addError(error: A2UIErrorRecord): void;
}

/** zustand vanilla store 实例类型。 */
export type CoreStore = StoreApi<CoreState>;

/** 创建一个独立的内核 store（每运行时一个，避免状态串味）。 */
export function createCoreStore(): CoreStore {
  return createStore<CoreState>()((set) => ({
    surfaces: {},
    componentsBySurface: {},
    dataModelBySurface: {},
    errors: [],

    createSurface: (surface) =>
      set((st) => ({ surfaces: { ...st.surfaces, [surface.id]: surface } })),

    upsertComponents: (surfaceId, components) =>
      set((st) => {
        const existing = st.componentsBySurface[surfaceId] ?? {};
        const next: Record<string, Component> = { ...existing };
        for (const c of components) next[c.id] = c;
        return { componentsBySurface: { ...st.componentsBySurface, [surfaceId]: next } };
      }),

    applyDataModel: (payload) =>
      set((st) => ({
        dataModelBySurface: {
          ...st.dataModelBySurface,
          [payload.surfaceId]: applyDataModelUpdate(
            st.dataModelBySurface[payload.surfaceId],
            payload,
          ),
        },
      })),

    setDataModelValueAtPath: (surfaceId, path, value) =>
      set((st) => ({
        dataModelBySurface: {
          ...st.dataModelBySurface,
          [surfaceId]: setValueAtPath(st.dataModelBySurface[surfaceId], path, value),
        },
      })),

    deleteSurface: (surfaceId) =>
      set((st) => {
        const surfaces = { ...st.surfaces };
        delete surfaces[surfaceId];
        const componentsBySurface = { ...st.componentsBySurface };
        delete componentsBySurface[surfaceId];
        const dataModelBySurface = { ...st.dataModelBySurface };
        delete dataModelBySurface[surfaceId];
        return { surfaces, componentsBySurface, dataModelBySurface };
      }),

    addError: (error) => set((st) => ({ errors: [...st.errors, error] })),
  }));
}
