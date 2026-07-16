import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
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

    if (await this.users.findByEmail(invite.email)) {
      throw new ConflictException('an account for this email already exists');
    }

    const passwordHash = await this.auth.hashPassword(password);

    // Atomically claim the invite so concurrent redemptions of the same token can't both proceed.
    const claim = await this.repo.update(
      { id: invite.id, redeemedAt: IsNull() },
      { redeemedAt: new Date() },
    );
    if (!claim.affected) throw new BadRequestException('invalid or used invite');

    try {
      const user = await this.users.create(invite.email, passwordHash);
      return { id: user.id, email: user.email };
    } catch (err) {
      const e = err as { code?: string; driverError?: { code?: string } };
      if (e?.code === '23505' || e?.driverError?.code === '23505') {
        throw new ConflictException('an account for this email already exists');
      }
      throw err;
    }
  }
}
