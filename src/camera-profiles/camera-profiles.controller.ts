import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { CameraProfilesService } from './camera-profiles.service';
import { CreateCameraProfileDto } from './dto/create-camera-profile.dto';
import { UpdateCameraProfileDto } from './dto/update-camera-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller('camera-profiles')
export class CameraProfilesController {
  constructor(private readonly profiles: CameraProfilesService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCameraProfileDto) {
    const created = await this.profiles.create(user.userId, dto);
    // Never return the raw entity: storageConfig/cameraConfig hold ciphertext, not plaintext,
    // but the API/read shape must never expose either. Re-fetch through the masking path.
    return this.profiles.getMasked(created.id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.profiles.listForOwner(user.userId);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.profiles.getMasked(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCameraProfileDto) {
    return this.profiles.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.profiles.remove(id);
  }
}
