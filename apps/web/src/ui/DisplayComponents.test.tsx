import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusChip } from './StatusChip.js';
import { TopAppBar } from './TopAppBar.js';

afterEach(() => {
  cleanup();
});

describe('display UI components', () => {
  it('renders status chip tones and the default neutral tone', () => {
    const { container } = render(
      <div>
        <StatusChip>Neutral</StatusChip>
        <StatusChip tone="success">Ready</StatusChip>
      </div>
    );

    expect(screen.getByText('Neutral')).toHaveClass('fa-status-chip-neutral');
    expect(screen.getByText('Ready')).toHaveClass('fa-status-chip-success');
    expect(container.querySelectorAll('.fa-status-chip')).toHaveLength(2);
  });

  it('renders the top app bar with optional subtitle and actions', () => {
    const onMenuClick = vi.fn();

    render(
      <TopAppBar
        actions={<button type="button">Refresh</button>}
        menuLabel="Open navigation"
        subtitle="Manage access"
        title="Users"
        onMenuClick={onMenuClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(onMenuClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Users' })).toBeVisible();
    expect(screen.getByText('Manage access')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  it('omits the top app bar subtitle when it is not provided', () => {
    render(<TopAppBar menuLabel="Open navigation" title="Settings" onMenuClick={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.queryByText('Manage access')).not.toBeInTheDocument();
  });
});
