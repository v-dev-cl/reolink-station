import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import { InviteEntity } from './invite.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(InviteEntity) private readonly repo: Repository<InviteEntity>,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createInvite(email: string): Promise<{ token: string }> {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.repo.save(this.repo.create({ email, tokenHash: this.hash(token), redeemedAt: null }));
    return { token };
  }

  async redeem(token: string, password: string): Promise<{ id: string; email: string }> {
    const invite = await this.repo.findOne({
      where: { tokenHash: this.hash(token), redeemedAt: IsNull() },
    });
    if (!invite) throw new BadRequestException('invalid or used invite');
    const user = await this.users.create(invite.email, await this.auth.hashPassword(password));
    invite.redeemedAt = new Date();
    await this.repo.save(invite);
    return { id: user.id, email: user.email };
  }
}
