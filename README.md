# Tax Document Processing System

A comprehensive tax document processing system built with N8N, Supabase, OpenAI/Whisper, Redis, and a Node.js API for WeWeb integration.

## Features

- **Document Processing**: OCR and classification using GPT-4 Vision
- **Audio Transcription**: Speech-to-text using OpenAI Whisper
- **Text Extraction**: Email and text content analysis
- **RAG Search**: Semantic search using pgvector embeddings
- **KAG Classification**: AI-powered document categorization with taxonomy
- **Batch Processing**: Handle large volumes of documents
- **Error Handling**: Dead Letter Queue with exponential backoff
- **Monitoring**: Performance dashboard and alerts

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   WeWeb Client  │────▶│   Node.js API   │────▶│    Supabase     │
│     Portal      │     │   (Vercel)      │     │   (PostgreSQL)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        │
                        ┌─────────────────┐             │
                        │      N8N        │─────────────┘
                        │   Workflows     │
                        └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │    OpenAI       │
                        │  GPT-4/Whisper  │
                        └─────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Supabase account
- OpenAI API key

### 1. Clone and Install

```bash
cd accodal-gustavo
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Start Infrastructure

```bash
docker-compose up -d
```

### 4. Apply Database Schema

Run the SQL migration in Supabase Dashboard:
```
supabase/migrations/001_initial_schema.sql
```

### 5. Deploy Supabase Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login and link project
supabase login
supabase link --project-ref your-project-ref

# Deploy functions
supabase functions deploy validate-document
supabase functions deploy validate-audio
supabase functions deploy validate-text
supabase functions deploy store-embedding
```

### 6. Import N8N Workflows

1. Access N8N at http://localhost:5678
2. Import workflows from `n8n-workflows/` directory
3. Configure credentials (OpenAI, Supabase)

### 7. Start API Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## API Endpoints

### Search (RAG)

```bash
# Semantic search
POST /api/v1/search
{
  "query": "W-2 wage information",
  "threshold": 0.7,
  "limit": 10
}

# Find similar documents
GET /api/v1/documents/{id}/similar

# Check inconsistencies
GET /api/v1/documents/{id}/inconsistencies
```

### Classification (KAG)

```bash
# Classify document
POST /api/v1/classify
{
  "content": "base64-encoded-image",
  "content_type": "base64_image",
  "filename": "document.png"
}

# Batch classification
POST /api/v1/classify/batch
{
  "items": [...]
}
```

### Documents

```bash
# List documents
GET /api/v1/documents?type=W-2&status=completed

# Get document
GET /api/v1/documents/{id}

# Reprocess document
POST /api/v1/documents/{id}/reprocess

# Delete document
DELETE /api/v1/documents/{id}
```

### Batch Processing

```bash
# Create batch job
POST /api/v1/batch/process
{
  "items": [
    { "type": "document", "data": {...} },
    { "type": "audio", "data": {...} }
  ]
}

# Check job status
GET /api/v1/batch/jobs/{jobId}
```

## N8N Workflows

### Core Processing
- `document-processing.json` - Document OCR and classification
- `audio-processing.json` - Audio transcription
- `text-processing.json` - Email/text extraction

### Error Handling
- `dlq-handler.json` - Dead Letter Queue processing
- `error-notifications.json` - Alert routing

### Orchestration
- `master-orchestrator.json` - Task distribution
- `workers/document-worker.json` - Document processing worker
- `workers/audio-worker.json` - Audio processing worker
- `workers/text-worker.json` - Text processing worker
- `workers/onboarding-worker.json` - Client onboarding
- `workers/communication-worker.json` - Response generation

### Monitoring
- `monitoring/performance-dashboard.json` - Metrics collection

## Database Schema

### Core Tables
- `documents` - Processed tax documents
- `audio_transcriptions` - Audio transcriptions
- `text_extractions` - Email/text content
- `document_embeddings` - Vector embeddings for RAG

### System Tables
- `processing_logs` - Audit trail
- `dead_letter_queue` - Failed processing items
- `error_notifications` - Alert history
- `task_queue` - Orchestration queue
- `worker_metrics` - Performance metrics
- `audit_log` - Compliance logging

## Deployment

### Vercel Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add OPENAI_API_KEY
vercel env add JWT_SECRET
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `OPENAI_API_KEY` | OpenAI API key |
| `JWT_SECRET` | JWT signing secret |
| `VALID_API_KEYS` | Comma-separated API keys |
| `REDIS_URL` | Redis connection URL (optional) |

## WeWeb Integration

### Setup

1. Create WeWeb project
2. Add Supabase plugin
3. Configure authentication
4. Create pages:
   - `/login` - Authentication
   - `/dashboard` - Document overview
   - `/upload` - File upload
   - `/search` - RAG search interface

### API Integration

Use the REST API plugin to connect to endpoints:

```javascript
// Search documents
await $ww.http.post('https://your-api.vercel.app/api/v1/search', {
  query: searchQuery,
  user_id: currentUser.id
});

// Upload document
await $ww.http.post('https://your-api.vercel.app/api/v1/batch/process', {
  items: [{ type: 'document', data: fileData }],
  user_id: currentUser.id
});
```

## Security

- Row Level Security (RLS) enabled on all tables
- JWT authentication for API
- API key authentication for webhooks
- Sensitive data masking (SSN, Tax ID)
- Rate limiting on all endpoints
- Audit logging for compliance

## Monitoring

### Metrics Tracked
- Document processing success/failure rates
- Average processing time
- Queue lengths
- Worker performance
- Error rates by type

### Alerts
- Critical errors → Slack + Email
- Warnings → Slack
- Info → Database only

## Support

For issues and feature requests, please create a GitHub issue.

## License

MIT
