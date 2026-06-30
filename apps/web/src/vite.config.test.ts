import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ProxyOptions } from 'vite';

import { createApiProxy } from '../vite.config.js';

describe('web Vite API proxy', () => {
  it('returns a public-edge 404 for internal service routes before proxying', async () => {
    const proxy = createApiProxy([
      {
        name: 'chat-service',
        envSuffix: 'CHAT_SERVICE',
        apiPath: '/api/chat',
        proxyTarget: 'http://localhost:3201',
        serviceUrl: 'http://localhost:3201',
      },
    ]);

    const chatProxy = proxy['/api/chat'];

    expect(chatProxy).toEqual(expect.objectContaining({ target: 'http://localhost:3201' }));
    expect(typeof (chatProxy as ProxyOptions).bypass).toBe('function');
    const bypassResult = await (chatProxy as ProxyOptions).bypass?.(
      { url: '/api/chat/internal/usage-events' } as IncomingMessage,
      {} as ServerResponse,
      chatProxy as ProxyOptions
    );

    expect(bypassResult).toBe(false);
  });

  it('still strips public API prefixes for proxied non-internal routes', () => {
    const proxy = createApiProxy([
      {
        name: 'chat-service',
        envSuffix: 'CHAT_SERVICE',
        apiPath: '/api/chat',
        proxyTarget: 'http://localhost:3201',
        serviceUrl: 'http://localhost:3201',
      },
    ]);

    const chatProxy = proxy['/api/chat'];

    expect((chatProxy as ProxyOptions).rewrite?.('/api/chat/messages')).toBe('/messages');
    expect((chatProxy as ProxyOptions).rewrite?.('/api/chat')).toBe('/');
  });
});
