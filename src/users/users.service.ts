import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserRole } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(UserEntity) private readonly repo: Repository<UserEntity>) {}

  create(email: string, passwordHash: string, role: UserRole = 'user'): Promise<UserEntity> {
    return this.repo.save(this.repo.create({ email, passwordHash, role }));
  }
  findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { email } });
  }
  findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { id } });
  }
}
