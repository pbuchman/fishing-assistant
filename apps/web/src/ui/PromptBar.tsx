import {
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { ArrowUp, Square } from 'lucide-react';

export type PromptBarActionMode = 'send' | 'queue' | 'stop' | 'disabled';

const minComposerHeight = 42;
const maxComposerHeight = 220;
const mobileViewportComposerRatio = 0.36;

function measureComposerMaxHeight(): number {
  if (typeof window === 'undefined') {
    return maxComposerHeight;
  }

  return Math.min(
    maxComposerHeight,
    Math.max(minComposerHeight, window.innerHeight * mobileViewportComposerRatio)
  );
}

function resizeComposer(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';

  const nextHeight = Math.round(
    Math.min(textarea.scrollHeight || minComposerHeight, measureComposerMaxHeight())
  );
  textarea.style.height = `${String(nextHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > nextHeight ? 'auto' : 'hidden';
}

export function PromptBar({
  value,
  disabled,
  readOnly,
  placeholder,
  label,
  sendLabel,
  queueLabel,
  stopLabel,
  actionMode,
  describedBy,
  leading,
  tools,
  onChange,
  onStop,
  onSubmit,
}: {
  value: string;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder: string;
  label: string;
  sendLabel: string;
  queueLabel?: string;
  stopLabel?: string;
  actionMode?: PromptBarActionMode;
  describedBy?: string;
  leading?: ReactNode;
  tools?: ReactNode;
  onChange: (value: string) => void;
  onStop?: () => void;
  onSubmit: () => void | Promise<void>;
}): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedActionMode: PromptBarActionMode =
    actionMode ?? (onStop === undefined ? 'send' : 'stop');
  const canSubmit =
    value.trim().length > 0 &&
    !disabled &&
    (resolvedActionMode === 'send' || resolvedActionMode === 'queue');
  const canStop = resolvedActionMode === 'stop' && onStop !== undefined;
  const actionLabel =
    resolvedActionMode === 'queue'
      ? (queueLabel ?? sendLabel)
      : resolvedActionMode === 'stop'
        ? (stopLabel ?? sendLabel)
        : sendLabel;
  const actionDisabled =
    resolvedActionMode === 'disabled'
      ? true
      : resolvedActionMode === 'stop'
        ? !canStop
        : !canSubmit;

  useLayoutEffect(() => {
    if (textareaRef.current) {
      resizeComposer(textareaRef.current);
    }
  }, [value]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (resolvedActionMode === 'stop') {
      if (!canStop) {
        return;
      }
      onStop();
      return;
    }

    if (!canSubmit) {
      return;
    }
    void onSubmit();
  }

  return (
    <form className="fa-prompt-bar" onSubmit={handleSubmit}>
      {leading}
      <textarea
        aria-label={label}
        aria-describedby={describedBy}
        disabled={disabled}
        placeholder={placeholder}
        ref={textareaRef}
        readOnly={readOnly}
        rows={1}
        value={value}
        onChange={(event) => {
          resizeComposer(event.currentTarget);
          onChange(event.currentTarget.value);
        }}
      />
      {tools}
      <button
        aria-label={actionLabel}
        className={`fa-icon-button fa-send-button${
          resolvedActionMode === 'stop' ? ' fa-stop-button' : ''
        }`}
        disabled={actionDisabled}
        type={
          resolvedActionMode === 'stop' || resolvedActionMode === 'disabled' ? 'button' : 'submit'
        }
        onClick={
          resolvedActionMode === 'stop'
            ? () => {
                if (canStop) {
                  onStop();
                }
              }
            : undefined
        }
      >
        {resolvedActionMode === 'stop' ? (
          <Square aria-hidden="true" fill="currentColor" size={18} />
        ) : (
          <ArrowUp aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
