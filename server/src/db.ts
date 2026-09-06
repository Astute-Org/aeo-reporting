// One SQLite file, opened once.
//
// SQLite rather than a database server because the whole point of this repo
// is that anyone can clone it and run it: a reading is a few hundred rows, a
// year of readings is a few megabytes, and a single process is all the
// concurrency the scheduler needs.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseHandle } from 'better-sqlite3';
import { config } from './config.js';
import { SCHEMA } from './schema.js';

export type Db = DatabaseHandle;

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

let handle: Db | null = null;

/** The process-wide database. Opened lazily so tests can swap in memory. */
export function getDb(): Db {
  if (!handle) handle = openDb(process.env.AEO_DB_FILE ?? path.join(config.dataDir, 'aeo.sqlite'));
  return handle;
}

export function useDb(db: Db): void {
  handle = db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function parseList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function toList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = String(v ?? '').trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
