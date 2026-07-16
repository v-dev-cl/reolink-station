export type PtzCommand = 'up' | 'down' | 'left' | 'right' | 'in' | 'out' | 'stop';
export const PTZ_COMMANDS: PtzCommand[] = ['up', 'down', 'left', 'right', 'in', 'out', 'stop'];

export function buildPtzTopic(profileId: string): string {
  return `neolink/${profileId}/control/ptz`;
}
export function buildPtzPayload(command: PtzCommand, amount = 32): string {
  return command === 'stop' ? 'stop' : `${command} ${amount}`;
}

export interface PtzTransport {
  send(profileId: string, command: PtzCommand, amount?: number): Promise<void>;
}
export const PTZ_TRANSPORT = Symbol('PTZ_TRANSPORT');
