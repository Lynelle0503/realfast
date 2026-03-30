import { createDefaultApiContext } from './api.js';
import { createLocalAppServer } from './local-app-server.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = process.env.CLAIMS_DB_PATH;

const context = createDefaultApiContext(dbPath ? { filePath: dbPath } : {});
const server = createLocalAppServer(context);

server.listen(port, host, () => {
  console.log(`Claims local app listening on http://${host}:${port}`);
  console.log(`Claims API available at http://${host}:${port}/api/v1`);
});

function shutdown(): void {
  server.close(() => {
    context.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
