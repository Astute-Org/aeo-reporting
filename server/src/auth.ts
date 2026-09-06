// Optional HTTP basic auth over the whole app.
//
// Every click here spends third-party money and the tables hold a company's
// declared competitor list, so anything reachable from the internet should be
// behind this. Basic auth because the browser handles it natively: no login
// screen to build, and nothing to store.

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminPassword) return next();

  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (matches(password, config.adminPassword)) return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="AEO reporting", charset="UTF-8"');
  res.status(401).json({ error: 'authentication required' });
}
