export interface StorageConfig { host: string; port: number; user: string; pass: string; basePath: string; }
export interface CameraConfig { uid: string; password: string; codec: 'h264'; }
export const STORAGE_SECRET_KEYS: (keyof StorageConfig)[] = ['pass'];
export const CAMERA_SECRET_KEYS: (keyof CameraConfig)[] = ['password'];
