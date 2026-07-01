import { describe, expect, it } from 'vitest';

import { chatAssistantPrompt, retrieveKnowledgeTool } from './chatAssistantPrompt.js';

function normalizeForAssertion(value: string): string {
  return value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gu, 'l');
}

function buildSystemPrompt(question = 'Czy lepiej wybrać produkt A czy produkt B?'): string {
  const messages = chatAssistantPrompt.buildDecisionMessages({
    now: new Date('2026-06-24T12:00:00.000Z'),
    latestMessages: [],
    question,
  });

  return messages.find((message) => message.role === 'system')?.content ?? '';
}

function buildToolInstruction(): string {
  const result = chatAssistantPrompt.buildToolResult({
    query: 'Czy lepiej wybrać produkt A czy produkt B?',
    evidence: [
      {
        id: 'evidence-1',
        sourceId: 'knowledge-service',
        sourceType: 'knowledge_page',
        title: 'Ogólne zasady',
        quote: 'Produkt A pracuje szybko. Produkt B jest subtelniejszy.',
        content: 'Fermentacja poprawia sygnał i strawność składnika.',
        score: 8,
        metadata: {
          headingPath: ['Zasady'],
          path: ['Knowledge Base', 'Zasady'],
          sourceLabel: 'Example Guide',
        },
      },
    ],
  });

  return (JSON.parse(result.content) as { instruction: string }).instruction;
}

function buildStreamingSystemPrompt(
  question = 'Czy lepiej wybrać produkt A czy produkt B?'
): string {
  const messages = chatAssistantPrompt.buildStreamingAnswerMessages({
    now: new Date('2026-06-24T12:00:00.000Z'),
    latestMessages: [],
    question,
  });

  return messages.find((message) => message.role === 'system')?.content ?? '';
}

function testRetrieveKnowledgeToolCall() {
  return {
    id: 'tool-call-1',
    type: 'function' as const,
    function: {
      name: 'retrieveKnowledge',
      arguments: JSON.stringify({ query: 'produkt A produkt B' }),
    },
  };
}

function expectNoProhibitedKnowledgeBaseTerms(label: string, value: string): void {
  expect(value, label).not.toMatch(/knowledge base/iu);
  expect(value, label).not.toMatch(/\bKB\b/u);
  expect(value, label).not.toMatch(/\b(?:baza|bazy|bazie|bazę) wiedzy\b/u);
  expect(value, label).not.toMatch(/\b(?:Baza|Bazy|Bazie|Bazę) wiedzy\b/u);
}

describe('chatAssistantPrompt', () => {
  it('does not expose prohibited knowledge base wording in model-facing prompts', () => {
    const metadataMessages = chatAssistantPrompt.buildMetadataMessages({
      now: new Date('2026-06-24T12:00:00.000Z'),
      latestMessages: [],
      question: 'Jak czytać wodę bez echosondy?',
      answerMarkdown: 'Brakuje danych o czytaniu wody bez echosondy.',
    });
    const emptyToolResult = chatAssistantPrompt.buildToolResult({
      query: 'Jak czytać wodę bez echosondy?',
      evidence: [],
    });
    const evidenceToolResult = chatAssistantPrompt.buildToolResult({
      query: 'Jak czytać wodę bez echosondy?',
      evidence: [
        {
          id: 'evidence-1',
          sourceId: 'knowledge-service',
          sourceType: 'knowledge_page',
          title: 'Czytanie wody',
          quote: 'Szukaj załamań nurtu, cienia i twardych przejść dna.',
          content: 'Bez echosondy obserwuj nurt, kolor wody, spławy i pracę drobnicy.',
          score: 8,
          metadata: {
            headingPath: ['Czytanie wody'],
            path: ['Knowledge Base', 'Technika'],
            sourceLabel: 'Example Guide',
          },
        },
      ],
    });
    const toolDescription = retrieveKnowledgeTool.function.description ?? '';

    expect(toolDescription).not.toBe('');

    const payloads = [
      ['tool description', toolDescription],
      ['decision system prompt', buildSystemPrompt('Jak czytać wodę bez echosondy?')],
      ['streaming system prompt', buildStreamingSystemPrompt('Jak czytać wodę bez echosondy?')],
      [
        'metadata system prompt',
        metadataMessages.find((message) => message.role === 'system')?.content ?? '',
      ],
      ['empty tool result', emptyToolResult.content],
      ['evidence tool result', evidenceToolResult.content],
    ] as const;

    for (const [label, value] of payloads) {
      expectNoProhibitedKnowledgeBaseTerms(label, value);
    }
  });

  it('builds a Polish grounded system prompt without topic-specific answer fixtures', () => {
    const messages = chatAssistantPrompt.buildDecisionMessages({
      now: new Date('2026-06-24T12:00:00.000Z'),
      latestMessages: [],
      question: 'Czy lepiej użyć fermentu czy mocnego aromatu?',
    });

    const system = messages.find((message) => message.role === 'system')?.content ?? '';

    expect(chatAssistantPrompt.version).toBe('1.1.23');
    expect(system).toContain('Prompt version: 1.1.23');
    expect(system).toContain('odpowiedz w tym języku');
    expect(system).toContain('po angielsku na angielskie pytanie');
    expect(system).toContain('użyj polskiego jako domyślnego');
    expect(system).not.toContain('wyraźnie poprosi o inny język');
    expect(system).toContain('głosem autora');
    expect(system).toContain('Nie udawaj, że jesteś autorem treści');
    expect(system).toContain('od mitu do mechanizmu');
    expect(system).toContain('Nie rób tabel');
    expect(system).toContain('praktyczną decyzję');
    expect(system).toContain('Nie wymyślaj faktów');
    expect(system).toContain('Nie zamieniaj biologii');
    expect(system).toContain('okresy ochronne');
    expect(system).toContain('Zachowuj dokładne ilości');
    expect(system).toContain('Nie dodawaj nowych zakresów liczbowych');
    expect(system).toContain('Jeśli źródła są puste');
    expect(system).toContain('wartość po etykiecie jest ukrytym obrazem lub linkiem');
    expect(system).toContain('konkretna wartość nie jest dostępna tekstowo');
    expect(system).toContain('nie ma konkretnej wartości tekstowej przed dalszym opisem');
    expect(system).toContain('nie nazywaj jej obrazem ani linkiem');
    expect(system).toContain('valueFindings');
    expect(system).toContain('hidden_image, hidden_link i missing_text_value');
    expect(system).toContain('nie przenoś stanu z jednej etykiety na inną');
    expect(system).toContain('różne powody braku');
    expect(system).toContain('nie streszczaj ich jedną wspólną przyczyną');
    expect(system).toContain('Nie wpisuj braków dla opcjonalnych parametrów');
    expect(system).toContain('łańcuch decyzji');
    expect(system).toContain('chemiczne tło łowiska');
    expect(system).toContain('reakcję aktywności ryb');
    expect(system).toContain('rozkład skrobi');
    expect(system).toContain('strawność, przyswajanie, metabolizm');
    expect(system).toContain('lokalny profil sygnałów');
    expect(system).toContain('nie zostawiaj tego dopasowania jako domyślu');
    expect(system).toContain('Gdy dowody pokazują zmianę warunków');
    expect(system).toContain('bez wymyślania nowych kategorii');
    expect(system).toContain('ważne słowa z pytania i pakietów dowodowych');
    expect(system).toContain('wspólną rodzinę lub kategorię');
    expect(system).toContain('nie szukaj wyłącznie stron pojedynczych produktów');
    expect(system).toContain('Nie dopisuj do zapytania nowych nazw produktów');
    expect(system).toContain('dopisz kategorię albo cel');
    expect(system).toContain('pakietów, których tytuł, ścieżka, nagłówki albo treść pasują');
    expect(system).toContain('szersze lub sąsiednie pakiety traktuj jako tło');
    expect(system).toContain('temperatury, jednostki i etykiety');
    expect(system).toContain('rozróżnia kilka elementów tej samej konfiguracji');
    expect(system).toContain('nie łącz ich w jedno uproszczenie');
    expect(system).toContain('pełna lista składników z najlepszego pasującego pakietu dowodowego');
    expect(system).toContain('Składnik nie jest ozdobą odpowiedzi');
    expect(system).toContain('skróć komentarz i mechanizm, ale nie skracaj listy składników');
    expect(system).toContain('nie podawaj też przykładowych wartości, punktów startowych');
    expect(system).toContain('określeń typu kilka, kilkanaście, około lub mniej więcej');
    expect(system).toContain('nie rozbijaj go na węższe zalecenia');
    expect(system).toContain('koncentrat, małą dawkę albo ograniczenie intensywności');
    expect(system).toContain('oznacz ją w answerMarkdown jako widoczny wniosek z dowodów');
    expect(system).toContain('Wniosek z dowodów:');
    expect(system).toContain('nie spłaszczaj realnej różnicy');
    expect(system).toContain('zachowaj ich sens i precyzję');
    expect(system).toContain('ważne alternatywy, spójniki i zastrzeżenia');
    expect(system).toContain('biologii, ekologii, siedliska albo zwyczajów nazwanego gatunku');
    expect(system).toContain('konkretnych nazw pokarmu');
    expect(system).toContain('przygotowanie ziaren, pelletu albo przynęty');
    expect(system).toContain('strawność, przyswajanie, miękkość');
    expect(system).toContain('Jeśli użytkownik wyraźnie pyta o aktualne przepisy');
    expect(system).toContain('nie dodawaj takich zastrzeżeń');
    expect(system).toContain('naturalną odmianę gramatyczną');
    expect(system).toContain('"answerMarkdown":"Markdown answer"');
    expect(system).toContain('usedSources');
    expect(system).toContain('missingInformation');
    expect(system).toContain('missingInformation nie jest listą opcjonalnych doprecyzowań');
    expect(system).not.toContain('Keep the English marker words exactly');
    expect(system).not.toContain('Answer in <main context> context');
    expect(system).not.toContain('context only as comparison');
  });

  it('adds tactical comparison guardrails and a generic example to the system prompt', () => {
    const system = buildSystemPrompt();

    expect(system).toContain('compare named things');
    expect(system).toContain('when choose');
    expect(system).toContain('when skip');
    expect(system).toContain('what to combine');
    expect(system).toContain('what not to combine');
    expect(system).toContain('Źródła mówią wprost:');
    expect(system).toContain('Wniosek praktyczny z dowodów:');
    for (const directAdviceVerb of [
      'wybierz',
      'odpuść',
      'najlepsza opcja',
      'najlepsza kombinacja',
      'połącz',
      'nie łącz',
    ]) {
      expect(system).toContain(directAdviceVerb);
    }
    expect(system).toContain('Przykład porównania:');
    expect(system).toContain('produkt A');
    expect(system).toContain('produkt B');
  });

  it('requires local inference markers for synthesized tactical bullets in the system prompt', () => {
    const system = buildSystemPrompt();

    expect(system).toContain('sama etykieta sekcji nie wystarcza');
    expect(system).toContain(
      'Każdy punkt albo zdanie zawierające "wybierz", "odpuść", "połącz", "nie łącz", "najlepsza opcja" albo "najlepsza kombinacja"'
    );
    expect(system).toContain('musi mieć lokalny znacznik przy tym punkcie albo zdaniu');
    expect(system).toContain('gdy jest syntezą z wielu pakietów dowodowych');
    expect(system).toContain('To jest wniosek z dowodów, nie dosłowna instrukcja źródła.');
  });

  it('adds tactical comparison guardrails to the tool-result instruction', () => {
    const instruction = buildToolInstruction();

    expect(instruction).toContain('compare named things');
    expect(instruction).toContain('when choose');
    expect(instruction).toContain('when skip');
    expect(instruction).toContain('what to combine');
    expect(instruction).toContain('what not to combine');
    expect(instruction).toContain('Źródła mówią wprost:');
    expect(instruction).toContain('Wniosek praktyczny z dowodów:');
  });

  it('requires local inference markers for synthesized tactical bullets in the tool-result instruction', () => {
    const instruction = buildToolInstruction();

    expect(instruction).toContain('sama etykieta sekcji nie wystarcza');
    expect(instruction).toContain(
      'Każdy punkt albo zdanie zawierające "wybierz", "odpuść", "połącz", "nie łącz", "najlepsza opcja" albo "najlepsza kombinacja"'
    );
    expect(instruction).toContain('musi mieć lokalny znacznik przy tym punkcie albo zdaniu');
    expect(instruction).toContain('gdy jest syntezą z wielu pakietów dowodowych');
    expect(instruction).toContain('To jest wniosek z dowodów, nie dosłowna instrukcja źródła.');
  });

  it('adds process consequence guardrails and generic examples to system and tool prompts', () => {
    const system = buildSystemPrompt('Co daje fermentacja składnika?');
    const instruction = buildToolInstruction();

    for (const prompt of [system, instruction]) {
      expect(prompt).toContain('fermentation, hydrolysis, soaking, cooking');
      expect(prompt).toContain('bacteria, enzymes, starch breakdown');
      expect(prompt).toContain('chemical/aroma signal');
      expect(prompt).toContain('food/energy availability');
      expect(prompt).toContain(
        'digestibility or assimilation or softness or metabolism or easier intake'
      );
      expect(prompt).toContain('risk/limit');
      expect(prompt).toContain('strawność');
      expect(prompt).toContain('łatwiejsze strawienie');
      expect(prompt).toContain('przyswajanie');
      expect(prompt).toContain('nie zatrzymuj wyjaśnienia na aromacie ani sygnale');
      expect(prompt).toContain('Przykład procesu:');
      expect(prompt).toContain('składnik przetworzony');
    }
  });

  it('adds final synthesis checklist guardrails and a generic example to the system prompt', () => {
    const system = buildSystemPrompt('Zrób finalną checklistę po naszej rozmowie.');

    expect(system).toContain('final checklist');
    expect(system).toContain('chronological plan');
    expect(system).toContain('step-by-step plan');
    expect(system).toContain('summary after multiple turns');
    expect(system).toContain('chronological or thematic sections');
    expect(system).toContain('three to six bullets per section');
    expect(system).toContain('one action/decision per bullet');
    expect(system).toContain('avoid re-explaining full mechanisms already covered');
    expect(system).toContain('no default final "czy chcesz..." question');
    expect(system).toContain('brak w dowodach');
    expect(system).toContain('Przykład finalnej checklisty:');
  });

  it('adds tactical comparison guardrails and a generic example to the streaming answer prompt', () => {
    const system = buildStreamingSystemPrompt();

    expect(system).toContain('compare named things');
    expect(system).toContain('when choose');
    expect(system).toContain('when skip');
    expect(system).toContain('what to combine');
    expect(system).toContain('what not to combine');
    expect(system).toContain('Źródła mówią wprost:');
    expect(system).toContain('Wniosek praktyczny z dowodów:');
    for (const directAdviceVerb of [
      'wybierz',
      'odpuść',
      'najlepsza opcja',
      'najlepsza kombinacja',
      'połącz',
      'nie łącz',
    ]) {
      expect(system).toContain(directAdviceVerb);
    }
    expect(system).toContain('Przykład porównania:');
    expect(system).toContain('produkt A');
    expect(system).toContain('produkt B');
  });

  it('passes retrieved evidence to answer prompts without a tool-call transcript', () => {
    const toolResultContent = JSON.stringify({
      query: 'produkt A produkt B',
      evidence: [{ sourceId: 'S1', title: 'Porównanie', content: 'Produkt A pracuje szybciej.' }],
      instruction: 'Użyj evidence do odpowiedzi.',
    });
    const messages = chatAssistantPrompt.buildStreamingAnswerMessages({
      now: new Date('2026-06-24T12:00:00.000Z'),
      latestMessages: [],
      question: 'Czy lepiej wybrać produkt A czy produkt B?',
      toolCall: testRetrieveKnowledgeToolCall(),
      toolResultContent,
    });

    expect(messages.some((message) => message.role === 'tool')).toBe(false);
    expect(
      messages.some((message) => message.role !== 'tool' && (message.toolCalls?.length ?? 0) > 0)
    ).toBe(false);
    expect(messages.map((message) => message.content).join('\n')).toContain(toolResultContent);
  });

  it('requires local inference markers for synthesized tactical bullets in the streaming answer prompt', () => {
    const system = buildStreamingSystemPrompt();

    expect(system).toContain('sama etykieta sekcji nie wystarcza');
    expect(system).toContain(
      'Każdy punkt albo zdanie zawierające "wybierz", "odpuść", "połącz", "nie łącz", "najlepsza opcja" albo "najlepsza kombinacja"'
    );
    expect(system).toContain('musi mieć lokalny znacznik przy tym punkcie albo zdaniu');
    expect(system).toContain('gdy jest syntezą z wielu pakietów dowodowych');
    expect(system).toContain('To jest wniosek z dowodów, nie dosłowna instrukcja źródła.');
  });

  it('adds process consequence guardrails and a generic example to the streaming answer prompt', () => {
    const system = buildStreamingSystemPrompt('Co daje fermentacja składnika?');

    expect(system).toContain('fermentation, hydrolysis, soaking, cooking');
    expect(system).toContain('bacteria, enzymes, starch breakdown');
    expect(system).toContain('chemical/aroma signal');
    expect(system).toContain('food/energy availability');
    expect(system).toContain(
      'digestibility or assimilation or softness or metabolism or easier intake'
    );
    expect(system).toContain('risk/limit');
    expect(system).toContain('strawność');
    expect(system).toContain('łatwiejsze strawienie');
    expect(system).toContain('przyswajanie');
    expect(system).toContain('nie zatrzymuj wyjaśnienia na aromacie ani sygnale');
    expect(system).toContain('Przykład procesu:');
    expect(system).toContain('składnik przetworzony');
  });

  it('adds final synthesis checklist guardrails and a generic example to the streaming answer prompt', () => {
    const system = buildStreamingSystemPrompt('Zrób finalną checklistę po naszej rozmowie.');

    expect(system).toContain('final checklist');
    expect(system).toContain('chronological plan');
    expect(system).toContain('step-by-step plan');
    expect(system).toContain('summary after multiple turns');
    expect(system).toContain('chronological or thematic sections');
    expect(system).toContain('three to six bullets per section');
    expect(system).toContain('one action/decision per bullet');
    expect(system).toContain('avoid re-explaining full mechanisms already covered');
    expect(system).toContain('no default final "czy chcesz..." question');
    expect(system).toContain('brak w dowodach');
    expect(system).toContain('Przykład finalnej checklisty:');
  });

  it('keeps source aliases out of visible answers and reserves them for metadata', () => {
    const system = buildSystemPrompt();
    const streamingSystem = buildStreamingSystemPrompt();
    const instruction = buildToolInstruction();

    for (const prompt of [system, streamingSystem, instruction]) {
      expect(prompt).toContain('Nie pokazuj aliasów źródeł typu [S1]');
      expect(prompt).toContain('Jeśli jawnie nazywasz źródło w answerMarkdown, użyj jego title');
      expect(prompt).toContain('Aliasów S1, S2 itd. używaj tylko w usedSources');
    }
  });

  it('keeps follow-up delta guidance generic', () => {
    const messages = chatAssistantPrompt.buildDecisionMessages({
      now: new Date('2026-06-24T12:00:00.000Z'),
      latestMessages: [
        {
          role: 'user',
          content: 'Mam warunek B i kontekst testowy.',
        },
        {
          role: 'assistant',
          content: 'W takim scenariuszu uzyj neutralnego wariantu testowego.',
        },
      ],
      question: 'Co by sie zmienilo przy warunku A zamiast warunku B?',
    });

    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const normalizedSystem = normalizeForAssertion(system);

    expect(system).toContain('Na pytania kontynuujące odpowiadaj zwięźle');
    expect(system).toContain('nie dodawaj opcjonalnych pytań');
    expect(system).toContain('najpierw odpowiedz, co się zmienia');
    expect(system).toContain('różnice wspierane przez źródła');
    expect(system).toContain('nie spłaszczaj realnej różnicy');
    expect(normalizedSystem).not.toContain('twardy zwir');
    expect(normalizedSystem).not.toContain('larw, skorupiakow');
    expect(normalizedSystem).not.toContain('nie pisz, ze nic sie nie zmienia');
  });

  it('builds compact tool results with aliases and bundled evidence context', () => {
    const result = chatAssistantPrompt.buildToolResult({
      query: `Jak użyć synthetic fixture?\n${'bardzo długie pytanie '.repeat(100)}`,
      evidence: [
        {
          id: 'evidence-1',
          sourceId: 'knowledge-service',
          sourceType: 'knowledge_page',
          title: `Synthetic Fixture ${'opis '.repeat(80)}`,
          quote: `Krótki cytat ${'cytat '.repeat(160)}`,
          content: `Pełny pakiet kontekstu ${'treść '.repeat(200)}\nSample parameter: 1-2 kg in fixture.\nFixture token:\n![hidden-code.png](https://example.test/code.png) ${'treść '.repeat(280)}`,
          score: 8,
          metadata: {
            headingPath: ['Synthetic fixture', 'Synthetic fixture', 'Koszyk'],
            path: ['Knowledge Base', 'Synthetic fixture', 'Koszyk'],
            sourceLabel: 'Example Guide',
          },
        },
      ],
    });

    expect(result.aliases).toEqual(new Map([['S1', 'knowledge-service\u0000evidence-1']]));
    const parsed = JSON.parse(result.content) as {
      query: string;
      evidence: {
        sourceId: string;
        title: string;
        context: string[];
        quote: string;
        content: string;
        exactValueSnippets: string[];
        extractionNotes: string[];
        valueFindings: {
          label: string;
          state: string;
          marker?: string;
          instruction: string;
        }[];
      }[];
      instruction: string;
    };
    expect(parsed.query.length).toBeLessThanOrEqual(1_000);
    expect(parsed.query.endsWith('...')).toBe(true);
    expect(parsed.evidence[0]).toMatchObject({
      sourceId: 'S1',
      context: ['Synthetic fixture', 'Koszyk', 'Baza Wiedzy', 'Example Guide'],
    });
    expect(parsed.evidence[0]?.title.length).toBeLessThanOrEqual(180);
    expect(parsed.evidence[0]?.quote.length).toBeLessThanOrEqual(700);
    expect(parsed.evidence[0]?.content.length).toBeLessThanOrEqual(4_000);
    expect(parsed.evidence[0]?.content).toContain('Fixture token:\n[image hidden]');
    expect(
      parsed.evidence[0]?.exactValueSnippets.some((snippet) =>
        snippet.includes('1-2 kg in fixture')
      )
    ).toBe(true);
    expect(parsed.evidence[0]?.extractionNotes).toEqual([
      'Po etykiecie "Fixture token" występuje ukryty obraz [image hidden]; konkretna wartość nie jest dostępna jako tekst.',
    ]);
    expect(parsed.evidence[0]?.valueFindings).toEqual([
      {
        label: 'Fixture token',
        state: 'hidden_image',
        marker: '[image hidden]',
        instruction:
          'Po etykiecie "Fixture token" występuje ukryty obraz [image hidden]; konkretna wartość nie jest dostępna jako tekst.',
      },
    ]);
    expect(parsed.instruction).toContain('Używaj wyłącznie tych aliasów sourceId');
    expect(parsed.instruction).toContain('exactValueSnippets');
    expect(parsed.instruction).toContain('przenieś dokładną liczbę i jednostkę');
    expect(parsed.instruction).toContain('mechanizmu do decyzji');
    expect(parsed.instruction).toContain(
      'Przy recepturach traktuj każdy nazwany składnik jako fakt krytyczny'
    );
    expect(parsed.instruction).toContain('przenieś pełną listę do answerMarkdown');
    expect(parsed.instruction).toContain('Nie pomijaj składników dlatego, że pełnią rolę koloru');
    expect(parsed.instruction).toContain('chemiczne tło lub lokalny profil sygnałów');
    expect(parsed.instruction).toContain('aktywnością ryb');
    expect(parsed.instruction).toContain('fermentację, hydrolizę, rozkład skrobi');
    expect(parsed.instruction).toContain('strawność, przyswajanie, metabolizm');
    expect(parsed.instruction).toContain('namaczanie, gotowanie, fermentację');
    expect(parsed.instruction).toContain('łatwiejszym pobraniem');
    expect(parsed.instruction).toContain('nie dopisuj zastrzeżeń o braku takiego zakresu');
    expect(parsed.instruction).toContain('DOM, tlen, dno lub dominację sygnału');
    expect(parsed.instruction).toContain('valueFindings jako autorytatywny stan');
    expect(parsed.instruction).toContain('hidden_image oznacza ukryty obraz');
    expect(parsed.instruction).toContain('missing_text_value brak konkretnej wartości tekstowej');
    expect(parsed.instruction).toContain('nie przenoś tych stanów między etykietami');
    expect(parsed.instruction).toContain('extractionNotes o ukrytym obrazie albo linku');
    expect(parsed.instruction).toContain('konkretna wartość nie jest dostępna jako tekst');
    expect(parsed.instruction).toContain('nie zgaduj jej');
    expect(parsed.instruction).toContain('nie ma konkretnej wartości tekstowej');
    expect(parsed.instruction).toContain('nie nazywaj jej obrazem ani linkiem bez placeholdera');
    expect(parsed.instruction).toContain('różne powody braku');
    expect(parsed.instruction).toContain('opisz każdą etykietę osobno');
    expect(parsed.instruction).toContain('ogólnych pakietów zasad o dawkowaniu');
    expect(parsed.instruction).toContain(
      'oznacz widocznie w answerMarkdown jako wniosek z dowodów'
    );
    expect(parsed.instruction).toContain('nazwanych profili gatunków');
  });

  it('annotates value labels that do not expose a concrete text value', () => {
    const result = chatAssistantPrompt.buildToolResult({
      query: 'Jaki jest kod partnerski?',
      evidence: [
        {
          id: 'evidence-1',
          sourceId: 'knowledge-service',
          sourceType: 'knowledge_page',
          title: 'Fixture label',
          quote: 'Fixture token:',
          content:
            'Dla testowego scenariusza przygotowano wpis.\nFixture token:\n\nincludes 10% fixture marker in the description.',
          score: 8,
          metadata: {
            headingPath: ['Fixtures'],
            path: ['Knowledge Base', 'Fixtures'],
            sourceLabel: 'Example Guide',
          },
        },
      ],
    });

    const parsed = JSON.parse(result.content) as {
      evidence: {
        extractionNotes: string[];
        valueFindings: {
          label: string;
          state: string;
          instruction: string;
        }[];
      }[];
    };

    expect(parsed.evidence[0]?.extractionNotes).toEqual([
      'Po etykiecie "Fixture token" nie ma konkretnej wartości tekstowej przed dalszym opisem; powiedz, że wartość nie jest podana jako tekst i nie nazywaj jej obrazem ani linkiem bez widocznego placeholdera.',
    ]);
    expect(parsed.evidence[0]?.extractionNotes.join('\n')).not.toContain('ukryty obraz');
    expect(parsed.evidence[0]?.extractionNotes.join('\n')).not.toContain('ukryty link');
    expect(parsed.evidence[0]?.valueFindings).toEqual([
      {
        label: 'Fixture token',
        state: 'missing_text_value',
        instruction:
          'Po etykiecie "Fixture token" nie ma konkretnej wartości tekstowej przed dalszym opisem; powiedz, że wartość nie jest podana jako tekst i nie nazywaj jej obrazem ani linkiem bez widocznego placeholdera.',
      },
    ]);
  });

  it('builds a missing-information instruction when retrieval returns no evidence', () => {
    const result = chatAssistantPrompt.buildToolResult({
      query: 'Czy baza coś wie?',
      evidence: [],
    });

    expect(result.aliases.size).toBe(0);
    expect(JSON.parse(result.content)).toMatchObject({
      query: 'Czy baza coś wie?',
      evidence: [],
      instruction: 'Nie pobrano fragmentów z Bazy Wiedzy. Powiedz, jakiej informacji brakuje.',
    });
  });
});
