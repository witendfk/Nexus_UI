import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDemoProcessPlan } from './dev-plan';

const root = fileURLToPath(new URL('..', import.meta.url));
const processes = createDemoProcessPlan();
const children = processes.map((processPlan) =>
  spawn(processPlan.command, processPlan.args, { cwd: root, stdio: 'inherit' }),
);

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`Demo process exited with code ${code ?? 'null'}.`);
      shutdown();
      process.exitCode = code ?? 1;
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
