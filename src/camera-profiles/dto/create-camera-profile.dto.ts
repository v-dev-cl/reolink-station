import { Type } from 'class-transformer';
import { IsInt, IsString, MinLength, ValidateNested } from 'class-validator';

class StorageDto {
  @IsString() host!: string;
  @IsInt() port!: number;
  @IsString() user!: string;
  @IsString() pass!: string;
  @IsString() basePath!: string;
}
class CameraDto {
  @IsString() uid!: string;
  @IsString() password!: string;
}
export class CreateCameraProfileDto {
  @IsString() @MinLength(1) name!: string;
  @ValidateNested() @Type(() => StorageDto) storage!: StorageDto;
  @ValidateNested() @Type(() => CameraDto) camera!: CameraDto;
}
