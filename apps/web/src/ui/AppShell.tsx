import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';

import {
  NavigationDrawer,
  type NavigationDrawerAction,
  type NavigationDrawerGroup,
} from './NavigationDrawer.js';
import { AppLanguageSwitch } from './AppLanguageSwitch.js';
import { TopAppBar } from './TopAppBar.js';

export function AppShell({
  title,
  subtitle,
  navLabel,
  openNavLabel,
  closeNavLabel,
  skipToContentLabel,
  mode,
  groups,
  drawerActions,
  drawerHeader,
  children,
}: {
  title: string;
  subtitle?: string;
  navLabel: string;
  openNavLabel: string;
  closeNavLabel: string;
  skipToContentLabel: string;
  mode: 'user' | 'admin';
  groups: readonly NavigationDrawerGroup[];
  drawerActions?: readonly NavigationDrawerAction[];
  drawerHeader?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={`fa-app-shell fa-app-shell-${mode}`}>
      <a className="fa-skip-link" href="#app-main-content">
        {skipToContentLabel}
      </a>
      <TopAppBar
        menuLabel={openNavLabel}
        title={title}
        {...(subtitle === undefined ? {} : { subtitle })}
        onMenuClick={() => {
          setDrawerOpen(true);
        }}
      />
      <NavigationDrawer
        {...(drawerActions === undefined ? {} : { actions: drawerActions })}
        closeLabel={closeNavLabel}
        groups={groups}
        label={navLabel}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
        }}
      >
        <div className="fa-drawer-language">
          <AppLanguageSwitch />
        </div>
        {drawerHeader}
      </NavigationDrawer>
      <main className="fa-main" id="app-main-content">
        {children}
      </main>
    </div>
  );
}
