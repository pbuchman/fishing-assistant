import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface AdminNavigationGuardState {
  isDirty: boolean;
  confirmMessage: string;
}

interface AdminNavigationGuardContextValue {
  setGuard: (guard: AdminNavigationGuardState | null) => void;
}

function noopSetGuard(): void {
  return undefined;
}

const AdminNavigationGuardContext = createContext<AdminNavigationGuardContextValue>({
  setGuard: noopSetGuard,
});

export function AdminNavigationGuardProvider({
  children,
  setGuard,
}: {
  children: ReactNode;
  setGuard: (guard: AdminNavigationGuardState | null) => void;
}): ReactElement {
  const value = useMemo<AdminNavigationGuardContextValue>(() => ({ setGuard }), [setGuard]);

  return (
    <AdminNavigationGuardContext.Provider value={value}>
      {children}
    </AdminNavigationGuardContext.Provider>
  );
}

export function useAdminNavigationGuard(guard: AdminNavigationGuardState | null): void {
  const { setGuard } = useContext(AdminNavigationGuardContext);

  useEffect(() => {
    setGuard(guard);

    return () => {
      setGuard(null);
    };
  }, [guard, setGuard]);
}
