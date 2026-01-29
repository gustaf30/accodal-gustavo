import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database';
import { getConfig } from '../config/database';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

// In-memory store for development (use Redis in production)
const rateLimitStore = new Map<string, RateLimitInfo>();

export function rateLimiter(options?: {
  limit?: number;
  windowMs?: number;
  keyGenerator?: (req: Request) => string;
}) {
  const config = getConfig();
  const limit = options?.limit || config.rateLimitRequests;
  const windowMs = options?.windowMs || config.rateLimitWindow;
  const keyGenerator = options?.keyGenerator || defaultKeyGenerator;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = keyGenerator(req);
      const now = Date.now();

      let info = rateLimitStore.get(key);

      if (!info || now > info.resetTime) {
        info = {
          count: 1,
          resetTime: now + windowMs,
        };
      } else {
        info.count++;
      }

      rateLimitStore.set(key, info);

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(Math.max(0, limit - info.count)),
        'X-RateLimit-Reset': String(Math.ceil(info.resetTime / 1000)),
      });

      if (info.count > limit) {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later',
            retryAfter: Math.ceil((info.resetTime - now) / 1000),
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      next();
    } catch (error) {
      // Don't block requests on rate limiter errors
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

  return `rate_limit:${ip}`;
}

// Database-backed rate limiter for distributed systems
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

  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_identifier: identifier,
    p_endpoint: endpoint,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error('Rate limit check failed:', error);
    // Allow request on error
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(Date.now() + windowSeconds * 1000),
    };
  }

  const allowed = data === true;

  return {
    allowed,
    remaining: allowed ? limit - 1 : 0,
    resetAt: new Date(Date.now() + windowSeconds * 1000),
  };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, info] of rateLimitStore.entries()) {
    if (now > info.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute
