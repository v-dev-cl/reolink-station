import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type UserRole = 'user' | 'admin';

@Entity('users')
@Unique(['email'])
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) email!: string;
  @Column({ name: 'password_hash', type: 'varchar' }) passwordHash!: string;
  @Column({ type: 'varchar', default: 'user' }) role!: UserRole;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
