import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CameraAccessService } from './camera-access.service';

export const REQUIRE_MANAGE = 'require_manage';
export const RequireManage = () => SetMetadata(REQUIRE_MANAGE, true);

@Injectable()
export class CameraAccessGuard implements CanActivate {
  constructor(private readonly access: CameraAccessService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const level = await this.access.access(req.user.userId, req.params.id);
    if (!level) throw new NotFoundException('profile not found'); // do not leak existence
    const needsManage = this.reflector.getAllAndOverride<boolean>(REQUIRE_MANAGE, [ctx.getHandler(), ctx.getClass()]);
    if (needsManage && level === 'view') throw new ForbiddenException('manage permission required');
    req.access = level;
    return true;
  }
}
