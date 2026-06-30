import type { ReactElement } from 'react';

export function SuggestionChips({
  prompts,
  label,
  onSelect,
  hrefForPrompt,
  hidden = false,
}: {
  prompts: readonly string[];
  label: string;
  onSelect: (prompt: string) => void;
  hrefForPrompt?: (prompt: string) => string;
  hidden?: boolean;
}): ReactElement {
  return (
    <div className={`fa-suggestion-chips${hidden ? ' is-collapsed' : ''}`} aria-label={label}>
      {prompts.map((prompt) => {
        const href = hrefForPrompt?.(prompt);

        return href === undefined ? (
          <button
            className="fa-suggestion-tile"
            key={prompt}
            type="button"
            onClick={() => {
              onSelect(prompt);
            }}
          >
            {prompt}
          </button>
        ) : (
          <a
            className="fa-suggestion-tile"
            href={href}
            key={prompt}
            onClick={() => {
              onSelect(prompt);
            }}
          >
            {prompt}
          </a>
        );
      })}
    </div>
  );
}
