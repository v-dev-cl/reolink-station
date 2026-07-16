import { Module } from '@nestjs/common';
import { SftpPoolModule } from './sftp-pool.module';
import { CameraProfilesModule } from '../camera-profiles/camera-profiles.module';
import { SharingModule } from '../sharing/sharing.module';
import { RecordingsService } from './recordings.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsManagerController } from './recordings-manager.controller';

@Module({
  imports: [SftpPoolModule, CameraProfilesModule, SharingModule],
  providers: [RecordingsService],
  controllers: [RecordingsController, RecordingsManagerController],
  exports: [RecordingsService],
})
export class RecordingsModule {}
