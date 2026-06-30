import { buildUsageEvent } from './buildUsageEvent.js';
import {
  UsageSink,
  type UsageEventInput,
  type UsageService,
  type UsageSinkRecordParams,
} from './types.js';

export interface FakeUsageSinkConfig {
  service?: UsageService;
  component?: string;
}

export class FakeUsageSink extends UsageSink {
  readonly events: UsageEventInput[] = [];
  private readonly service: UsageService;
  private readonly component: string;

  constructor(config: FakeUsageSinkConfig = {}) {
    super();
    this.service = config.service ?? 'chat-service';
    this.component = config.component ?? 'test';
  }

  record(params: UsageSinkRecordParams): Promise<void> {
    this.events.push(
      buildUsageEvent({
        ...params,
        service: this.service,
        component: this.component,
      })
    );
    return Promise.resolve();
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  clear(): void {
    this.events.length = 0;
  }
}
