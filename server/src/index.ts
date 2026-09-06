// One process: the API, the built client, and the scheduler.

import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { basicAuth } from './auth.js';
import { config, REPO_ROOT } from './config.js';
import { getDb } from './db.js';
import { api } from './routes.js';
import { releaseRuns, startScheduler } from './scheduler.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(basicAuth);
app.use('/api', api);

// The built client, when it exists. In development the Vite dev server
// serves the client and proxies /api here instead.
const clientDist = path.join(REPO_ROOT, 'client', 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('AEO reporting API is running. Build the client with `npm run build`, or run `npm run dev` for the Vite dev server.');
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[aeo] unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
});

getDb();
const server = app.listen(config.port, () => {
  console.log(`[aeo] listening on http://localhost:${config.port}${config.adminPassword ? ' (basic auth on)' : ' (no password set)'}`);
  startScheduler();
});

function shutdown(signal: string) {
  console.log(`[aeo] ${signal} received, shutting down`);
  releaseRuns();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
