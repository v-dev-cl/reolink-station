import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { HealthController } from './health/health.controller';
import { CryptoModule } from './crypto/crypto.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? ['.env.test'] : ['.env'],
    }),
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: databaseConfig }),
    CryptoModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
