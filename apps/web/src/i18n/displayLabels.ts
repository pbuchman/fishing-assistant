import type { AppMessages } from '@fa/i18n';
import type { UserRole, UserStatus } from '@fa/http-contracts';

import type { UsageGroupBy } from '../services/usageApi.js';
import type { KnowledgeAccessGate } from '../services/knowledgeApi.js';

export function userRoleLabel(role: UserRole, app: AppMessages): string {
  return app.userRoles[role];
}

export function userStatusLabel(status: UserStatus, app: AppMessages): string {
  if (status === 'profile_required') {
    return app.userStatuses.profileRequired;
  }

  return app.userStatuses[status];
}

export function roleForLabel(email: string, app: AppMessages): string {
  return `${app.adminUsers.roleFor} ${email}`;
}

export function userRoleForLabel(email: string, app: AppMessages): string {
  return `${app.adminUsers.userRoleFor} ${email}`;
}

export function adminRoleForLabel(email: string, app: AppMessages): string {
  return `${app.adminUsers.adminRoleFor} ${email}`;
}

export function statusForLabel(email: string, app: AppMessages): string {
  return `${app.adminUsers.statusFor} ${email}`;
}

export function levelForLabel(email: string, app: AppMessages): string {
  return `${app.adminUsers.levelFor} ${email}`;
}

export function knowledgeAccessLabel(
  gate: KnowledgeAccessGate,
  requiredLevel: number | null | undefined,
  app: AppMessages
): string {
  if (gate === 'public') {
    return app.knowledgeAccess.approved;
  }

  if (gate === 'level') {
    return `${app.knowledgeAccess.level} ${String(requiredLevel ?? 1)}+`;
  }

  return app.knowledgeAccess[gate];
}

export function usageGroupByLabel(groupBy: UsageGroupBy, app: AppMessages): string {
  const labels = app.adminUsage.groupByLabels;
  const groupByLabels: Record<UsageGroupBy, string> = {
    'time.bucket': labels.timeBucket,
    'request.provider': labels.provider,
    'request.model': labels.model,
    'owner.id': labels.userId,
    'source.service': labels.service,
    'source.component': labels.component,
    'source.operation': labels.operation,
    'source.promptType': labels.promptType,
  };

  return groupByLabels[groupBy];
}

export function usageGroupByAriaLabel(groupBy: UsageGroupBy, app: AppMessages): string {
  const labels = app.adminUsage.groupByAriaLabels;
  const groupByLabels: Record<UsageGroupBy, string> = {
    'time.bucket': labels.timeBucket,
    'request.provider': labels.provider,
    'request.model': labels.model,
    'owner.id': labels.userId,
    'source.service': labels.service,
    'source.component': labels.component,
    'source.operation': labels.operation,
    'source.promptType': labels.promptType,
  };

  return groupByLabels[groupBy];
}

function labelFromRecord(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value;
}

export function usageComponentLabel(component: string, app: AppMessages): string {
  return labelFromRecord(component, app.usageSources.components);
}

export function usageOperationLabel(operation: string, app: AppMessages): string {
  return labelFromRecord(operation, app.usageSources.operations);
}

export function usagePromptTypeLabel(promptType: string, app: AppMessages): string {
  return labelFromRecord(promptType, app.usageSources.promptTypes);
}

export function usageServiceLabel(service: string, app: AppMessages): string {
  return labelFromRecord(service, app.usageSources.services);
}
