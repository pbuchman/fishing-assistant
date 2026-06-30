import type { ReactElement } from 'react';
import { Fish } from 'lucide-react';

import { SuggestionChips } from '../ui/SuggestionChips.js';
import { ChatComposer } from './ChatComposer.js';

export function EmptyChatStart({
  heading,
  body,
  suggestionsLabel,
  prompts,
  composerValue,
  composerDisabled,
  composerLabel,
  composerPlaceholder,
  sendLabel,
  offlineMessage,
  onComposerChange,
  onSelectPrompt,
  onSubmit,
}: {
  heading: string;
  body: string;
  suggestionsLabel: string;
  prompts: readonly string[];
  composerValue: string;
  composerDisabled: boolean;
  composerLabel: string;
  composerPlaceholder: string;
  sendLabel: string;
  offlineMessage: string | undefined;
  onComposerChange: (value: string) => void;
  onSelectPrompt: (prompt: string) => void;
  onSubmit: () => void | Promise<void>;
}): ReactElement {
  return (
    <section className="workspace-empty-start" aria-labelledby="chat-start-heading">
      <Fish aria-hidden="true" className="workspace-empty-icon" />
      <h2 id="chat-start-heading">{heading}</h2>
      <p>{body}</p>
      {offlineMessage === undefined ? null : (
        <p className="offline-status workspace-empty-offline">{offlineMessage}</p>
      )}
      <ChatComposer
        disabled={composerDisabled}
        label={composerLabel}
        placeholder={composerPlaceholder}
        sendLabel={sendLabel}
        value={composerValue}
        onChange={onComposerChange}
        onSubmit={onSubmit}
      />
      <SuggestionChips
        hidden={composerValue.trim().length > 0}
        label={suggestionsLabel}
        prompts={prompts}
        onSelect={onSelectPrompt}
      />
    </section>
  );
}
