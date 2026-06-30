import type { ReactElement, ReactNode } from 'react';
import { Menu } from 'lucide-react';

export function TopAppBar({
  title,
  subtitle,
  menuLabel,
  actions,
  onMenuClick,
}: {
  title: string;
  subtitle?: string;
  menuLabel: string;
  actions?: ReactNode;
  onMenuClick: () => void;
}): ReactElement {
  return (
    <header className="fa-top-app-bar">
      <button
        aria-label={menuLabel}
        className="fa-icon-button fa-menu-button"
        type="button"
        onClick={onMenuClick}
      >
        <Menu aria-hidden="true" />
      </button>
      <div className="fa-top-title">
        <h1>{title}</h1>
        {subtitle !== undefined ? <p>{subtitle}</p> : null}
      </div>
      <div className="fa-top-actions">{actions}</div>
    </header>
  );
}
