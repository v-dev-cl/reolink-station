import { BadRequestException, Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
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
    if (!path) throw new BadRequestException('path is required');
    const { size } = await this.recordings.stat(id, path);
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType(path));
    if (range) {
      const { stream } = await this.recordings.openRead(id, path, range, size);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      stream.pipe(res);
    } else {
      const { stream } = await this.recordings.openRead(id, path, undefined, size);
      res.status(200);
      res.setHeader('Content-Length', String(size));
      stream.pipe(res);
    }
  }
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // malformed → serve full file
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return null;
  let start: number;
  let end: number;
  if (!hasStart) {
    const n = parseInt(m[2], 10); // suffix: last N bytes
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : size - 1;
    if (end >= size) end = size - 1;
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}
function contentType(p: string): string {
  if (p.endsWith('.mp4')) return 'video/mp4';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
