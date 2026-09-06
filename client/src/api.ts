// The one place the client talks to the server.
//
// Paths are '/companies/...', never '/api/companies/...': the prefix is added
// here. Basic auth, when the server has a password, is handled by the
// browser's own prompt.

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...((options.headers as Record<string, string>) ?? {}) },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error((body as Record<string, string>).error || `API error: ${res.status}`) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
