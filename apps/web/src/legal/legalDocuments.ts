export type LegalDocumentId = 'legal' | 'privacy' | 'cookies' | 'terms' | 'ai';

export interface LegalDocumentSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  route: string;
  title: string;
  summary: string;
  sections: LegalDocumentSection[];
}

const sharedScopeBullets = [
  'Dokument opisuje standardowy zakres działania Fishing Assistant jako aplikacji webowej.',
  'Operator wdrożenia utrzymuje aktualne dane kontaktowe, listę dostawców technicznych i okresy retencji.',
  'Treść ma charakter informacyjny i nie zastępuje indywidualnej porady prawnej.',
] as const;

const complianceBullets = [
  'Zakres informacji dobrano pod wymagania transparentności z RODO art. 12 i 13, obowiązki informacyjne usług online z dyrektywy 2000/31/WE art. 5 oraz polskiej ustawy o świadczeniu usług drogą elektroniczną art. 6 i 8.',
  'Informacje o cookies i pamięci przeglądarki zaprojektowano pod wymogi Prawa komunikacji elektronicznej art. 399.',
  'Informację o AI przygotowano z uwzględnieniem AI Act art. 50 oraz kalendarza stosowania z art. 113.',
] as const;

const legalDocumentList = [
  {
    id: 'legal',
    route: '#/legal',
    title: 'Informacje prawne',
    summary:
      'Podstawowe informacje o zakresie działania Fishing Assistant, kontakcie i dokumentach użytkownika.',
    sections: [
      { title: 'Zakres dokumentu', bullets: [...sharedScopeBullets] },
      { title: 'Podstawy transparentności', bullets: [...complianceBullets] },
      {
        title: 'Czym jest FA',
        paragraphs: [
          'Fishing Assistant jest przygotowywany jako webowy asystent wiedzy wędkarskiej dla użytkowników z kontem w aplikacji.',
          'Na tym etapie FA nie jest sklepem, checkoutem ani systemem sprzedaży subskrypcji.',
        ],
      },
      {
        title: 'Zakres aplikacji',
        paragraphs: [
          'Dokumenty FA opisują korzystanie z aplikacji, konta użytkownika, bazy wiedzy, rozmów z asystentem oraz technicznego przetwarzania danych.',
          'Jeżeli wdrożenie obejmie sprzedaż, płatności albo dodatkowe usługi, dokumenty powinny zostać zaktualizowane przed ich udostępnieniem użytkownikom.',
        ],
      },
      {
        title: 'Dane podmiotu',
        paragraphs: [
          'Administratorem danych i usługodawcą jest operator konkretnego wdrożenia Fishing Assistant.',
          'Kontakt w sprawach aplikacji, danych lub korekty profilu: hello@fishing-assistant.example.',
        ],
      },
      {
        title: 'Informacje utrzymywane przez operatora',
        bullets: [
          'pełna nazwa i dane identyfikacyjne administratora danych oraz usługodawcy;',
          'adres kontaktowy i ewentualny adres do doręczeń;',
          'aktualna lista dostawców technicznych i modeli AI;',
          'okresy przechowywania danych;',
          'procedura reklamacji albo zgłoszeń dotyczących działania usługi.',
        ],
      },
    ],
  },
  {
    id: 'privacy',
    route: '#/privacy',
    title: 'Polityka prywatności',
    summary:
      'Opis tego, jakie dane może przetwarzać FA, dlaczego są potrzebne i jak użytkownik może zgłaszać sprawy dotyczące danych.',
    sections: [
      { title: 'Zakres dokumentu', bullets: [...sharedScopeBullets] },
      { title: 'Podstawy transparentności', bullets: [...complianceBullets] },
      {
        title: 'Administrator danych',
        paragraphs: [
          'Administratorem danych jest operator konkretnego wdrożenia Fishing Assistant.',
          'Kontakt w sprawach danych: hello@fishing-assistant.example.',
        ],
      },
      {
        title: 'Kategorie danych',
        bullets: [
          'Dane logowania Auth0: identyfikator użytkownika, adres e-mail i status weryfikacji e-maila.',
          'Dane konta FA: imię, nazwisko, telefon, rola, status konta, próg dostępu oraz daty utworzenia, zatwierdzenia lub zawieszenia konta.',
          'Dane rozmów: pytania użytkownika, odpowiedzi asystenta, historia rozmów, tytuły rozmów, cytowania, ślady wyszukiwania w Bazie Wiedzy i informacje o brakach w odpowiedzi.',
          'Zgłoszenia luk wiedzy: pytanie, opis brakującej informacji, próg dostępu użytkownika, data zgłoszenia, techniczne identyfikatory zgłoszenia, rozmowy i wiadomości oraz opcjonalnie kontekst rozmowy i kontakt, jeżeli użytkownik je udostępni.',
          'Dane użycia LLM: dostawca, model, liczba tokenów, szacowany koszt, typ operacji i identyfikatory powiązane z rozmową.',
          'Dane techniczne i bezpieczeństwa: metadane żądań, logi, stan uwierzytelnienia, diagnostyka usług i informacje operacyjne.',
        ],
      },
      {
        title: 'Po co FA przetwarza dane',
        bullets: [
          'aby logować użytkownika i rozpoznawać jego konto;',
          'aby kontrolować dostęp do aplikacji zgodnie ze statusem konta;',
          'aby prowadzić historię rozmów i umożliwić powrót do poprzednich pytań;',
          'aby generować odpowiedzi AI na podstawie pytania i dostępnej Bazy Wiedzy;',
          'aby administrator mógł uzupełniać Bazę Wiedzy i ocenić, czy brak dotyczy całej bazy, czy zakresu dostępnego dla danego progu;',
          'aby mierzyć użycie modeli, koszty, stabilność i bezpieczeństwo działania usługi;',
          'aby obsługiwać zgłoszenia, korekty danych oraz problemy techniczne.',
        ],
      },
      {
        title: 'Podstawy prawne zgłoszeń luk wiedzy',
        bullets: [
          'Minimalne zgłoszenie luki wiedzy, obejmujące opis braku, pytanie, próg dostępu użytkownika, datę i techniczne identyfikatory zgłoszenia, opiera się o prawnie uzasadniony interes polegający na utrzymaniu jakości i kompletności Bazy Wiedzy.',
          'Dobrowolne udostępnienie kontaktu i kontekstu rozmowy opiera się na zgodzie użytkownika wyrażonej przez zaznaczenie odpowiednich opcji i służy wyłącznie doprecyzowaniu zgłoszenia, uzupełnieniu materiału oraz ewentualnemu kontaktowi administratora z użytkownikiem.',
          'Jeżeli użytkownik nie udostępni kontaktu, zgłoszenie nie powinno pokazywać administratorowi adresu e-mail, imienia, nazwiska ani stałego identyfikatora użytkownika.',
        ],
      },
      {
        title: 'Okresy przechowywania i kryteria retencji',
        bullets: [
          'Kryteria retencji zgłoszeń luk wiedzy powinny uwzględniać status zgłoszenia, potrzebę uzupełnienia Bazy Wiedzy, rozliczalność zmian oraz możliwość usunięcia albo anonimizacji danych kontaktowych po zamknięciu sprawy.',
          'Operator utrzymuje okresy przechowywania dla zgłoszeń oczekujących, zamkniętych i wycofanych przez użytkownika.',
        ],
      },
      {
        title: 'Dostawcy i podmioty techniczne',
        bullets: [
          'Auth0 obsługuje logowanie i uwierzytelnienie.',
          'Google Cloud / Firestore przechowuje dane aplikacji.',
          'Hetzner, nginx i Cloudflare obsługują produkcyjne dostarczanie aplikacji.',
          'Dostawców modeli AI i embeddingów, takich jak OpenRouter, MiniMax, OpenAI lub Gemini, można używać do przetwarzania treści pytań i kontekstu rozmowy zależnie od aktywnej konfiguracji.',
          'Grafana, Loki i Alloy mogą przetwarzać dane techniczne w logach operacyjnych.',
        ],
      },
      {
        title: 'Ostrożność przy treści pytań',
        paragraphs: [
          'Użytkownik nie powinien wpisywać danych wrażliwych ani cudzych danych osobowych, jeżeli nie jest to konieczne i nie ma do tego podstawy.',
          'Treść pytań może zostać przetworzona przez dostawców modeli AI lub embeddingów, dlatego pytania powinny dotyczyć tematu korzystania z FA i wiedzy wędkarskiej.',
        ],
      },
      {
        title: 'Prawa użytkownika',
        paragraphs: [
          'Użytkownik może korzystać z praw z RODO, w tym dostępu do danych, sprostowania, usunięcia, ograniczenia przetwarzania, sprzeciwu i skargi do organu nadzorczego.',
          'Pytania o dane lub korektę profilu można kierować na hello@fishing-assistant.example.',
        ],
      },
    ],
  },
  {
    id: 'cookies',
    route: '#/cookies',
    title: 'Cookies i pamięć przeglądarki',
    summary: 'Opis technicznej pamięci przeglądarki używanej przez FA bez marketingowych cookies.',
    sections: [
      { title: 'Zakres dokumentu', bullets: [...sharedScopeBullets] },
      { title: 'Podstawy transparentności', bullets: [...complianceBullets] },
      {
        title: 'Co zapisuje FA',
        bullets: [
          'Auth0 może zapisywać dane sesji w local storage, ponieważ FA używa uwierzytelniania Auth0 SPA.',
          'FA zapisuje fa.locale w local storage, żeby pamiętać wybrany język interfejsu.',
          'FA zapisuje fa.force_login_after_logout w session storage, żeby poprawnie obsłużyć logowanie po wylogowaniu.',
          'Service worker może zapisywać pliki powłoki aplikacji w Cache Storage, aby obsłużyć techniczny fallback i działanie offline.',
        ],
      },
      {
        title: 'Czego nie używamy teraz',
        paragraphs: [
          'FA nie używa marketingowych cookies, cookies reklamowych ani marketingowej analityki.',
          'Jeżeli wdrożenie doda niekonieczną analitykę lub marketingowe storage, informacja i mechanizm zgód powinny zostać zaktualizowane.',
        ],
      },
      {
        title: 'Dlaczego nie ma banera',
        paragraphs: [
          'Aktualny opis zakłada wyłącznie techniczną pamięć potrzebną do działania żądanej usługi, logowania, preferencji języka oraz cache aplikacji.',
          'Jeżeli zakres pamięci przeglądarki zmieni się, ta informacja powinna zostać zaktualizowana.',
        ],
      },
    ],
  },
  {
    id: 'terms',
    route: '#/terms',
    title: 'Regulamin korzystania z asystenta',
    summary: 'Zasady korzystania z asystenta wiedzy wędkarskiej.',
    sections: [
      { title: 'Zakres dokumentu', bullets: [...sharedScopeBullets] },
      { title: 'Podstawy transparentności', bullets: [...complianceBullets] },
      {
        title: 'Dostęp',
        paragraphs: [
          'Dostęp do FA może wymagać logowania przez Auth0 oraz aktywnego konta w aplikacji.',
          'Regulamin FA nie opisuje sprzedaży, zwrotów ani subskrypcji, ponieważ FA nie jest sklepem w tej fazie.',
        ],
      },
      {
        title: 'Zasady korzystania',
        bullets: [
          'Nie wolno atakować aplikacji, obchodzić zabezpieczeń ani udostępniać danych logowania.',
          'Nie wolno wprowadzać treści bezprawnych ani celowo wpisywać niepotrzebnych danych wrażliwych lub danych osób trzecich.',
          'Nie wolno używać FA do działań naruszających prawo, regulaminy łowisk albo prawa innych osób.',
          'FA może być zmieniane, zawieszane lub ograniczane z powodów technicznych, bezpieczeństwa albo jakości działania.',
        ],
      },
      {
        title: 'Charakter odpowiedzi',
        paragraphs: [
          'Odpowiedzi AI są wsparciem informacyjnym przy pracy z wiedzą wędkarską. Nie zastępują oceny eksperta, zasad bezpieczeństwa, aktualnych przepisów ani lokalnych regulacji łowiska.',
          'Użytkownik powinien samodzielnie weryfikować informacje ważne, aktualne, prawne, bezpieczeństwa lub zależne od konkretnego miejsca.',
        ],
      },
      {
        title: 'Zgłoszenia',
        paragraphs: [
          'Zgłoszenia dotyczące działania FA można kierować na hello@fishing-assistant.example.',
        ],
      },
    ],
  },
  {
    id: 'ai',
    route: '#/ai',
    title: 'Informacja o AI',
    summary:
      'Krótka informacja o tym, że użytkownik rozmawia z systemem AI i co to oznacza dla pytań oraz odpowiedzi.',
    sections: [
      { title: 'Zakres dokumentu', bullets: [...sharedScopeBullets] },
      { title: 'Podstawy transparentności', bullets: [...complianceBullets] },
      {
        title: 'Rozmowa z asystentem',
        paragraphs: [
          'W FA użytkownik rozmawia z asystentem opartym o modele AI. Odpowiedzi są generowane automatycznie na podstawie pytania, historii rozmowy i dostępnych materiałów z Bazy Wiedzy, jeżeli takie materiały zostaną odnalezione.',
          'Interfejs powinien być traktowany jako system AI, a nie rozmowa z człowiekiem.',
        ],
      },
      {
        title: 'Przetwarzanie przez modele',
        paragraphs: [
          'Treść pytań i kontekst rozmowy mogą być przekazywane do dostawców modeli AI lub embeddingów. Zakres zależy od aktywnej konfiguracji technicznej FA.',
          'Dostawców modeli AI można zmienić, dlatego aktualna lista powinna być utrzymywana w polityce prywatności operatora.',
        ],
      },
      {
        title: 'Ograniczenia',
        bullets: [
          'Odpowiedź może być niepełna lub błędna.',
          'Ważne, aktualne, prawne, bezpieczeństwa i czasowo wrażliwe informacje trzeba zweryfikować poza FA.',
          'Asystent powinien informować, gdy dostępna Baza Wiedzy nie zawiera wystarczających informacji, ale ta informacja nie jest gwarancją bezbłędności.',
          'Użytkownik nie powinien wpisywać danych wrażliwych ani cudzych danych osobowych, jeżeli nie jest to konieczne.',
        ],
      },
    ],
  },
] as const satisfies readonly LegalDocument[];

const defaultLegalDocument = legalDocumentList[0];

export const legalDocuments: readonly LegalDocument[] = legalDocumentList;

export const legalDocumentLinks = legalDocuments.map(({ id, route, title }) => ({
  id,
  route,
  label: title,
})) satisfies readonly { id: LegalDocumentId; route: string; label: string }[];

export function legalDocumentById(id: LegalDocumentId): LegalDocument {
  return legalDocuments.find((document) => document.id === id) ?? defaultLegalDocument;
}

export function legalDocumentByRoute(routePath: string): LegalDocument | null {
  const path = routePath.split('?')[0] ?? routePath;
  return legalDocuments.find((document) => document.route === path) ?? null;
}

export function isLegalRoutePath(routePath: string): boolean {
  return legalDocumentByRoute(routePath) !== null;
}
