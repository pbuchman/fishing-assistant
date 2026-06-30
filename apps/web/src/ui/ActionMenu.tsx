import type { ComponentType, ReactElement, SVGProps } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface ActionMenuItem {
  label: string;
  ariaLabel?: string;
  title?: string;
  description?: string;
  sectionLabel?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

export function ActionMenu({
  icon: Icon = MoreHorizontal,
  label,
  title,
  items,
}: {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  title?: string;
  items: readonly ActionMenuItem[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) {
        return;
      }

      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement('down');
      return;
    }

    const root = rootRef.current;
    const popover = popoverRef.current;
    if (root === null || popover === null) {
      return;
    }

    const viewportHeight = window.innerHeight;
    const gap = 6;
    const rootRect = root.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const overflowsBelow = rootRect.bottom + gap + popoverRect.height > viewportHeight;
    const fitsAbove = rootRect.top - gap - popoverRect.height >= 0;
    setPlacement(overflowsBelow && fitsAbove ? 'up' : 'down');
  }, [open]);

  return (
    <div className="fa-action-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="fa-chip fa-action-menu-trigger"
        title={title ?? label}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open ? (
        <div
          className={`fa-action-menu-popover ${placement === 'up' ? 'up' : 'down'}`}
          data-placement={placement}
          ref={popoverRef}
          role="menu"
        >
          {items.map((item, index) => {
            const ItemIcon = item.icon;
            const previousItem = items[index - 1];
            const showSection =
              item.sectionLabel !== undefined && item.sectionLabel !== previousItem?.sectionLabel;

            return (
              <div className="fa-action-menu-entry" key={item.ariaLabel ?? item.label}>
                {showSection ? (
                  <div className="fa-action-menu-section" role="presentation">
                    {item.sectionLabel}
                  </div>
                ) : null}
                <button
                  aria-label={item.ariaLabel ?? item.label}
                  className={[
                    item.tone === 'danger' ? 'danger' : null,
                    item.description !== undefined ? 'fa-action-menu-rich-item' : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={item.disabled}
                  role="menuitem"
                  title={item.title}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {ItemIcon === undefined ? null : <ItemIcon aria-hidden="true" />}
                  <span className="fa-action-menu-item-copy">
                    <span>{item.label}</span>
                    {item.description === undefined ? null : <small>{item.description}</small>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
