import { Module } from '@nestjs/common';
import { CameraProfilesModule } from '../camera-profiles/camera-profiles.module';
import { SharingModule } from '../sharing/sharing.module';
import { LiveConfigService } from './live-config.service';
import { LiveController } from './live.controller';
import { MqttPtzTransport } from './mqtt-ptz.transport';
import { PTZ_TRANSPORT } from './ptz';

@Module({
  imports: [CameraProfilesModule, SharingModule],
  providers: [LiveConfigService, MqttPtzTransport, { provide: PTZ_TRANSPORT, useExisting: MqttPtzTransport }],
  controllers: [LiveController],
  exports: [LiveConfigService],
})
export class LiveModule {}
