/**
 * @nexus-ui/react/style —— 显式注入骨架样式（挂载淡入）。S4.2 起不再随包
 * import 自动注入：宿主按需调用本函数（幂等，重复调用只注入一次）。
 *
 * 仅浏览器环境生效；React 按 key 复用 DOM：已挂载节点不会重新插入，动画只在
 * **新挂载**节点上跑一次。
 */
let injected = false;

export function injectNexusStyle(): void {
  if (injected) return;
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  if (document.getElementById('nexus-react-style')) {
    injected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'nexus-react-style';
  style.textContent = [
    '@keyframes nexusFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
    '.nexus-surface, .nexus-surface * { animation: nexusFadeIn .28s ease both; }',
  ].join('\n');
  document.head.appendChild(style);
  injected = true;
}

export {};
