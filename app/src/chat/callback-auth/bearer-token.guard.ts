import { UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { constantTimeEquals } from './callback-auth.utils.ts';

const BEARER_PATTERN = /^Bearer (?<token>.+)$/u;

/**
 * §6.4 — a bearer token compared in constant time before the route's own body parsing runs. Each
 * subclass names the one variable it reads, so a token for one route is a wrong token on another;
 * an absent secret refuses every request, because absence closes a route rather than opening it.
 */
export abstract class BearerTokenGuard implements CanActivate {
  protected abstract readonly secret: string | undefined;

  canActivate(context: ExecutionContext): boolean {
    const { headers } = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    const presented = BEARER_PATTERN.exec(headers.authorization ?? '')?.groups?.token;
    if (this.secret === undefined || presented === undefined || !constantTimeEquals(presented, this.secret)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
