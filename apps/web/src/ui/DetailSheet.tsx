import type { ReactElement, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true'
  );
}

export function DetailSheet({
  title,
  open,
  closeLabel = 'Zamknij',
  closePresentation = 'text',
  initialFocus = 'content',
  className,
  children,
  onClose,
}: {
  title: string;
  open: boolean;
  closeLabel?: string;
  closePresentation?: 'text' | 'icon';
  initialFocus?: 'content' | 'close';
  className?: string;
  children: ReactNode;
  onClose: () => void;
}): ReactElement | null {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const sheet = sheetRef.current;
    if (sheet === null) {
      return undefined;
    }

    const previouslyFocused = document.activeElement;
    const controls = focusableElements(sheet);
    const closeControl = controls.find((element) => element.dataset['faSheetClose'] === 'true');
    const contentControl = controls.find((element) => element.dataset['faSheetClose'] !== 'true');
    const focusTarget = initialFocus === 'close' ? closeControl : contentControl;
    (focusTarget ?? controls[0] ?? sheet).focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const nextControls = focusableElements(sheet);
      if (nextControls.length === 0) {
        event.preventDefault();
        sheet.focus();
        return;
      }

      const [firstControl] = nextControls;
      const lastControl = nextControls.at(-1);
      if (firstControl === undefined || lastControl === undefined) {
        event.preventDefault();
        sheet.focus();
        return;
      }

      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === firstControl || !sheet.contains(activeElement))) {
        event.preventDefault();
        lastControl.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected &&
        previouslyFocused !== document.body
      ) {
        previouslyFocused.focus();
      }
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fa-dialog-backdrop" onClick={onClose}>
      <section
        className={['fa-detail-sheet', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={sheetRef}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="fa-detail-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button
            aria-label={closePresentation === 'icon' ? closeLabel : undefined}
            className={closePresentation === 'icon' ? 'fa-detail-sheet-close-icon' : undefined}
            data-fa-sheet-close="true"
            type="button"
            onClick={onClose}
          >
            {closePresentation === 'icon' ? <X aria-hidden="true" /> : closeLabel}
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
