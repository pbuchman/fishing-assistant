import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetailSheet } from './DetailSheet.js';

describe('DetailSheet', () => {
  afterEach(() => {
    cleanup();
  });

  it('moves focus into the sheet and traps Tab navigation while open', async () => {
    const onClose = vi.fn();

    render(
      <>
        <button type="button">Background action</button>
        <DetailSheet title="Create page" open onClose={onClose}>
          <label>
            Page title
            <input />
          </label>
          <button type="button">Create page</button>
        </DetailSheet>
      </>
    );

    const titleInput = screen.getByLabelText('Page title');
    const createButton = screen.getByRole('button', { name: 'Create page' });
    const closeButton = screen.getByRole('button', { name: 'Zamknij' });

    await waitFor(() => {
      expect(titleInput).toHaveFocus();
    });

    createButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(createButton).toHaveFocus();
  });

  it('closes on Escape while focus is inside the sheet', () => {
    const onClose = vi.fn();

    render(
      <DetailSheet title="Create page" open onClose={onClose}>
        <button type="button">Create page</button>
      </DetailSheet>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the supplied close button label', () => {
    render(
      <DetailSheet title="Create page" closeLabel="Close" open onClose={vi.fn()}>
        <button type="button">Create page</button>
      </DetailSheet>
    );

    expect(screen.getByRole('button', { name: 'Close' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Zamknij' })).toBeNull();
  });

  it('can focus the icon close button first for preview-style sheets', async () => {
    render(
      <DetailSheet
        closeLabel="Close details"
        closePresentation="icon"
        initialFocus="close"
        title="Report details"
        open
        onClose={vi.fn()}
      >
        <button type="button">Mark done</button>
      </DetailSheet>
    );

    const closeButton = screen.getByRole('button', { name: 'Close details' });
    expect(closeButton).toHaveClass('fa-detail-sheet-close-icon');
    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });
    expect(screen.queryByText('Close details')).toBeNull();
  });

  it('returns focus to the opener after closing', () => {
    const onClose = vi.fn();

    const { rerender } = render(
      <>
        <button type="button">Open history</button>
        <DetailSheet title="Conversations" open={false} onClose={onClose}>
          <button type="button">New chat</button>
        </DetailSheet>
      </>
    );
    const opener = screen.getByRole('button', { name: 'Open history' });
    opener.focus();

    rerender(
      <>
        <button type="button">Open history</button>
        <DetailSheet title="Conversations" open onClose={onClose}>
          <button type="button">New chat</button>
        </DetailSheet>
      </>
    );
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveFocus();

    rerender(
      <>
        <button type="button">Open history</button>
        <DetailSheet title="Conversations" open={false} onClose={onClose}>
          <button type="button">New chat</button>
        </DetailSheet>
      </>
    );

    expect(screen.getByRole('button', { name: 'Open history' })).toHaveFocus();
  });
});
