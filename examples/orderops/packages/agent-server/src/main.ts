import { createApp } from './http/app';

const port = Number(process.env.PORT ?? 3202);

createApp().listen(port, '127.0.0.1', () => {
  console.log(`@orderops/agent-server listening on http://127.0.0.1:${port}`);
});
