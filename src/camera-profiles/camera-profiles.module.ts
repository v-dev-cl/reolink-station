import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraProfileEntity } from './camera-profile.entity';
import { CameraProfilesService } from './camera-profiles.service';
import { CameraProfilesController } from './camera-profiles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CameraProfileEntity])],
  providers: [CameraProfilesService],
  controllers: [CameraProfilesController],
  exports: [CameraProfilesService],
})
export class CameraProfilesModule {}
