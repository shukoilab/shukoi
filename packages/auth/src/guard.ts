/**
 * @purpose Declarative RBAC and ABAC authorization guard evaluators.
 * @rationale Enforces role boundaries, capability scopes, and dynamic tenant/ownership policies across actions.
 * @preconditions ActionAuthConfig definition and caller context.
 * @invariants Pure evaluation; RFC 9457 compliant exceptions; thread-safe.
 */

import type { ActionAuthConfig } from '@shukoi/core';
import { DomainError } from '@shukoi/core';

/**
 * @purpose Evaluates whether an authenticated user matches required RBAC roles.
 * @param user Authenticated user payload.
 * @param requiredRoles Array of permitted roles (OR semantics).
 * @returns True if user has at least one required role or wildcard (*).
 * @invariants Big-O O(R) where R is role count.
 */
export function hasRequiredRoles(user: unknown, requiredRoles?: readonly string[]): boolean {
  if (!requiredRoles || requiredRoles.length === 0) {
    return true;
  }
  if (!user || typeof user !== 'object') {
    return false;
  }

  const userRoles = new Set<string>();
  const userObj = user as Record<string, unknown>;

  if (Array.isArray(userObj['roles'])) {
    for (const r of userObj['roles']) {
      userRoles.add(String(r));
    }
  } else if (typeof userObj['role'] === 'string') {
    userRoles.add(userObj['role']);
  }

  return userRoles.has('*') || requiredRoles.some((r) => userRoles.has(r));
}

/**
 * @purpose Evaluates whether caller permission scopes satisfy required permissions.
 * @param scopes Set of granted permission scopes.
 * @param requiredPermissions Array of required permissions.
 * @returns True if all required permissions are granted or wildcard (*) is present.
 * @invariants Big-O O(P) where P is permission count.
 */
export function hasRequiredPermissions(
  scopes: ReadonlySet<string>,
  requiredPermissions?: readonly string[],
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }
  if (scopes.has('*')) {
    return true;
  }
  return requiredPermissions.every((p) => scopes.has(p));
}

/**
 * @purpose Evaluates complete RBAC & ABAC policy rules for an action invocation.
 * @param authConfig Action authorization configuration block.
 * @param user Authenticated caller user claims or null.
 * @param scopes Granted caller capability scopes.
 * @param headers Transport headers map.
 * @param input Validated input payload.
 * @returns Promise resolving if authorization is granted.
 * @throws DomainError('UNAUTHORIZED', 401) or DomainError('FORBIDDEN', 403).
 */
export async function evaluateActionAuth<TUser = unknown, TInput = unknown>(
  authConfig: ActionAuthConfig<TUser, TInput> | undefined,
  user: Readonly<TUser> | null,
  scopes: ReadonlySet<string>,
  headers: Readonly<Record<string, string>>,
  input: Readonly<TInput>,
): Promise<void> {
  if (!authConfig) {
    return;
  }

  if (authConfig.required && user === null) {
    throw new DomainError('UNAUTHORIZED', 'Authentication is required for this action', 401);
  }

  if (authConfig.roles && !hasRequiredRoles(user, authConfig.roles)) {
    throw new DomainError(
      'FORBIDDEN',
      `Insufficient role privileges. Requires one of: ${authConfig.roles.join(', ')}`,
      403,
    );
  }

  if (authConfig.permissions && !hasRequiredPermissions(scopes, authConfig.permissions)) {
    throw new DomainError(
      'FORBIDDEN',
      `Missing required permission: ${authConfig.permissions.join(', ')}`,
      403,
    );
  }

  if (authConfig.policy) {
    const allowed = await authConfig.policy({ user, scopes, headers }, input);
    if (!allowed) {
      throw new DomainError('FORBIDDEN', 'Access policy evaluation denied request', 403);
    }
  }
}
