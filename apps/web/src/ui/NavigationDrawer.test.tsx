import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';

import { NavigationDrawer } from './NavigationDrawer.js';

function mockMobileDrawer(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 980px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function DrawerHarness(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open navigation
      </button>
      <NavigationDrawer
        closeLabel="Close navigation"
        groups={[
          {
            items: [
              { href: '#/chat', label: 'Chat' },
              { href: '#/usage', label: 'Usage' },
            ],
          },
        ]}
        label="Primary navigation"
        open={open}
        actions={[
          {
            label: 'Log out',
            onSelect: vi.fn(),
          },
        ]}
        onClose={() => {
          setOpen(false);
        }}
      />
      <button type="button">Underlying chat action</button>
    </>
  );
}

describe('NavigationDrawer', () => {
  beforeEach(() => {
    mockMobileDrawer();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('removes closed mobile drawer controls from the tab order', () => {
    render(
      <NavigationDrawer
        closeLabel="Close navigation"
        groups={[{ items: [{ href: '#/chat', label: 'Chat' }] }]}
        label="Primary navigation"
        open={false}
        actions={[{ label: 'Log out', onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />
    );

    const drawer = screen.getByLabelText('Primary navigation');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Close navigation', hidden: true })).toHaveAttribute(
      'tabindex',
      '-1'
    );
    expect(screen.getByRole('link', { name: 'Chat', hidden: true })).toHaveAttribute(
      'tabindex',
      '-1'
    );
    expect(screen.getByRole('button', { name: 'Log out', hidden: true })).toHaveAttribute(
      'tabindex',
      '-1'
    );
  });

  it('moves focus into the open mobile drawer, traps Tab, and returns focus on Escape', async () => {
    render(<DrawerHarness />);

    const opener = screen.getByRole('button', { name: 'Open navigation' });
    opener.focus();
    fireEvent.click(opener);

    const closeButton = await screen.findByRole('button', { name: 'Close navigation' });
    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    const logoutButton = screen.getByRole('button', { name: 'Log out' });
    logoutButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(logoutButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });
});
