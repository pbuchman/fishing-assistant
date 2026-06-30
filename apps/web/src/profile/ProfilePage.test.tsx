import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FaAuthAccountState } from '../auth/useFaAuth.js';

const profilePageModulePath = './ProfilePage.js';

const mockCompleteProfile = vi.fn(() => Promise.resolve());
const mockLogout = vi.fn(() => Promise.resolve());

let mockAccountState: FaAuthAccountState = {
  status: 'profile_required' as const,
  account: {
    state: 'profile_required' as const,
    user: null,
    requiredFields: ['firstName', 'lastName', 'mobileNumber'],
  },
};

vi.mock('../auth/useFaAuth.js', () => ({
  useFaAuth: () => ({
    accountState: mockAccountState,
    sessionKey: 'profile-session',
    login: vi.fn(() => Promise.resolve()),
    logout: mockLogout,
    refreshCurrentUser: vi.fn(() => Promise.resolve()),
    completeProfile: mockCompleteProfile,
    isLoading: false,
    isAuthenticated: true,
    getAccessToken: vi.fn(() => Promise.resolve('token')),
    refreshAccessToken: vi.fn(() => Promise.resolve('token-refresh')),
  }),
}));

async function renderProfilePage(): Promise<void> {
  const { ProfilePage } = (await import(profilePageModulePath)) as {
    ProfilePage: () => React.ReactElement;
  };

  render(createElement(ProfilePage));
}

describe('ProfilePage', () => {
  beforeEach(() => {
    mockCompleteProfile.mockReset();
    mockLogout.mockReset();
    mockAccountState = {
      status: 'profile_required' as const,
      account: {
        state: 'profile_required' as const,
        user: null,
        requiredFields: ['firstName', 'lastName', 'mobileNumber'],
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the three required profile fields with the E.164 placeholder', async () => {
    await renderProfilePage();

    expect(screen.getByLabelText('Imię')).toBeInTheDocument();
    expect(screen.getByLabelText('Nazwisko')).toBeInTheDocument();
    expect(screen.getByLabelText('Telefon')).toHaveAttribute('placeholder', '+15550101000');
  });

  it('validates E.164 mobile numbers before submitting', async () => {
    await renderProfilePage();

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText('Telefon'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(screen.getByText('Podaj numer telefonu w formacie E.164.')).toBeInTheDocument();
    expect(mockCompleteProfile).not.toHaveBeenCalled();
  });

  it('submits first name, last name, and mobile number through the auth context', async () => {
    await renderProfilePage();

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText('Telefon'), {
      target: { value: '+15550101000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));

    await waitFor(() => {
      expect(mockCompleteProfile).toHaveBeenCalledWith({
        firstName: 'Test',
        lastName: 'User',
        mobileNumber: '+15550101000',
      });
    });
  });

  it('renders approved account details without the completion form', async () => {
    mockAccountState = {
      status: 'approved' as const,
      account: {
        state: 'approved' as const,
        user: {
          id: 'user-1',
          email: 'profile-user@example.test',
          firstName: 'Test',
          lastName: 'User',
          mobileNumber: '+15550101000',
          role: 'admin' as const,
          status: 'approved' as const,
          level: null,
          effectiveLevel: 10 as const,
        },
        authorization: {
          userId: 'user-1',
          auth0Subject: 'auth0|test-profile-user',
          email: 'profile-user@example.test',
          role: 'admin' as const,
          status: 'approved' as const,
          effectiveLevel: 10 as const,
        },
      },
      authorization: {
        userId: 'user-1',
        auth0Subject: 'auth0|test-profile-user',
        email: 'profile-user@example.test',
        role: 'admin' as const,
        status: 'approved' as const,
        effectiveLevel: 10 as const,
      },
    };

    await renderProfilePage();

    expect(screen.getByRole('heading', { level: 1, name: 'Profil' })).toBeInTheDocument();
    expect(screen.getByText('Dane Twojego konta w Fishing Assistant.')).toBeInTheDocument();
    expect(screen.getByText('profile-user@example.test')).toBeInTheDocument();
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('+15550101000')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Zatwierdzone')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/Dane profilu są tutaj tylko do odczytu/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Poproś o korektę' })).toHaveAttribute(
      'href',
      'mailto:hello@fishing-assistant.example?subject=Fishing%20Assistant%20profile%20correction'
    );
    expect(screen.getByRole('link', { name: 'Wróć do chatu' })).toHaveAttribute('href', '#/chat');
    expect(document.title).toBe('Profil - Fishing Assistant');
    expect(screen.queryByRole('button', { name: 'Dalej' })).toBeNull();
    screen.getByRole('button', { name: 'Wyloguj' }).click();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('keeps approved profile values readable on the light auth surface', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.profile-summary dd\s*{[^}]*color:\s*var\(--fa-text\)/s);
    expect(styles).not.toMatch(/\.profile-summary dd\s*{[^}]*color:\s*#f5f3e9/s);
  });
});
