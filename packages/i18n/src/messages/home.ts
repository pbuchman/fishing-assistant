import type { Locale } from '../locales.js';
import type { LinkMessage } from './shared.js';

export interface HomeMessages {
  meta: {
    brandLabel: string;
    navLabel: string;
    mobileNavLabel: string;
    skipToContent: string;
  };
  nav: {
    knowledge: string;
    topics: string;
    assistant: string;
    process: string;
    faq: string;
  };
  hero: {
    title: string;
    subtitle: string;
    body: string;
    primaryCta: LinkMessage;
    assistantCta: LinkMessage;
    proof: readonly string[];
    stats: readonly { value: string; label: string }[];
  };
  knowledgeValue: {
    title: string;
    body: string;
    cards: readonly { title: string; body: string }[];
  };
  assistant: {
    title: string;
    body: string;
    statusLabel: string;
    questionLabel: string;
    answerLabel: string;
    question: string;
    answer: string;
    missingInfoLabel: string;
    missingInfo: string;
    examplesTitle: string;
    examples: readonly string[];
  };
  topics: {
    title: string;
    body: string;
    items: readonly { title: string; body: string }[];
  };
  process: {
    title: string;
    body: string;
    items: readonly { title: string; body: string }[];
  };
  author: {
    title: string;
    body: string;
    quote: string;
  };
  faq: {
    title: string;
    items: readonly { question: string; answer: string; cta?: LinkMessage }[];
  };
  footer: {
    summary: string;
    contact: LinkMessage;
    privacy: LinkMessage;
    terms: LinkMessage;
  };
  finalCta: {
    title: string;
    body: string;
    primaryCta: LinkMessage;
    assistantCta: LinkMessage;
  };
}

export const homeMessages: Record<Locale, HomeMessages> = {
  pl: {
    meta: {
      brandLabel: 'Fishing Assistant - strona główna',
      navLabel: 'Strona główna',
      mobileNavLabel: 'Sekcje strony',
      skipToContent: 'Pomiń do treści',
    },
    nav: {
      knowledge: 'Baza wiedzy',
      topics: 'Tematy',
      assistant: 'Asystent',
      process: 'Proces',
      faq: 'FAQ',
    },
    hero: {
      title: 'Fishing Assistant',
      subtitle: 'Baza wiedzy i asystent wędkarski do decyzji nad wodą',
      body: 'Pracuj z uporządkowaną wiedzą o metodach, gatunkach, zanętach, przynętach i warunkach na łowisku. Zadawaj pytania, porównuj warianty i szybciej dochodź do praktycznego planu działania.',
      primaryCta: {
        label: 'Otwórz asystenta',
        ariaLabel: 'Otwórz aplikację Fishing Assistant',
      },
      assistantCta: {
        label: 'Zobacz przykłady',
        ariaLabel: 'Przejdź do przykładów pracy z asystentem',
      },
      proof: [
        'Obszary i notatki tematyczne',
        'Pytania prowadzące do decyzji nad wodą',
        'Odpowiedzi z jasnym zakresem pewności',
      ],
      stats: [
        { value: '120+', label: 'obszarów i notatek' },
        { value: '10+', label: 'obszarów tematycznych' },
        { value: '24/7', label: 'dostęp do asystenta' },
      ],
    },
    knowledgeValue: {
      title: 'Wiedza uporządkowana pod realne decyzje',
      body: 'Fishing Assistant porządkuje materiały tak, aby łatwo wrócić do metody, gatunku, warunku albo problemu z konkretnej sesji. Zamiast przeszukiwać luźne notatki, zaczynasz od pytania i przechodzisz do działania.',
      cards: [
        {
          title: 'Metody i zestawy',
          body: 'Method feeder, feeder klasyczny, spławik, karpiarstwo, podajniki, przypony i czytanie brań.',
        },
        {
          title: 'Warunki łowiska',
          body: 'Ciśnienie, temperatura, roślinność, zamulone dno, presja wędkarska i aktywność drobnicy.',
        },
        {
          title: 'Decyzje taktyczne',
          body: 'Dobór zanęty, pelletu, przynęty, tempa donęcania, dystansu i jednej zmiany testowanej naraz.',
        },
      ],
    },
    assistant: {
      title: 'Asystent wiedzy wędkarskiej',
      body: 'Asystent pomaga znaleźć właściwy fragment wiedzy i przełożyć go na praktyczny plan. Gdy brakuje danych, pokazuje, czego jeszcze potrzeba do lepszej odpowiedzi.',
      statusLabel: 'Odpowiedzi oparte na bazie wiedzy',
      questionLabel: 'Przykładowe pytanie',
      answerLabel: 'Przykładowa odpowiedź',
      question:
        'Łowię na method feeder na zamulonym łowisku, przy brzegu jest dużo glonów i drobnicy. Jak podejść do zanęty i pelletu?',
      answer:
        'Zacznij od obserwacji dna, roślinności i reakcji ryb. Na takiej wodzie warto ograniczyć chaos zanętowy, kontrolować pracę mieszanki i testować jedną zmianę naraz: frakcję, tempo donęcania albo linię łowienia.',
      missingInfoLabel: 'Co poprawi odpowiedź',
      missingInfo:
        'Głębokość, temperatura, presja wędkarska, dystans łowienia i to, czy brania pojawiają się po donęceniu.',
      examplesTitle: 'O co można pytać?',
      examples: [
        'Co zmienia skok ciśnienia przed sesją?',
        'Kiedy donęcać, a kiedy zostawić zestaw w spokoju?',
        'Jak dobrać zanętę pod lina albo karpia?',
        'Czy pellet z zanętą ma sens przy dużej drobnicy?',
      ],
    },
    topics: {
      title: 'Tematy zbudowane wokół metod, gatunków i warunków',
      body: 'Materiały są ułożone tak, żeby można było iść krok po kroku albo wracać do tematu wtedy, gdy łowisko zada konkretne pytanie.',
      items: [
        {
          title: 'Najważniejsze na początek',
          body: 'Podstawy, które ustawiają sposób myślenia przed pierwszym rzutem.',
        },
        {
          title: 'Method feeder i feeder',
          body: 'Podajniki, koszyki, praca zanęty, pellet, przypony i czytanie brań.',
        },
        {
          title: 'Spławik i karpiarstwo',
          body: 'Taktyka pod ryby spokojnego żeru: ziarna, mieszanki, selekcja brań i praca z większą rybą.',
        },
        {
          title: 'Gatunki ryb słodkowodnych',
          body: 'Zachowania lina, karpia, leszcza, płoci i innych gatunków w konkretnych warunkach.',
        },
        {
          title: 'Mikrośrodowiska',
          body: 'Roślinność, strefy denne, temperatura, głębokość i miejsca, w których ryba zmienia zachowanie.',
        },
        {
          title: 'Taktyka sesji',
          body: 'Planowanie zmian, tempo nęcenia, praca zestawu i interpretacja reakcji ryb w czasie łowienia.',
        },
      ],
    },
    process: {
      title: 'Od pytania do planu działania',
      body: 'Strona pokazuje prosty proces pracy z wiedzą: opisujesz sytuację, asystent dobiera kontekst, a odpowiedź wskazuje konkretne decyzje i brakujące dane.',
      items: [
        {
          title: 'Opisz łowisko',
          body: 'Podaj metodę, warunki, głębokość, aktywność ryb i to, co już zostało sprawdzone.',
        },
        {
          title: 'Porównaj warianty',
          body: 'Asystent zestawia możliwe kierunki: frakcję zanęty, tempo donęcania, dystans albo zmianę przynęty.',
        },
        {
          title: 'Zapisz wnioski',
          body: 'Najlepsze odpowiedzi prowadzą do testu jednej zmiany naraz i notowania reakcji ryb.',
        },
      ],
    },
    author: {
      title: 'Minimum obietnic, maksimum konkretu',
      body: 'Fishing Assistant nie obiecuje gotowej recepty na każde łowisko. Pomaga uporządkować dane, nazwać założenia i wybrać kolejny rozsądny test.',
      quote:
        'Najlepsza odpowiedź nie zastępuje obserwacji nad wodą. Ma pomóc szybciej zrozumieć, co warto sprawdzić jako następne.',
    },
    faq: {
      title: 'Najczęstsze pytania',
      items: [
        {
          question: 'Czy asystent zastępuje własną ocenę łowiska?',
          answer:
            'Nie. To narzędzie do pracy z wiedzą i porządkowania decyzji. Warunki, przepisy i bezpieczeństwo zawsze wymagają własnej oceny.',
          cta: {
            label: 'Otwórz asystenta',
            ariaLabel: 'Otwórz aplikację Fishing Assistant',
          },
        },
        {
          question: 'Jakiego typu pytania mają największy sens?',
          answer:
            'Najlepiej działają pytania z kontekstem: metoda, typ dna, pogoda, aktywność ryb, dystans, zanęta i to, co już było testowane.',
        },
        {
          question: 'Skąd pochodzą odpowiedzi?',
          answer:
            'Odpowiedzi są generowane na podstawie dostępnej bazy wiedzy i pytania użytkownika. Gdy brakuje informacji, asystent powinien to jasno wskazać.',
        },
        {
          question: 'Czy strona jest dostępna po angielsku?',
          answer:
            'Tak. Polski jest językiem domyślnym, a przełącznik języka pokazuje angielską wersję sensu i kontekstu, nie dosłowne tłumaczenie słowo w słowo.',
        },
      ],
    },
    footer: {
      summary:
        'Fishing Assistant to aplikacja do pracy z wiedzą wędkarską; kontakt i dokumenty prawne są dostępne poniżej.',
      contact: {
        label: 'Kontakt',
        ariaLabel: 'Kontakt',
      },
      privacy: {
        label: 'Prywatność',
        ariaLabel: 'Prywatność',
      },
      terms: {
        label: 'Regulamin',
        ariaLabel: 'Regulamin',
      },
    },
    finalCta: {
      title: 'Przejdź od pytania do decyzji nad wodą',
      body: 'Otwórz asystenta, opisz sytuację na łowisku i sprawdź, które dane oraz kierunki działania są najważniejsze przed kolejną zmianą zestawu.',
      primaryCta: {
        label: 'Otwórz asystenta',
        ariaLabel: 'Otwórz aplikację Fishing Assistant',
      },
      assistantCta: {
        label: 'Zobacz przykłady',
        ariaLabel: 'Wróć do przykładów pracy z asystentem',
      },
    },
  },
  en: {
    meta: {
      brandLabel: 'Fishing Assistant homepage',
      navLabel: 'Home',
      mobileNavLabel: 'Page sections',
      skipToContent: 'Skip to content',
    },
    nav: {
      knowledge: 'Knowledge base',
      topics: 'Topics',
      assistant: 'Assistant',
      process: 'Process',
      faq: 'FAQ',
    },
    hero: {
      title: 'Fishing Assistant',
      subtitle: 'A fishing knowledge base and assistant for decisions at the water',
      body: 'Work with structured knowledge about methods, fish species, bait, rigs, and venue conditions. Ask questions, compare options, and move faster toward a practical plan.',
      primaryCta: {
        label: 'Open the assistant',
        ariaLabel: 'Open the Fishing Assistant app',
      },
      assistantCta: {
        label: 'See examples',
        ariaLabel: 'Jump to assistant examples',
      },
      proof: [
        'Topic areas and notes',
        'Questions that lead to venue decisions',
        'Answers with clear confidence boundaries',
      ],
      stats: [
        { value: '120+', label: 'topic areas and notes' },
        { value: '10+', label: 'topic areas' },
        { value: '24/7', label: 'assistant access' },
      ],
    },
    knowledgeValue: {
      title: 'Knowledge organized around real decisions',
      body: 'Fishing Assistant organizes material so it is easy to return to a method, species, condition, or problem from a session. Instead of searching loose notes, start with a question and move toward action.',
      cards: [
        {
          title: 'Methods and rigs',
          body: 'Method feeder, classic feeder, float fishing, carp fishing, feeders, hook lengths, and bite reading.',
        },
        {
          title: 'Venue conditions',
          body: 'Pressure, temperature, weed, silty bottoms, angling pressure, and small-fish activity.',
        },
        {
          title: 'Tactical decisions',
          body: 'Groundbait, pellets, hookbaits, feeding rhythm, distance, and one controlled change at a time.',
        },
      ],
    },
    assistant: {
      title: 'A knowledge-guided fishing assistant',
      body: 'The assistant helps find the right knowledge and turn it into a practical plan. When context is missing, it shows what would improve the answer.',
      statusLabel: 'Grounded in the knowledge base',
      questionLabel: 'Example question',
      answerLabel: 'Example answer',
      question:
        'I am fishing Method feeder on a silty water with a lot of weed and small fish close in. How should I approach groundbait and pellets?',
      answer:
        'Start by observing the bottom, weed, and fish response. On this kind of venue, keep your baiting simple, control how the mix breaks down, and test one change at a time: particle size, feeding rhythm, or the line you choose to fish.',
      missingInfoLabel: 'What would improve the answer',
      missingInfo:
        'Depth, temperature, angling pressure, fishing distance, and whether bites appear after feeding.',
      examplesTitle: 'What can you ask?',
      examples: [
        'What does a pressure change mean before a session?',
        'When should I feed again, and when should I leave the rig alone?',
        'How should I choose groundbait for tench or carp?',
        'Does mixing pellets with groundbait make sense around small fish?',
      ],
    },
    topics: {
      title: 'Topics built around methods, species, and water conditions',
      body: 'The material is structured so you can follow a path step by step or return to a subject when a venue asks a specific question.',
      items: [
        {
          title: 'Essentials first',
          body: 'The foundations that shape your thinking before the first cast.',
        },
        {
          title: 'Method feeder and feeder',
          body: 'Feeders, baskets, groundbait work, pellets, hook lengths, and reading bites.',
        },
        {
          title: 'Float fishing and carp fishing',
          body: 'Approaches for coarse fish, grains, mixes, bite selection, and handling bigger fish.',
        },
        {
          title: 'Freshwater fish species',
          body: 'Tench, carp, bream, roach, and other species in specific conditions.',
        },
        {
          title: 'Microhabitats',
          body: 'Weed, bottom zones, temperature, depth, and places where fish behavior changes.',
        },
        {
          title: 'Session tactics',
          body: 'Planning changes, feeding rhythm, rig behavior, and reading fish response during a session.',
        },
      ],
    },
    process: {
      title: 'From question to action plan',
      body: 'The page presents a simple knowledge workflow: describe the situation, let the assistant find context, and use the answer to identify decisions and missing details.',
      items: [
        {
          title: 'Describe the venue',
          body: 'Include the method, conditions, depth, fish activity, and what has already been tested.',
        },
        {
          title: 'Compare options',
          body: 'The assistant can contrast possible directions: particle size, feeding rhythm, distance, or hookbait changes.',
        },
        {
          title: 'Record conclusions',
          body: 'The best answers lead to one controlled test at a time and notes on how fish respond.',
        },
      ],
    },
    author: {
      title: 'Fewer promises, more useful detail',
      body: 'Fishing Assistant does not promise a universal recipe for every venue. It helps organize facts, name assumptions, and choose the next reasonable test.',
      quote:
        'The best answer does not replace observation at the water. It helps you understand what is worth checking next.',
    },
    faq: {
      title: 'Frequently asked questions',
      items: [
        {
          question: 'Does the assistant replace venue judgment?',
          answer:
            'No. It is a tool for working with knowledge and organizing decisions. Conditions, rules, and safety still require your own judgment.',
          cta: {
            label: 'Open the assistant',
            ariaLabel: 'Open the Fishing Assistant app',
          },
        },
        {
          question: 'What questions work best?',
          answer:
            'Questions with context work best: method, bottom type, weather, fish activity, distance, bait, and what has already been tested.',
        },
        {
          question: 'Where do answers come from?',
          answer:
            'Answers are generated from the available knowledge base and the user question. When information is missing, the assistant should say so clearly.',
        },
        {
          question: 'Is the page available in English?',
          answer:
            'Yes. Polish is the default language, and the language switch shows an English version focused on meaning and context.',
        },
      ],
    },
    footer: {
      summary:
        'Fishing Assistant is an app for working with fishing knowledge; contact and legal documents are available below.',
      contact: {
        label: 'Contact',
        ariaLabel: 'Contact',
      },
      privacy: {
        label: 'Privacy',
        ariaLabel: 'Privacy',
      },
      terms: {
        label: 'Terms',
        ariaLabel: 'Terms',
      },
    },
    finalCta: {
      title: 'Move from question to decision at the water',
      body: 'Open the assistant, describe the venue situation, and see which details and action paths matter before the next rig or baiting change.',
      primaryCta: {
        label: 'Open the assistant',
        ariaLabel: 'Open the Fishing Assistant app',
      },
      assistantCta: {
        label: 'See examples',
        ariaLabel: 'Return to assistant examples',
      },
    },
  },
};
