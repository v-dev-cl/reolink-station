import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('invite_tokens')
export class InviteEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) email!: string;
  @Column({ name: 'token_hash', type: 'varchar' }) tokenHash!: string;
  @Column({ name: 'redeemed_at', type: 'timestamptz', nullable: true }) redeemedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
