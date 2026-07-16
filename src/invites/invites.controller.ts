import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { RedeemInviteDto } from './dto/redeem-invite.dto';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  create(@Body() dto: CreateInviteDto) { return this.invites.createInvite(dto.email); }

  @Post('redeem')
  redeem(@Body() dto: RedeemInviteDto) { return this.invites.redeem(dto.token, dto.password); }
}
