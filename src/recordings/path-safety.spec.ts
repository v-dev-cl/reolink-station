import { ForbiddenException } from '@nestjs/common';
import { resolveSafe } from './path-safety';

describe('resolveSafe', () => {
  const base = '/reolink';
  it('joins a clean relative path under base', () => {
    expect(resolveSafe(base, '2026/07/15/clip.mp4')).toBe('/reolink/2026/07/15/clip.mp4');
  });
  it('treats empty/./ as the base itself', () => {
    expect(resolveSafe(base, '')).toBe('/reolink');
    expect(resolveSafe(base, '.')).toBe('/reolink');
  });
  it('rejects parent-traversal', () => {
    expect(() => resolveSafe(base, '../secret')).toThrow(ForbiddenException);
    expect(() => resolveSafe(base, '2026/../../etc')).toThrow(ForbiddenException);
  });
  it('rejects an absolute path that escapes base', () => {
    expect(() => resolveSafe(base, '/etc/passwd')).toThrow(ForbiddenException);
  });
  it('rejects a sibling-prefix escape', () => {
    expect(() => resolveSafe('/reolink', '../reolink-evil/x')).toThrow(ForbiddenException);
  });
});
