import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraShareEntity } from './camera-share.entity';
import { CameraProfileEntity } from '../camera-profiles/camera-profile.entity';
import { CameraAccessService } from './camera-access.service';
import { CameraAccessGuard } from './camera-access.guard';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([CameraShareEntity, CameraProfileEntity]), UsersModule],
  providers: [CameraAccessService, CameraAccessGuard, SharingService],
  controllers: [SharingController],
  exports: [CameraAccessService, CameraAccessGuard, SharingService],
})
export class SharingModule {}
