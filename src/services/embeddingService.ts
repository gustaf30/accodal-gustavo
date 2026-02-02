/**
 * Embedding Service
 *
 * NOTE: Document embedding generation is now handled by N8N workflows.
 * N8N document-worker generates embeddings directly via OpenAI API.
 *
 * This service only provides embedding generation for SEARCH QUERIES.
 * When a user searches, we need to generate an embedding for their query text
 * to compare against stored document embeddings.
 */

import OpenAI from 'openai';
import { getConfig } from '../config/database';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const config = getConfig();
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
      timeout: 120000, // 2 minutes for serverless cold starts
      maxRetries: 5,
      fetch: globalThis.fetch, // Use native fetch for better compatibility
    });
  }
  return openaiClient;
}

/**
 * Generate embedding for a search query text
 * Used by searchService to enable semantic search
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
}
