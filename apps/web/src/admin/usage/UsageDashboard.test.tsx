import { createElement, type ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUserSummary } from '@fa/http-contracts';

import type {
  LlmUsageEvent,
  UsageAggregationResponse,
  UsageDimensionsResponse,
  UsageEventsResponse,
  UsageGroupBy,
} from '../../services/usageApi.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';

const usageDashboardModulePath = './UsageDashboard.js';

const mocks = vi.hoisted(() => ({
  getUsageDimensions: vi.fn(),
  listUsers: vi.fn(),
  queryUsageAggregates: vi.fn(),
  queryUsageEvents: vi.fn(),
}));

vi.mock('../../services/usageApi.js', async () => {
  const actual = await vi.importActual('../../services/usageApi.js');
  return {
    ...actual,
    getUsageDimensions: mocks.getUsageDimensions,
    queryUsageAggregates: mocks.queryUsageAggregates,
    queryUsageEvents: mocks.queryUsageEvents,
  };
});

vi.mock('../../services/userApi.js', async () => {
  const actual = await vi.importActual('../../services/userApi.js');
  return {
    ...actual,
    listUsers: mocks.listUsers,
  };
});

const dimensions: UsageDimensionsResponse = {
  models: ['openai/gpt-4.1-mini', 'openai/text-embedding-3-small'],
  providers: ['openrouter'],
  components: ['query-embedding', 'rag-chat'],
  promptTypes: ['fishing-answer', 'rag-query-embedding'],
  services: ['chat-service', 'knowledge-service'],
  operations: ['chat.stream', 'embedding'],
};

const aggregateResponse: UsageAggregationResponse = {
  rows: [
    {
      group: { 'time.bucket': '2026-06-17' },
      metrics: {
        calls: 3,
        estimatedCostUsd: 0.012345,
        inputTokens: 1200,
        outputTokens: 450,
        totalTokens: 1650,
        estimatedCallCount: 1,
        errorCallCount: 0,
      },
    },
  ],
  totals: {
    calls: 3,
    estimatedCostUsd: 0.012345,
    inputTokens: 1200,
    outputTokens: 450,
    totalTokens: 1650,
    estimatedCallCount: 1,
    errorCallCount: 0,
  },
  meta: {
    timeRange: {
      from: '2026-05-18T00:00:00.000Z',
      to: '2026-06-17T23:59:59.999Z',
    },
    timeBucket: 'day',
    groupBy: ['time.bucket'],
    limit: 100,
  },
};

const groupedAggregateResponse: UsageAggregationResponse = {
  rows: [
    {
      group: {
        'request.provider': 'openrouter',
        'request.model': 'openai/gpt-4.1-mini',
        'owner.id': 'fa-user-1',
        'source.component': 'rag-chat',
        'source.promptType': 'fishing-answer',
      },
      metrics: {
        calls: 4,
        estimatedCostUsd: 0.022222,
        inputTokens: 2000,
        outputTokens: 800,
        totalTokens: 2800,
        estimatedCallCount: 0,
        errorCallCount: 1,
      },
    },
  ],
  totals: {
    calls: 4,
    estimatedCostUsd: 0.022222,
    inputTokens: 2000,
    outputTokens: 800,
    totalTokens: 2800,
    estimatedCallCount: 0,
    errorCallCount: 1,
  },
  meta: {
    timeRange: {
      from: '2026-05-18T00:00:00.000Z',
      to: '2026-06-17T23:59:59.999Z',
    },
    timeBucket: 'day',
    groupBy: [
      'request.provider',
      'request.model',
      'owner.id',
      'source.component',
      'source.promptType',
    ],
    limit: 100,
  },
};

const baseUsageEvent: LlmUsageEvent = {
  id: 'usage-event-1',
  owner: { type: 'user', id: 'fa-user-1' },
  source: {
    service: 'chat-service',
    component: 'rag-chat',
    operation: 'chat.stream',
    promptType: 'fishing-answer',
  },
  request: {
    provider: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    promptVersion: '1.0.0',
  },
  usage: {
    inputTokens: 1200,
    outputTokens: 450,
    totalTokens: 1650,
    estimated: false,
  },
  cost: { estimatedCostUsd: 0.012345 },
  correlation: { requestId: 'req-1' },
  createdAt: '2026-06-17T12:00:00.000Z',
};

const eventsResponse: UsageEventsResponse = {
  events: [baseUsageEvent],
};

const usageAdminUser: CurrentUserSummary = {
  id: 'fa-user-1',
  email: 'usage-table-user@example.test',
  firstName: 'Ada',
  lastName: 'Angler',
  mobileNumber: null,
  role: 'user',
  status: 'approved',
  level: 9,
  effectiveLevel: 9,
};

function usageEvent(overrides: Partial<LlmUsageEvent> = {}): LlmUsageEvent {
  return {
    ...baseUsageEvent,
    ...overrides,
    owner: {
      ...baseUsageEvent.owner,
      ...overrides.owner,
    },
    source: {
      ...baseUsageEvent.source,
      ...overrides.source,
    },
    request: {
      ...baseUsageEvent.request,
      ...overrides.request,
    },
    usage: {
      ...baseUsageEvent.usage,
      ...overrides.usage,
    },
    cost: {
      ...baseUsageEvent.cost,
      ...overrides.cost,
    },
    correlation: {
      ...baseUsageEvent.correlation,
      ...overrides.correlation,
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function renderUsageDashboard(): Promise<void> {
  const { UsageDashboard } = (await import(usageDashboardModulePath)) as {
    UsageDashboard: ComponentType;
  };
  render(createElement(I18nProvider, null, createElement(UsageDashboard)));
}

describe('UsageDashboard', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'en');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-17T14:30:00.000Z'));
    mocks.getUsageDimensions.mockReset();
    mocks.listUsers.mockReset();
    mocks.queryUsageAggregates.mockReset();
    mocks.queryUsageEvents.mockReset();
    mocks.getUsageDimensions.mockResolvedValue(dimensions);
    mocks.listUsers.mockResolvedValue({
      users: [usageAdminUser],
      nextCursor: null,
    });
    mocks.queryUsageAggregates.mockResolvedValue(aggregateResponse);
    mocks.queryUsageEvents.mockResolvedValue(eventsResponse);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('loads aggregate usage by default for the last 30 complete days plus today', async () => {
    await renderUsageDashboard();

    expect(await screen.findByRole('heading', { level: 2, name: 'AI costs' })).not.toBeNull();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    expect(mocks.getUsageDimensions).toHaveBeenCalledWith({
      timeRange: {
        from: '2026-05-18T00:00:00.000Z',
        to: '2026-06-17T23:59:59.999Z',
      },
      timeBucket: 'day',
    });
    expect(mocks.queryUsageAggregates).toHaveBeenCalledWith({
      timeRange: {
        from: '2026-05-18T00:00:00.000Z',
        to: '2026-06-17T23:59:59.999Z',
      },
      timeBucket: 'day',
      groupBy: ['time.bucket'],
      limit: 100,
    });
    expect(mocks.queryUsageEvents).not.toHaveBeenCalled();

    for (const label of ['Cost', 'AI requests', 'Tokens used', 'Errors']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByText('May 18, 2026 - Jun 17, 2026')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('No extra filters')).toBeInTheDocument();
    expect(screen.queryByText(/Timezone:/)).toBeNull();
    expect(screen.queryByText(/Europe\/Warsaw/)).toBeNull();
    expect(screen.queryByText(/filters: 0/)).toBeNull();
    expect(screen.getAllByText('$0.01').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1.7K').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Highlights')).toBeInTheDocument();
    expect(screen.getByText(/Highest usage: Jun 17, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Highest cost: Jun 17, 2026/)).toBeInTheDocument();
    expect(screen.getByText('No errors recorded')).toBeInTheDocument();
    expect(screen.queryByText('usage-user@example.test')).toBeNull();
    expect(screen.queryByText('+15550101099')).toBeNull();
    expect(screen.queryByText('auth0|test-usage-user')).toBeNull();
    expect(screen.queryByText('Use the retrieved evidence')).toBeNull();

    const filtersButton = screen.getByRole('button', { name: 'Filters' });
    const rawEventsButton = screen.getByRole('button', { name: 'Individual requests' });
    expect(filtersButton.querySelector('svg')).not.toBeNull();
    expect(rawEventsButton.querySelector('svg')).not.toBeNull();
  });

  it('presents daily usage chronologically and highlights the most important days', async () => {
    mocks.queryUsageAggregates.mockResolvedValueOnce({
      ...aggregateResponse,
      rows: [
        {
          group: { 'time.bucket': '2026-06-15' },
          metrics: {
            calls: 10,
            estimatedCostUsd: 0.1,
            inputTokens: 100,
            outputTokens: 100,
            totalTokens: 200,
            estimatedCallCount: 0,
            errorCallCount: 0,
          },
        },
        {
          group: { 'time.bucket': '2026-06-17' },
          metrics: {
            calls: 3,
            estimatedCostUsd: 0.03,
            inputTokens: 1000,
            outputTokens: 3000,
            totalTokens: 4000,
            estimatedCallCount: 0,
            errorCallCount: 0,
          },
        },
        {
          group: { 'time.bucket': '2026-06-16' },
          metrics: {
            calls: 4,
            estimatedCostUsd: 0.5,
            inputTokens: 200,
            outputTokens: 400,
            totalTokens: 600,
            estimatedCallCount: 0,
            errorCallCount: 2,
          },
        },
      ],
      totals: {
        calls: 17,
        estimatedCostUsd: 0.63,
        inputTokens: 1300,
        outputTokens: 3500,
        totalTokens: 4800,
        estimatedCallCount: 0,
        errorCallCount: 2,
      },
    });

    await renderUsageDashboard();

    const table = await screen.findByRole('table', { name: 'Daily usage' });
    expect(screen.getByText('Sorting: newest days first')).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: /Date.*sorted newest first/ })
    ).toBeInTheDocument();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Jun 17, 2026');
    expect(rows[1]).toHaveTextContent('Jun 16, 2026');
    expect(rows[2]).toHaveTextContent('Jun 15, 2026');
    expect(screen.getByText(/Highest usage: Jun 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Highest cost: Jun 16, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Errors recorded: 2')).toBeInTheDocument();
  });

  it('shows loading and empty states in plain language', async () => {
    const aggregateDeferred = createDeferred<UsageAggregationResponse>();
    mocks.queryUsageAggregates.mockReturnValueOnce(aggregateDeferred.promise);

    await renderUsageDashboard();

    expect(screen.getByText('Loading AI usage...')).toBeInTheDocument();

    await act(async () => {
      aggregateDeferred.resolve({
        ...aggregateResponse,
        rows: [],
        totals: {
          calls: 0,
          estimatedCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCallCount: 0,
          errorCallCount: 0,
        },
      });
      await aggregateDeferred.promise;
    });

    expect(await screen.findByText('No AI usage in this period.')).toBeInTheDocument();
  });

  it('uses Polish admin labels while preserving raw usage filter values', async () => {
    window.localStorage.setItem('fa.locale', 'pl');
    mocks.queryUsageAggregates.mockResolvedValueOnce(aggregateResponse);
    mocks.queryUsageAggregates.mockResolvedValueOnce({
      ...groupedAggregateResponse,
      rows: [
        {
          ...groupedAggregateResponse.rows[0],
          group: { 'source.component': 'rag-chat' },
        },
      ],
      meta: {
        ...groupedAggregateResponse.meta,
        groupBy: ['source.component'],
      },
    });

    await renderUsageDashboard();

    expect(await screen.findByRole('heading', { level: 2, name: 'Koszty AI' })).not.toBeNull();
    for (const label of ['Koszt', 'Zapytania AI', 'Zużyte tokeny', 'Błędy']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.queryByText('Estimated cost')).toBeNull();
    expect(screen.queryByText('Total tokens')).toBeNull();
    expect(screen.queryByText('Użycie LLM')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filtry' }));

    const filtersForm = screen.getByRole('form', { name: 'Filtry' });
    expect(within(filtersForm).getByRole('heading', { name: 'Filtry' })).not.toBeNull();
    expect(within(filtersForm).getByRole('group', { name: 'Podstawowe' })).not.toBeNull();
    expect(within(filtersForm).getByRole('group', { name: 'Zaawansowane filtry' })).not.toBeNull();
    expect(within(filtersForm).getByLabelText('Od')).toBeInTheDocument();
    expect(within(filtersForm).getByLabelText('Do')).toBeInTheDocument();
    expect(within(filtersForm).getByRole('combobox', { name: 'Widok' })).toBeInTheDocument();
    expect(within(filtersForm).getByLabelText('Filtr dostawcy')).toBeInTheDocument();
    expect(within(filtersForm).getByLabelText('Filtr modelu')).toBeInTheDocument();
    expect(within(filtersForm).getByLabelText('Filtr użytkownika')).toBeInTheDocument();
    expect(within(filtersForm).getByLabelText('Filtr typu promptu')).toBeInTheDocument();
    expect(within(filtersForm).getByLabelText('Filtr operacji')).toBeInTheDocument();

    fireEvent.click(within(filtersForm).getByLabelText('Grupuj według daty'));
    fireEvent.click(within(filtersForm).getByLabelText('Grupuj według komponentu'));
    fireEvent.click(within(filtersForm).getByRole('button', { name: 'Zastosuj filtry' }));

    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(2);
    });
    expect(mocks.queryUsageAggregates.mock.calls[1]?.[0]).toMatchObject({
      groupBy: ['source.component'],
    });

    const table = screen.getByRole('table', { name: 'Podsumowanie użycia' });
    expect(within(table).getByRole('columnheader', { name: 'Komponent' })).toBeInTheDocument();
    expect(within(table).getByText('Chat z wiedzą')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pojedyncze zapytania' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Pojedyncze zapytania' })
    ).not.toBeNull();
    expect(screen.getByText('Ostatnie 50 zapytań z wybranego okresu.')).toBeInTheDocument();
    const rawEventsTable = await screen.findByRole('table', { name: 'Pojedyncze zapytania AI' });
    expect(
      within(rawEventsTable).getByRole('columnheader', { name: 'Utworzono' })
    ).toBeInTheDocument();
    expect(
      within(rawEventsTable).getByRole('columnheader', { name: 'Komponent' })
    ).toBeInTheDocument();
    expect(
      within(rawEventsTable).getByRole('columnheader', { name: 'Operacja' })
    ).toBeInTheDocument();
    expect(
      within(rawEventsTable).getByRole('columnheader', { name: 'Status' })
    ).toBeInTheDocument();
    expect(within(rawEventsTable).getByText('Chat z wiedzą')).toBeInTheDocument();
    expect(within(rawEventsTable).getByText('Odpowiedź asystenta')).toBeInTheDocument();
    expect(within(rawEventsTable).getByText('OK')).toBeInTheDocument();
    expect(within(rawEventsTable).queryByText('rag-chat')).toBeNull();
    expect(within(rawEventsTable).queryByText('chat.stream')).toBeNull();
  });

  it('formats aggregates and raw events with active English locale values and accessible full totals', async () => {
    mocks.queryUsageAggregates.mockResolvedValueOnce({
      ...aggregateResponse,
      rows: [
        {
          group: { 'time.bucket': '2026-06-17' },
          metrics: {
            calls: 3,
            estimatedCostUsd: 0.000004,
            inputTokens: 1200,
            outputTokens: 2074888,
            totalTokens: 2076088,
            estimatedCallCount: 1,
            errorCallCount: 0,
          },
        },
      ],
      totals: {
        calls: 3,
        estimatedCostUsd: 0.000004,
        inputTokens: 1200,
        outputTokens: 2074888,
        totalTokens: 2076088,
        estimatedCallCount: 1,
        errorCallCount: 0,
      },
    });
    mocks.queryUsageEvents.mockResolvedValueOnce({
      events: [
        usageEvent({
          createdAt: '2026-06-19T15:07:00.000Z',
          usage: {
            inputTokens: 1200,
            outputTokens: 2074888,
            totalTokens: 2076088,
            estimated: false,
          },
          cost: { estimatedCostUsd: 0.000004 },
        }),
      ],
    });

    await renderUsageDashboard();

    await screen.findByText('AI costs');
    expect(screen.getAllByText('<$0.01').length).toBeGreaterThanOrEqual(2);
    const aggregateTable = screen.getByRole('table', { name: 'Daily usage' });
    const compactTokens = within(aggregateTable).getByText('2.1M');
    expect(compactTokens).toHaveAttribute('title', '2,076,088');
    expect(compactTokens).toHaveAttribute('aria-label', '2,076,088 tokens');

    const bucketCell = within(aggregateTable).getByText(/Jun 17, 2026/);
    expect(bucketCell).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Individual requests' }));
    const rawEventsRegion = await screen.findByRole('heading', {
      level: 2,
      name: 'Individual requests',
    });
    expect(rawEventsRegion).toBeInTheDocument();
    expect(screen.getAllByText(/Jun 19, 2026/).length).toBeGreaterThanOrEqual(1);
  });

  it('applies time, provider, model, user, component, prompt type, service, and operation filters', async () => {
    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.change(screen.getByLabelText('View'), {
      target: { value: 'hour' },
    });
    fireEvent.change(screen.getByLabelText('Provider filter'), {
      target: { value: 'openrouter' },
    });
    fireEvent.change(screen.getByLabelText('Model filter'), {
      target: { value: 'openai/gpt-4.1-mini' },
    });
    fireEvent.change(screen.getByLabelText('User filter'), {
      target: { value: 'fa-user-1' },
    });
    fireEvent.change(screen.getByLabelText('Prompt type filter'), {
      target: { value: 'fishing-answer' },
    });
    fireEvent.change(screen.getByLabelText('Component filter'), {
      target: { value: 'rag-chat' },
    });
    fireEvent.change(screen.getByLabelText('Service filter'), {
      target: { value: 'chat-service' },
    });
    fireEvent.change(screen.getByLabelText('Operation filter'), {
      target: { value: 'chat.stream' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(2);
    });

    expect(mocks.queryUsageAggregates.mock.calls[1]?.[0]).toMatchObject({
      timeRange: {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-17T23:59:59.999Z',
      },
      timeBucket: 'hour',
      filters: {
        providers: ['openrouter'],
        models: ['openai/gpt-4.1-mini'],
        userIds: ['fa-user-1'],
        components: ['rag-chat'],
        promptTypes: ['fishing-answer'],
        services: ['chat-service'],
        operations: ['chat.stream'],
      },
      groupBy: ['time.bucket'],
    });
    await waitFor(() => {
      expect(mocks.getUsageDimensions).toHaveBeenLastCalledWith({
        timeRange: {
          from: '2026-06-01T00:00:00.000Z',
          to: '2026-06-17T23:59:59.999Z',
        },
        timeBucket: 'hour',
      });
    });
  });

  it('labels the filter panel, groups advanced filters, and resets applied filters', async () => {
    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    const filtersForm = screen.getByRole('form', { name: 'Filters' });
    expect(within(filtersForm).getByRole('heading', { name: 'Filters' })).not.toBeNull();
    const advancedFilters = within(filtersForm).getByRole('group', { name: 'Advanced filters' });
    expect(within(advancedFilters).getByLabelText('User filter')).not.toBeNull();
    expect(within(advancedFilters).getByLabelText('Prompt type filter')).not.toBeNull();
    expect(within(advancedFilters).getByLabelText('Operation filter')).not.toBeNull();

    fireEvent.change(within(filtersForm).getByLabelText('Provider filter'), {
      target: { value: 'openrouter' },
    });
    fireEvent.click(within(filtersForm).getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(2);
    });
    expect(mocks.queryUsageAggregates.mock.calls[1]?.[0]).toMatchObject({
      filters: { providers: ['openrouter'] },
    });

    fireEvent.click(within(filtersForm).getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(3);
    });
    expect(mocks.queryUsageAggregates.mock.calls[2]?.[0]).toMatchObject({
      groupBy: ['time.bucket'],
    });
    expect(mocks.queryUsageAggregates.mock.calls[2]?.[0]).not.toHaveProperty('filters');
    expect(within(filtersForm).getByLabelText('Provider filter')).toHaveValue('');
  });

  it('lets admins group aggregates by provider, model, user, component, and prompt type', async () => {
    mocks.queryUsageAggregates.mockResolvedValueOnce(aggregateResponse);
    mocks.queryUsageAggregates.mockResolvedValueOnce(groupedAggregateResponse);

    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByLabelText('Group by date'));
    const groupByLabels: Record<UsageGroupBy, string> = {
      'time.bucket': 'date',
      'request.provider': 'provider',
      'request.model': 'model',
      'owner.id': 'user',
      'source.service': 'service',
      'source.component': 'component',
      'source.operation': 'operation',
      'source.promptType': 'prompt type',
    };
    const groupByValues: UsageGroupBy[] = [
      'request.provider',
      'request.model',
      'owner.id',
      'source.component',
      'source.promptType',
    ];
    for (const groupBy of groupByValues) {
      fireEvent.click(screen.getByLabelText(`Group by ${groupByLabels[groupBy]}`));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(2);
    });

    expect(mocks.queryUsageAggregates.mock.calls[1]?.[0]).toMatchObject({
      groupBy: [
        'request.provider',
        'request.model',
        'owner.id',
        'source.component',
        'source.promptType',
      ],
    });

    const table = screen.getByRole('table', { name: 'Usage summary' });
    expect(within(table).queryByRole('columnheader', { name: 'Date' })).toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Provider' })).not.toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Model' })).not.toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'User' })).not.toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Component' })).not.toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Prompt type' })).not.toBeNull();
    expect(within(table).getByText('openrouter')).not.toBeNull();
    expect(within(table).getByText('openai/gpt-4.1-mini')).not.toBeNull();
    expect(within(table).getByText('usage-table-user@example.test')).not.toBeNull();
    expect(
      within(table).getByText((_content, node) => node?.textContent === 'User id: fa-user-1')
    ).not.toBeNull();
    expect(within(table).getByText('Knowledge chat')).not.toBeNull();
    expect(within(table).getByText('Fishing answer')).not.toBeNull();
  });

  it('keeps raw-event technical tokens scannable on desktop', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.usage-raw-table\s*{[^}]*display:\s*block[^}]*overflow-x:\s*auto/s);
    expect(styles).toMatch(
      /\.usage-raw-table th,\s*\.usage-raw-table td\s*{[^}]*white-space:\s*nowrap[^}]*overflow-wrap:\s*normal/s
    );
  });

  it('renders coarse aggregate errors without sensitive API text', async () => {
    const sensitiveText =
      'usage-user@example.test +15550101099 auth0|test-usage-user Bearer abc X-Internal-Auth secret Use the retrieved evidence requestId=req-secret {"providerRequest":"payload"}';
    mocks.queryUsageAggregates.mockRejectedValueOnce(new Error(sensitiveText));

    await renderUsageDashboard();

    expect(
      await screen.findByText('Unable to load usage reporting right now.')
    ).toBeInTheDocument();
    for (const fragment of [
      'usage-user@example.test',
      '+15550101099',
      'auth0|test-usage-user',
      'Bearer abc',
      'X-Internal-Auth',
      'Use the retrieved evidence',
      'req-secret',
      'providerRequest',
    ]) {
      expect(screen.queryByText(new RegExp(fragment.replace(/[|+]/g, '\\$&')))).toBeNull();
    }
  });

  it('loads raw events only after the admin opens the event drill-down', async () => {
    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    expect(mocks.queryUsageEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Individual requests' }));

    await waitFor(() => {
      expect(mocks.queryUsageEvents).toHaveBeenCalledTimes(1);
    });
    expect(mocks.queryUsageEvents.mock.calls[0]?.[0]).toMatchObject({
      timeRange: {
        from: '2026-05-18T00:00:00.000Z',
        to: '2026-06-17T23:59:59.999Z',
      },
      limit: 50,
    });

    const table = await screen.findByRole('table', { name: 'Individual AI requests' });
    expect(within(table).getByText('usage-table-user@example.test')).not.toBeNull();
    expect(
      within(table).getByText((_content, node) => node?.textContent === 'User id: fa-user-1')
    ).not.toBeNull();
    expect(within(table).getByText('Fishing answer')).not.toBeNull();
    expect(screen.queryByText('req-1')).toBeNull();
  });

  it('surfaces failed no-charge chat events by status and error code without raw error text', async () => {
    mocks.queryUsageAggregates.mockResolvedValueOnce({
      ...aggregateResponse,
      rows: [
        {
          group: { 'time.bucket': '2026-06-17' },
          metrics: {
            calls: 1,
            estimatedCostUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCallCount: 1,
            errorCallCount: 1,
          },
        },
      ],
      totals: {
        calls: 1,
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCallCount: 1,
        errorCallCount: 1,
      },
    });
    mocks.queryUsageEvents.mockResolvedValueOnce({
      events: [
        usageEvent({
          id: 'failed-chat-event',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: true },
          cost: { estimatedCostUsd: 0 },
          correlation: {
            conversationId: 'conversation-1',
            messageId: 'failed-assistant-message-1',
          },
          error: {
            code: 'ANSWER_GENERATION_FAILED',
            message:
              'Provider error details redacted. Bearer secret-token prompt text evidence text',
          },
        }),
      ],
    });

    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    const errorsMetric = screen.getByText('Errors').closest('.usage-metric');
    expect(errorsMetric).not.toBeNull();
    expect(within(errorsMetric as HTMLElement).getByText('1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Individual requests' }));

    const table = await screen.findByRole('table', { name: 'Individual AI requests' });
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getAllByText('Error: ANSWER_GENERATION_FAILED').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Provider error details redacted/)).toBeNull();
    expect(screen.queryByText(/Bearer secret-token/)).toBeNull();
    expect(screen.queryByText(/prompt text evidence text/)).toBeNull();
  });

  it('offers mobile actions for filters and raw events', async () => {
    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    const actionsButton = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(actionsButton);
    const filtersMenuItem = screen.getByRole('menuitem', { name: 'Filters' });
    expect(filtersMenuItem.querySelector('svg.lucide-filter')).not.toBeNull();
    fireEvent.click(filtersMenuItem);
    expect(screen.getByLabelText('From')).toBeInTheDocument();

    fireEvent.click(actionsButton);
    const rawEventsMenuItem = screen.getByRole('menuitem', { name: 'Individual requests' });
    expect(rawEventsMenuItem.querySelector('svg.lucide-rows3')).not.toBeNull();
    fireEvent.click(rawEventsMenuItem);

    await waitFor(() => {
      expect(mocks.queryUsageEvents).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByRole('table', { name: 'Individual AI requests' })
    ).toBeInTheDocument();
  });

  it('ignores stale raw-event responses after filter changes', async () => {
    const firstEvents = createDeferred<UsageEventsResponse>();
    const secondEvents = createDeferred<UsageEventsResponse>();
    mocks.queryUsageEvents.mockReset();
    mocks.queryUsageEvents.mockReturnValueOnce(firstEvents.promise);
    mocks.queryUsageEvents.mockReturnValueOnce(secondEvents.promise);

    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Individual requests' }));
    await waitFor(() => {
      expect(mocks.queryUsageEvents).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(screen.getByLabelText('User filter'), {
      target: { value: 'fa-user-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(mocks.queryUsageEvents).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondEvents.resolve({
        events: [usageEvent({ id: 'usage-event-2', owner: { type: 'user', id: 'fa-user-2' } })],
      });
      await secondEvents.promise;
    });
    expect((await screen.findAllByText('fa-user-2')).length).toBeGreaterThan(0);

    await act(async () => {
      firstEvents.resolve({
        events: [usageEvent({ id: 'usage-event-1', owner: { type: 'user', id: 'fa-user-1' } })],
      });
      await firstEvents.promise;
    });

    expect(screen.getAllByText('fa-user-2').length).toBeGreaterThan(0);
    expect(screen.queryByText('fa-user-1')).toBeNull();
  });

  it('renders coarse raw-event errors without sensitive API text', async () => {
    const sensitiveText =
      'usage-user@example.test +15550101099 auth0|test-usage-user Bearer abc X-Internal-Auth secret prompt text evidence text requestId=req-secret {"providerResponse":"payload"}';
    mocks.queryUsageEvents.mockRejectedValueOnce(new Error(sensitiveText));

    await renderUsageDashboard();
    await waitFor(() => {
      expect(mocks.queryUsageAggregates).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Individual requests' }));

    expect(
      await screen.findByText('Unable to load individual requests right now.')
    ).toBeInTheDocument();
    for (const fragment of [
      'usage-user@example.test',
      '+15550101099',
      'auth0|test-usage-user',
      'Bearer abc',
      'X-Internal-Auth',
      'prompt text',
      'evidence text',
      'req-secret',
      'providerResponse',
    ]) {
      expect(screen.queryByText(new RegExp(fragment.replace(/[|+]/g, '\\$&')))).toBeNull();
    }
  });
});
