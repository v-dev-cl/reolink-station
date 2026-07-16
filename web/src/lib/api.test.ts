import { api, ApiError } from './api';
import { vi, afterEach } from 'vitest';

afterEach(() => vi.restoreAllMocks());

it('GET returns parsed json', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
  await expect(api.get<{ ok: number }>('/x')).resolves.toEqual({ ok: 1 });
});
it('throws ApiError with status on non-2xx', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
  await expect(api.get('/x')).rejects.toMatchObject({ status: 401 } as ApiError);
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
