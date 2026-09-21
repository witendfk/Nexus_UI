import { createElement, useState } from 'react';
import type { ReactNode } from 'react';
import type { RenderFn } from '../types';

interface TabsViewProps {
  id: string;
  tabs: Array<{ title?: unknown; child?: unknown }>;
  children: ReactNode[];
}

function TabsView({ id, tabs, children }: TabsViewProps) {
  const [requestedIndex, setRequestedIndex] = useState(0);
  const activeIndex = tabs.length === 0 ? 0 : Math.min(requestedIndex, tabs.length - 1);

  return createElement(
    'section',
    { key: id, style: { width: '100%' } },
    createElement(
      'div',
      { role: 'tablist', style: { display: 'flex', gap: 4, borderBottom: '1px solid #e3e3e3' } },
      ...tabs.map((tab, index) =>
        createElement(
          'button',
          {
            key: `${id}-tab-${String(tab.child ?? index)}`,
            type: 'button',
            role: 'tab',
            'aria-selected': index === activeIndex,
            onClick: () => setRequestedIndex(index),
            style: {
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '8px 10px',
              fontWeight: index === activeIndex ? 600 : 400,
              color: index === activeIndex ? '#111' : '#666',
              borderBottom: index === activeIndex ? '2px solid #111' : '2px solid transparent',
            },
          },
          tab.title === undefined ? null : String(tab.title),
        ),
      ),
    ),
    createElement(
      'div',
      { role: 'tabpanel', style: { paddingTop: 12 } },
      children[activeIndex] ?? null,
    ),
  );
}

/** Tabs：协议静态 tabs 定义；active 状态留在渲染层本地。 */
export const Tabs: RenderFn = (vnode, children) => {
  const tabs = Array.isArray(vnode.props.tabs)
    ? (vnode.props.tabs as Array<{ title?: unknown; child?: unknown }>)
    : [];
  return createElement(TabsView, { id: vnode.id, tabs, children });
};
