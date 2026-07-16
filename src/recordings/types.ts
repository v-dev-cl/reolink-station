export interface RecordingEntry {
  name: string;
  path: string; // relative to the profile base_path
  type: 'dir' | 'file';
  size: number;
  mtime: number; // epoch ms
}
export interface RangeSpec { start: number; end: number }
