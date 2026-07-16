import { IsString, MinLength } from 'class-validator';
export class RedeemInviteDto {
  @IsString() token!: string;
  @IsString() @MinLength(10) password!: string;
}
