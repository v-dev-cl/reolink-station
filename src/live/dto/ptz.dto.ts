import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PTZ_COMMANDS, PtzCommand } from '../ptz';

export class PtzDto {
  @IsIn(PTZ_COMMANDS) command!: PtzCommand;
  @IsOptional() @IsInt() @Min(1) @Max(100) amount?: number;
}
