import { Body, Controller, Get, Inject, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Readable, pipeline } from 'node:stream';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard, RequireManage } from '../sharing/camera-access.guard';
import { PtzDto } from './dto/ptz.dto';
import { PTZ_TRANSPORT, PtzTransport } from './ptz';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@Controller('camera-profiles/:id')
export class LiveController {
  private readonly logger = new Logger(LiveController.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(PTZ_TRANSPORT) private readonly ptz: PtzTransport,
  ) {}

  @Get('live/stream.mp4')
  async stream(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const base = this.config.getOrThrow<string>('GO2RTC_URL');
    const upstream = await fetch(`${base}/api/stream.mp4?src=${encodeURIComponent(id)}`);
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'video/mp4');
    if (!upstream.body) { res.end(); return; }
    pipeline(Readable.fromWeb(upstream.body as never), res, (err) => {
      if (err) this.logger.warn(`live stream ${id} pipe error: ${err.message}`);
    });
  }

  @RequireManage()
  @Post('ptz')
  async movePtz(@Param('id') id: string, @Body() dto: PtzDto): Promise<{ ok: true }> {
    await this.ptz.send(id, dto.command, dto.amount);
    return { ok: true };
  }
}
