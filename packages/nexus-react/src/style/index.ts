/**
 * @nexus-ui/react/style —— 注入骨架样式（挂载淡入）。仅浏览器环境，幂等。
 *
 * 让流式逐条到达的组件挂载时有 fade-in，避免「啪」地跳出，体感更丝滑。
 * React 按 key 复用 DOM：已挂载节点不会重新插入，动画只在**新挂载**节点上跑一次。
 */
if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  if (!document.getElementById('nexus-react-style')) {
    const style = document.createElement('style');
    style.id = 'nexus-react-style';
    style.textContent = [
      '@keyframes nexusFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
      '.nexus-surface, .nexus-surface * { animation: nexusFadeIn .28s ease both; }',
    ].join('\n');
    document.head.appendChild(style);
  }
}

export {};
