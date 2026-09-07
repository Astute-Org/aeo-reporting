// Optional HTTP basic auth over the whole app.
//
// Every click here spends third-party money and the tables hold a company's
// declared competitor list, so anything reachable from the internet should be
// behind this. Basic auth because the browser handles it natively: no login
// screen to build, and nothing to store.
//
// A request that passes basic auth also gets a session cookie, and the cookie
// is accepted on its own afterwards. Browsers normally reuse cached basic-auth
// credentials for a page's own API calls, but not in every situation (a link
// with the password embedded in it, some embedded browsers), and a page whose
// API calls silently fail looks like an unconfigured server rather than a
// login problem. The cookie makes that path unambiguous. Its value is derived
// from a per-process secret, so it dies on restart and cannot be minted
// offline.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const COOKIE = 'aeo_session';
const SECRET = randomBytes(32);

function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionToken(): string {
  return createHmac('sha256', SECRET).update(config.adminPassword).digest('hex');
}

function cookieValue(req: Request): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminPassword) return next();

  const cookie = cookieValue(req);
  if (cookie && matches(cookie, sessionToken())) return next();

  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (matches(password, config.adminPassword)) {
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE}=${sessionToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`);
      return next();
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="AEO reporting", charset="UTF-8"');
  res.status(401).json({ error: 'authentication required' });
}
