import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { CameraConfig, StorageConfig } from './camera-profile.config';

@Entity('camera_profiles')
export class CameraProfileEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ name: 'storage_config', type: 'jsonb' }) storageConfig!: StorageConfig;
  @Column({ name: 'camera_config', type: 'jsonb' }) cameraConfig!: CameraConfig;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
