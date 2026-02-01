import Redis from 'ioredis';

let redisClient: Redis | null = null;
let isConnected = false;

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  retryDelayMs?: number;
}

function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'taxdoc:',
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryDelayMs: 1000,
  };
}

export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_HOST && !process.env.REDIS_URL) {
    // Redis not configured - return null to use fallback
    return null;
  }

  if (redisClient && isConnected) {
    return redisClient;
  }

  const config = getRedisConfig();

  // Support Redis URL format (for cloud providers like Upstash, Redis Cloud)
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL, {
      keyPrefix: config.keyPrefix,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      enableReadyCheck: config.enableReadyCheck,
      retryStrategy: (times) => {
        if (times > 10) {
          console.error('Redis: Max retries exceeded, giving up');
          return null; // Stop retrying
        }
        const delay = Math.min(times * config.retryDelayMs!, 30000);
        console.log(`Redis: Retrying connection in ${delay}ms (attempt ${times})`);
        return delay;
      },
      lazyConnect: true,
    });
  } else {
    redisClient = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      keyPrefix: config.keyPrefix,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      enableReadyCheck: config.enableReadyCheck,
      retryStrategy: (times) => {
        if (times > 10) {
          console.error('Redis: Max retries exceeded, giving up');
          return null;
        }
        const delay = Math.min(times * config.retryDelayMs!, 30000);
        console.log(`Redis: Retrying connection in ${delay}ms (attempt ${times})`);
        return delay;
      },
      lazyConnect: true,
    });
  }

  redisClient.on('connect', () => {
    console.log('Redis: Connected');
    isConnected = true;
  });

  redisClient.on('ready', () => {
    console.log('Redis: Ready to accept commands');
  });

  redisClient.on('error', (err) => {
    console.error('Redis: Connection error:', err.message);
    isConnected = false;
  });

  redisClient.on('close', () => {
    console.log('Redis: Connection closed');
    isConnected = false;
  });

  redisClient.on('reconnecting', () => {
    console.log('Redis: Reconnecting...');
  });

  // Connect lazily
  redisClient.connect().catch((err) => {
    console.error('Redis: Initial connection failed:', err.message);
    isConnected = false;
  });

  return redisClient;
}

export function isRedisConnected(): boolean {
  return isConnected && redisClient !== null;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
    console.log('Redis: Connection closed gracefully');
  }
}

// Health check for Redis
export async function checkRedisHealth(): Promise<{
  connected: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const client = getRedisClient();

  if (!client) {
    return { connected: false, error: 'Redis not configured' };
  }

  try {
    const startTime = Date.now();
    await client.ping();
    const latencyMs = Date.now() - startTime;

    return { connected: true, latencyMs };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
