import type { ActionEvent } from '@nexus-ui/core';
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { analyzeCase, dispatchAction } from './nexus/transport';

type SurfaceStatus = 'idle' | 'streaming' | 'ready' | 'error';

interface CaseSurfaceProps {
  caseId: string;
  /** Provider 层 onAction 在 context 之外，经此 ref 桥接到持 runtime 的本组件。 */
  actionHandlerRef: MutableRefObject<(event: ActionEvent) => void>;
}

function CaseSurface({ caseId, actionHandlerRef }: CaseSurfaceProps) {
  const runtime = useA2UI();
  const [status, setStatus] = useState<SurfaceStatus>('idle');
  const [error, setError] = useState<string>();

  useEffect(() => {
    actionHandlerRef.current = (event: ActionEvent) => {
      void dispatchAction(runtime, event).then((outcome) => {
        if (!outcome.ok) {
          setStatus('error');
          setError(outcome.error);
        }
      });
    };
  }, [runtime, actionHandlerRef]);

  const analyze = useCallback(async () => {
    setStatus('streaming');
    setError(undefined);
    const outcome = await analyzeCase(runtime, caseId);
    if (outcome.ok) {
      setStatus('ready');
    } else {
      setStatus('error');
      setError(outcome.error);
    }
  }, [runtime, caseId]);

  return (
    <section>
      <p>当前案件：{caseId}</p>
      <button type="button" onClick={() => void analyze()} disabled={status === 'streaming'}>
        {status === 'streaming' ? '生成中…' : '生成审核 surface'}
      </button>
      {status === 'error' && <p role="alert">生成失败：{error}</p>}
    </section>
  );
}

export function App() {
  const actionHandler = useRef<(event: ActionEvent) => void>(() => {});
  return (
    <A2UIProvider onAction={(event) => actionHandler.current(event)}>
      <main>
        <h1>OrderOps Copilot</h1>
        <CaseSurface caseId="case-1" actionHandlerRef={actionHandler} />
      </main>
    </A2UIProvider>
  );
}
