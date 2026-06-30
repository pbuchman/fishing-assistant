import type { ReactElement, ReactNode } from 'react';

import { useDocumentTitle } from '../ui/useDocumentTitle.js';

function SignOutButton({
  onLogout,
  label = 'Wyloguj',
  className,
}: {
  onLogout: () => Promise<void>;
  label?: string;
  className?: string;
}): ReactElement {
  return (
    <button className={className} type="button" onClick={() => void onLogout()}>
      {label}
    </button>
  );
}

function AccountStateFrame({
  title,
  children,
  actions,
  pending = false,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  pending?: boolean;
}): ReactElement {
  useDocumentTitle(title);

  return (
    <main className="auth-screen">
      <section
        className={pending ? 'auth-panel fa-surface' : 'auth-panel'}
        aria-labelledby="auth-panel-title"
      >
        {pending ? <div className="auth-panel-eyebrow">Fishing Assistant</div> : null}
        <h1 id="auth-panel-title">{title}</h1>
        <div className="auth-copy">{children}</div>
        {actions !== undefined ? <div className="auth-actions">{actions}</div> : null}
      </section>
    </main>
  );
}

export function PendingPage({ onLogout }: { onLogout: () => Promise<void> }): ReactElement {
  return (
    <AccountStateFrame
      pending
      title="Konto czeka na akceptację"
      actions={<SignOutButton onLogout={onLogout} label="Wyloguj" className="fa-primary-button" />}
    >
      <p>Administrator sprawdzi dostęp i odblokuje asystenta.</p>
    </AccountStateFrame>
  );
}

export function RejectedPage({ onLogout }: { onLogout: () => Promise<void> }): ReactElement {
  return (
    <AccountStateFrame
      title="Konto nie zostało zatwierdzone"
      actions={<SignOutButton onLogout={onLogout} />}
    >
      <p>
        Twoje konto nie zostało zatwierdzone. Skontaktuj się z administratorem, jeśli to pomyłka.
      </p>
    </AccountStateFrame>
  );
}

export function SuspendedPage({ onLogout }: { onLogout: () => Promise<void> }): ReactElement {
  return (
    <AccountStateFrame title="Konto zawieszone" actions={<SignOutButton onLogout={onLogout} />}>
      <p>Twoje konto zostało zawieszone.</p>
      <p>Skontaktuj się z administratorem, aby przywrócić dostęp.</p>
    </AccountStateFrame>
  );
}

export function NotAllowedPage({ onLogout }: { onLogout: () => Promise<void> }): ReactElement {
  return (
    <AccountStateFrame
      title="Brak dostępu"
      actions={
        <>
          <a className="fa-primary-button" href="#/chat">
            Wróć do chatu
          </a>
          <SignOutButton onLogout={onLogout} className="fa-secondary-button" />
        </>
      }
    >
      <p>Ta strona nie jest dostępna dla Twojego konta.</p>
    </AccountStateFrame>
  );
}

export function NotFoundPage(): ReactElement {
  return (
    <AccountStateFrame
      title="Nie znaleziono strony"
      actions={
        <a className="fa-primary-button" href="#/chat">
          Wróć do chatu
        </a>
      }
    >
      <p>Ta strona aplikacji nie istnieje albo nie jest już dostępna.</p>
    </AccountStateFrame>
  );
}

export function TemporaryAdminPlaceholder(): ReactElement {
  return (
    <AccountStateFrame title="Admin workspace">
      <p>Admin tools are coming soon.</p>
    </AccountStateFrame>
  );
}

export function AccountErrorPage({
  message,
  onRetry,
  onLogout,
}: {
  message: string;
  onRetry: () => Promise<void>;
  onLogout: () => Promise<void>;
}): ReactElement {
  return (
    <AccountStateFrame
      title="Nie udało się sprawdzić konta"
      actions={
        <>
          <button className="fa-primary-button" type="button" onClick={() => void onRetry()}>
            Spróbuj ponownie
          </button>
          <SignOutButton onLogout={onLogout} className="fa-secondary-button" />
          <a className="fa-secondary-button" href="#/home">
            Wróć na stronę główną
          </a>
        </>
      }
    >
      <p>{message}</p>
    </AccountStateFrame>
  );
}

export function AuthErrorPage({
  title = 'Logowanie nie powiodło się',
  message,
  onRetry,
  retryLabel = 'Spróbuj ponownie',
  homeLink = false,
}: {
  title?: string;
  message: string;
  onRetry: () => Promise<void>;
  retryLabel?: string;
  homeLink?: boolean;
}): ReactElement {
  return (
    <AccountStateFrame
      title={title}
      actions={
        <>
          <button className="fa-primary-button" type="button" onClick={() => void onRetry()}>
            {retryLabel}
          </button>
          {homeLink ? (
            <a className="fa-secondary-button" href="#/home">
              Wróć na stronę główną
            </a>
          ) : null}
        </>
      }
    >
      <p>{message}</p>
    </AccountStateFrame>
  );
}
