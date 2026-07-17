import { vi, afterEach } from 'vitest';
import { liveStreamUrl, sendPtz } from './live';

afterEach(() => vi.unstubAllGlobals());

it('liveStreamUrl points at the same-origin proxy for the profile', () => {
  expect(liveStreamUrl('p1')).toBe('/api/camera-profiles/p1/live/stream.mp4');
});

it('sendPtz posts the command (no amount key when omitted)', async () => {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await sendPtz('p1', 'left');
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/camera-profiles/p1/ptz');
  expect(JSON.parse(init.body)).toEqual({ command: 'left' });
});

it('sendPtz includes amount when provided', async () => {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await sendPtz('p1', 'in', 20);
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ command: 'in', amount: 20 });
});
