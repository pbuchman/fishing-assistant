import { createElement, type ComponentType } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider.js';

const pendingRequestsPageModulePath = './PendingRequestsPage.js';

const mocks = vi.hoisted(() => ({
  approveUser: vi.fn(),
  listPendingRequests: vi.fn(),
  rejectUser: vi.fn(),
  suspendUser: vi.fn(),
}));

vi.mock('../services/userApi.js', async () => {
  const actual = await vi.importActual('../services/userApi.js');
  return {
    ...actual,
    approveUser: mocks.approveUser,
    listPendingRequests: mocks.listPendingRequests,
    rejectUser: mocks.rejectUser,
    suspendUser: mocks.suspendUser,
  };
});

const pendingUser = {
  id: 'pending-1',
  email: 'pending@example.com',
  firstName: 'Pat',
  lastName: 'Pending',
  mobileNumber: '+15550101000',
  role: 'user' as const,
  status: 'pending' as const,
  level: 1,
  effectiveLevel: 1,
};

async function renderPendingRequestsPage(
  onRequestsChanged = vi.fn()
): Promise<ReturnType<typeof render>> {
  const { PendingRequestsPage } = (await import(pendingRequestsPageModulePath)) as {
    PendingRequestsPage: ComponentType<{
      onRequestsChanged(): Promise<void>;
    }>;
  };

  return render(
    createElement(I18nProvider, null, createElement(PendingRequestsPage, { onRequestsChanged }))
  );
}

describe('PendingRequestsPage', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'en');
    mocks.listPendingRequests.mockReset();
    mocks.approveUser.mockReset();
    mocks.rejectUser.mockReset();
    mocks.suspendUser.mockReset();
    mocks.listPendingRequests.mockResolvedValue({
      users: [pendingUser],
      nextCursor: null,
    });
    mocks.approveUser.mockResolvedValue({ user: pendingUser, events: [] });
    mocks.rejectUser.mockResolvedValue({ user: pendingUser, events: [] });
    mocks.suspendUser.mockResolvedValue({ user: pendingUser, events: [] });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('defaults pending approvals to user role with a visible level selector', async () => {
    await renderPendingRequestsPage();

    expect(await screen.findByText('pending@example.com')).not.toBeNull();
    const roleToggle = screen.getByRole('group', { name: 'Role for pending@example.com' });
    expect(
      within(roleToggle).getByRole('button', { name: 'User role for pending@example.com' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(roleToggle).getByRole('button', { name: 'Admin role for pending@example.com' })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Tier for pending@example.com')).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Approve pending@example.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('title', 'More');
    expect(screen.queryByRole('button', { name: 'Reject pending@example.com' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suspend pending@example.com' })).toBeNull();
  });

  it('turns an empty pending queue into an orienting admin state', async () => {
    const onRequestsChanged = vi.fn(() => Promise.resolve());
    mocks.listPendingRequests.mockResolvedValue({
      users: [],
      nextCursor: null,
    });

    await renderPendingRequestsPage(onRequestsChanged);

    expect(
      await screen.findByRole('heading', { name: 'No pending requests right now' })
    ).not.toBeNull();
    expect(screen.getByText(/New user requests will appear here/)).toBeInTheDocument();
    expect(screen.getByText(/Last checked:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all users' })).toHaveAttribute(
      'href',
      '#/admin/users'
    );
    expect(screen.getByRole('link', { name: 'Open Usage' })).toHaveAttribute(
      'href',
      '#/admin/usage'
    );
    expect(screen.getByRole('link', { name: 'Open Knowledge Base' })).toHaveAttribute(
      'href',
      '#/admin/knowledge'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));

    await waitFor(() => {
      expect(mocks.listPendingRequests).toHaveBeenCalledTimes(2);
    });
    expect(onRequestsChanged).toHaveBeenCalledTimes(1);
  });

  it('localizes the empty pending queue for the Polish admin UI', async () => {
    window.localStorage.setItem('fa.locale', 'pl');
    mocks.listPendingRequests.mockResolvedValue({
      users: [],
      nextCursor: null,
    });

    await renderPendingRequestsPage();

    expect(await screen.findByRole('heading', { name: 'Brak oczekujących próśb' })).not.toBeNull();
    expect(screen.getByText(/Nowe prośby użytkowników pojawią się tutaj/)).toBeInTheDocument();
    expect(screen.getByText(/Ostatnio sprawdzono:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zobacz wszystkich użytkowników' })).toHaveAttribute(
      'href',
      '#/admin/users'
    );
  });

  it('uses Polish role and level copy for pending access decisions', async () => {
    window.localStorage.setItem('fa.locale', 'pl');

    await renderPendingRequestsPage();

    expect(await screen.findByText('pending@example.com')).not.toBeNull();
    const roleToggle = screen.getByRole('group', { name: 'Rola dla pending@example.com' });
    expect(
      within(roleToggle).getByRole('button', { name: 'Rola użytkownika dla pending@example.com' })
    ).toHaveTextContent('Użytkownik');
    expect(
      within(roleToggle).getByRole('button', { name: 'Rola admina dla pending@example.com' })
    ).toHaveTextContent('Admin');
    expect(screen.getByLabelText('Próg dla pending@example.com')).toHaveValue('1');
    fireEvent.click(
      within(roleToggle).getByRole('button', { name: 'Rola admina dla pending@example.com' })
    );
    expect(screen.getByText('Admini mają dostęp progu 10.')).toBeInTheDocument();
    expect(screen.queryByText('Admins get tier 10 access.')).toBeNull();
  });

  it('uses Polish confirmation copy for pending reject and suspend actions', async () => {
    window.localStorage.setItem('fa.locale', 'pl');

    await renderPendingRequestsPage();

    expect(await screen.findByText('pending@example.com')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Więcej' }));
    const rejectMenuItem = screen.getByRole('menuitem', { name: 'Odrzuć pending@example.com' });
    expect(rejectMenuItem.querySelector('svg.lucide-circle-x')).not.toBeNull();
    fireEvent.click(rejectMenuItem);

    expect(screen.getByRole('dialog', { name: 'Odrzucić prośbę?' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ta zmiana dotyczy dostępu dla pending@example.com. Użytkowników możesz sprawdzić później.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));

    fireEvent.click(screen.getByRole('button', { name: 'Więcej' }));
    const suspendMenuItem = screen.getByRole('menuitem', { name: 'Zawieś pending@example.com' });
    expect(suspendMenuItem.querySelector('svg.lucide-ban')).not.toBeNull();
    fireEvent.click(suspendMenuItem);

    expect(screen.getByRole('dialog', { name: 'Zawiesić prośbę?' })).toBeInTheDocument();
    expect(screen.queryByText('Reject request?')).toBeNull();
    expect(screen.queryByText('Suspend request?')).toBeNull();
    expect(screen.queryByText(/You can review users later/)).toBeNull();
  });

  it('approves admins without sending a level and refreshes the list', async () => {
    const onRequestsChanged = vi.fn(() => Promise.resolve());
    await renderPendingRequestsPage(onRequestsChanged);
    expect(await screen.findByText('pending@example.com')).not.toBeNull();

    const roleToggle = screen.getByRole('group', { name: 'Role for pending@example.com' });
    fireEvent.click(
      within(roleToggle).getByRole('button', { name: 'Admin role for pending@example.com' })
    );

    await waitFor(() => {
      expect(screen.queryByLabelText('Tier for pending@example.com')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve pending@example.com' }));

    await waitFor(() => {
      expect(mocks.approveUser).toHaveBeenCalledWith('pending-1', { role: 'admin' });
    });
    expect(mocks.listPendingRequests).toHaveBeenCalledTimes(2);
    expect(onRequestsChanged).toHaveBeenCalledTimes(1);
  });

  it('approves normal users with the selected level and supports reject and suspend actions', async () => {
    const onRequestsChanged = vi.fn(() => Promise.resolve());
    await renderPendingRequestsPage(onRequestsChanged);
    expect(await screen.findByText('pending@example.com')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Tier for pending@example.com'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve pending@example.com' }));

    await waitFor(() => {
      expect(mocks.approveUser).toHaveBeenCalledWith('pending-1', { role: 'user', level: 4 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reject pending@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => {
      expect(mocks.rejectUser).toHaveBeenCalledWith('pending-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Suspend pending@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => {
      expect(mocks.suspendUser).toHaveBeenCalledWith('pending-1');
    });
  });
});
