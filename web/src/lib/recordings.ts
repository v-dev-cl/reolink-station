import { api } from './api';

export interface RecordingEntry {
  name: string;
  path: string; // relative to the profile's storage base path
  type: 'dir' | 'file';
  size: number;
  mtime: number; // epoch ms
}

export function listRecordings(profileId: string, dir = ''): Promise<RecordingEntry[]> {
  return api.get<RecordingEntry[]>(
    `/camera-profiles/${profileId}/recordings/list?dir=${encodeURIComponent(dir)}`,
  );
}

/** Same-origin media URL — the httpOnly cookie authenticates it automatically. */
export function recordingFileUrl(profileId: string, path: string): string {
  return `/api/camera-profiles/${profileId}/recordings/file?path=${encodeURIComponent(path)}`;
}

export function deleteRecordings(profileId: string, paths: string[]): Promise<{ deleted: number }> {
  return api.post<{ deleted: number }>(`/camera-profiles/${profileId}/recordings/delete`, { paths });
}

export function pruneRecordings(profileId: string, olderThanDays: number): Promise<{ deleted: number }> {
  return api.post<{ deleted: number }>(`/camera-profiles/${profileId}/recordings/prune`, { olderThanDays });
}

export function isVideo(name: string): boolean {
  return /\.mp4$/i.test(name);
}
export function isImage(name: string): boolean {
  return /\.jpe?g$/i.test(name);
}
