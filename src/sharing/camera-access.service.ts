import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CameraProfileEntity } from '../camera-profiles/camera-profile.entity';
import { CameraShareEntity } from './camera-share.entity';

export type AccessLevel = 'owner' | 'manage' | 'view' | null;

@Injectable()
export class CameraAccessService {
  constructor(
    @InjectRepository(CameraProfileEntity) private readonly profiles: Repository<CameraProfileEntity>,
    @InjectRepository(CameraShareEntity) private readonly shares: Repository<CameraShareEntity>,
  ) {}

  async access(userId: string, profileId: string): Promise<AccessLevel> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return null;
    if (profile.ownerId === userId) return 'owner';
    const share = await this.shares.findOne({ where: { cameraProfileId: profileId, granteeId: userId } });
    return share ? share.permission : null;
  }

  /** ids of profiles this user can see (owned + shared). */
  async accessibleProfileIds(userId: string): Promise<string[]> {
    const owned = await this.profiles.find({ where: { ownerId: userId }, select: ['id'] });
    const shared = await this.shares.find({ where: { granteeId: userId }, select: ['cameraProfileId'] });
    return [...owned.map((p) => p.id), ...shared.map((s) => s.cameraProfileId)];
  }
}
