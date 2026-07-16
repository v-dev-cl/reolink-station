import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
export class DeleteRecordingsDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) paths!: string[];
}
