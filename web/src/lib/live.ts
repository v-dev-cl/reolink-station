import { api } from './api';

export type PtzCommand = 'up' | 'down' | 'left' | 'right' | 'in' | 'out' | 'stop';

export function liveStreamUrl(profileId: string): string {
  return `/api/camera-profiles/${profileId}/live/stream.mp4`;
}

export function sendPtz(profileId: string, command: PtzCommand, amount?: number): Promise<void> {
  const body: { command: PtzCommand; amount?: number } = { command };
  if (amount !== undefined) body.amount = amount;
  return api.post<void>(`/camera-profiles/${profileId}/ptz`, body);
}
