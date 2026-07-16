import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
export type SharePermission = 'view' | 'manage';

@Entity('camera_shares')
@Unique(['cameraProfileId', 'granteeId'])
export class CameraShareEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'camera_profile_id', type: 'uuid' }) cameraProfileId!: string;
  @Column({ name: 'grantee_id', type: 'uuid' }) granteeId!: string;
  @Column({ type: 'varchar' }) permission!: SharePermission;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
