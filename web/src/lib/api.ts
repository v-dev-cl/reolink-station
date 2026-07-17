export class ApiError extends Error {
  constructor(public status: number, message?: string) { super(message ?? `HTTP ${status}`); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && typeof window !== 'undefined') {
      // Clear the rejected cookie first: middleware bounces /login → / while a cookie
      // exists, so redirecting with a stale token would loop forever.
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
      window.location.assign('/login');
    }
    throw new ApiError(res.status, await res.text().catch(() => undefined));
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => req<T>('PATCH', p, b),
  del: <T>(p: string, b?: unknown) => req<T>('DELETE', p, b),
};

export interface Me { id: string; email: string; role: 'user' | 'admin' }
export interface MaskedStorage { host: string; port: number; user: string; basePath: string; hasPass: boolean }
export interface MaskedCamera { uid: string; codec: string; hasPassword: boolean }
export interface CameraProfile { id: string; name: string; storage: MaskedStorage; camera: MaskedCamera; createdAt: string }
