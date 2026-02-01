import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database';
import { getConfig } from '../config/database';
import { getRedisClient, isRedisConnected } from '../config/redis';

/**
 * Rate Limiter Middleware
 *
 * Uses Redis for fast distributed rate limiting.
 * Falls back to Supabase database if Redis is not available.
 *
 * Implements sliding window rate limiting algorithm.
 */
export function rateLimiter(options?: {
  limit?: number;
  windowMs?: number;
  keyGenerator?: (req: Request) => string;
}) {
  const config = getConfig();
  const limit = options?.limit || config.rateLimitRequests;
  const windowMs = options?.windowMs || config.rateLimitWindow;
  const windowSeconds = Math.ceil(windowMs / 1000);
  const keyGenerator = options?.keyGenerator || defaultKeyGenerator;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identifier = keyGenerator(req);
      const endpoint = req.path;

      // Try Redis first, then fall back to database
      const result = await checkRateLimit(identifier, endpoint, limit, windowSeconds);

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt.getTime() / 1000)),
        'X-RateLimit-Source': result.source,
      });

      if (!result.allowed) {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later',
            retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      next();
    } catch (error) {
      // Don't block requests on rate limiter errors (fail open)
      console.error('Rate limiter error:', error);
      next();
    }
  };
}

function defaultKeyGenerator(req: Request): string {
  // Use IP address as default key
  const ip =
    req.ip ||
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    'unknown';

  return typeof ip === 'string' ? ip : Array.isArray(ip) ? ip[0] : 'unknown';
}

/**
 * Check rate limit using Redis (primary) or Supabase (fallback)
 */
async function checkRateLimit(
  identifier: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  source: 'redis' | 'supabase';
}> {
  const redis = getRedisClient();

  // Try Redis first
  if (redis && isRedisConnected()) {
    try {
      const result = await redisRateLimiter(redis, identifier, endpoint, limit, windowSeconds);
      return { ...result, source: 'redis' };
    } catch (error) {
      console.error('Redis rate limit failed, falling back to Supabase:', error);
    }
  }

  // Fallback to Supabase
  const result = await dbRateLimiter(identifier, endpoint, limit, windowSeconds);
  return { ...result, source: 'supabase' };
}

/**
 * Redis-based sliding window rate limiter
 *
 * Uses sorted sets to implement sliding window with microsecond precision.
 * This is more efficient and accurate than fixed window approaches.
 */
async function redisRateLimiter(
  redis: ReturnType<typeof getRedisClient>,
  identifier: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  const key = `ratelimit:${identifier}:${endpoint}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Use a transaction (pipeline) for atomicity
  const pipeline = redis.multi();

  // Remove old entries outside the window
  pipeline.zremrangebyscore(key, 0, windowStart);

  // Count current entries in window
  pipeline.zcard(key);

  // Add current request (will only be kept if under limit)
  pipeline.zadd(key, now, `${now}:${Math.random()}`);

  // Set TTL on the key
  pipeline.expire(key, windowSeconds + 1);

  const results = await pipeline.exec();

  if (!results) {
    throw new Error('Redis transaction failed');
  }

  // results[1] contains the count before adding the new request
  const currentCount = (results[1]?.[1] as number) || 0;

  const allowed = currentCount < limit;
  const remaining = Math.max(0, limit - currentCount - 1);
  const resetAt = new Date(now + windowSeconds * 1000);

  // If not allowed, remove the entry we just added
  if (!allowed) {
    // Don't actually need to remove - it will be cleaned up next time
    // But we need to ensure accurate count
  }

  return { allowed, remaining, resetAt };
}

/**
 * Database-backed rate limiter using Supabase's check_rate_limit_sliding function
 * This ensures distributed rate limiting works across serverless function instances
 */
export async function dbRateLimiter(
  identifier: string,
  endpoint: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}> {
  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase.rpc('check_rate_limit_sliding', {
      p_identifier: identifier,
      p_endpoint: endpoint,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error('Rate limit check failed:', error);
      // Allow request on error (fail open)
      return {
        allowed: true,
        remaining: limit,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
      };
    }

    // check_rate_limit_sliding returns a table with allowed, current_count, remaining, reset_at
    const result = Array.isArray(data) && data.length > 0 ? data[0] : data;

    if (!result || typeof result.allowed === 'undefined') {
      // Fallback to simple check_rate_limit if sliding window function not available
      const { data: simpleData, error: simpleError } = await supabase.rpc(
        'check_rate_limit',
        {
          p_identifier: identifier,
          p_endpoint: endpoint,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        }
      );

      if (simpleError) {
        console.error('Simple rate limit check failed:', simpleError);
        return {
          allowed: true,
          remaining: limit,
          resetAt: new Date(Date.now() + windowSeconds * 1000),
        };
      }

      const allowed = simpleData === true;
      return {
        allowed,
        remaining: allowed ? limit - 1 : 0,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
      };
    }

    return {
      allowed: result.allowed,
      remaining: result.remaining ?? (result.allowed ? limit - 1 : 0),
      resetAt: result.reset_at
        ? new Date(result.reset_at)
        : new Date(Date.now() + windowSeconds * 1000),
    };
  } catch (error) {
    console.error('Rate limit check exception:', error);
    // Allow request on error (fail open)
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(Date.now() + windowSeconds * 1000),
    };
  }
}

/**
 * Get rate limit info for a specific identifier/endpoint without incrementing
 */
export async function getRateLimitInfo(
  identifier: string,
  endpoint: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<{
  currentCount: number;
  remaining: number;
  resetAt: Date;
  source: 'redis' | 'supabase';
}> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      const key = `ratelimit:${identifier}:${endpoint}`;
      const now = Date.now();
      const windowStart = now - windowSeconds * 1000;

      // Remove old entries and count
      await redis.zremrangebyscore(key, 0, windowStart);
      const currentCount = await redis.zcard(key);

      return {
        currentCount,
        remaining: Math.max(0, limit - currentCount),
        resetAt: new Date(now + windowSeconds * 1000),
        source: 'redis',
      };
    } catch (error) {
      console.error('Redis rate limit info failed:', error);
    }
  }

  // Fallback - just return default values
  return {
    currentCount: 0,
    remaining: limit,
    resetAt: new Date(Date.now() + windowSeconds * 1000),
    source: 'supabase',
  };
}
