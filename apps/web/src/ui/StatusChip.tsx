import type { ReactElement, ReactNode } from 'react';

export type StatusChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function StatusChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: StatusChipTone;
}): ReactElement {
  return <span className={`fa-status-chip fa-status-chip-${tone}`}>{children}</span>;
}
