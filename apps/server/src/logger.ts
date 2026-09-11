import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  if (!pretty) return pino({ level });
  return pino({
    level,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  });
}

/** Silent logger for tests. */
export const nullLogger = (): Logger => pino({ level: 'silent' });
