import { err, ok, type Result } from '@fa/common-core';
import type { AuthorizationResolveResponse } from '@fa/http-contracts';

import {
  bootstrapUser,
  type BootstrapUserDependencies,
  type BootstrapUserInput,
  type UserUsecaseError,
} from './bootstrapUser.js';
import {
  mapUserToAuthorizationContext,
  mapUserToCurrentUserSummary,
  missingRequiredProfileFields,
} from './userMapping.js';

export async function resolveAuthorization(
  deps: BootstrapUserDependencies,
  input: BootstrapUserInput
): Promise<Result<AuthorizationResolveResponse, UserUsecaseError>> {
  const bootstrapped = await bootstrapUser(deps, input);
  if (!bootstrapped.ok) {
    return err(bootstrapped.error);
  }

  const user = bootstrapped.value;
  const summary = mapUserToCurrentUserSummary(user);

  if (user.status === 'approved') {
    return ok({
      state: 'approved',
      user: { ...summary, status: 'approved' },
      authorization: mapUserToAuthorizationContext(user),
    });
  }

  if (user.status === 'profile_required') {
    return ok({
      state: 'profile_required',
      user: { ...summary, status: 'profile_required' },
      requiredFields: missingRequiredProfileFields(user),
    });
  }

  if (user.status === 'pending') {
    return ok({ state: 'pending', user: { ...summary, status: 'pending' } });
  }

  if (user.status === 'rejected') {
    return ok({ state: 'rejected', user: { ...summary, status: 'rejected' } });
  }

  return ok({ state: 'suspended', user: { ...summary, status: 'suspended' } });
}
