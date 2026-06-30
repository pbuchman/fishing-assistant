export type LogLevel = 'silent' | 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(obj: object, message?: string): void;
  info(obj: object, message?: string): void;
  warn(obj: object, message?: string): void;
  error(obj: object, message?: string): void;
}

export const LOGGER_METHODS = ['debug', 'info', 'warn', 'error'] as const;

const supportedLogLevels = new Set<LogLevel>(['silent', 'debug', 'info', 'warn', 'error']);

export function getLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  if (env['NODE_ENV'] === 'test') {
    return 'silent';
  }

  const configuredLevel = env['LOG_LEVEL'];
  if (configuredLevel !== undefined && supportedLogLevels.has(configuredLevel as LogLevel)) {
    return configuredLevel as LogLevel;
  }

  return 'info';
}
