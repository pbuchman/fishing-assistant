import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmptyChatStart } from './EmptyChatStart.js';

afterEach(() => {
  cleanup();
});

function renderEmptyStart(composerValue: string): void {
  render(
    <EmptyChatStart
      body="Zacznij od łowiska."
      composerDisabled={false}
      composerLabel="Pytanie"
      composerPlaceholder="Zapytaj o łowisko, metodę albo sprzęt"
      composerValue={composerValue}
      heading="O co chcesz zapytać?"
      offlineMessage={undefined}
      prompts={['Dobierz przynętę', 'Wyjaśnij branie']}
      sendLabel="Wyślij wiadomość"
      suggestionsLabel="Sugestie"
      onComposerChange={vi.fn()}
      onSelectPrompt={vi.fn()}
      onSubmit={vi.fn()}
    />
  );
}

describe('EmptyChatStart', () => {
  it('keeps suggestions visible before typing and collapses them once the composer has text', () => {
    renderEmptyStart('');

    expect(screen.getByLabelText('Sugestie')).not.toHaveClass('is-collapsed');
    cleanup();

    renderEmptyStart('Dobierz');

    expect(screen.getByLabelText('Sugestie')).toHaveClass('is-collapsed');
  });
});
