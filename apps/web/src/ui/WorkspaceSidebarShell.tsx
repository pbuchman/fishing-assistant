import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Fish,
  Languages,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
} from 'lucide-react';
import type { Locale } from '@fa/i18n';

import { useI18n } from '../i18n/useI18n.js';
import type { WorkspaceAccountSummary } from './accountSummary.js';
import { mobileDrawerQuery } from './layoutBreakpoints.js';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface WorkspaceSidebarItem {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  badge?: string | number | null;
}

export interface WorkspaceSidebarGroup {
  label?: string;
  items: readonly WorkspaceSidebarItem[];
}

interface SidebarRenderContext {
  controlTabIndex: number | undefined;
  closeNavigation: () => void;
}

interface WorkspaceSidebarShellProps {
  brandTitle: string;
  children: ReactNode;
  mainId: string;
  mobileTitle: string;
  navigationGroups?: readonly WorkspaceSidebarGroup[];
  primaryAction?: (context: SidebarRenderContext) => ReactNode;
  resetKey: string;
  sidebarContent?: (context: SidebarRenderContext) => ReactNode;
  skipToContentLabel: string;
  user: WorkspaceAccountSummary;
  utilityItems?: readonly WorkspaceSidebarItem[];
  onLogout: () => void | Promise<void>;
  onOpenProfile: () => void;
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

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true'
  );
}

function AccountAvatar({
  initials,
  compact = false,
}: {
  initials: string;
  compact?: boolean;
}): ReactElement {
  return (
    <span className={compact ? 'workspace-account-avatar compact' : 'workspace-account-avatar'}>
      {initials}
    </span>
  );
}

function WorkspaceLanguageMenu({
  label,
  locale,
  onSelectLocale,
}: {
  label: string;
  locale: Locale;
  onSelectLocale: (locale: Locale) => void;
}): ReactElement {
  const options: readonly { locale: Locale; shortLabel: string; label: string }[] = [
    { locale: 'pl', shortLabel: 'PL', label: 'Polski' },
    { locale: 'en', shortLabel: 'EN', label: 'English' },
  ];

  return (
    <div className="workspace-language-menu" role="menu" aria-label={label}>
      {options.map((option) => (
        <button
          aria-checked={locale === option.locale}
          className={
            locale === option.locale
              ? 'workspace-language-option active'
              : 'workspace-language-option'
          }
          key={option.locale}
          role="menuitemradio"
          type="button"
          onClick={() => {
            onSelectLocale(option.locale);
          }}
        >
          <span className="workspace-language-code">{option.shortLabel}</span>
          <span>{option.label}</span>
          {locale === option.locale ? <Check aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

function WorkspaceAccountMenu({
  accountLabel,
  languageLabel,
  logoutLabel,
  settingsLabel,
  user,
  onLogout,
  onOpenProfile,
}: {
  accountLabel: string;
  languageLabel: string;
  logoutLabel: string;
  settingsLabel: string;
  user: WorkspaceAccountSummary;
  onLogout: () => void | Promise<void>;
  onOpenProfile: () => void;
}): ReactElement {
  const { locale, setLocale } = useI18n();
  const [languageOpen, setLanguageOpen] = useState(false);

  return (
    <div className="workspace-account-popover" role="menu" aria-label={settingsLabel}>
      <button
        aria-label={accountLabel}
        className="workspace-account-menu-row profile"
        role="menuitem"
        type="button"
        onClick={onOpenProfile}
      >
        <AccountAvatar initials={user.initials} compact />
        <span className="workspace-account-menu-copy">
          <strong>{user.displayName}</strong>
          <span>Level {user.level}</span>
        </span>
      </button>
      <button
        aria-expanded={languageOpen}
        className={
          languageOpen ? 'workspace-account-menu-row active' : 'workspace-account-menu-row'
        }
        role="menuitem"
        type="button"
        onClick={() => {
          setLanguageOpen((current) => !current);
        }}
      >
        <Languages aria-hidden="true" />
        <span>{languageLabel}</span>
      </button>
      {languageOpen ? (
        <WorkspaceLanguageMenu
          label={languageLabel}
          locale={locale}
          onSelectLocale={(nextLocale) => {
            setLocale(nextLocale);
          }}
        />
      ) : null}
      <button
        className="workspace-account-menu-row"
        role="menuitem"
        type="button"
        onClick={() => {
          void onLogout();
        }}
      >
        <LogOut aria-hidden="true" />
        <span>{logoutLabel}</span>
      </button>
    </div>
  );
}

function WorkspaceNavigationGroups({
  controlTabIndex,
  groups,
  onNavigate,
}: {
  controlTabIndex: number | undefined;
  groups: readonly WorkspaceSidebarGroup[];
  onNavigate: () => void;
}): ReactElement {
  return (
    <div className="workspace-nav-list workspace-nav-groups">
      {groups.map((group, groupIndex) => (
        <div className="workspace-nav-group" key={group.label ?? String(groupIndex)}>
          {group.label !== undefined ? (
            <p className="workspace-sidebar-section-label workspace-sidebar-text">{group.label}</p>
          ) : null}
          {group.items.map((item) => (
            <a
              aria-current={item.active ? 'page' : undefined}
              className={item.active ? 'workspace-nav-item active' : 'workspace-nav-item'}
              href={item.href}
              key={item.key}
              tabIndex={controlTabIndex}
              onClick={onNavigate}
            >
              {item.icon}
              <span className="workspace-sidebar-text">{item.label}</span>
              {item.badge !== null && item.badge !== undefined ? (
                <span className="workspace-nav-badge">{item.badge}</span>
              ) : null}
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}

function WorkspaceUtilityItems({
  controlTabIndex,
  items,
  onNavigate,
}: {
  controlTabIndex: number | undefined;
  items: readonly WorkspaceSidebarItem[];
  onNavigate: () => void;
}): ReactElement {
  return (
    <div className="workspace-nav-list workspace-utility-nav">
      {items.map((item) => (
        <a
          aria-current={item.active ? 'page' : undefined}
          className={item.active ? 'workspace-nav-item active' : 'workspace-nav-item'}
          href={item.href}
          key={item.key}
          tabIndex={controlTabIndex}
          onClick={onNavigate}
        >
          {item.icon}
          <span className="workspace-sidebar-text">{item.label}</span>
          {item.badge !== null && item.badge !== undefined ? (
            <span className="workspace-nav-badge">{item.badge}</span>
          ) : null}
        </a>
      ))}
    </div>
  );
}

export function WorkspaceSidebarShell({
  brandTitle,
  children,
  mainId,
  mobileTitle,
  navigationGroups = [],
  primaryAction,
  resetKey,
  sidebarContent,
  skipToContentLabel,
  user,
  utilityItems = [],
  onLogout,
  onOpenProfile,
}: WorkspaceSidebarShellProps): ReactElement {
  const { messages } = useI18n();
  const shell = messages.app.shell;
  const isMobileDrawer = useMobileDrawerMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const onCloseMobileRef = useRef<() => void>(() => undefined);
  const collapsed = !isMobileDrawer && sidebarCollapsed;
  const mobileModalOpen = isMobileDrawer && mobileOpen;
  const mobileHidden = isMobileDrawer && !mobileOpen;
  const controlTabIndex = mobileHidden ? -1 : undefined;
  const accountLabel = `${user.displayName} Level ${String(user.level)}`;

  function closeNavigation(): void {
    setMobileOpen(false);
  }

  useEffect(() => {
    onCloseMobileRef.current = closeNavigation;
  }, []);

  useEffect(() => {
    if (!mobileHidden) {
      drawerRef.current?.removeAttribute('inert');
      return;
    }

    drawerRef.current?.setAttribute('inert', '');
  }, [mobileHidden]);

  useEffect(() => {
    setMobileOpen(false);
    setAccountMenuOpen(false);
  }, [resetKey]);

  useEffect(() => {
    if (collapsed) {
      setAccountMenuOpen(false);
    }
  }, [collapsed]);

  useEffect(() => {
    if (!mobileModalOpen) {
      return undefined;
    }

    const drawer = drawerRef.current;
    if (drawer === null) {
      return undefined;
    }

    const previouslyFocused = document.activeElement;
    drawer.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseMobileRef.current();
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

  const sidebarClassName = [
    'workspace-sidebar',
    collapsed ? 'workspace-sidebar-rail' : '',
    mobileOpen ? 'mobile-open' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const shellClassName = collapsed
    ? 'workspace-shell workspace-shell-collapsed'
    : 'workspace-shell';

  return (
    <div className={shellClassName}>
      <a className="fa-skip-link" href={`#${mainId}`}>
        {skipToContentLabel}
      </a>
      <header className="workspace-mobile-topbar">
        <button
          aria-label={shell.openNavigation}
          className="workspace-icon-button"
          type="button"
          onClick={() => {
            setMobileOpen(true);
          }}
        >
          <Menu aria-hidden="true" />
        </button>
        <span>{mobileTitle}</span>
      </header>
      <div
        className={mobileModalOpen ? 'workspace-sidebar-scrim open' : 'workspace-sidebar-scrim'}
        onClick={() => {
          setMobileOpen(false);
        }}
      />
      <aside
        aria-hidden={mobileHidden ? true : undefined}
        aria-label={shell.primaryNavigation}
        aria-modal={mobileModalOpen ? true : undefined}
        className={sidebarClassName}
        ref={drawerRef}
        role={mobileModalOpen ? 'dialog' : 'navigation'}
        tabIndex={mobileModalOpen ? -1 : undefined}
      >
        <div className="workspace-sidebar-header">
          <a
            className="workspace-brand-link"
            href="#/chat"
            tabIndex={controlTabIndex}
            onClick={() => {
              setMobileOpen(false);
            }}
          >
            <Fish aria-hidden="true" />
            <span className="workspace-sidebar-text">{brandTitle}</span>
          </a>
          <button
            aria-label={shell.closeNavigation}
            className="workspace-icon-button workspace-mobile-close"
            tabIndex={controlTabIndex}
            type="button"
            onClick={() => {
              setMobileOpen(false);
            }}
          >
            <X aria-hidden="true" />
          </button>
          <button
            aria-label={collapsed ? shell.expandSidebar : shell.collapseSidebar}
            className="workspace-icon-button workspace-collapse-button"
            tabIndex={controlTabIndex}
            type="button"
            onClick={() => {
              setAccountMenuOpen(false);
              setSidebarCollapsed((current) => !current);
            }}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </button>
        </div>

        {primaryAction?.({ controlTabIndex, closeNavigation })}
        {sidebarContent?.({ controlTabIndex, closeNavigation })}
        {navigationGroups.length > 0 ? (
          <WorkspaceNavigationGroups
            controlTabIndex={controlTabIndex}
            groups={navigationGroups}
            onNavigate={closeNavigation}
          />
        ) : null}
        {utilityItems.length > 0 ? (
          <WorkspaceUtilityItems
            controlTabIndex={controlTabIndex}
            items={utilityItems}
            onNavigate={closeNavigation}
          />
        ) : null}

        <div className="workspace-account-block">
          {accountMenuOpen ? (
            <WorkspaceAccountMenu
              accountLabel={accountLabel}
              languageLabel={shell.language}
              logoutLabel={shell.logout}
              settingsLabel={shell.accountSettings}
              user={user}
              onLogout={onLogout}
              onOpenProfile={() => {
                setAccountMenuOpen(false);
                setMobileOpen(false);
                onOpenProfile();
              }}
            />
          ) : null}
          <button
            aria-label={accountLabel}
            className="workspace-account-profile"
            tabIndex={controlTabIndex}
            type="button"
            onClick={() => {
              setMobileOpen(false);
              onOpenProfile();
            }}
          >
            <AccountAvatar initials={user.initials} />
            <span className="workspace-account-copy workspace-sidebar-text">
              <strong>{user.displayName}</strong>
              <span>Level {user.level}</span>
            </span>
          </button>
          <button
            aria-expanded={accountMenuOpen}
            aria-label={shell.accountSettings}
            className="workspace-icon-button workspace-account-settings"
            tabIndex={controlTabIndex}
            type="button"
            onClick={() => {
              setAccountMenuOpen((current) => !current);
            }}
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </aside>
      <main className="workspace-main" id={mainId}>
        {children}
      </main>
    </div>
  );
}
