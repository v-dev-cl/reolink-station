import { IsEmail, IsIn } from 'class-validator';
export class CreateShareDto {
  @IsEmail() email!: string;
  @IsIn(['view', 'manage']) permission!: 'view' | 'manage';
}
