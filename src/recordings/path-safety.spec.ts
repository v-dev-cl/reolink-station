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
  it('rejects a non-string (e.g. array) path input', () => {
    expect(() => resolveSafe(base, ['a', 'b'] as unknown as string)).toThrow(ForbiddenException);
    expect(() => resolveSafe(base, 123 as unknown as string)).toThrow(ForbiddenException);
  });
  it('rejects a double-slash absolute escape and bare ..', () => {
    expect(() => resolveSafe(base, '//etc/passwd')).toThrow(ForbiddenException);
    expect(() => resolveSafe(base, '..')).toThrow(ForbiddenException);
  });
  it('normalizes doubled inner slashes for a legitimate path', () => {
    expect(resolveSafe(base, 'foo//bar')).toBe('/reolink/foo/bar');
  });
});
