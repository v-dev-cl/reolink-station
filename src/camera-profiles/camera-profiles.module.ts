import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraProfileEntity } from './camera-profile.entity';
import { CameraProfilesService } from './camera-profiles.service';
import { CameraProfilesController } from './camera-profiles.controller';
import { SharingModule } from '../sharing/sharing.module';

@Module({
  imports: [TypeOrmModule.forFeature([CameraProfileEntity]), SharingModule],
  controllers: [CameraProfilesController],
  providers: [CameraProfilesService],
  exports: [CameraProfilesService],
})
export class CameraProfilesModule {}
