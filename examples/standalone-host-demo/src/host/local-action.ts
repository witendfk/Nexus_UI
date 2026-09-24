import { DEMO_AGENT_ACTION } from '../contract';
import type { AgentAction } from '@nexus-ui/server';

function readContextValue(action: AgentAction, key: string): string {
  const value = action.context[key];
  return value === undefined || value === null ? 'unknown' : String(value);
}

/**
 * Local action fixture for hosts that keep a business operation in-process.
 * Its output is still candidate JSONL and must pass the same stream guard.
 */
export function createLocalApprovalActionHandler() {
  return (action: AgentAction) => {
    if (action.name !== DEMO_AGENT_ACTION) {
      throw new Error(`本地审批 handler 不支持 action: ${action.name}`);
    }

    const approvalId = readContextValue(action, 'approvalId');
    const amount = readContextValue(action, 'amount');
    return [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: action.surfaceId,
          components: [
            {
              id: 'root',
              component: 'ApprovalSummary',
              title: { path: '/title' },
              amount: { path: '/amount' },
              children: ['submit'],
            },
            {
              id: 'submit',
              component: 'Button',
              child: 'submitLabel',
              disabled: true,
            },
            { id: 'submitLabel', component: 'Text', text: 'Approved locally' },
          ],
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          value: {
            title: `Approved locally: ${approvalId}`,
            amount,
          },
        },
      },
    ];
  };
}
