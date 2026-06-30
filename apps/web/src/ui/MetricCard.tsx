import type { ReactElement } from 'react';

export function MetricCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="fa-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
