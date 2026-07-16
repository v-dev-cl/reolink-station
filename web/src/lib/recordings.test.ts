import { vi, afterEach } from 'vitest';
import {
  listRecordings, recordingFileUrl, deleteRecordings, pruneRecordings, isVideo, isImage,
} from './recordings';

afterEach(() => { vi.unstubAllGlobals(); });

it('listRecordings encodes the dir into the query', async () => {
  const spy = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', spy);
  await listRecordings('p1', '2026/07/15');
  expect(spy.mock.calls[0][0]).toBe('/api/camera-profiles/p1/recordings/list?dir=2026%2F07%2F15');
});

it('listRecordings defaults to the root dir', async () => {
  const spy = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', spy);
  await listRecordings('p1');
  expect(spy.mock.calls[0][0]).toBe('/api/camera-profiles/p1/recordings/list?dir=');
});

it('recordingFileUrl encodes the path', () => {
  expect(recordingFileUrl('p1', '2026/07/15/a b.mp4'))
    .toBe('/api/camera-profiles/p1/recordings/file?path=2026%2F07%2F15%2Fa%20b.mp4');
});

it('deleteRecordings posts the paths array', async () => {
  const spy = vi.fn(async () => new Response('{"deleted":2}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await expect(deleteRecordings('p1', ['a.mp4', 'b.jpg'])).resolves.toEqual({ deleted: 2 });
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/camera-profiles/p1/recordings/delete');
  expect(JSON.parse(init.body)).toEqual({ paths: ['a.mp4', 'b.jpg'] });
});

it('pruneRecordings posts olderThanDays', async () => {
  const spy = vi.fn(async () => new Response('{"deleted":5}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await expect(pruneRecordings('p1', 30)).resolves.toEqual({ deleted: 5 });
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ olderThanDays: 30 });
});

it('classifies file kinds by extension (case-insensitive)', () => {
  expect(isVideo('clip.mp4')).toBe(true);
  expect(isVideo('CLIP.MP4')).toBe(true);
  expect(isImage('shot.jpg')).toBe(true);
  expect(isImage('shot.JPEG')).toBe(true);
  expect(isVideo('shot.jpg')).toBe(false);
  expect(isImage('clip.mp4')).toBe(false);
});
