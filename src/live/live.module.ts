import { Module } from '@nestjs/common';
import { CameraProfilesModule } from '../camera-profiles/camera-profiles.module';
import { LiveConfigService } from './live-config.service';

@Module({
  imports: [CameraProfilesModule],
  providers: [LiveConfigService],
  exports: [LiveConfigService],
})
export class LiveModule {}
