import { BadRequestException, Controller, Get, Logger, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard } from '../sharing/camera-access.guard';
import { RecordingsService } from './recordings.service';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@Controller('camera-profiles/:id/recordings')
export class RecordingsController {
  private readonly logger = new Logger(RecordingsController.name);

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
    // recordings are timestamped and never rewritten — safe for the browser to cache
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(size));
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    try {
      await this.recordings.streamTo(id, path, res, range ?? undefined);
    } catch (err) {
      // headers are already sent — an HTTP error is no longer possible; cut the connection
      this.logger.warn(`stream ${path} failed: ${err instanceof Error ? err.message : err}`);
      res.destroy();
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
