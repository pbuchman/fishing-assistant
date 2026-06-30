import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MobileTabs } from './MobileTabs.js';
import { SegmentedControl } from './SegmentedControl.js';

describe('segmented controls', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders mobile tabs with stable selected state and change events', () => {
    const onChange = vi.fn();

    render(
      <MobileTabs
        label="Workspace views"
        value="chat"
        tabs={[
          { value: 'chat', label: 'Chat' },
          { value: 'sources', label: 'Sources' },
        ]}
        onChange={onChange}
      />
    );

    const selected = screen.getByRole('tab', { name: 'Chat' });
    const next = screen.getByRole('tab', { name: 'Sources' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveClass('active');
    expect(next).toHaveAttribute('aria-selected', 'false');
    expect(next).not.toHaveClass('active');

    fireEvent.click(next);

    expect(onChange).toHaveBeenCalledWith('sources');
  });

  it('renders segmented options with pressed state and change events', () => {
    const onChange = vi.fn();

    render(
      <SegmentedControl
        label="Answer length"
        value="short"
        options={[
          { value: 'short', label: 'Short' },
          { value: 'long', label: 'Long' },
        ]}
        onChange={onChange}
      />
    );

    const selected = screen.getByRole('button', { name: 'Short' });
    const next = screen.getByRole('button', { name: 'Long' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toHaveClass('selected');
    expect(next).toHaveAttribute('aria-pressed', 'false');
    expect(next).not.toHaveClass('selected');

    fireEvent.click(next);

    expect(onChange).toHaveBeenCalledWith('long');
  });
});
