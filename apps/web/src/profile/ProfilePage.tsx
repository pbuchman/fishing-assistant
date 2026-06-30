import type { ReactElement, SyntheticEvent } from 'react';
import { useState } from 'react';

import { useFaAuth } from '../auth/useFaAuth.js';
import { useDocumentTitle } from '../ui/useDocumentTitle.js';

const mobilePattern = /^\+[1-9][0-9]{7,14}$/;
const correctionRequestHref =
  'mailto:hello@fishing-assistant.example?subject=Fishing%20Assistant%20profile%20correction';

function formatLevel(level: number | null | undefined, effectiveLevel: number): string {
  return String(level ?? effectiveLevel);
}

function formatRole(role: 'admin' | 'user'): string {
  return role === 'admin' ? 'Administrator' : 'Użytkownik';
}

function formatStatus(status: 'approved' | 'pending' | 'rejected' | 'suspended'): string {
  switch (status) {
    case 'approved':
      return 'Zatwierdzone';
    case 'pending':
      return 'Oczekuje';
    case 'rejected':
      return 'Odrzucone';
    case 'suspended':
      return 'Zawieszone';
  }
}

export function ProfilePage(): ReactElement {
  const auth = useFaAuth();
  useDocumentTitle(auth.accountState.status === 'approved' ? 'Profil' : 'Uzupełnij profil');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (trimmedFirstName.length === 0 || trimmedLastName.length === 0) {
      setErrorMessage('Podaj imię i nazwisko.');
      return;
    }

    if (!mobilePattern.test(mobileNumber)) {
      setErrorMessage('Podaj numer telefonu w formacie E.164.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await auth.completeProfile({
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        mobileNumber,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (auth.accountState.status === 'approved') {
    const { user } = auth.accountState.account;
    const displayName = [user.firstName, user.lastName]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ');

    return (
      <main className="auth-screen">
        <section className="auth-panel" aria-labelledby="profile-title">
          <h1 id="profile-title">Profil</h1>
          <p className="auth-copy">Dane Twojego konta w Fishing Assistant.</p>
          <p className="auth-copy">
            Dane profilu są tutaj tylko do odczytu. Imię, nazwisko i telefon pochodzą z rekordu
            konta FA, a rola, status i próg dostępu są zarządzane przez administratora.
          </p>
          <dl className="profile-summary">
            <div>
              <dt>E-mail</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Imię i nazwisko</dt>
              <dd>{displayName.length > 0 ? displayName : '-'}</dd>
            </div>
            <div>
              <dt>Telefon</dt>
              <dd>{user.mobileNumber}</dd>
            </div>
            <div>
              <dt>Rola</dt>
              <dd>{formatRole(user.role)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{formatStatus(user.status)}</dd>
            </div>
            <div>
              <dt>Próg</dt>
              <dd>{formatLevel(user.level, user.effectiveLevel)}</dd>
            </div>
          </dl>
          <div className="auth-actions">
            <a className="fa-primary-button" href={correctionRequestHref}>
              Poproś o korektę
            </a>
            <a className="fa-secondary-button" href="#/chat">
              Wróć do chatu
            </a>
            <button
              className="fa-secondary-button"
              type="button"
              onClick={() => void auth.logout()}
            >
              Wyloguj
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="profile-title">
        <h1 id="profile-title">Uzupełnij profil</h1>
        <p className="auth-copy">Uzupełnij te pola, zanim przejdziesz do aplikacji.</p>
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="auth-field">
            <span>Imię</span>
            <input
              autoComplete="given-name"
              name="firstName"
              type="text"
              value={firstName}
              onChange={(event) => {
                setFirstName(event.target.value);
              }}
            />
          </label>
          <label className="auth-field">
            <span>Nazwisko</span>
            <input
              autoComplete="family-name"
              name="lastName"
              type="text"
              value={lastName}
              onChange={(event) => {
                setLastName(event.target.value);
              }}
            />
          </label>
          <label className="auth-field">
            <span>Telefon</span>
            <input
              autoComplete="tel"
              name="mobileNumber"
              type="tel"
              placeholder="+15550101000"
              value={mobileNumber}
              onChange={(event) => {
                setMobileNumber(event.target.value);
              }}
            />
          </label>
          {errorMessage !== null ? <p className="auth-error">{errorMessage}</p> : null}
          <div className="auth-actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Zapisywanie...' : 'Dalej'}
            </button>
            <button type="button" onClick={() => void auth.logout()}>
              Wyloguj
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
