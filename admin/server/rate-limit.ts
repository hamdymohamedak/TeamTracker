/**
 * Simple in-memory rate limiter for sensitive endpoints.
 * Suitable for a single-VPS Node process (no Redis required).
 */

import { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  /** Optional custom key; default is IP + prefix */
  keyFn?: (req: Request) => string;
  message?: string;
}

function clientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) {
    return xf.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function rateLimit(opts: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyPrefix = 'rl',
    keyFn,
    message = 'Too many requests. Please try again later.',
  } = opts;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${keyPrefix}:${keyFn ? keyFn(req) : clientIp(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.status(429).json({ success: false, error: message });
      return;
    }

    next();
  };
}

/** Periodic cleanup to avoid unbounded Map growth */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}, 60_000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
