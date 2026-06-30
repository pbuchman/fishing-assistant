import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog.js';
import { DetailSheet } from './DetailSheet.js';

describe('dialogs', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders confirm dialog actions and handles escape', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Delete"
        open={false}
        title="Delete item"
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        Remove this item?
      </ConfirmDialog>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Delete"
        open={true}
        title="Delete item"
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        Remove this item?
      </ConfirmDialog>
    );

    expect(screen.getByRole('dialog', { name: 'Delete item' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('focuses detail sheet content, closes from backdrop and escape, and traps tab focus', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <DetailSheet open={false} title="Details" onClose={onClose}>
        <input aria-label="Name" />
      </DetailSheet>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <DetailSheet open={true} title="Details" onClose={onClose}>
        <input aria-label="Name" />
        <button type="button">Save</button>
      </DetailSheet>
    );

    const sheet = screen.getByRole('dialog', { name: 'Details' });
    const closeButton = screen.getByRole('button', { name: 'Zamknij' });
    const nameInput = screen.getByRole('textbox', { name: 'Name' });
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(nameInput).toHaveFocus();

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(onClose).not.toHaveBeenCalled();

    saveButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(saveButton).toHaveFocus();

    fireEvent.click(sheet);
    fireEvent.keyDown(document, { key: 'Escape' });
    const backdrop = sheet.parentElement;
    if (backdrop === null) {
      throw new Error('Expected sheet backdrop');
    }
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
