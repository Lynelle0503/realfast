import { createDefaultApiContext, createApiServer } from './api.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.CLAIMS_DB_PATH;

const context = createDefaultApiContext(dbPath ? { filePath: dbPath } : {});
const server = createApiServer(context);

server.listen(port, () => {
  console.log(`Claims API listening on http://127.0.0.1:${port}/api/v1`);
});

function shutdown(): void {
  server.close(() => {
    context.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
