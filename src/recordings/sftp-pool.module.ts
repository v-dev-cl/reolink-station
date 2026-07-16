import { Module } from '@nestjs/common';
import { SftpPoolService } from './sftp-pool.service';

@Module({ providers: [SftpPoolService], exports: [SftpPoolService] })
export class SftpPoolModule {}
