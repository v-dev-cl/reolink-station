import { ForbiddenException } from '@nestjs/common';
import * as path from 'node:path';

/**
 * Resolve `relative` under `basePath` (both POSIX). Returns the absolute path
 * if and only if it stays within basePath; throws ForbiddenException otherwise.
 */
export function resolveSafe(basePath: string, relative: string): string {
  const base = path.posix.normalize(basePath).replace(/\/+$/, '') || '/';
  const rel = relative ?? '';
  // Reject absolute inputs outright; callers pass paths relative to base.
  // (A naive strip-leading-slash-then-join would silently fold `/etc/passwd`
  // into `<base>/etc/passwd` instead of rejecting it — so reject up front.)
  if (path.posix.isAbsolute(rel)) {
    throw new ForbiddenException('path escapes base directory');
  }
  const resolved = path.posix.normalize(path.posix.join(base, rel));
  if (resolved !== base && !resolved.startsWith(base + '/')) {
    throw new ForbiddenException('path escapes base directory');
  }
  return resolved;
}
