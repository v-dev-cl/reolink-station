import { api, ApiError } from './api';
import { vi, afterEach } from 'vitest';

afterEach(() => vi.restoreAllMocks());

it('GET returns parsed json', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
  await expect(api.get<{ ok: number }>('/x')).resolves.toEqual({ ok: 1 });
});
it('throws ApiError with status on non-2xx', async () => {
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', { configurable: true, value: { assign: vi.fn(), href: '' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
  await expect(api.get('/x')).rejects.toMatchObject({ status: 401 } as ApiError);
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});
it('redirects to /login on a 401 from any path other than /auth/login', async () => {
  const originalLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { assign, href: '' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
  await expect(api.get('/camera-profiles')).rejects.toMatchObject({ status: 401 } as ApiError);
  expect(assign).toHaveBeenCalledWith('/login');
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});
it('does not redirect on a 401 from /auth/login (lets LoginForm show its own error)', async () => {
  const originalLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { assign, href: '' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
  await expect(api.post('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toMatchObject({ status: 401 } as ApiError);
  expect(assign).not.toHaveBeenCalled();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});
it('POST sends json body and credentials', async () => {
  const spy = vi.fn(async () => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await api.post('/auth/login', { email: 'a@b.c', password: 'x' });
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/auth/login');
  expect(init.credentials).toBe('same-origin');
  expect(JSON.parse(init.body)).toEqual({ email: 'a@b.c', password: 'x' });
});
