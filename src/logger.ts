/**
 * Structured logging for enterprise observability.
 * Outputs JSON to stderr for compatibility with ELK, Datadog, Splunk, CloudWatch.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

let verboseMode = false;

export function setVerbose(v: boolean): void {
  verboseMode = v;
}

export function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (level === 'DEBUG' && !verboseMode) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export function logDebug(message: string, context?: Record<string, unknown>): void {
  log('DEBUG', message, context);
}

export function logInfo(message: string, context?: Record<string, unknown>): void {
  log('INFO', message, context);
}

export function logWarn(message: string, context?: Record<string, unknown>): void {
  log('WARN', message, context);
}

export function logError(message: string, context?: Record<string, unknown>): void {
  log('ERROR', message, context);
}
