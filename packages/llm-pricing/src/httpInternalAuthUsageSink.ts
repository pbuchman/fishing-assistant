import {
  InternalClientError,
  createLlmUsageServiceClient,
  type LlmUsageServiceClient,
} from '@fa/internal-clients';
import { getErrorMessage } from '@fa/common-core';

import { buildUsageEvent } from './buildUsageEvent.js';
import type {
  FlushOptions,
  HttpInternalAuthUsageSinkConfig,
  UsageEventInput,
  UsageSinkRecordParams,
} from './types.js';
import { UsageSink } from './types.js';

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function summarizeRejectedUsageEvents(
  rejected: readonly { index: number; code: string }[]
): { index: number; code: string }[] {
  return rejected.map(({ index, code }) => ({ index, code }));
}

export class HttpInternalAuthUsageSink extends UsageSink {
  private readonly config: HttpInternalAuthUsageSinkConfig;
  private readonly usageServiceUrl: string;
  private readonly client: LlmUsageServiceClient;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private buffer: UsageEventInput[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(config: HttpInternalAuthUsageSinkConfig) {
    super();
    this.config = config;
    this.usageServiceUrl = trimTrailingSlashes(config.usageServiceUrl);
    this.client = createLlmUsageServiceClient({
      baseUrl: this.usageServiceUrl,
      internalAuthToken: config.internalAuthToken,
      timeoutMs: config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  }

  async record(params: UsageSinkRecordParams): Promise<void> {
    const event = buildUsageEvent({
      ...params,
      service: this.config.service,
      component: this.config.component,
    });
    const wasEmpty = this.buffer.length === 0;
    this.buffer.push(event);

    if (this.buffer.length >= this.maxBatchSize) {
      await this.flush();
      return;
    }

    if (wasEmpty) {
      this.scheduleFlush();
    }
  }

  async flush(options: FlushOptions = {}): Promise<void> {
    this.clearFlushTimer();

    if (this.inFlight !== null) {
      await this.inFlight;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const events = this.buffer;
    this.buffer = [];

    const request = this.postEvents(events, { rethrow: options.rethrow === true });
    this.inFlight = request.finally(() => {
      if (this.inFlight === request) {
        this.inFlight = null;
      }
    });
    await this.inFlight;
  }

  private scheduleFlush(): void {
    if (this.flushIntervalMs === 0) {
      void this.flush();
      return;
    }

    if (this.flushTimer !== null) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async postEvents(
    events: readonly UsageEventInput[],
    options: Required<FlushOptions>
  ): Promise<void> {
    const url = `${this.usageServiceUrl}/internal/usage-events`;

    try {
      const usageResponse = await this.client.ingestUsageEvents(events);
      if (usageResponse.rejected.length > 0) {
        this.config.logger.warn(
          {
            rejectedCount: usageResponse.rejected.length,
            rejected: summarizeRejectedUsageEvents(usageResponse.rejected),
            url,
            batchSize: events.length,
          },
          'Usage service rejected usage events'
        );
      }
    } catch (error) {
      if (error instanceof InternalClientError && error.statusCode !== undefined) {
        this.config.logger.warn(
          { statusCode: error.statusCode, url, batchSize: events.length },
          'Usage service returned non-2xx status'
        );

        if (options.rethrow) {
          throw new Error(`Usage service returned status ${String(error.statusCode)}`, {
            cause: error,
          });
        }

        return;
      }

      if (options.rethrow) {
        throw error;
      }

      this.config.logger.warn(
        { error: getErrorMessage(error), url, batchSize: events.length },
        'Usage service ingest request failed'
      );
    }
  }
}
