import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionMenu } from './ActionMenu.js';

describe('ActionMenu', () => {
  const originalInnerHeight = window.innerHeight;
  const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'getBoundingClientRect'
  );

  function callOriginalGetBoundingClientRect(element: HTMLElement): DOMRect {
    const originalValue = originalGetBoundingClientRect?.value as unknown;
    if (typeof originalValue !== 'function') {
      return new DOMRect();
    }

    return (originalValue as (this: HTMLElement) => DOMRect).call(element);
  }

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
    if (originalGetBoundingClientRect === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
    } else {
      Object.defineProperty(
        HTMLElement.prototype,
        'getBoundingClientRect',
        originalGetBoundingClientRect
      );
    }
    vi.clearAllMocks();
  });

  it('flips the popover above the trigger when there is not enough viewport space below', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList.contains('fa-action-menu')) {
        return {
          x: 270,
          y: 808,
          top: 808,
          right: 370,
          bottom: 852,
          left: 270,
          width: 100,
          height: 44,
          toJSON: () => ({}),
        };
      }

      if (this.classList.contains('fa-action-menu-popover')) {
        return {
          x: 220,
          y: 858,
          top: 858,
          right: 370,
          bottom: 914,
          left: 220,
          width: 150,
          height: 56,
          toJSON: () => ({}),
        };
      }

      return callOriginalGetBoundingClientRect(this);
    };

    render(
      <ActionMenu
        label="More"
        items={[
          {
            label: 'Suspend user@example.com',
            onSelect: vi.fn(),
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    const menu = screen.getByRole('menu');
    await waitFor(() => {
      expect(menu).toHaveAttribute('data-placement', 'up');
    });
  });

  it('uses a fixed mobile sheet so popovers do not overlap adjacent toolbar actions', () => {
    const packageStylesPath = join(process.cwd(), 'src/styles.css');
    const stylesPath = existsSync(packageStylesPath)
      ? packageStylesPath
      : join(process.cwd(), 'apps/web/src/styles.css');
    const styles = readFileSync(stylesPath, 'utf8');

    expect(
      /@media \(max-width: 640px\)\s*{[\s\S]*\.fa-action-menu-popover,\s*\.fa-action-menu-popover\.up\s*{[^}]*position:\s*fixed[^}]*right:\s*12px[^}]*bottom:\s*calc\(12px \+ var\(--fa-safe-bottom\)\)[^}]*left:\s*12px[^}]*top:\s*auto/s.test(
        styles
      )
    ).toBe(true);
    expect(/\.fa-action-menu-popover button\s*{[^}]*min-height:\s*44px/s.test(styles)).toBe(true);
  });

  it('keeps the popover below the trigger when space is available and selects enabled actions', async () => {
    const disabledSelect = vi.fn();
    const enabledSelect = vi.fn();

    render(
      <ActionMenu
        label="More"
        items={[
          {
            ariaLabel: 'Delete account',
            disabled: true,
            label: 'Delete',
            title: 'Cannot delete your own account',
            tone: 'danger',
            onSelect: disabledSelect,
          },
          {
            label: 'Details',
            onSelect: enabledSelect,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    const menu = screen.getByRole('menu');
    await waitFor(() => {
      expect(menu).toHaveAttribute('data-placement', 'down');
    });

    const disabledAction = screen.getByRole('menuitem', { name: 'Delete account' });
    expect(disabledAction).toBeDisabled();
    expect(disabledAction).toHaveClass('danger');
    expect(disabledAction).toHaveAttribute('title', 'Cannot delete your own account');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }));

    expect(disabledSelect).not.toHaveBeenCalled();
    expect(enabledSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders grouped menu items with descriptions without changing menu item names', () => {
    render(
      <ActionMenu
        label="Add"
        items={[
          {
            sectionLabel: 'Create manually',
            label: 'Category',
            description: 'Main collection of materials, for example feeder tactics.',
            onSelect: vi.fn(),
          },
          {
            sectionLabel: 'Review',
            label: 'Request review',
            description: 'Ask another maintainer to review this knowledge page.',
            onSelect: vi.fn(),
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Create manually')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Category' })).toBeInTheDocument();
    expect(
      screen.getByText('Main collection of materials, for example feeder tactics.')
    ).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Request review' })).toBeInTheDocument();
    expect(
      screen.getByText('Ask another maintainer to review this knowledge page.')
    ).toBeInTheDocument();
  });
});
