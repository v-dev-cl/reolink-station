import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, MqttClient } from 'mqtt';
import { buildPtzPayload, buildPtzTopic, PtzCommand, PtzTransport } from './ptz';

const SEND_TIMEOUT_MS = 3_000;

@Injectable()
export class MqttPtzTransport implements PtzTransport, OnModuleDestroy {
  private readonly logger = new Logger(MqttPtzTransport.name);
  private client?: MqttClient;

  constructor(private readonly config: ConfigService) {}

  private conn(): MqttClient {
    if (!this.client) {
      // queueQoSZero:false — a publish while disconnected fails immediately instead of
      // queueing; queued moves would burst-deliver on reconnect and re-move the camera.
      this.client = connect(this.config.getOrThrow<string>('MQTT_URL'), { queueQoSZero: false });
      this.client.on('error', (e) => this.logger.warn(`mqtt error: ${e.message}`));
    }
    return this.client;
  }

  async send(profileId: string, command: PtzCommand, amount?: number): Promise<void> {
    const client = this.conn();
    let timer: NodeJS.Timeout | undefined;
    let onConnect: (() => void) | undefined;
    const attempt = (async () => {
      if (!client.connected) {
        await new Promise<void>((resolve) => {
          onConnect = () => resolve();
          client.once('connect', onConnect);
        });
      }
      await new Promise<void>((resolve, reject) => {
        client.publish(buildPtzTopic(profileId), buildPtzPayload(command, amount), (err) => {
          if (err) {
            this.logger.warn(`ptz publish failed: ${err.message}`);
            reject(new ServiceUnavailableException('ptz broker unavailable'));
          } else {
            resolve();
          }
        });
      });
    })();
    attempt.catch(() => undefined); // if the timeout wins, the late rejection must not go unhandled
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ServiceUnavailableException('ptz broker unavailable')), SEND_TIMEOUT_MS);
    });
    try {
      await Promise.race([attempt, timeout]);
    } finally {
      clearTimeout(timer);
      if (onConnect) client.removeListener('connect', onConnect);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((r) => (this.client ? this.client.end(false, {}, () => r()) : r()));
  }
}
