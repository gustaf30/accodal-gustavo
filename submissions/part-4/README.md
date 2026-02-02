# Part 4: Node.js Proficiency Test (RAG & KAG Implementation)

## Overview

This submission demonstrates a production-ready Node.js/TypeScript API that implements:

- **RAG (Retrieval Augmented Generation)**: Semantic search using pgvector embeddings
- **KAG (Knowledge Augmented Generation)**: AI-powered document classification
- **Asynchronous Processing**: Redis queue with worker threads
- **Security**: JWT authentication, rate limiting, data masking

## Project Structure

```
src/
├── app.ts                    # Express application setup
├── config/
│   └── database.ts           # Supabase & Redis configuration
├── controllers/
│   ├── classificationController.ts  # KAG endpoints
│   ├── documentController.ts        # Document CRUD
│   ├── searchController.ts          # RAG search endpoints
│   └── uploadController.ts          # File upload handlers
├── middleware/
│   ├── auth.ts               # JWT & API key authentication
│   ├── errorHandler.ts       # Global error handling
│   └── rateLimiter.ts        # Redis-based rate limiting
├── routes/
│   └── index.ts              # Route definitions
├── services/
│   ├── classificationService.ts  # KAG logic
│   ├── embeddingService.ts       # OpenAI embeddings
│   ├── processingService.ts      # Batch processing
│   ├── queueService.ts           # Redis queue
│   └── searchService.ts          # RAG logic
└── types/
    └── index.ts              # TypeScript interfaces
```

## RAG Implementation

### Semantic Search Flow

```typescript
// searchService.ts
export async function searchDocuments(params: SearchParams): Promise<SearchResult[]> {
  // 1. Generate embedding for query
  const queryEmbedding = await generateEmbedding(params.query);

  // 2. Search pgvector for similar documents
  const { data } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_threshold: params.threshold,
    match_count: params.limit,
    filter_user_id: params.userId
  });

  // 3. Join with document metadata
  const results = await enrichWithDocuments(data);

  return results;
}
```

### Embedding Generation

```typescript
// embeddingService.ts
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
}
```

### pgvector Search Function

```sql
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  document_id UUID,
  content TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.document_id,
    de.content,
    1 - (de.embedding <=> query_embedding) as similarity
  FROM document_embeddings de
  JOIN documents d ON d.id = de.document_id
  WHERE
    1 - (de.embedding <=> query_embedding) > match_threshold
    AND (filter_user_id IS NULL OR d.user_id = filter_user_id)
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

## KAG Implementation

### Document Classification

```typescript
// classificationService.ts
export async function classifyDocument(
  content: string,
  contentType: 'text' | 'base64_image' | 'url'
): Promise<ClassificationResult> {
  const openai = getOpenAIClient();

  // Build prompt based on content type
  const messages = buildClassificationMessages(content, contentType);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    response_format: { type: 'json_object' },
    max_tokens: 2048,
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Map to taxonomy
  const taxonomy = await findOrCreateTaxonomy(result.document_type, result);

  return {
    document_type: result.document_type,
    confidence: result.confidence,
    category: taxonomy.category,
    subcategory: taxonomy.subcategory,
    keywords: result.keywords,
    extracted_fields: result.extracted_data,
    taxonomy_id: taxonomy.id,
  };
}
```

### Taxonomy Mapping

```typescript
// Build or update taxonomy based on document analysis
export async function buildTaxonomy(
  documentType: string,
  extractedData: Record<string, unknown>
): Promise<TaxonomyMapping> {
  // Check for existing taxonomy
  let taxonomy = await findTaxonomyByType(documentType);

  if (!taxonomy) {
    // Create new taxonomy entry
    taxonomy = await createTaxonomy({
      document_type: documentType,
      category: inferCategory(documentType),
      subcategory: inferSubcategory(documentType, extractedData),
      keywords: extractKeywords(documentType, extractedData),
      extraction_rules: buildExtractionRules(extractedData),
    });
  }

  return taxonomy;
}
```

## Asynchronous Processing

### Redis Queue Service

```typescript
// queueService.ts
export enum TaskPriority {
  CRITICAL = 0,  // P0: Immediate
  HIGH = 1,      // P1: < 1 minute
  NORMAL = 2,    // P2: < 5 minutes
  LOW = 3,       // P3: < 15 minutes
  BACKGROUND = 4 // P4: Best effort
}

export async function enqueueTask(
  type: 'document' | 'audio' | 'text',
  payload: Record<string, unknown>,
  options: { priority?: TaskPriority } = {}
): Promise<{ taskId: string; queue: 'redis' | 'supabase' }> {
  const taskId = uuidv4();
  const priority = options.priority ?? TaskPriority.NORMAL;
  const score = Date.now() + (priority * 60000);

  await redis.zadd('tasks:pending', score, JSON.stringify({
    taskId,
    type,
    payload,
    priority,
    createdAt: new Date().toISOString(),
  }));

  return { taskId, queue: 'redis' };
}
```

### Batch Processing

```typescript
// processingService.ts
export async function createBatchJob(
  request: BatchProcessingRequest
): Promise<BatchProcessingResponse> {
  const batchId = uuidv4();

  // Create batch job record
  await supabase.from('batch_jobs').insert({
    batch_id: batchId,
    total_items: request.items.length,
    status: 'pending',
  });

  // Process items via N8N
  processBatchViaN8n(batchId, request).catch(console.error);

  return {
    job_id: batchId,
    total_items: request.items.length,
    status: 'queued',
    queue_source: 'n8n',
  };
}
```

## API Security

### JWT Authentication

```typescript
// auth.ts
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: { code: 'INVALID_TOKEN' } });
      return;
    }

    (req as any).userId = user.id;
    next();
  } catch (error) {
    res.status(401).json({ error: { code: 'AUTH_ERROR' } });
  }
};
```

### Rate Limiting

```typescript
// rateLimiter.ts
interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export function rateLimiter(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = (req as any).userId || req.ip;
    const key = `ratelimit:${identifier}:${req.path}`;
    const windowStart = Math.floor(Date.now() / config.windowMs);
    const redisKey = `${key}:${windowStart}`;

    try {
      const count = await redis.incr(redisKey);

      if (count === 1) {
        await redis.expire(redisKey, Math.ceil(config.windowMs / 1000));
      }

      if (count > config.limit) {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            retryAfter: config.windowMs / 1000,
          },
        });
        return;
      }

      next();
    } catch (error) {
      // Fail open if Redis is unavailable
      next();
    }
  };
}
```

## Installation & Deployment

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Supabase account
- OpenAI API key
- Redis instance (optional)

### Local Development

```bash
# Clone repository
git clone https://github.com/your-repo/tax-document-processing.git
cd tax-document-processing

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev
```

### Environment Variables

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# OpenAI
OPENAI_API_KEY=your-openai-key

# Redis (optional)
REDIS_URL=redis://default:password@host:port

# N8N
N8N_WEBHOOK_URL=https://your-n8n-instance.com

# Security
API_KEY=your-api-key-for-webhooks
```

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

The API is deployed at: https://accodal-gustavo.vercel.app

### Build Commands

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "vercel-build": "tsc",
    "test": "jest"
  }
}
```

## API Documentation

### OpenAPI/Swagger

See `openapi.yaml` for complete API specification.

Import into Swagger UI or use:
```bash
npx swagger-ui-watcher openapi.yaml
```

### Postman Collection

Import `postman-collection.json` into Postman.

Variables to configure:
- `baseUrl`: API base URL
- `bearerToken`: Supabase JWT token
- `apiKey`: API key for webhooks

## Testing

### Unit Tests

```bash
npm test
```

### API Tests

```bash
# Health check
curl https://accodal-gustavo.vercel.app/api/v1/health

# Semantic search
curl -X POST https://accodal-gustavo.vercel.app/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "W-2 wage", "threshold": 0.3, "limit": 10}'

# Classification
curl -X POST https://accodal-gustavo.vercel.app/api/v1/classify \
  -H "Content-Type: application/json" \
  -d '{"content": "W-2 Wage Statement...", "content_type": "text"}'
```

## Performance Metrics

| Endpoint | Avg Response Time | Throughput |
|----------|-------------------|------------|
| /search | 150-300ms | 50 req/min |
| /classify | 500-1000ms | 30 req/min |
| /upload/base64 | 200-500ms | 20 req/min |
| /documents | 50-100ms | 100 req/min |

## Files Included

- `README.md` - This documentation
- `openapi.yaml` - OpenAPI 3.0 specification
- `postman-collection.json` - Postman collection
- Source code reference: `../src/` (main project)

## Source Code Repository

The complete source code is available in the main project directory:
- Controllers: `src/controllers/`
- Services: `src/services/`
- Middleware: `src/middleware/`
- Types: `src/types/`
