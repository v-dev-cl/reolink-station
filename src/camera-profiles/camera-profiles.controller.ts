import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { CameraAccessGuard, RequireManage } from '../sharing/camera-access.guard';
import { CameraAccessService } from '../sharing/camera-access.service';
import { CameraProfilesService } from './camera-profiles.service';
import { CreateCameraProfileDto } from './dto/create-camera-profile.dto';
import { UpdateCameraProfileDto } from './dto/update-camera-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller('camera-profiles')
export class CameraProfilesController {
  constructor(
    private readonly profiles: CameraProfilesService,
    private readonly access: CameraAccessService,
  ) {}

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateCameraProfileDto) {
    const p = await this.profiles.create(u.userId, dto);
    return this.profiles.getMasked(p.id);
  }

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const ids = await this.access.accessibleProfileIds(u.userId);
    return Promise.all(ids.map((id) => this.profiles.getMasked(id)));
  }

  @UseGuards(CameraAccessGuard)
  @Get(':id')
  get(@Param('id') id: string) { return this.profiles.getMasked(id); }

  @UseGuards(CameraAccessGuard)
  @RequireManage()
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCameraProfileDto) {
    return this.profiles.update(id, dto);
  }

  @UseGuards(CameraAccessGuard)
  @RequireManage()
  @Delete(':id')
  remove(@Param('id') id: string) { return this.profiles.remove(id); }
}
