import { useId, type ReactElement } from 'react';
import { ListPlus, Pencil, Trash2 } from 'lucide-react';

import { PromptBar, type PromptBarActionMode } from '../ui/PromptBar.js';

export function ChatComposer({
  value,
  disabled,
  readOnly,
  label,
  placeholder,
  sendLabel,
  queueLabel,
  stopLabel,
  actionMode = 'send',
  hint,
  queuedFollowUp,
  editQueuedFollowUpLabel,
  removeQueuedFollowUpLabel,
  onChange,
  onStop,
  onEditQueuedFollowUp,
  onRemoveQueuedFollowUp,
  onSubmit,
}: {
  value: string;
  disabled: boolean;
  readOnly?: boolean;
  label: string;
  placeholder: string;
  sendLabel: string;
  queueLabel?: string;
  stopLabel?: string;
  actionMode?: PromptBarActionMode;
  hint?: string;
  queuedFollowUp?: string | null;
  editQueuedFollowUpLabel?: string;
  removeQueuedFollowUpLabel?: string;
  onChange: (value: string) => void;
  onStop?: () => void;
  onEditQueuedFollowUp?: () => void;
  onRemoveQueuedFollowUp?: () => void;
  onSubmit: () => void | Promise<void>;
}): ReactElement {
  const hintId = useId();
  const queuedStatusLabel =
    queuedFollowUp === undefined || queuedFollowUp === null
      ? undefined
      : `${placeholder}: ${queuedFollowUp}`;

  return (
    <div className="chat-composer-shell">
      {queuedFollowUp === undefined || queuedFollowUp === null ? null : (
        <div className="chat-queued-follow-up" role="status" aria-label={queuedStatusLabel}>
          <ListPlus className="chat-queued-follow-up-icon" aria-hidden="true" />
          <span className="chat-queued-follow-up-text">{queuedFollowUp}</span>
          <div className="chat-queued-follow-up-actions">
            {onEditQueuedFollowUp === undefined || editQueuedFollowUpLabel === undefined ? null : (
              <button
                aria-label={editQueuedFollowUpLabel}
                className="chat-queued-follow-up-action"
                type="button"
                onClick={onEditQueuedFollowUp}
              >
                <Pencil aria-hidden="true" size={17} />
              </button>
            )}
            {onRemoveQueuedFollowUp === undefined ||
            removeQueuedFollowUpLabel === undefined ? null : (
              <button
                aria-label={removeQueuedFollowUpLabel}
                className="chat-queued-follow-up-action"
                type="button"
                onClick={onRemoveQueuedFollowUp}
              >
                <Trash2 aria-hidden="true" size={17} />
              </button>
            )}
          </div>
        </div>
      )}
      <PromptBar
        actionMode={actionMode}
        disabled={disabled}
        label={label}
        placeholder={placeholder}
        sendLabel={sendLabel}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        {...(queueLabel === undefined ? {} : { queueLabel })}
        {...(readOnly === undefined ? {} : { readOnly })}
        {...(stopLabel === undefined ? {} : { stopLabel })}
        {...(onStop === undefined ? {} : { onStop })}
        {...(hint === undefined ? {} : { describedBy: hintId })}
      />
      {hint === undefined ? null : (
        <p className="chat-composer-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
