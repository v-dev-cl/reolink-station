import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CameraShareEntity, SharePermission } from './camera-share.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class SharingService {
  constructor(
    @InjectRepository(CameraShareEntity) private readonly shares: Repository<CameraShareEntity>,
    private readonly users: UsersService,
  ) {}

  async grant(profileId: string, email: string, permission: SharePermission) {
    const grantee = await this.users.findByEmail(email);
    if (!grantee) throw new NotFoundException('grantee not found');
    const existing = await this.shares.findOne({ where: { cameraProfileId: profileId, granteeId: grantee.id } });
    if (existing) { existing.permission = permission; return this.shares.save(existing); }
    return this.shares.save(this.shares.create({ cameraProfileId: profileId, granteeId: grantee.id, permission }));
  }

  async revoke(profileId: string, granteeId: string) {
    await this.shares.delete({ cameraProfileId: profileId, granteeId });
    return { ok: true };
  }
}
