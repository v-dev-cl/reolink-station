import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';

class StorageUpdateDto {
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() port?: number;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;      // blank = keep stored
  @IsOptional() @IsString() basePath?: string;
}
class CameraUpdateDto {
  @IsOptional() @IsString() uid?: string;
  @IsOptional() @IsString() password?: string;  // blank = keep stored
}
export class UpdateCameraProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @ValidateNested() @Type(() => StorageUpdateDto) storage?: StorageUpdateDto;
  @IsOptional() @ValidateNested() @Type(() => CameraUpdateDto) camera?: CameraUpdateDto;
}
