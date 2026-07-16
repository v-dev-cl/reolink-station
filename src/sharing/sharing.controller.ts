import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard, RequireManage } from './camera-access.guard';
import { SharingService } from './sharing.service';
import { CreateShareDto } from './dto/create-share.dto';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@RequireManage()
@Controller('camera-profiles/:id/shares')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post()
  grant(@Param('id') id: string, @Body() dto: CreateShareDto) {
    return this.sharing.grant(id, dto.email, dto.permission);
  }

  @Delete(':granteeId')
  revoke(@Param('id') id: string, @Param('granteeId') granteeId: string) {
    return this.sharing.revoke(id, granteeId);
  }
}
