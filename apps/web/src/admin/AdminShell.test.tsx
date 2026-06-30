import { createElement, type ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider.js';

const adminShellModulePath = './AdminShell.js';
const mocks = vi.hoisted(() => ({
  getPendingRequestsCount: vi.fn(),
  logout: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/userApi.js', async () => {
  const actual = await vi.importActual('../services/userApi.js');
  return {
    ...actual,
    getPendingRequestsCount: mocks.getPendingRequestsCount,
  };
});

vi.mock('./PendingRequestsPage.js', () => ({
  PendingRequestsPage: ({ onRequestsChanged }: { onRequestsChanged: () => Promise<void> }) =>
    createElement(
      'div',
      null,
      createElement('h2', null, 'Pending Requests'),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void onRequestsChanged();
          },
        },
        'Refresh count from pending page'
      )
    ),
}));

vi.mock('./UsersPage.js', () => ({
  UsersPage: ({ onUsersChanged }: { onUsersChanged: () => Promise<void> }) =>
    createElement(
      'div',
      null,
      createElement('h2', null, 'Users'),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void onUsersChanged();
          },
        },
        'Refresh count from users page'
      )
    ),
}));

vi.mock('../workspace/WorkspaceApp.js', () => ({
  KnowledgePage: ({ pageId }: { pageId?: string }) =>
    createElement(
      'div',
      null,
      pageId === undefined ? 'Workspace Knowledge Base' : `Workspace Knowledge ${pageId}`
    ),
}));

vi.mock('./knowledge/KnowledgeAdminPage.js', () => ({
  KnowledgeAdminPage: ({ selectedPageId }: { selectedPageId?: string }) =>
    createElement(
      'div',
      null,
      selectedPageId === undefined ? 'Admin Knowledge Base' : `Admin Knowledge ${selectedPageId}`
    ),
}));

vi.mock('./answer-gaps/AnswerGapsPage.js', () => ({
  AnswerGapsPage: () => createElement('div', null, 'Admin Answer Gaps'),
}));

vi.mock('./usage/UsageDashboard.js', () => ({
  UsageDashboard: () => createElement('div', null, 'Admin Usage Dashboard'),
}));

vi.mock('./settings/SettingsPage.js', () => ({
  SettingsPage: () => createElement('div', null, 'Admin Settings Page'),
}));

vi.mock('../auth/useFaAuth.js', () => ({
  useFaAuth: () => ({
    accountState: {
      status: 'approved',
      account: {
        state: 'approved',
        user: {
          id: 'admin-1',
          email: 'angler@example.com',
          firstName: 'River',
          lastName: 'Walker',
          mobileNumber: '+15550101000',
          role: 'admin',
          status: 'approved',
          level: null,
          effectiveLevel: 10,
        },
        authorization: {
          userId: 'admin-1',
          auth0Subject: 'auth0|river',
          email: 'angler@example.com',
          role: 'admin',
          status: 'approved',
          effectiveLevel: 10,
        },
      },
      authorization: {
        userId: 'admin-1',
        auth0Subject: 'auth0|river',
        email: 'angler@example.com',
        role: 'admin',
        status: 'approved',
        effectiveLevel: 10,
      },
    },
    logout: mocks.logout,
  }),
}));

async function renderAdminShell(): Promise<ReturnType<typeof render>> {
  const { AdminShell } = (await import(adminShellModulePath)) as {
    AdminShell: ComponentType;
  };

  return render(createElement(I18nProvider, null, createElement(AdminShell)));
}

describe('AdminShell', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'pl');
    mocks.getPendingRequestsCount.mockReset();
    mocks.getPendingRequestsCount.mockResolvedValue({ count: 3 });
    window.history.replaceState(null, '', '/#/admin/pending');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.logout.mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('renders admin navigation with a pending badge only when the count is positive', async () => {
    await renderAdminShell();

    expect(await screen.findByRole('link', { name: 'Oczekujące prośby 3' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Czat' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Koszty AI' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Użytkownicy' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Baza Wiedzy' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Ustawienia' })).not.toBeNull();
    expect(screen.queryByText(/services/i)).toBeNull();
    expect(screen.getByText('3')).not.toBeNull();

    cleanup();
    mocks.getPendingRequestsCount.mockResolvedValue({ count: 0 });
    await renderAdminShell();
    expect(await screen.findByRole('link', { name: 'Oczekujące prośby' })).not.toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('uses the active admin route for document title while preserving page content', async () => {
    window.history.replaceState(null, '', '/#/admin/settings');

    await renderAdminShell();

    expect(await screen.findByText('Admin Settings Page')).not.toBeNull();
    expect(document.title).toBe('Ustawienia - Admin - Fishing Assistant');
  });

  it('keeps grouped admin navigation in the workspace-style shell', async () => {
    await renderAdminShell();

    const sidebar = await screen.findByRole('navigation', { name: 'Główna nawigacja' });
    expect(within(sidebar).getByText('Workspace')).not.toBeNull();
    expect(within(sidebar).getByText('Dostęp')).not.toBeNull();
    expect(within(sidebar).getByText('Wiedza')).not.toBeNull();
    expect(within(sidebar).getByText('Raporty')).not.toBeNull();
    expect(within(sidebar).getByText('System')).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Czat' })).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Koszty AI' })).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Użytkownicy' })).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Baza Wiedzy' })).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Ustawienia' })).not.toBeNull();
    expect(within(sidebar).queryByRole('button', { name: 'Wyloguj' })).toBeNull();

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Ustawienia konta' }));
    const accountMenu = await within(sidebar).findByRole('menu', { name: 'Ustawienia konta' });
    fireEvent.click(within(accountMenu).getByRole('menuitem', { name: 'Język' }));
    fireEvent.click(within(sidebar).getByRole('menuitemradio', { name: 'EN English' }));
    expect(window.localStorage.getItem('fa.locale')).toBe('en');
    expect(within(accountMenu).getByRole('menuitem', { name: 'Log out' })).not.toBeNull();
    fireEvent.click(within(sidebar).getByRole('menuitemradio', { name: 'PL Polski' }));
    expect(window.localStorage.getItem('fa.locale')).toBe('pl');
    expect(within(accountMenu).getByRole('menuitem', { name: 'Wyloguj' })).not.toBeNull();
  });

  it('keeps admin content aligned within the workspace shell on medium desktop widths', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(
      /\.workspace-main \.admin-content-shell\s*{[^}]*box-sizing:\s*border-box[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden/s.test(
        styles
      )
    ).toBe(true);
    expect(
      /\.workspace-main \.admin-content-shell > \*\s*{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s.test(
        styles
      )
    ).toBe(true);
    expect(/\.knowledge-admin-header > div:first-child\s*{[^}]*min-width:\s*0/s.test(styles)).toBe(
      true
    );
    expect(
      /\.knowledge-admin-header \.panel-subtitle\s*{[^}]*overflow-wrap:\s*anywhere/s.test(styles)
    ).toBe(true);
    expect(
      /@media \(max-width: 1180px\)\s*{[\s\S]*\.workspace-main \.admin-content-shell\s*{[^}]*padding-inline:\s*clamp\(16px,\s*2vw,\s*24px\)/s.test(
        styles
      )
    ).toBe(true);
  });

  it('keeps the language switch in the account menu on desktop and narrow layouts', async () => {
    await renderAdminShell();

    expect(document.querySelector('.fa-top-actions .fa-language-switch')).toBeNull();
    expect(document.querySelector('.fa-drawer-language .fa-language-switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Język' }));
    expect(screen.getByRole('menuitemradio', { name: 'PL Polski' })).not.toBeNull();
  });

  it('redirects bare admin routes to pending requests', async () => {
    window.history.replaceState(null, '', '/#/admin');

    await renderAdminShell();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/admin/pending');
    });
  });

  it('refreshes the pending badge after child-page mutations', async () => {
    mocks.getPendingRequestsCount
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await renderAdminShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh count from pending page' }));
    await waitFor(() => {
      expect(screen.getByText('1')).not.toBeNull();
    });

    window.history.replaceState(null, '', '/#/admin/users');
    window.dispatchEvent(new Event('hashchange'));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh count from users page' }));

    await waitFor(() => {
      expect(screen.queryByText('1')).toBeNull();
    });
  });

  it('does not reuse the workspace KnowledgePage for admin Knowledge Base routes', async () => {
    window.history.replaceState(null, '', '/#/admin/knowledge/page-1');

    await renderAdminShell();

    expect(screen.getByRole('link', { name: 'Baza Wiedzy' })).not.toBeNull();
    expect(screen.getByText('Admin Knowledge page-1')).not.toBeNull();
    expect(screen.queryByText('Workspace Knowledge page-1')).toBeNull();
  });

  it('routes admin usage to the real admin dashboard surface', async () => {
    window.history.replaceState(null, '', '/#/admin/usage');

    await renderAdminShell();

    expect(screen.getByRole('link', { name: 'Koszty AI' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Czat' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Oczekujące prośby' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Użytkownicy' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Baza Wiedzy' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Wyloguj' })).toBeNull();
    expect(screen.getByText('Admin Usage Dashboard')).not.toBeNull();
    expect(screen.queryByText(/lands in a later authorization packet/i)).toBeNull();
  });

  it('routes admin settings to the settings page', async () => {
    window.history.replaceState(null, '', '/#/admin/settings');

    await renderAdminShell();

    expect(screen.getByRole('link', { name: 'Ustawienia' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByText('Admin Settings Page')).not.toBeNull();
  });

  it('routes admin answer gaps to the answer gaps surface and active navigation item', async () => {
    window.history.replaceState(null, '', '/#/admin/answer-gaps');

    await renderAdminShell();

    expect(screen.getByRole('link', { name: 'Luki w wiedzy' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByText('Admin Answer Gaps')).not.toBeNull();
    expect(screen.queryByText('Admin Knowledge Base')).toBeNull();
  });

  it('shows a recoverable not-found state for invalid admin subroutes', async () => {
    window.history.replaceState(null, '', '/#/admin/does-not-exist-production-qa');

    await renderAdminShell();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Admin page not found' })
    ).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open Usage' })).toHaveAttribute(
      'href',
      '#/admin/usage'
    );
    expect(screen.queryByText('Pending Requests')).toBeNull();
  });

  it('logs out from the admin shell action', async () => {
    await renderAdminShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Wyloguj' }));

    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
