import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const cfg = { getOrThrow: () => '0123456789abcdef0123456789abcdef' } as unknown as ConfigService;

describe('CryptoService', () => {
  const svc = new CryptoService(cfg);

  it('round-trips a secret', () => {
    const enc = svc.encrypt('hunter2');
    expect(enc).not.toContain('hunter2');
    expect(enc.split(':')).toHaveLength(3);
    expect(svc.decrypt(enc)).toBe('hunter2');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('detects a tampered ciphertext via auth tag', () => {
    const enc = svc.encrypt('secret');
    const [iv, tag, ct] = enc.split(':');
    const bad = `${iv}:${tag}:${ct.slice(0, -2)}AA`;
    expect(() => svc.decrypt(bad)).toThrow();
  });

  it('isEncrypted recognizes its own output and rejects plaintext', () => {
    expect(svc.isEncrypted(svc.encrypt('a'))).toBe(true);
    expect(svc.isEncrypted('plaintext')).toBe(false);
  });

  it('rejects a key that is not 32 bytes', () => {
    const badCfg = { getOrThrow: () => 'too-short' } as unknown as ConfigService;
    expect(() => new CryptoService(badCfg)).toThrow();
  });
});
