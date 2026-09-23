import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const children = [
  spawn('pnpm', ['exec', 'tsx', 'scripts/run-agent.ts'], { cwd: root, stdio: 'inherit' }),
  spawn('pnpm', ['exec', 'tsx', 'scripts/run-host.ts'], { cwd: root, stdio: 'inherit' }),
  spawn('pnpm', ['exec', 'vite'], { cwd: root, stdio: 'inherit' }),
];

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`Demo process exited with code ${code ?? 'null'}.`);
      shutdown();
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => {
  shutdown();
  process.exit();
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit();
});
