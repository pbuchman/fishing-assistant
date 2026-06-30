import { createHmac } from 'node:crypto';

export type IdentityConflictReason =
  | 'email_owned_by_other_subject'
  | 'subject_email_changed_unverified'
  | 'subject_email_changed_to_owned_email'
  | 'email_unverified'
  | 'email_not_allowed_for_signup'
  | 'email_missing';

export interface IdentityConflictLogEvent {
  event: 'user_identity_conflict';
  reason: IdentityConflictReason;
  auth0SubjectHash: string;
  normalizedEmailHash?: string;
  existingUserId?: string;
}

export function hashSecurityLogValue(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}
