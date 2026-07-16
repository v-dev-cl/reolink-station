import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('APP_ENCRYPTION_KEY');
    const buf = Buffer.from(secret);
    if (buf.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be exactly 32 bytes');
    }
    this.key = buf;
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let enc = cipher.update(text, 'utf8', 'base64url');
    enc += cipher.final('base64url');
    const tag = cipher.getAuthTag().toString('base64url');
    return `${iv.toString('base64url')}:${tag}:${enc}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ct] = payload.split(':');
    if (!ivB64 || !tagB64 || ct === undefined) throw new Error('malformed ciphertext');
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    let dec = decipher.update(ct, 'base64url', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  isEncrypted(value: string): boolean {
    if (typeof value !== 'string') return false;
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    const [iv, tag, ct] = parts;
    const b64url = /^[A-Za-z0-9_-]+$/;
    if (iv.length !== 16 || tag.length !== 22 || ct.length === 0) return false;
    if (!b64url.test(iv) || !b64url.test(tag) || !b64url.test(ct)) return false;
    // Definitive check: only a value that authenticates under our key counts as encrypted.
    try {
      this.decrypt(value);
      return true;
    } catch {
      return false;
    }
  }
}
