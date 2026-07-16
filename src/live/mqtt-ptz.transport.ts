import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, MqttClient } from 'mqtt';
import { buildPtzPayload, buildPtzTopic, PtzCommand, PtzTransport } from './ptz';

@Injectable()
export class MqttPtzTransport implements PtzTransport, OnModuleDestroy {
  private readonly logger = new Logger(MqttPtzTransport.name);
  private client?: MqttClient;

  constructor(private readonly config: ConfigService) {}

  private conn(): MqttClient {
    if (!this.client) {
      this.client = connect(this.config.getOrThrow<string>('MQTT_URL'));
      this.client.on('error', (e) => this.logger.warn(`mqtt error: ${e.message}`));
    }
    return this.client;
  }

  async send(profileId: string, command: PtzCommand, amount?: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.conn().publish(buildPtzTopic(profileId), buildPtzPayload(command, amount), (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((r) => (this.client ? this.client.end(false, {}, () => r()) : r()));
  }
}
