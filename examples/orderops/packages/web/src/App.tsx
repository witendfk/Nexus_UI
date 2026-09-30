import type { ActionEvent } from '@nexus-ui/core';
import { A2UIProvider } from '@nexus-ui/react';
import { createContext, useContext, useRef, type MutableRefObject } from 'react';
import { Route, Routes } from 'react-router-dom';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { QueuePage } from './pages/QueuePage';

/**
 * action 桥：Provider.onAction 在 context 之外，持 runtime 的页面组件经此
 * 注册处理器（原 ref 透传模式在路由组合下的等价物）。
 */
const ActionBridgeContext = createContext<MutableRefObject<(event: ActionEvent) => void>>({
  current: () => {},
});

export function useActionBridge(): MutableRefObject<(event: ActionEvent) => void> {
  return useContext(ActionBridgeContext);
}

/**
 * App 只负责路由组合 + action 桥；BrowserRouter 由 main.tsx 提供（测试用
 * MemoryRouter 注入）。路由参数驱动数据获取——刷新后状态一致，见 T2.6 判据。
 */
export function App() {
  const actionHandler = useRef<(event: ActionEvent) => void>(() => {});
  return (
    <A2UIProvider onAction={(event) => actionHandler.current(event)}>
      <ActionBridgeContext.Provider value={actionHandler}>
        <main>
          <h1>OrderOps Copilot</h1>
          <Routes>
            <Route path="/" element={<QueuePage />} />
            <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          </Routes>
        </main>
      </ActionBridgeContext.Provider>
    </A2UIProvider>
  );
}
