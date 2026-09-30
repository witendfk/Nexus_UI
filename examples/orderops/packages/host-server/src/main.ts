import { createApp } from './http/app';

const port = Number(process.env.PORT ?? 3201);

createApp().listen(port, '127.0.0.1', () => {
  console.log(`@orderops/host-server listening on http://127.0.0.1:${port}`);
});
