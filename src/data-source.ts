import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from './users/user.entity';
import { InviteEntity } from './invites/invite.entity';
import { CameraProfileEntity } from './camera-profiles/camera-profile.entity';
import { CameraShareEntity } from './sharing/camera-share.entity';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [UserEntity, InviteEntity, CameraProfileEntity, CameraShareEntity],
  migrations: ['dist/migrations/*.js'],
});
