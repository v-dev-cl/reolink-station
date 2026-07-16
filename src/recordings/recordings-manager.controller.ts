import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard, RequireManage } from '../sharing/camera-access.guard';
import { RecordingsService } from './recordings.service';
import { DeleteRecordingsDto } from './dto/delete-recordings.dto';
import { PruneRecordingsDto } from './dto/prune-recordings.dto';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@RequireManage()
@Controller('camera-profiles/:id/recordings')
export class RecordingsManagerController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post('delete')
  remove(@Param('id') id: string, @Body() dto: DeleteRecordingsDto) {
    return this.recordings.deleteFiles(id, dto.paths);
  }

  @Post('prune')
  prune(@Param('id') id: string, @Body() dto: PruneRecordingsDto) {
    return this.recordings.prune(id, dto.olderThanDays);
  }
}
