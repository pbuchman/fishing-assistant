import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider.js';
import { AppShell } from './AppShell.js';

vi.mock('./TopAppBar.js', () => ({
  TopAppBar: ({
    title,
    subtitle,
    menuLabel,
    onMenuClick,
  }: {
    title: string;
    subtitle?: string;
    menuLabel: string;
    onMenuClick: () => void;
  }) => (
    <header>
      <button type="button" onClick={onMenuClick}>
        {menuLabel}
      </button>
      <span>{title}</span>
      {subtitle === undefined ? null : <p>{subtitle}</p>}
    </header>
  ),
}));

vi.mock('./NavigationDrawer.js', () => ({
  NavigationDrawer: ({
    actions,
    children,
    open,
    onClose,
  }: {
    actions?: readonly { label: string }[];
    children?: React.ReactNode;
    open: boolean;
    onClose: () => void;
  }) => (
    <nav aria-label="Primary navigation" data-open={String(open)}>
      {actions?.map((action) => (
        <span key={action.label}>{action.label}</span>
      ))}
      {open ? (
        <button type="button" onClick={onClose}>
          Close drawer
        </button>
      ) : null}
      {children}
    </nav>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('AppShell', () => {
  it('provides a skip link to the app main content', () => {
    render(
      <I18nProvider>
        <AppShell
          closeNavLabel="Close navigation"
          groups={[]}
          mode="user"
          navLabel="Primary navigation"
          openNavLabel="Open navigation"
          skipToContentLabel="Skip to content"
          title="Assistant"
        >
          <h1>Chat</h1>
        </AppShell>
      </I18nProvider>
    );

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#app-main-content'
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'app-main-content');
  });

  it('passes optional subtitle and drawer actions through the shell', () => {
    render(
      <I18nProvider>
        <AppShell
          closeNavLabel="Close navigation"
          drawerActions={[{ label: 'Logout', onSelect: vi.fn() }]}
          groups={[]}
          mode="admin"
          navLabel="Primary navigation"
          openNavLabel="Open navigation"
          skipToContentLabel="Skip to content"
          subtitle="Manage users"
          title="Users"
        >
          <h1>Users table</h1>
        </AppShell>
      </I18nProvider>
    );

    expect(screen.getByText('Manage users')).toBeVisible();
    expect(screen.getByText('Logout')).toBeVisible();
    expect(screen.getByRole('navigation')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('navigation')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.getByRole('navigation')).toHaveAttribute('data-open', 'false');
  });
});
