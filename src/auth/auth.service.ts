import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private readonly jwt: JwtService) {}

  private dummyHash!: string;
  async onModuleInit() {
    this.dummyHash = await this.hashPassword('timing-equalizer-not-a-real-password');
  }

  hashPassword(pw: string): Promise<string> { return argon2.hash(pw, { type: argon2.argon2id }); }
  verifyPassword(hash: string, pw: string): Promise<boolean> { return argon2.verify(hash, pw); }
  signToken(user: UserEntity): string { return this.jwt.sign({ sub: user.id, role: user.role }); }

  async validateCredentials(user: UserEntity | null, password: string): Promise<boolean> {
    const hash = user?.passwordHash ?? this.dummyHash;
    const ok = await this.verifyPassword(hash, password);
    return !!user && ok;
  }
}
