export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  correlationId: string;
  requestId?: string;
  eventId?: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(private readonly serviceName: string) {}

  log(level: LogLevel, message: string, context: LogContext, extra?: Record<string, unknown>): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...context,
      ...extra
    };

    console.log(JSON.stringify(payload));
  }

  info(message: string, context: LogContext, extra?: Record<string, unknown>): void {
    this.log('INFO', message, context, extra);
  }

  warn(message: string, context: LogContext, extra?: Record<string, unknown>): void {
    this.log('WARN', message, context, extra);
  }

  error(message: string, context: LogContext, extra?: Record<string, unknown>): void {
    this.log('ERROR', message, context, extra);
  }
}
