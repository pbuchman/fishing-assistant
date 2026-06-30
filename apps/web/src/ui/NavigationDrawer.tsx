import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { mobileDrawerQuery } from './layoutBreakpoints.js';

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

function getMatchMedia(): Window['matchMedia'] | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as Window & { matchMedia?: Window['matchMedia'] }).matchMedia;
}

function useMobileDrawerMode(): boolean {
  const [matches, setMatches] = useState(
    () => getMatchMedia()?.(mobileDrawerQuery).matches ?? false
  );

  useEffect(() => {
    const matchMedia = getMatchMedia();
    if (matchMedia === undefined) {
      return undefined;
    }

    const mediaQuery = matchMedia(mobileDrawerQuery);
    const handleChange = (): void => {
      setMatches(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return matches;
}

export interface NavigationDrawerItem {
  href: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  badge?: string | number | null;
}

export interface NavigationDrawerGroup {
  label?: string;
  items: NavigationDrawerItem[];
}

export interface NavigationDrawerAction {
  label: string;
  icon?: ReactNode;
  onSelect(): void;
}

export function NavigationDrawer({
  label,
  closeLabel,
  open,
  groups,
  actions,
  children,
  onClose,
}: {
  label: string;
  closeLabel: string;
  open: boolean;
  groups: readonly NavigationDrawerGroup[];
  actions?: readonly NavigationDrawerAction[];
  children?: ReactNode;
  onClose: () => void;
}): ReactElement {
  const drawerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isMobileDrawer = useMobileDrawerMode();
  const mobileModalOpen = isMobileDrawer && open;
  const mobileHidden = isMobileDrawer && !open;
  const drawerControlTabIndex = mobileHidden ? -1 : undefined;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const drawer = drawerRef.current;

    if (drawer === null) {
      return;
    }

    if (mobileHidden) {
      drawer.setAttribute('inert', '');
      return;
    }

    drawer.removeAttribute('inert');
  }, [mobileHidden]);

  useEffect(() => {
    if (!mobileModalOpen) {
      return undefined;
    }

    const drawer = drawerRef.current;
    if (drawer === null) {
      return undefined;
    }

    const previouslyFocused = document.activeElement;
    const controls = focusableElements(drawer);
    (controls[0] ?? drawer).focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const nextControls = focusableElements(drawer);
      if (nextControls.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const [firstControl] = nextControls;
      const lastControl = nextControls.at(-1);
      if (firstControl === undefined || lastControl === undefined) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === firstControl || !drawer.contains(activeElement))) {
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
  }, [mobileModalOpen]);

  return (
    <>
      <div className={open ? 'fa-drawer-scrim open' : 'fa-drawer-scrim'} onClick={onClose} />
      <aside
        aria-hidden={mobileHidden ? true : undefined}
        aria-label={label}
        aria-modal={mobileModalOpen ? true : undefined}
        className={open ? 'fa-nav-drawer open' : 'fa-nav-drawer'}
        ref={drawerRef}
        role={mobileModalOpen ? 'dialog' : undefined}
        tabIndex={mobileModalOpen ? -1 : undefined}
      >
        <div className="fa-drawer-mobile-header">
          <span>{label}</span>
          <button
            aria-label={closeLabel}
            className="fa-icon-button"
            tabIndex={drawerControlTabIndex}
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
        {groups.map((group, groupIndex) => (
          <div className="fa-nav-group" key={group.label ?? String(groupIndex)}>
            {group.label !== undefined ? <p>{group.label}</p> : null}
            {group.items.map((item) => (
              <a
                aria-current={item.active ? 'page' : undefined}
                className={item.active ? 'fa-nav-item active' : 'fa-nav-item'}
                href={item.href}
                key={item.href}
                tabIndex={drawerControlTabIndex}
                onClick={onClose}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge !== null && item.badge !== undefined ? (
                  <span className="fa-nav-badge">{item.badge}</span>
                ) : null}
              </a>
            ))}
          </div>
        ))}
        {actions !== undefined && actions.length > 0 ? (
          <div className="fa-nav-actions">
            {actions.map((action) => (
              <button
                className="fa-nav-action"
                key={action.label}
                tabIndex={drawerControlTabIndex}
                type="button"
                onClick={() => {
                  onClose();
                  action.onSelect();
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>
    </>
  );
}
