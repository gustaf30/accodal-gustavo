import OpenAI from 'openai';
import { getConfig } from '../config/database';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const config = getConfig();
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
      timeout: 30000,
      maxRetries: 3,
    });
  }
  return openaiClient;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const openai = getOpenAIClient();

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data.map((item) => item.embedding);
}

export function chunkText(
  text: string,
  maxChunkSize: number = MAX_CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChunkSize;

    // Try to break at sentence boundaries
    if (end < text.length) {
      const breakPoints = ['\n\n', '\n', '. ', '! ', '? ', '; '];
      for (const breakPoint of breakPoints) {
        const lastBreak = text.lastIndexOf(breakPoint, end);
        if (lastBreak > start + maxChunkSize / 2) {
          end = lastBreak + breakPoint.length;
          break;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    start = end - overlap;
    if (start < 0) start = 0;

    // Safety limit
    if (chunks.length > 100) break;
  }

  return chunks;
}

export async function generateChunkedEmbeddings(
  text: string,
  metadata: Record<string, unknown> = {}
): Promise<
  Array<{
    chunk_index: number;
    content: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }>
> {
  const chunks = chunkText(text);
  const embeddings = await generateEmbeddings(chunks);

  return chunks.map((chunk, index) => ({
    chunk_index: index,
    content: chunk,
    embedding: embeddings[index],
    metadata: {
      ...metadata,
      chunk_total: chunks.length,
      original_length: text.length,
    },
  }));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
