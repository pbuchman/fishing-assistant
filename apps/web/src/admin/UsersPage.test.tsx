import { createElement, type ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaAuthContextValue } from '../auth/useFaAuth.js';

import { I18nProvider } from '../i18n/I18nProvider.js';

const usersPageModulePath = './UsersPage.js';

const mocks = vi.hoisted(() => ({
  listUserHistory: vi.fn(),
  listUsers: vi.fn(),
  patchUser: vi.fn(),
  suspendUser: vi.fn(),
  unsuspendUser: vi.fn(),
}));

let mockAuthValue: FaAuthContextValue;

vi.mock('../services/userApi.js', async () => {
  const actual = await vi.importActual('../services/userApi.js');
  return {
    ...actual,
    listUserHistory: mocks.listUserHistory,
    listUsers: mocks.listUsers,
    patchUser: mocks.patchUser,
    suspendUser: mocks.suspendUser,
    unsuspendUser: mocks.unsuspendUser,
  };
});

vi.mock('../auth/useFaAuth.js', () => ({
  useFaAuth: () => mockAuthValue,
}));

const normalUser = {
  id: 'user-1',
  email: 'user-one@example.test',
  firstName: 'User',
  lastName: 'One',
  mobileNumber: '+15550101001',
  role: 'user' as const,
  status: 'approved' as const,
  level: 3,
  effectiveLevel: 3 as const,
};

const adminUser = {
  id: 'admin-1',
  email: 'admin-one@example.test',
  firstName: 'Admin',
  lastName: 'One',
  mobileNumber: '+15550101002',
  role: 'admin' as const,
  status: 'approved' as const,
  level: null,
  effectiveLevel: 10 as const,
};

const otherAdminUser = {
  id: 'admin-2',
  email: 'admin-two@example.test',
  firstName: 'Admin',
  lastName: 'Two',
  mobileNumber: '+15550101003',
  role: 'admin' as const,
  status: 'approved' as const,
  level: null,
  effectiveLevel: 10 as const,
};

const suspendedUser = {
  id: 'user-2',
  email: 'suspended-user@example.test',
  firstName: 'Suspended',
  lastName: 'User',
  mobileNumber: '+15550101004',
  role: 'user' as const,
  status: 'suspended' as const,
  level: 2,
  effectiveLevel: 2 as const,
};

const pendingUser = {
  id: 'pending-1',
  email: 'pending-user@example.test',
  firstName: 'Pending',
  lastName: 'User',
  mobileNumber: '+15550101005',
  role: 'user' as const,
  status: 'pending' as const,
  level: 1,
  effectiveLevel: 1 as const,
};

const profileRequiredUser = {
  id: 'profile-1',
  email: 'profile-required@example.test',
  firstName: '',
  lastName: '',
  mobileNumber: '',
  role: 'user' as const,
  status: 'profile_required' as const,
  level: null,
  effectiveLevel: 1 as const,
};

const longEmailUser = {
  id: 'long-email-user-1',
  email: 'long-address-user-0001@example.test',
  firstName: 'Long',
  lastName: 'EmailFixture',
  mobileNumber: '+15550101006',
  role: 'user' as const,
  status: 'approved' as const,
  level: 9,
  effectiveLevel: 9 as const,
};

async function renderUsersPage(onUsersChanged = vi.fn()): Promise<ReturnType<typeof render>> {
  const { UsersPage } = (await import(usersPageModulePath)) as {
    UsersPage: ComponentType<{
      onUsersChanged(): Promise<void>;
    }>;
  };

  return render(createElement(I18nProvider, null, createElement(UsersPage, { onUsersChanged })));
}

function readStylesSource(): string {
  const cwd = process.cwd();
  const stylesPath = cwd.endsWith('/apps/web')
    ? join(cwd, 'src/styles.css')
    : join(cwd, 'apps/web/src/styles.css');
  return readFileSync(stylesPath, 'utf8');
}

describe('UsersPage', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'en');
    mockAuthValue = {
      accountState: {
        status: 'approved',
        account: {
          state: 'approved',
          user: adminUser,
          authorization: {
            userId: adminUser.id,
            auth0Subject: 'auth0|admin-1',
            email: adminUser.email,
            role: 'admin',
            status: 'approved',
            effectiveLevel: 10,
          },
        },
        authorization: {
          userId: adminUser.id,
          auth0Subject: 'auth0|admin-1',
          email: adminUser.email,
          role: 'admin',
          status: 'approved',
          effectiveLevel: 10,
        },
      },
      isLoading: false,
      isAuthenticated: true,
      isLogoutInProgress: false,
      sessionKey: 'session-key',
      login: vi.fn(),
      logout: vi.fn(),
      refreshCurrentUser: vi.fn(),
      completeProfile: vi.fn(),
      getAccessToken: vi.fn(),
      refreshAccessToken: vi.fn(),
    };
    mocks.listUsers.mockReset();
    mocks.listUserHistory.mockReset();
    mocks.patchUser.mockReset();
    mocks.suspendUser.mockReset();
    mocks.unsuspendUser.mockReset();
    mocks.listUsers.mockResolvedValue({
      users: [normalUser, adminUser, suspendedUser],
      nextCursor: null,
      totalCount: 3,
    });
    mocks.listUserHistory.mockImplementation((userId: string) =>
      Promise.resolve({
        events: [
          {
            id: `history-${userId}`,
            targetUserId: userId,
            actorUserId: adminUser.id,
            type: 'status_changed',
            before: { status: 'pending' },
            after: { status: 'approved' },
            createdAt: '2026-06-20T03:04:00.000Z',
          },
        ],
        nextCursor: null,
      })
    );
    mocks.patchUser.mockResolvedValue({ user: normalUser, events: [] });
    mocks.suspendUser.mockResolvedValue({ user: suspendedUser, events: [] });
    mocks.unsuspendUser.mockResolvedValue({ user: suspendedUser, events: [] });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows editable level controls for approved normal users only', async () => {
    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();
    expect(screen.getByLabelText('Tier for user-one@example.test')).toHaveValue('3');
    expect(screen.queryByLabelText('Tier for admin-one@example.test')).toBeNull();
    const adminRow = screen.getByText('admin-one@example.test').closest('[role="row"]');
    expect(adminRow).toBeInstanceOf(HTMLElement);
    if (!(adminRow instanceof HTMLElement)) {
      throw new Error('Expected admin row');
    }
    expect(within(adminRow).getByText('10')).not.toBeNull();
  });

  it('keeps lifecycle audit context out of compact rows', async () => {
    await renderUsersPage();

    const row = (await screen.findByText('user-one@example.test')).closest('[role="row"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected user row');
    }

    expect(within(row).queryByText('Status changed')).toBeNull();
    expect(within(row).queryByText(/Jun 20, 2026/)).toBeNull();
    expect(within(row).queryByText('By admin-one@example.test')).toBeNull();
    expect(within(row).queryByText('User id: user-1')).toBeNull();
    expect(mocks.listUserHistory).toHaveBeenCalledWith('user-1', { limit: 3 });
  });

  it('renders each user as a separated access row with stable zones', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [longEmailUser],
      nextCursor: null,
    });

    await renderUsersPage();

    const row = (await screen.findByText(longEmailUser.email)).closest('[role="row"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected user row');
    }

    expect(row).toHaveClass('admin-user-row');
    expect(row.querySelector('.admin-user-identity')).toBeInstanceOf(HTMLElement);
    expect(row.querySelector('.admin-user-access')).toBeInstanceOf(HTMLElement);
    expect(row.querySelector('.admin-user-audit-preview')).toBeNull();
    expect(row.querySelector('.admin-user-row-actions')).toBeInstanceOf(HTMLElement);
    expect(within(row).getByLabelText(`Access controls for ${longEmailUser.email}`)).not.toBeNull();
    expect(
      within(row).getByRole('button', {
        name: `Show audit details for ${longEmailUser.email}`,
      })
    ).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('keeps full audit metadata in a details sheet instead of the row', async () => {
    await renderUsersPage();

    const row = (await screen.findByText('user-one@example.test')).closest('[role="row"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected user row');
    }

    expect(within(row).queryByText('User id: user-1')).toBeNull();
    fireEvent.click(
      within(row).getByRole('button', { name: 'Show audit details for user-one@example.test' })
    );

    const dialog = await screen.findByRole('dialog', { name: 'Audit for User One' });
    expect(within(dialog).getByText('User One')).toBeInTheDocument();
    expect(within(dialog).getByText('user-one@example.test')).toBeInTheDocument();
    expect(within(dialog).getByText('Status changed')).toBeInTheDocument();
    expect(within(dialog).getByText(/Jun 20, 2026/)).toBeInTheDocument();
    expect(within(dialog).getByText('By Admin One')).toBeInTheDocument();
    expect(within(dialog).queryByText('By admin-one@example.test')).toBeNull();
    expect(within(dialog).queryByText('User id: user-1')).toBeNull();
  });

  it('confirms level changes before saving access updates', async () => {
    await renderUsersPage();
    expect(await screen.findByText('user-one@example.test')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Tier for user-one@example.test'), {
      target: { value: '4' },
    });

    expect(mocks.patchUser).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Confirm access change?' });
    expect(within(dialog).getByText(/user-one@example.test/)).not.toBeNull();
    expect(within(dialog).getByText(/tier: 4/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('user-1', { level: 4 });
    });
    expect(await screen.findByText('Saved')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes user-one@example.test' })).toBeNull();
  });

  it('confirms status changes before saving access updates', async () => {
    await renderUsersPage();
    expect(await screen.findByText('user-one@example.test')).not.toBeNull();

    const row = screen.getByText('user-one@example.test').closest('[role="row"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected user row');
    }
    fireEvent.click(within(row).getByRole('button', { name: 'Suspended' }));

    expect(mocks.patchUser).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Confirm access change?' });
    expect(within(dialog).getByText(/user-one@example.test/)).not.toBeNull();
    expect(within(dialog).getByText(/status: Suspended/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('user-1', { status: 'suspended' });
    });
    expect(await screen.findByText('Saved')).not.toBeNull();
  });

  it('sends the default user level when demoting an admin to a user', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [otherAdminUser],
      nextCursor: null,
    });

    await renderUsersPage();
    expect(await screen.findByText('admin-two@example.test')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'User role for admin-two@example.test' }));

    expect(mocks.patchUser).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Confirm access change?' });
    expect(within(dialog).getByText(/admin-two@example.test/)).not.toBeNull();
    expect(within(dialog).getByText(/role: User/)).not.toBeNull();
    expect(within(dialog).getByText(/tier: 1/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('admin-2', { role: 'user', level: 1 });
    });
  });

  it('does not send stale level data when promoting a normal user to admin', async () => {
    await renderUsersPage();
    expect(await screen.findByText('user-one@example.test')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Admin role for user-one@example.test' }));

    expect(mocks.patchUser).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Confirm access change?' });
    expect(within(dialog).getByText(/user-one@example.test/)).not.toBeNull();
    expect(within(dialog).getByText(/role: Admin/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('user-1', { role: 'admin' });
    });
  });

  it('disables role status and level controls for the current admin user', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [adminUser, normalUser],
      nextCursor: null,
    });

    await renderUsersPage();

    expect(await screen.findByText('admin-one@example.test')).not.toBeNull();
    expect(screen.getByLabelText('Role for admin-one@example.test')).toBeDisabled();
    expect(screen.getByLabelText('Status for admin-one@example.test')).toBeDisabled();
    const adminRow = screen.getByText('admin-one@example.test').closest('[role="row"]');
    expect(adminRow).toBeInstanceOf(HTMLElement);
    if (!(adminRow instanceof HTMLElement)) {
      throw new Error('Expected admin row');
    }
    expect(
      within(adminRow).getByRole('button', { name: 'User role for admin-one@example.test' })
    ).toHaveAttribute('disabled');
    expect(
      within(adminRow).getByRole('button', { name: 'Admin role for admin-one@example.test' })
    ).toHaveAttribute('disabled');
    expect(screen.getByText('You cannot modify your own access')).not.toBeNull();
  });

  it('uses Polish labels and accessible names for access-management controls', async () => {
    window.localStorage.setItem('fa.locale', 'pl');
    mocks.listUsers.mockResolvedValue({
      users: [adminUser, normalUser, pendingUser, suspendedUser],
      nextCursor: null,
    });

    await renderUsersPage();

    expect(await screen.findByText('admin-one@example.test')).not.toBeNull();
    expect(screen.getByLabelText('Szukaj użytkowników')).toHaveAttribute(
      'placeholder',
      'Imię, nazwisko albo email'
    );
    expect(screen.getByLabelText('Filtr statusu')).toBeInTheDocument();
    expect(screen.getByLabelText('Filtr roli')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobilny filtr statusu')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobilny filtr roli')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobilny filtr progu')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rozmiar strony')).toBeNull();

    const statusFilter = screen.getByLabelText('Filtr statusu');
    expect(within(statusFilter).getByRole('option', { name: 'Wszystkie' })).toBeInTheDocument();
    expect(within(statusFilter).getByRole('option', { name: 'Oczekujący' })).toBeInTheDocument();
    expect(within(statusFilter).getByRole('option', { name: 'Aktywny' })).toBeInTheDocument();
    expect(within(statusFilter).getByRole('option', { name: 'Zawieszony' })).toBeInTheDocument();
    expect(within(statusFilter).queryByRole('option', { name: 'Odrzucone' })).toBeNull();

    const roleFilter = screen.getByLabelText('Filtr roli');
    expect(within(roleFilter).getByRole('option', { name: 'Użytkownik' })).toBeInTheDocument();
    expect(within(roleFilter).getByRole('option', { name: 'Admin' })).toBeInTheDocument();

    const adminRow = screen.getByText('admin-one@example.test').closest('[role="row"]');
    expect(adminRow).toBeInstanceOf(HTMLElement);
    if (!(adminRow instanceof HTMLElement)) {
      throw new Error('Expected admin row');
    }

    expect(
      within(adminRow).getByRole('button', { name: 'Rola użytkownika dla admin-one@example.test' })
    ).toHaveTextContent('Użytkownik');
    expect(
      within(adminRow).getByRole('button', { name: 'Rola admina dla admin-one@example.test' })
    ).toHaveTextContent('Admin');
    expect(screen.getByText('Nie możesz zmienić własnego dostępu')).toBeInTheDocument();
    expect(screen.queryByText('You cannot modify your own access')).toBeNull();
    expect(within(adminRow).getByText('10')).toBeInTheDocument();
    expect(screen.queryByText('Próg efektywny 10')).toBeNull();
  });

  it('uses a single details action instead of the old action menu', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [adminUser, normalUser],
      nextCursor: null,
    });

    await renderUsersPage();

    expect(await screen.findByText('admin-one@example.test')).not.toBeNull();
    const adminRow = screen.getByText('admin-one@example.test').closest('[role="row"]');
    expect(adminRow).toBeInstanceOf(HTMLElement);
    if (!(adminRow instanceof HTMLElement)) {
      throw new Error('Expected admin row');
    }

    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(
      within(adminRow).getByRole('button', {
        name: 'Show audit details for admin-one@example.test',
      })
    ).toBeInTheDocument();
  });

  it('shows error feedback when a confirmed access save fails', async () => {
    mocks.patchUser.mockRejectedValueOnce(new Error('boom'));

    await renderUsersPage();
    expect(await screen.findByText('user-one@example.test')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Tier for user-one@example.test'), {
      target: { value: '4' },
    });
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirm access change?' })).getByRole(
        'button',
        { name: 'Confirm' }
      )
    );

    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('user-1', { level: 4 });
    });
    expect(await screen.findByText('Error')).not.toBeNull();
  });

  it('keeps pending as a filter and presents a single activate transition', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [pendingUser],
      nextCursor: null,
    });

    await renderUsersPage();
    expect(await screen.findByText('pending-user@example.test')).not.toBeNull();

    const statusFilter = screen.getByLabelText('Status filter');
    const pendingFilterOption = within(statusFilter).getByRole('option', {
      name: 'Pending',
    });
    expect(pendingFilterOption).not.toBeDisabled();

    const row = screen.getByText('pending-user@example.test').closest('[role="row"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected pending row');
    }
    expect(within(row).getByText('Pending')).toBeInTheDocument();
    expect(row.querySelector('.pending-status-arrow svg')).toBeInstanceOf(SVGElement);
    fireEvent.click(within(row).getByRole('button', { name: 'Activate' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirm access change?' })).getByRole(
        'button',
        { name: 'Confirm' }
      )
    );
    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('pending-1', { status: 'approved' });
    });
  });

  it('maps profile-required to the pending UX and defaults null user levels to one', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [profileRequiredUser],
      nextCursor: null,
    });

    await renderUsersPage();
    await waitFor(() => {
      expect(screen.getAllByText('profile-required@example.test').length).toBeGreaterThan(0);
    });

    const row = screen
      .getByLabelText('Access controls for profile-required@example.test')
      .closest('[role="row"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected profile-required row');
    }
    expect(within(row).getByText('Pending')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tier for profile-required@example.test')).toHaveValue('1');
  });

  it('uses status toggles for suspend and activate transitions', async () => {
    const onUsersChanged = vi.fn(() => Promise.resolve());
    await renderUsersPage(onUsersChanged);
    expect(await screen.findByText('user-one@example.test')).not.toBeNull();

    const normalUserRow = screen.getByText('user-one@example.test').closest('[role="row"]');
    expect(normalUserRow).toBeInstanceOf(HTMLElement);
    if (!(normalUserRow instanceof HTMLElement)) {
      throw new Error('Expected user row');
    }
    fireEvent.click(within(normalUserRow).getByRole('button', { name: 'Suspended' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirm access change?' })).getByRole(
        'button',
        { name: 'Confirm' }
      )
    );
    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('user-1', { status: 'suspended' });
    });

    const suspendedUserRow = screen
      .getByText('suspended-user@example.test')
      .closest('[role="row"]');
    expect(suspendedUserRow).toBeInstanceOf(HTMLElement);
    if (!(suspendedUserRow instanceof HTMLElement)) {
      throw new Error('Expected suspended user row');
    }
    fireEvent.click(within(suspendedUserRow).getByRole('button', { name: 'Active' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirm access change?' })).getByRole(
        'button',
        { name: 'Confirm' }
      )
    );
    await waitFor(() => {
      expect(mocks.patchUser).toHaveBeenCalledWith('user-2', { status: 'approved' });
    });

    expect(onUsersChanged).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when filters return no users', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [],
      nextCursor: null,
    });

    await renderUsersPage();

    const emptyState = await screen.findByText('No users match the current filters');
    const emptyRow = emptyState.closest('[role="row"]');
    expect(emptyRow).toBeInstanceOf(HTMLElement);
    if (!(emptyRow instanceof HTMLElement)) {
      throw new Error('Expected empty state row');
    }

    expect(emptyRow).toHaveClass('admin-user-empty-row');
    expect(within(emptyRow).queryByText('-')).toBeNull();
    expect(emptyRow).toHaveTextContent('No users match the current filters');
  });

  it('searches users by email or name through the backend list API', async () => {
    mocks.listUsers
      .mockResolvedValueOnce({
        users: [normalUser, adminUser, suspendedUser],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [normalUser],
        nextCursor: null,
      });

    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Search users'), {
      target: { value: ' User One ' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { query: 'User One' });
    });
  });

  it('places an infinite-scroll sentinel after the users table only when another page exists', async () => {
    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading more users' })).toBeNull();
    cleanup();

    mocks.listUsers.mockResolvedValue({
      users: [normalUser],
      nextCursor: 'cursor-2',
      totalCount: 38,
    });

    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();
    expect(screen.getAllByText('Loaded 1 of 38')).not.toHaveLength(0);
    const loadMoreStatus = screen.getByRole('status', { name: 'Loading more users' });
    const usersTable = screen.getByRole('table', { name: 'Users' });
    const filters = screen.getByLabelText('Search users').closest('.admin-filters');
    expect(filters).toBeInstanceOf(HTMLElement);
    expect(filters?.contains(loadMoreStatus)).toBe(false);
    expect(
      usersTable.compareDocumentPosition(loadMoreStatus) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
  });

  it('honors API-provided status transitions instead of inferring every status action', async () => {
    mocks.listUsers.mockResolvedValue({
      users: [
        {
          ...normalUser,
          availableStatusTransitions: [],
        },
      ],
      nextCursor: null,
      totalCount: 1,
    });

    await renderUsersPage();

    const row = (await screen.findByText('user-one@example.test')).closest('[role="row"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected user row');
    }
    expect(within(row).getByRole('button', { name: 'Active' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Suspended' })).toBeDisabled();
  });

  it('serializes role and level filters while dropping empty values', async () => {
    mocks.listUsers
      .mockResolvedValueOnce({
        users: [normalUser],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [adminUser],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [normalUser],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [normalUser, adminUser],
        nextCursor: null,
      });

    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Role filter'), {
      target: { value: 'admin' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { role: 'admin' });
    });

    fireEvent.change(screen.getByLabelText('Tier filter'), {
      target: { value: '7' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(3, { role: 'admin', level: 7 });
    });

    fireEvent.change(screen.getByLabelText('Role filter'), {
      target: { value: '' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(4, { level: 7 });
    });
  });

  it('serializes compact mobile filters with the same backend contract as desktop filters', async () => {
    mocks.listUsers
      .mockResolvedValueOnce({
        users: [normalUser],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [pendingUser],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [pendingUser],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [pendingUser],
        nextCursor: null,
      });

    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Mobile status filter'), {
      target: { value: 'pending' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { status: 'pending' });
    });

    fireEvent.change(screen.getByLabelText('Mobile role filter'), {
      target: { value: 'user' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(3, { status: 'pending', role: 'user' });
    });

    fireEvent.change(screen.getByLabelText('Mobile tier filter'), {
      target: { value: '4' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(4, {
        status: 'pending',
        role: 'user',
        level: 4,
      });
    });
  });

  it('labels the role filter as role rather than user', async () => {
    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();

    const roleFilter = screen.getByLabelText('Role filter');
    const filterLabel = roleFilter.closest('label');
    expect(filterLabel).toBeInstanceOf(HTMLElement);
    expect(filterLabel).toHaveTextContent('Role');
    expect(filterLabel).not.toHaveTextContent(/^User$/);
  });

  it('serializes status filters without page-size parameters', async () => {
    mocks.listUsers
      .mockResolvedValueOnce({
        users: [normalUser],
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        users: [adminUser],
        nextCursor: null,
      });

    await renderUsersPage();

    expect(await screen.findByText('user-one@example.test')).not.toBeNull();
    expect(mocks.listUsers).toHaveBeenNthCalledWith(1, {});

    fireEvent.change(screen.getByLabelText('Status filter'), {
      target: { value: 'approved' },
    });

    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { status: 'approved' });
    });
  });

  it('keeps mobile account-management controls at least 44px tall', () => {
    const styles = readStylesSource();

    expect(styles).toMatch(
      /\.admin-users-filters input,\s*\.admin-users-filters select\s*{[^}]*min-height:\s*42px/s
    );
    expect(styles).toMatch(
      /\.admin-user-table \.fa-segmented-control button\s*{[^}]*min-height:\s*44px/s
    );
    expect(styles).toMatch(
      /\.admin-user-table \.admin-user-row-actions \.fa-secondary-button,\s*\.admin-user-table \.admin-user-row-actions \.fa-chip,\s*\.admin-user-table \.admin-audit-details-trigger\s*{[^}]*min-height:\s*44px/s
    );
  });

  it('defines the compact mobile filters panel from the accepted mockup', () => {
    const styles = readStylesSource();

    expect(styles).toMatch(/\.admin-users-mobile-filters\s*{[^}]*display:\s*none/s);
    expect(styles).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*\.admin-users-mobile-filters\s*{[^}]*display:\s*block/s
    );
    expect(styles).toMatch(
      /\.admin-users-filters > \.admin-inline-control:not\(\.admin-users-search-filter\)\s*{[^}]*display:\s*none/s
    );
    expect(styles).toMatch(/\.admin-users-mobile-filters\[open\]\s*{[^}]*grid-column:\s*1 \/ -1/s);
    expect(styles).toMatch(
      /\.admin-users-mobile-filter-grid\s*{[^}]*position:\s*static[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
    expect(styles).toMatch(/\.pending-status-arrow svg\s*{[^}]*width:\s*16px[^}]*height:\s*16px/s);
  });

  it('defines responsive layout rules that prevent user row overlap', () => {
    const styles = readStylesSource();
    expect(styles).toMatch(
      /\.admin-user-table \.admin-user-row\s*{[^}]*grid-template-columns:\s*var\(--users-row-grid\)[^}]*grid-template-areas:\s*['"]identity access actions['"]/s
    );
    expect(styles).toMatch(
      /--users-row-grid:\s*minmax\(232px,\s*0\.82fr\)\s*minmax\(540px,\s*1\.7fr\)\s*minmax\(132px,\s*max-content\)/s
    );
    expect(styles).toMatch(/\.admin-user-identity\s*{[^}]*grid-area:\s*identity/s);
    expect(styles).toMatch(
      /\.admin-user-table \.admin-user-access\s*{[^}]*grid-area:\s*access[^}]*grid-template-columns:\s*minmax\(180px,\s*280px\)\s*minmax\(220px,\s*300px\)\s*minmax\(96px,\s*132px\)/s
    );
    expect(styles).toMatch(
      /@container admin-users \(max-width:\s*960px\)[\s\S]*?\.admin-user-table \.admin-user-row\s*{[\s\S]*?grid-template-areas:\s*['"]identity actions['"]\s*['"]access access['"]/s
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*1180px\)[\s\S]*?\.admin-user-table \.admin-user-row\s*{[\s\S]*?grid-template-areas:\s*['"]identity['"]\s*['"]access['"]\s*['"]actions['"]/s
    );
  });
});
