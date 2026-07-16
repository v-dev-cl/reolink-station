import { IsInt, Min } from 'class-validator';
export class PruneRecordingsDto {
  @IsInt() @Min(1) olderThanDays!: number;
}
