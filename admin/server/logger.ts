/**
 * Minimal structured logger. Never log passwords, JWTs, or API keys.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (/bearer\s+/i.test(value)) return '[REDACTED_TOKEN]';
    if (value.length > 40 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
      return '[REDACTED_JWT]';
    }
    return value;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (
        key.includes('password') ||
        key.includes('secret') ||
        key.includes('token') ||
        key.includes('authorization') ||
        key.includes('api_key') ||
        key.includes('apikey')
      ) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  // Keep test stdout free of noise — Node's test runner IPC shares the pipe with
  // child stdout when isolation is on; even with isolation=none, quieter CI logs help.
  if (process.env.NODE_ENV === 'test' && level !== 'error' && level !== 'warn') {
    return;
  }
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(meta ? { meta: redact(meta) as Record<string, unknown> } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === 'debug') write('debug', message, meta);
  },
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
