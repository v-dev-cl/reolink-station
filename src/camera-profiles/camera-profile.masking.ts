import { CameraConfig, StorageConfig } from './camera-profile.config';

export function maskStorage(s: StorageConfig) {
  return { host: s.host, port: s.port, user: s.user, basePath: s.basePath, hasPass: !!s.pass };
}
export function maskCamera(c: CameraConfig) {
  return { uid: c.uid, codec: c.codec, hasPassword: !!c.password };
}
