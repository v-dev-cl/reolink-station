import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard } from '../sharing/camera-access.guard';
import { RecordingsService } from './recordings.service';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@Controller('camera-profiles/:id/recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get('list')
  list(@Param('id') id: string, @Query('dir') dir = '') {
    return this.recordings.listDir(id, dir);
  }

  @Get('file')
  async file(
    @Param('id') id: string,
    @Query('path') path: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { size } = await this.recordings.stat(id, path);
    const range = parseRange(req.headers.range, size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType(path));
    if (range) {
      const { stream } = await this.recordings.openRead(id, path, range);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      stream.pipe(res);
    } else {
      const { stream } = await this.recordings.openRead(id, path);
      res.status(200);
      res.setHeader('Content-Length', String(size));
      stream.pipe(res);
    }
  }
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? 0 : parseInt(m[1], 10);
  let end = m[2] === '' ? size - 1 : parseInt(m[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) { start = 0; end = size - 1; }
  return { start, end };
}
function contentType(p: string): string {
  if (p.endsWith('.mp4')) return 'video/mp4';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
