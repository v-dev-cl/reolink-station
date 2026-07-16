import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoService } from '../crypto/crypto.service';
import { CameraProfileEntity } from './camera-profile.entity';
import {
  CAMERA_SECRET_KEYS, CameraConfig, STORAGE_SECRET_KEYS, StorageConfig,
} from './camera-profile.config';
import { maskCamera, maskStorage } from './camera-profile.masking';
import { CreateCameraProfileDto } from './dto/create-camera-profile.dto';
import { UpdateCameraProfileDto } from './dto/update-camera-profile.dto';

@Injectable()
export class CameraProfilesService {
  constructor(
    @InjectRepository(CameraProfileEntity) private readonly repo: Repository<CameraProfileEntity>,
    private readonly crypto: CryptoService,
  ) {}

  private encSecrets<T extends Record<string, any>>(obj: T, keys: (keyof T)[]): T {
    const out = { ...obj };
    for (const k of keys) {
      const v = out[k];
      if (typeof v === 'string' && v.length && !this.crypto.isEncrypted(v)) {
        out[k] = this.crypto.encrypt(v) as any;
      }
    }
    return out;
  }
  private decSecrets<T extends Record<string, any>>(obj: T, keys: (keyof T)[]): T {
    const out = { ...obj };
    for (const k of keys) {
      const v = out[k];
      if (typeof v === 'string' && this.crypto.isEncrypted(v)) out[k] = this.crypto.decrypt(v) as any;
    }
    return out;
  }

  async create(ownerId: string, dto: CreateCameraProfileDto): Promise<CameraProfileEntity> {
    const entity = this.repo.create({
      ownerId,
      name: dto.name,
      storageConfig: this.encSecrets({ ...dto.storage }, STORAGE_SECRET_KEYS),
      cameraConfig: this.encSecrets({ ...dto.camera, codec: 'h264' } as CameraConfig, CAMERA_SECRET_KEYS),
    });
    return this.repo.save(entity);
  }

  listForOwner(ownerId: string) {
    return this.repo.find({ where: { ownerId }, order: { createdAt: 'DESC' } })
      .then((rows) => rows.map((r) => this.toMasked(r)));
  }

  private async load(id: string): Promise<CameraProfileEntity> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('profile not found');
    return p;
  }

  private toMasked(p: CameraProfileEntity) {
    return { id: p.id, name: p.name, storage: maskStorage(p.storageConfig), camera: maskCamera(p.cameraConfig), createdAt: p.createdAt };
  }

  async getMasked(id: string) { return this.toMasked(await this.load(id)); }

  async findOneDecryptedForConnection(id: string): Promise<{ id: string; storage: StorageConfig; camera: CameraConfig }> {
    const p = await this.load(id);
    return {
      id: p.id,
      storage: this.decSecrets(p.storageConfig, STORAGE_SECRET_KEYS),
      camera: this.decSecrets(p.cameraConfig, CAMERA_SECRET_KEYS),
    };
  }

  async update(id: string, dto: UpdateCameraProfileDto) {
    const p = await this.load(id);
    if (dto.name) p.name = dto.name;
    if (dto.storage) {
      const merged = { ...p.storageConfig, ...stripBlank(dto.storage) };
      p.storageConfig = this.encSecrets(merged, STORAGE_SECRET_KEYS);
    }
    if (dto.camera) {
      const merged = { ...p.cameraConfig, ...stripBlank(dto.camera) };
      p.cameraConfig = this.encSecrets(merged, CAMERA_SECRET_KEYS);
    }
    return this.toMasked(await this.repo.save(p));
  }

  async remove(id: string) { await this.repo.delete({ id }); return { ok: true }; }
}

function stripBlank<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === undefined) continue; // blank secret = keep stored
    (out as any)[k] = v;
  }
  return out;
}
