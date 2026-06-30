import type { ReactElement } from 'react';

import type { UserRole } from '@fa/http-contracts';

export function RoleToggle({
  value,
  disabled = false,
  label,
  labels,
  onChange,
}: {
  value: UserRole;
  disabled?: boolean;
  label: string;
  labels?: {
    user: string;
    admin: string;
    userAriaLabel: string;
    adminAriaLabel: string;
  };
  onChange: (value: UserRole) => void;
}): ReactElement {
  const roleLabels = labels ?? {
    user: 'user',
    admin: 'admin',
    userAriaLabel: `User role for ${label.replace(/^Role for /, '')}`,
    adminAriaLabel: `Admin role for ${label.replace(/^Role for /, '')}`,
  };

  return (
    <fieldset aria-label={label} className="fa-role-toggle" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="fa-segmented-control" role="group">
        {(['user', 'admin'] as const).map((role) => (
          <button
            aria-label={role === 'user' ? roleLabels.userAriaLabel : roleLabels.adminAriaLabel}
            aria-pressed={role === value}
            className={role === value ? 'selected' : undefined}
            disabled={disabled}
            key={role}
            type="button"
            onClick={() => {
              onChange(role);
            }}
          >
            {role === 'user' ? roleLabels.user : roleLabels.admin}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
