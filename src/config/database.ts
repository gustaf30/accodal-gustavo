import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig } from '../types';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

export function getConfig(): AppConfig {
  const jwtSecret = process.env.JWT_SECRET;

  // JWT secret is required for authentication
  if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET environment variable - required for authentication');
  }

  const config: AppConfig = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    redisUrl: process.env.REDIS_URL,
    jwtSecret,
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL,
    validApiKeys: process.env.VALID_API_KEYS?.split(',').filter(k => k.trim()) || [],
    rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS || '100', 10),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
  };

  // Validate required config
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Missing required Supabase configuration');
  }

  if (!config.openaiApiKey) {
    throw new Error('Missing OpenAI API key');
  }

  return config;
}

export async function testConnection(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('documents').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
