import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraProfileEntity } from './camera-profile.entity';
import { CameraProfilesService } from './camera-profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([CameraProfileEntity])],
  providers: [CameraProfilesService],
  exports: [CameraProfilesService],
})
export class CameraProfilesModule {}
