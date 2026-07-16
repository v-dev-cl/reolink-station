import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard } from '../sharing/camera-access.guard';
import { PtzDto } from './dto/ptz.dto';
import { PTZ_TRANSPORT, PtzTransport } from './ptz';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@Controller('camera-profiles/:id')
export class LiveController {
  constructor(
    private readonly config: ConfigService,
    @Inject(PTZ_TRANSPORT) private readonly ptz: PtzTransport,
  ) {}

  @Get('live/stream.mp4')
  async stream(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const base = this.config.getOrThrow<string>('GO2RTC_URL');
    const upstream = await fetch(`${base}/api/stream.mp4?src=${encodeURIComponent(id)}`);
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'video/mp4');
    if (!upstream.body) { res.end(); return; }
    Readable.fromWeb(upstream.body as never).pipe(res);
    req.on('close', () => { /* client left; upstream GC's on stream end */ });
  }

  @Post('ptz')
  async movePtz(@Param('id') id: string, @Body() dto: PtzDto): Promise<{ ok: true }> {
    await this.ptz.send(id, dto.command, dto.amount);
    return { ok: true };
  }
}
