import type { CSSProperties, ReactElement, SyntheticEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Filter, Rows3 } from 'lucide-react';
import type { CurrentUserSummary } from '@fa/http-contracts';
import { ActionMenu, type ActionMenuItem } from '../../ui/ActionMenu.js';

import {
  getUsageDimensions,
  queryUsageAggregates,
  queryUsageEvents,
  recentUsageRange,
  type LlmUsageEvent,
  type UsageAggregationFilters,
  type UsageAggregationQuery,
  type UsageAggregationResponse,
  type UsageDimensionsResponse,
  type UsageEventsFilters,
  type UsageEventsResponse,
  type UsageGroupBy,
  type UsageOperation,
  type UsageService,
  type UsageTimeBucket,
} from '../../services/usageApi.js';
import { listUsers } from '../../services/userApi.js';
import { useI18n } from '../../i18n/useI18n.js';
import {
  usageComponentLabel,
  usageGroupByAriaLabel,
  usageGroupByLabel,
  usageOperationLabel,
  usagePromptTypeLabel,
  usageServiceLabel,
  userRoleLabel,
  userStatusLabel,
} from '../../i18n/displayLabels.js';
import {
  formatCostUsd,
  formatDate,
  formatDateTime,
  formatInteger,
  formatTokens,
} from '../../ui/formatters.js';

interface UsageFilterDraft {
  fromDate: string;
  toDate: string;
  timeBucket: UsageTimeBucket;
  model: string;
  provider: string;
  userId: string;
  component: string;
  promptType: string;
  service: string;
  operation: string;
}

const zeroTotals = {
  calls: 0,
  estimatedCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCallCount: 0,
  errorCallCount: 0,
};

const usageUserDirectoryPageLimit = 200;
const usageUserDirectoryMaxPages = 25;

const groupByOptions = [
  'time.bucket',
  'request.provider',
  'request.model',
  'owner.id',
  'source.service',
  'source.component',
  'source.operation',
  'source.promptType',
] satisfies UsageGroupBy[];

interface DashboardInitialState {
  aggregateQuery: UsageAggregationQuery;
  draftFilters: UsageFilterDraft;
  draftGroupBy: UsageGroupBy[];
}

interface UsageUserDirectory {
  byId: ReadonlyMap<string, CurrentUserSummary>;
  bySearchKey: ReadonlyMap<string, string[]>;
}

type UsageAggregateRow = UsageAggregationResponse['rows'][number];

function dateInputValue(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

function isoDayStart(dateText: string): string {
  return `${dateText}T00:00:00.000Z`;
}

function isoDayEnd(dateText: string): string {
  return `${dateText}T23:59:59.999Z`;
}

function defaultFilterDraft(query: UsageAggregationQuery): UsageFilterDraft {
  return {
    fromDate: dateInputValue(query.timeRange.from),
    toDate: dateInputValue(query.timeRange.to),
    timeBucket: query.timeBucket ?? 'day',
    model: '',
    provider: '',
    userId: '',
    component: '',
    promptType: '',
    service: '',
    operation: '',
  };
}

function initialDashboardState(now = new Date()): DashboardInitialState {
  const aggregateQuery = defaultAggregateQuery(now);
  return {
    aggregateQuery,
    draftFilters: defaultFilterDraft(aggregateQuery),
    draftGroupBy: ['time.bucket'],
  };
}

function emptyUserDirectory(): UsageUserDirectory {
  return {
    byId: new Map<string, CurrentUserSummary>(),
    bySearchKey: new Map<string, string[]>(),
  };
}

function normalizeUserLookup(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function userFullName(user: CurrentUserSummary): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}

function addUserSearchKey(
  searchIndex: Map<string, string[]>,
  user: CurrentUserSummary,
  value: string | null
): void {
  if (value === null) {
    return;
  }

  const key = normalizeUserLookup(value);
  if (key.length === 0) {
    return;
  }

  const userIds = searchIndex.get(key) ?? [];
  if (!userIds.includes(user.id)) {
    searchIndex.set(key, [...userIds, user.id]);
  }
}

function buildUserDirectory(users: readonly CurrentUserSummary[]): UsageUserDirectory {
  const byId = new Map<string, CurrentUserSummary>();
  const bySearchKey = new Map<string, string[]>();

  for (const user of users) {
    byId.set(user.id, user);
    addUserSearchKey(bySearchKey, user, user.id);
    addUserSearchKey(bySearchKey, user, user.email);
    addUserSearchKey(bySearchKey, user, user.firstName);
    addUserSearchKey(bySearchKey, user, user.lastName);
    addUserSearchKey(bySearchKey, user, userFullName(user));
  }

  return { byId, bySearchKey };
}

function userIdsForFilter(value: string, userDirectory: UsageUserDirectory): string[] {
  const trimmedValue = value.trim();
  const matches = userDirectory.bySearchKey.get(normalizeUserLookup(trimmedValue));
  if (matches !== undefined && matches.length > 0) {
    return matches;
  }

  return [trimmedValue];
}

function buildAggregationFilters(
  draft: UsageFilterDraft,
  userDirectory: UsageUserDirectory = emptyUserDirectory()
): UsageAggregationFilters | undefined {
  const filters: UsageAggregationFilters = {};
  const model = draft.model.trim();
  const provider = draft.provider.trim();
  const userId = draft.userId.trim();
  const component = draft.component.trim();
  const promptType = draft.promptType.trim();

  if (model.length > 0) {
    filters.models = [model];
  }

  if (provider.length > 0) {
    filters.providers = [provider];
  }

  if (userId.length > 0) {
    filters.userIds = userIdsForFilter(userId, userDirectory);
  }

  if (component.length > 0) {
    filters.components = [component];
  }

  if (promptType.length > 0) {
    filters.promptTypes = [promptType];
  }

  if (draft.service !== '') {
    filters.services = [draft.service as UsageService];
  }

  if (draft.operation !== '') {
    filters.operations = [draft.operation as UsageOperation];
  }

  return Object.keys(filters).length === 0 ? undefined : filters;
}

function UsageUserIdentity({
  userId,
  userDirectory,
  app,
}: {
  userId: string;
  userDirectory: UsageUserDirectory;
  app: ReturnType<typeof useI18n>['messages']['app'];
}): ReactElement {
  const user = userDirectory.byId.get(userId);

  if (user === undefined) {
    return <span className="usage-user-identity">{userId}</span>;
  }

  return (
    <span className="usage-user-identity">
      <span className="usage-user-primary">{user.email}</span>
      <span className="usage-user-meta">
        {userRoleLabel(user.role, app)} / {userStatusLabel(user.status, app)} / {app.admin.level}{' '}
        {String(user.effectiveLevel)}
      </span>
      <span className="usage-user-id">
        {app.adminUsers.userId}: {user.id}
      </span>
    </span>
  );
}

function buildEventFilters(
  filters: UsageAggregationFilters | undefined
): UsageEventsFilters | undefined {
  if (filters === undefined) {
    return undefined;
  }

  const eventFilters: UsageEventsFilters = {
    ...(filters.userIds === undefined ? {} : { userIds: filters.userIds }),
    ...(filters.providers === undefined ? {} : { providers: filters.providers }),
    ...(filters.models === undefined ? {} : { models: filters.models }),
    ...(filters.services === undefined ? {} : { services: filters.services }),
    ...(filters.components === undefined ? {} : { components: filters.components }),
    ...(filters.operations === undefined ? {} : { operations: filters.operations }),
    ...(filters.promptTypes === undefined ? {} : { promptTypes: filters.promptTypes }),
  };

  return Object.keys(eventFilters).length === 0 ? undefined : eventFilters;
}

function defaultAggregateQuery(now = new Date()): UsageAggregationQuery {
  return {
    timeRange: recentUsageRange(now),
    timeBucket: 'day',
    groupBy: ['time.bucket'],
    limit: 100,
  };
}

function selectedGroupBy(values: UsageGroupBy[]): UsageGroupBy[] {
  return values.length === 0 ? ['time.bucket'] : values;
}

function formatDateOnlyValue(value: string, locale: string): string {
  return formatDate(`${value}T00:00:00`, locale);
}

function formatDateOnlyFromTimestamp(value: string, locale: string): string {
  return formatDateOnlyValue(dateInputValue(value), locale);
}

function formatReportDateRange(query: UsageAggregationQuery, locale: string): string {
  return `${formatDateOnlyFromTimestamp(query.timeRange.from, locale)} - ${formatDateOnlyFromTimestamp(
    query.timeRange.to,
    locale
  )}`;
}

function formatDisplayCostUsd(value: number): string {
  if (value === 0) {
    return '$0.00';
  }

  if (value > 0 && value < 0.01) {
    return '<$0.01';
  }

  return `$${value.toFixed(2)}`;
}

function formatGroupValue(
  groupBy: UsageGroupBy,
  value: string | undefined,
  locale: string
): string {
  if (value === undefined || value.length === 0) {
    return 'Total';
  }

  if (groupBy === 'time.bucket') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return formatDateOnlyValue(value, locale);
    }

    return formatDateTime(value, locale);
  }

  return value;
}

function metricCards(
  response: UsageAggregationResponse | null,
  locale: string,
  app: ReturnType<typeof useI18n>['messages']['app']
): { label: string; value: string; title?: string; description?: string; ariaLabel?: string }[] {
  const totals = response?.totals ?? zeroTotals;
  return [
    {
      label: app.adminUsage.metrics.estimatedCost,
      value: formatDisplayCostUsd(totals.estimatedCostUsd),
      title: formatCostUsd(totals.estimatedCostUsd),
    },
    { label: app.adminUsage.metrics.calls, value: formatInteger(totals.calls, locale) },
    {
      label: app.adminUsage.metrics.totalTokens,
      value: formatTokens(totals.totalTokens, { compact: true, locale }),
      title: formatTokens(totals.totalTokens, { locale }),
      ariaLabel: `${formatTokens(totals.totalTokens, { locale })} ${app.adminUsage.tokensAriaLabel}`,
      description: app.adminUsage.tokenMetricHelp,
    },
    { label: app.adminUsage.metrics.errors, value: formatInteger(totals.errorCallCount, locale) },
  ];
}

function activeFilterCount(query: UsageAggregationQuery): number {
  return Object.values(query.filters ?? {}).filter((value) => value !== undefined).length;
}

function eventKey(event: LlmUsageEvent): string {
  return `${event.createdAt}:${event.id}`;
}

function eventStatusLabel(
  event: LlmUsageEvent,
  app: ReturnType<typeof useI18n>['messages']['app']
): string {
  return event.error === undefined
    ? app.adminUsage.statusOk
    : `${app.adminUsage.statusErrorPrefix}: ${event.error.code}`;
}

function aggregateRowKey(
  row: UsageAggregationResponse['rows'][number],
  groupBy: UsageGroupBy[]
): string {
  return groupBy.map((group) => row.group[group] ?? '').join(':') || 'total';
}

function isTimeOnlyGroup(groupBy: readonly UsageGroupBy[]): boolean {
  return groupBy.length === 1 && groupBy[0] === 'time.bucket';
}

function compareTimeBucketDescending(left: UsageAggregateRow, right: UsageAggregateRow): number {
  return (right.group['time.bucket'] ?? '').localeCompare(left.group['time.bucket'] ?? '');
}

function mostByMetric(
  rows: readonly UsageAggregateRow[],
  metric: keyof Pick<UsageAggregateRow['metrics'], 'calls' | 'estimatedCostUsd'>
): UsageAggregateRow | null {
  return rows.reduce<UsageAggregateRow | null>((current, row) => {
    if (current === null || row.metrics[metric] > current.metrics[metric]) {
      return row;
    }

    return current;
  }, null);
}

function messageWithValue(template: string, value: string): string {
  return template.replace('{date}', value).replace('{count}', value);
}

function RawUsageEventCards({
  events,
  locale,
  userDirectory,
  app,
}: {
  events: readonly LlmUsageEvent[];
  locale: string;
  userDirectory: UsageUserDirectory;
  app: ReturnType<typeof useI18n>['messages']['app'];
}): ReactElement {
  return (
    <div className="usage-event-cards" aria-label={app.adminUsage.rawEventsSummary}>
      {events.map((usageEvent) => (
        <article className="usage-event-card" key={eventKey(usageEvent)}>
          <div className="usage-event-card-header">
            <strong>{usagePromptTypeLabel(usageEvent.source.promptType, app)}</strong>
            <span title={formatCostUsd(usageEvent.cost.estimatedCostUsd)}>
              {formatDisplayCostUsd(usageEvent.cost.estimatedCostUsd)}
            </span>
          </div>
          <dl>
            <div>
              <dt>{app.usage.created}</dt>
              <dd>{formatDateTime(usageEvent.createdAt, locale)}</dd>
            </div>
            <div>
              <dt>{app.adminUsage.user}</dt>
              <dd>
                <UsageUserIdentity
                  app={app}
                  userDirectory={userDirectory}
                  userId={usageEvent.owner.id}
                />
              </dd>
            </div>
            <div>
              <dt>{app.usage.model}</dt>
              <dd>
                {usageEvent.request.provider} / {usageEvent.request.model}
              </dd>
            </div>
            <div>
              <dt>{app.adminUsage.action}</dt>
              <dd>
                {usageComponentLabel(usageEvent.source.component, app)} /{' '}
                {usageOperationLabel(usageEvent.source.operation, app)}
              </dd>
            </div>
            <div>
              <dt>{app.adminUsage.status}</dt>
              <dd>{eventStatusLabel(usageEvent, app)}</dd>
            </div>
            <div>
              <dt>{app.usage.tokens}</dt>
              <dd title={formatTokens(usageEvent.usage.totalTokens, { locale })}>
                {formatTokens(usageEvent.usage.totalTokens, { compact: true, locale })}
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function UsageDashboard(): ReactElement {
  const { locale, messages } = useI18n();
  const app = messages.app;
  const [initialState] = useState(() => initialDashboardState());
  const [dimensions, setDimensions] = useState<UsageDimensionsResponse>({
    models: [],
    providers: [],
    components: [],
    promptTypes: [],
    services: [],
    operations: [],
  });
  const [draftFilters, setDraftFilters] = useState<UsageFilterDraft>(initialState.draftFilters);
  const [draftGroupBy, setDraftGroupBy] = useState<UsageGroupBy[]>(initialState.draftGroupBy);
  const [aggregateQuery, setAggregateQuery] = useState<UsageAggregationQuery>(
    initialState.aggregateQuery
  );
  const [aggregateResponse, setAggregateResponse] = useState<UsageAggregationResponse | null>(null);
  const [eventsResponse, setEventsResponse] = useState<UsageEventsResponse | null>(null);
  const [eventsVisible, setEventsVisible] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dimensionsError, setDimensionsError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [userDirectory, setUserDirectory] = useState<UsageUserDirectory>(() =>
    emptyUserDirectory()
  );
  const [userDirectoryError, setUserDirectoryError] = useState<string | null>(null);
  const eventsRequestIdRef = useRef(0);
  const cards = useMemo(
    () => metricCards(aggregateResponse, locale, app),
    [aggregateResponse, app, locale]
  );
  const activeGroupBy = selectedGroupBy(
    aggregateResponse?.meta.groupBy ?? aggregateQuery.groupBy ?? []
  );
  const timeOnlyAggregate = isTimeOnlyGroup(activeGroupBy);
  const aggregateRows = aggregateResponse?.rows ?? [];
  const aggregateRowsForDisplay = useMemo(() => {
    const rows = [...aggregateRows];
    return timeOnlyAggregate ? rows.sort(compareTimeBucketDescending) : rows;
  }, [aggregateRows, timeOnlyAggregate]);
  const highestUsageRow = useMemo(() => mostByMetric(aggregateRows, 'calls'), [aggregateRows]);
  const highestCostRow = useMemo(
    () => mostByMetric(aggregateRows, 'estimatedCostUsd'),
    [aggregateRows]
  );
  const aggregateTableStyle = {
    '--usage-group-columns': activeGroupBy.length,
  } as CSSProperties;
  const rawEvents = useMemo(
    () =>
      [...(eventsResponse?.events ?? [])].sort((left, right) =>
        eventKey(right).localeCompare(eventKey(left))
      ),
    [eventsResponse]
  );
  const rawEventsLabel = app.admin.rawEvents;
  const filterCount = activeFilterCount(aggregateQuery);
  const reportContextItems = [
    formatReportDateRange(aggregateQuery, locale),
    (aggregateQuery.timeBucket ?? 'day') === 'hour' ? app.adminUsage.hour : app.adminUsage.day,
    filterCount === 0
      ? app.adminUsage.noExtraFilters
      : `${app.adminUsage.filters}: ${formatInteger(filterCount, locale)}`,
  ];
  const aggregateTableLabel = timeOnlyAggregate
    ? (aggregateQuery.timeBucket ?? 'day') === 'hour'
      ? app.adminUsage.hourlyAggregateTable
      : app.adminUsage.dailyAggregateTable
    : app.adminUsage.aggregateTable;
  const aggregateSortingLabel =
    (aggregateQuery.timeBucket ?? 'day') === 'hour'
      ? app.adminUsage.sortingNewestHours
      : app.adminUsage.sortingNewestDays;
  const queryKey = JSON.stringify(aggregateQuery);
  const dimensionsKey = JSON.stringify({
    timeRange: aggregateQuery.timeRange,
    timeBucket: aggregateQuery.timeBucket ?? 'day',
  });

  useEffect(() => {
    let cancelled = false;

    async function loadUserDirectory(): Promise<void> {
      setUserDirectoryError(null);

      try {
        const users: CurrentUserSummary[] = [];
        let cursor: string | undefined;

        for (let page = 0; page < usageUserDirectoryMaxPages; page += 1) {
          const response = await listUsers({
            limit: usageUserDirectoryPageLimit,
            ...(cursor === undefined ? {} : { cursor }),
          });
          users.push(...response.users);

          if (response.nextCursor === null) {
            break;
          }

          cursor = response.nextCursor;
        }

        if (!cancelled) {
          setUserDirectory(buildUserDirectory(users));
        }
      } catch {
        if (!cancelled) {
          setUserDirectory(emptyUserDirectory());
          setUserDirectoryError(app.adminUsage.loadUserDirectoryError);
        }
      }
    }

    void loadUserDirectory();

    return () => {
      cancelled = true;
    };
  }, [app.adminUsage.loadUserDirectoryError]);

  useEffect(() => {
    let cancelled = false;

    async function loadDimensions(): Promise<void> {
      setDimensionsError(null);

      try {
        const nextDimensions = await getUsageDimensions({
          timeRange: aggregateQuery.timeRange,
          timeBucket: aggregateQuery.timeBucket ?? 'day',
        });

        if (!cancelled) {
          setDimensions(nextDimensions);
        }
      } catch {
        if (!cancelled) {
          setDimensionsError(app.adminUsage.loadDimensionsError);
        }
      }
    }

    void loadDimensions();

    return () => {
      cancelled = true;
    };
  }, [app.adminUsage.loadDimensionsError, dimensionsKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadAggregates(): Promise<void> {
      setBusy(true);
      setError(null);

      try {
        const nextAggregates = await queryUsageAggregates(aggregateQuery);

        if (!cancelled) {
          setAggregateResponse(nextAggregates);
        }
      } catch {
        if (!cancelled) {
          setError(app.adminUsage.loadAggregatesError);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadAggregates();

    return () => {
      cancelled = true;
    };
  }, [app.adminUsage.loadAggregatesError, queryKey]);

  async function loadEvents(query: UsageAggregationQuery): Promise<void> {
    const requestId = eventsRequestIdRef.current + 1;
    eventsRequestIdRef.current = requestId;
    setEventsBusy(true);
    setEventsError(null);

    try {
      const eventFilters = buildEventFilters(query.filters);
      const nextEvents = await queryUsageEvents({
        timeRange: query.timeRange,
        ...(eventFilters === undefined ? {} : { filters: eventFilters }),
        limit: 50,
      });
      if (eventsRequestIdRef.current === requestId) {
        setEventsResponse(nextEvents);
      }
    } catch {
      if (eventsRequestIdRef.current === requestId) {
        setEventsError(app.adminUsage.loadRawEventsError);
      }
    } finally {
      if (eventsRequestIdRef.current === requestId) {
        setEventsBusy(false);
      }
    }
  }

  function updateDraft(patch: Partial<UsageFilterDraft>): void {
    setDraftFilters((current) => ({ ...current, ...patch }));
  }

  function toggleGroupBy(groupBy: UsageGroupBy): void {
    setDraftGroupBy((current) => {
      if (current.includes(groupBy)) {
        return current.filter((value) => value !== groupBy);
      }

      return [...current, groupBy];
    });
  }

  function handleApplyFilters(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const filters = buildAggregationFilters(draftFilters, userDirectory);
    const groupBy = selectedGroupBy(draftGroupBy);
    const nextQuery: UsageAggregationQuery = {
      timeRange: {
        from: isoDayStart(draftFilters.fromDate),
        to: isoDayEnd(draftFilters.toDate),
      },
      timeBucket: draftFilters.timeBucket,
      groupBy,
      limit: 100,
      ...(filters === undefined ? {} : { filters }),
    };

    setEventsResponse(null);
    setAggregateQuery(nextQuery);

    if (eventsVisible) {
      void loadEvents(nextQuery);
    }
  }

  function handleResetFilters(): void {
    setDraftFilters(initialState.draftFilters);
    setDraftGroupBy(initialState.draftGroupBy);
    setEventsResponse(null);
    setAggregateQuery(initialState.aggregateQuery);

    if (eventsVisible) {
      void loadEvents(initialState.aggregateQuery);
    }
  }

  function handleToggleEvents(): void {
    const nextVisible = !eventsVisible;
    setEventsVisible(nextVisible);

    if (!nextVisible) {
      eventsRequestIdRef.current += 1;
      setEventsBusy(false);
      return;
    }

    if (eventsResponse === null) {
      void loadEvents(aggregateQuery);
    }
  }

  const mobileActionItems: ActionMenuItem[] = [
    {
      label: app.admin.showFilters,
      icon: Filter,
      onSelect: () => {
        setFiltersOpen((current) => !current);
      },
    },
    {
      label: rawEventsLabel,
      icon: Rows3,
      onSelect: handleToggleEvents,
    },
  ];

  return (
    <section className="view-stack" aria-labelledby="admin-usage-heading">
      <div className="panel-header">
        <div>
          <h2 id="admin-usage-heading">{app.admin.llmUsage}</h2>
          <p className="panel-subtitle">{app.admin.llmUsageSubtitle}</p>
          <div className="usage-report-context" aria-label={app.usage.reportPeriod}>
            {reportContextItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
        <div className="toolbar-actions usage-dashboard-desktop-actions">
          <button
            className="fa-chip icon-button-label"
            type="button"
            onClick={() => {
              setFiltersOpen((current) => !current);
            }}
          >
            <Filter aria-hidden="true" />
            {filtersOpen ? app.admin.hideFilters : app.admin.showFilters}
          </button>
          <button className="fa-chip icon-button-label" type="button" onClick={handleToggleEvents}>
            <Rows3 aria-hidden="true" />
            {rawEventsLabel}
          </button>
        </div>
        <div className="usage-dashboard-mobile-actions">
          <ActionMenu label={app.commonActions.actions} items={mobileActionItems} />
        </div>
      </div>

      {filtersOpen ? (
        <form
          aria-labelledby="usage-filters-heading"
          className="toolbar-actions admin-filters usage-filter-panel fa-surface"
          onSubmit={handleApplyFilters}
        >
          <div className="usage-filter-header">
            <h3 id="usage-filters-heading">{app.adminUsage.filters}</h3>
            <p>{app.adminUsage.filterIntro}</p>
          </div>
          <fieldset className="usage-filter-section">
            <legend>{app.adminUsage.basics}</legend>
            <label className="admin-inline-control">
              <span>{app.adminUsage.from}</span>
              <input
                aria-label={app.adminUsage.from}
                required
                type="date"
                value={draftFilters.fromDate}
                onChange={(event) => {
                  updateDraft({ fromDate: event.currentTarget.value });
                }}
              />
            </label>
            <label className="admin-inline-control">
              <span>{app.adminUsage.to}</span>
              <input
                aria-label={app.adminUsage.to}
                required
                type="date"
                value={draftFilters.toDate}
                onChange={(event) => {
                  updateDraft({ toDate: event.currentTarget.value });
                }}
              />
            </label>
            <label className="admin-inline-control">
              <span>{app.adminUsage.timeBucket}</span>
              <select
                aria-label={app.adminUsage.timeBucket}
                value={draftFilters.timeBucket}
                onChange={(event) => {
                  updateDraft({ timeBucket: event.currentTarget.value as UsageTimeBucket });
                }}
              >
                <option value="day">{app.adminUsage.day}</option>
                <option value="hour">{app.adminUsage.hour}</option>
              </select>
            </label>
            <label className="admin-inline-control">
              <span>{app.admin.provider}</span>
              <select
                aria-label={app.adminUsage.providerFilter}
                value={draftFilters.provider}
                onChange={(event) => {
                  updateDraft({ provider: event.currentTarget.value });
                }}
              >
                <option value="">{app.adminUsage.all}</option>
                {dimensions.providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-inline-control">
              <span>{app.usage.model}</span>
              <select
                aria-label={app.adminUsage.modelFilter}
                value={draftFilters.model}
                onChange={(event) => {
                  updateDraft({ model: event.currentTarget.value });
                }}
              >
                <option value="">{app.adminUsage.all}</option>
                {dimensions.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset className="usage-filter-section">
            <legend>{app.adminUsage.advancedFilters}</legend>
            <label className="admin-inline-control">
              <span>{app.usage.component}</span>
              <select
                aria-label={app.adminUsage.componentFilter}
                value={draftFilters.component}
                onChange={(event) => {
                  updateDraft({ component: event.currentTarget.value });
                }}
              >
                <option value="">{app.adminUsage.all}</option>
                {dimensions.components.map((component) => (
                  <option key={component} value={component}>
                    {usageComponentLabel(component, app)}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-inline-control">
              <span>{app.adminUsers.userId}</span>
              <input
                aria-label={app.adminUsage.userIdFilter}
                type="text"
                value={draftFilters.userId}
                onChange={(event) => {
                  updateDraft({ userId: event.currentTarget.value });
                }}
              />
            </label>
            <label className="admin-inline-control">
              <span>{app.usage.promptType}</span>
              <select
                aria-label={app.adminUsage.promptTypeFilter}
                value={draftFilters.promptType}
                onChange={(event) => {
                  updateDraft({ promptType: event.currentTarget.value });
                }}
              >
                <option value="">{app.adminUsage.all}</option>
                {dimensions.promptTypes.map((promptType) => (
                  <option key={promptType} value={promptType}>
                    {usagePromptTypeLabel(promptType, app)}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-inline-control">
              <span>{app.adminUsage.service}</span>
              <select
                aria-label={app.adminUsage.serviceFilter}
                value={draftFilters.service}
                onChange={(event) => {
                  updateDraft({ service: event.currentTarget.value });
                }}
              >
                <option value="">{app.adminUsage.all}</option>
                {dimensions.services.map((service) => (
                  <option key={service} value={service}>
                    {usageServiceLabel(service, app)}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-inline-control">
              <span>{app.usage.operation}</span>
              <select
                aria-label={app.adminUsage.operationFilter}
                value={draftFilters.operation}
                onChange={(event) => {
                  updateDraft({ operation: event.currentTarget.value });
                }}
              >
                <option value="">{app.adminUsage.all}</option>
                {dimensions.operations.map((operation) => (
                  <option key={operation} value={operation}>
                    {usageOperationLabel(operation, app)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset className="admin-group-controls usage-filter-section">
            <legend>{app.adminUsage.groupBy}</legend>
            {groupByOptions.map((option) => (
              <label className="admin-check-control" key={option}>
                <input
                  aria-label={`${app.adminUsage.groupByAriaPrefix} ${usageGroupByAriaLabel(
                    option,
                    app
                  )}`}
                  type="checkbox"
                  checked={draftGroupBy.includes(option)}
                  onChange={() => {
                    toggleGroupBy(option);
                  }}
                />
                <span>{usageGroupByLabel(option, app)}</span>
              </label>
            ))}
          </fieldset>
          <div className="usage-filter-actions">
            <button type="submit">{app.adminUsage.applyFilters}</button>
            <button type="button" onClick={handleResetFilters}>
              {app.adminUsage.resetFilters}
            </button>
          </div>
        </form>
      ) : null}

      {error === null ? null : <p className="error-copy">{error}</p>}
      {dimensionsError === null ? null : <p className="error-copy">{dimensionsError}</p>}
      {userDirectoryError === null ? null : <p className="error-copy">{userDirectoryError}</p>}

      <div className="usage-metric-grid" aria-busy={busy}>
        {cards.map((card) => (
          <div className="usage-metric" key={card.label}>
            <span>{card.label}</span>
            <strong aria-label={card.ariaLabel} title={card.title}>
              {card.value}
            </strong>
            {card.description === undefined ? null : <small>{card.description}</small>}
          </div>
        ))}
      </div>

      {busy ? <p className="usage-state-message">{app.adminUsage.loadingAggregates}</p> : null}

      {!busy && aggregateRowsForDisplay.length === 0 ? (
        <p className="usage-state-message">
          {filterCount === 0 ? app.adminUsage.noUsage : app.adminUsage.noFilteredUsage}
        </p>
      ) : null}

      {!busy && timeOnlyAggregate && aggregateRowsForDisplay.length > 0 ? (
        <section className="usage-highlights" aria-labelledby="usage-highlights-heading">
          <h3 id="usage-highlights-heading">{app.adminUsage.highlights}</h3>
          <ul>
            <li>
              {messageWithValue(
                app.adminUsage.highestUsage,
                formatGroupValue('time.bucket', highestUsageRow?.group['time.bucket'], locale)
              )}
            </li>
            <li>
              {messageWithValue(
                app.adminUsage.highestCost,
                formatGroupValue('time.bucket', highestCostRow?.group['time.bucket'], locale)
              )}
            </li>
            <li>
              {aggregateResponse?.totals.errorCallCount === 0
                ? app.adminUsage.noErrorsRecorded
                : messageWithValue(
                    app.adminUsage.errorsRecorded,
                    formatInteger(aggregateResponse?.totals.errorCallCount ?? 0, locale)
                  )}
            </li>
          </ul>
        </section>
      ) : null}

      {aggregateRowsForDisplay.length > 0 ? (
        <div className="usage-table-block">
          <div className="usage-table-title">
            <h3>{aggregateTableLabel}</h3>
            {timeOnlyAggregate ? <p>{aggregateSortingLabel}</p> : null}
          </div>
          <div
            className="table-shell usage-aggregate-table"
            role="table"
            aria-label={aggregateTableLabel}
            style={aggregateTableStyle}
          >
            <div className="table-row table-head" role="row">
              {activeGroupBy.map((groupBy) => {
                const label =
                  groupBy === 'time.bucket'
                    ? (aggregateQuery.timeBucket ?? 'day') === 'hour'
                      ? app.adminUsage.hourColumn
                      : app.adminUsage.dateColumn
                    : usageGroupByLabel(groupBy, app);
                const sortedColumn = timeOnlyAggregate && groupBy === 'time.bucket';

                return (
                  <span
                    aria-sort={sortedColumn ? 'descending' : undefined}
                    role="columnheader"
                    key={groupBy}
                  >
                    {label}
                    {sortedColumn ? (
                      <span className="sr-only"> {app.adminUsage.sortedNewestFirst}</span>
                    ) : null}
                  </span>
                );
              })}
              <span role="columnheader">{app.adminUsage.metrics.calls}</span>
              <span role="columnheader">{app.adminUsage.metrics.estimatedCost}</span>
              <span role="columnheader">{app.adminUsage.metrics.totalTokens}</span>
            </div>
            {aggregateRowsForDisplay.map((row) => (
              <div className="table-row" role="row" key={aggregateRowKey(row, activeGroupBy)}>
                {activeGroupBy.map((groupBy) => (
                  <span className="usage-group-value" key={groupBy}>
                    {groupBy === 'owner.id' && row.group[groupBy] !== undefined ? (
                      <UsageUserIdentity
                        app={app}
                        userDirectory={userDirectory}
                        userId={row.group[groupBy]}
                      />
                    ) : groupBy === 'source.component' && row.group[groupBy] !== undefined ? (
                      usageComponentLabel(row.group[groupBy], app)
                    ) : groupBy === 'source.operation' && row.group[groupBy] !== undefined ? (
                      usageOperationLabel(row.group[groupBy], app)
                    ) : groupBy === 'source.promptType' && row.group[groupBy] !== undefined ? (
                      usagePromptTypeLabel(row.group[groupBy], app)
                    ) : groupBy === 'source.service' && row.group[groupBy] !== undefined ? (
                      usageServiceLabel(row.group[groupBy], app)
                    ) : (
                      formatGroupValue(groupBy, row.group[groupBy], locale)
                    )}
                  </span>
                ))}
                <span>{formatInteger(row.metrics.calls, locale)}</span>
                <span
                  aria-label={`${formatCostUsd(row.metrics.estimatedCostUsd)} ${app.adminUsage.costAriaLabel}`}
                  className="usage-compact-value"
                  title={formatCostUsd(row.metrics.estimatedCostUsd)}
                >
                  {formatDisplayCostUsd(row.metrics.estimatedCostUsd)}
                </span>
                <span
                  aria-label={`${formatTokens(row.metrics.totalTokens, { locale })} ${app.adminUsage.tokensAriaLabel}`}
                  className="usage-compact-value"
                  title={formatTokens(row.metrics.totalTokens, { locale })}
                >
                  {formatTokens(row.metrics.totalTokens, { compact: true, locale })}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {eventsVisible ? (
        <section className="view-stack" aria-labelledby="raw-events-heading">
          <div className="panel-header">
            <div>
              <h2 id="raw-events-heading">{rawEventsLabel}</h2>
              <p className="panel-subtitle">{app.adminUsage.rawEventsDescription}</p>
            </div>
          </div>
          {eventsError === null ? null : <p className="error-copy">{eventsError}</p>}
          <RawUsageEventCards
            app={app}
            events={rawEvents}
            locale={locale}
            userDirectory={userDirectory}
          />
          <table
            className="usage-table usage-raw-table"
            aria-label={app.adminUsage.rawEventsTable}
            aria-busy={eventsBusy}
          >
            <thead>
              <tr>
                <th>{app.usage.created}</th>
                <th>{app.adminUsage.user}</th>
                <th>{app.admin.provider}</th>
                <th>{app.usage.model}</th>
                <th>{app.usage.component}</th>
                <th>{app.usage.promptType}</th>
                <th>{app.usage.operation}</th>
                <th>{app.adminUsage.status}</th>
                <th>{app.usage.cost}</th>
                <th>{app.usage.tokens}</th>
              </tr>
            </thead>
            <tbody>
              {rawEvents.map((usageEvent) => (
                <tr key={eventKey(usageEvent)}>
                  <td>{formatDateTime(usageEvent.createdAt, locale)}</td>
                  <td>
                    <UsageUserIdentity
                      app={app}
                      userDirectory={userDirectory}
                      userId={usageEvent.owner.id}
                    />
                  </td>
                  <td>{usageEvent.request.provider}</td>
                  <td>{usageEvent.request.model}</td>
                  <td>{usageComponentLabel(usageEvent.source.component, app)}</td>
                  <td>{usagePromptTypeLabel(usageEvent.source.promptType, app)}</td>
                  <td>{usageOperationLabel(usageEvent.source.operation, app)}</td>
                  <td>{eventStatusLabel(usageEvent, app)}</td>
                  <td title={formatCostUsd(usageEvent.cost.estimatedCostUsd)}>
                    {formatDisplayCostUsd(usageEvent.cost.estimatedCostUsd)}
                  </td>
                  <td title={formatTokens(usageEvent.usage.totalTokens, { locale })}>
                    {formatTokens(usageEvent.usage.totalTokens, { compact: true, locale })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}
