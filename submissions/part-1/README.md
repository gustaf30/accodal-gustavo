# Part 1: Core Document, Audio & Text Processing

## Overview

This submission implements a unified tax document processing system using N8N workflows and Supabase backend. The system handles:

- **Documents**: Tax forms (W-2, 1099), invoices, receipts via OCR
- **Audio**: Recorded conversations via Whisper AI transcription
- **Text**: Structured and unstructured data extraction via NLP

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Client Upload  │────▶│ Master Orchestrator│────▶│  Specialized    │
│  (WeWeb/API)    │     │  (N8N Webhook)    │     │  Workers        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                        ┌─────────────────────────────────┼────────────────┐
                        │                                 │                │
                        ▼                                 ▼                ▼
                ┌───────────────┐              ┌──────────────┐   ┌──────────────┐
                │ Document      │              │ Audio        │   │ Text         │
                │ Worker        │              │ Worker       │   │ Worker       │
                │ - OCR         │              │ - Whisper    │   │ - NLP        │
                │ - Classification│            │ - Entity     │   │ - Extraction │
                │ - Embedding   │              │   Extraction │   │ - Validation │
                └───────┬───────┘              └──────┬───────┘   └──────┬───────┘
                        │                             │                  │
                        └─────────────────────────────┼──────────────────┘
                                                      ▼
                                            ┌─────────────────┐
                                            │    Supabase     │
                                            │  - PostgreSQL   │
                                            │  - pgvector     │
                                            │  - Storage      │
                                            └─────────────────┘
```

## N8N Workflows

### 1. Master Orchestrator (`n8n-master-orchestrator.json`)

The central workflow that receives all incoming tasks and routes them to specialized workers.

**Webhook Endpoint**: `POST /webhook/orchestrate`

**Input Payload**:
```json
{
  "task_type": "document|audio|text",
  "priority": 2,
  "payload": {
    "filename": "w2.png",
    "file_url": "https://...",
    "mime_type": "image/png",
    "user_id": "uuid"
  }
}
```

### 2. Document Worker (`n8n-document-worker.json`)

Processes tax documents through:
1. File download from Supabase Storage
2. OCR extraction using OpenAI Vision (GPT-4o)
3. Document type classification (W-2, 1099, Invoice, etc.)
4. Structured data extraction
5. Embedding generation (text-embedding-3-small)
6. Storage in Supabase

**Supported Formats**: PDF, PNG, JPEG, TIFF

### 3. Audio Worker (`n8n-audio-worker.json`)

Processes audio recordings through:
1. File download
2. Transcription using OpenAI Whisper
3. Financial entity extraction (SSNs, amounts, dates)
4. Storage with extracted entities

**Supported Formats**: MP3, WAV, M4A, OGG

## Supabase Backend

### Database Schema

```sql
-- Documents table
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  file_url TEXT,
  file_size INTEGER,
  mime_type TEXT,
  type TEXT, -- W-2, 1099-MISC, Invoice, etc.
  raw_text TEXT,
  extracted_data JSONB DEFAULT '{}',
  ocr_confidence DECIMAL(3,2),
  classification_confidence DECIMAL(3,2),
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document embeddings for RAG
CREATE TABLE document_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  chunk_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audio transcriptions
CREATE TABLE audio_transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  file_url TEXT,
  transcribed_text TEXT,
  duration_seconds INTEGER,
  language TEXT DEFAULT 'en',
  extracted_entities JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Text extractions
CREATE TABLE text_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  source_type TEXT, -- email, form, contract
  raw_text TEXT,
  extracted_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Create similarity search function
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
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
  WHERE 1 - (de.embedding <=> query_embedding) > match_threshold
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/upload/base64 | Upload document via base64 |
| POST | /api/v1/upload/url | Process document from URL |
| POST | /api/v1/batch/process | Batch process multiple items |
| GET | /api/v1/documents | List all documents |
| GET | /api/v1/documents/:id | Get document details |
| POST | /api/v1/search | Semantic search (RAG) |
| GET | /api/v1/audio | List audio transcriptions |
| GET | /api/v1/text | List text extractions |

## Setup Instructions

### 1. N8N Configuration

1. Import the workflow JSON files into N8N
2. Configure credentials:
   - **OpenAI API**: Add your API key
   - **Supabase API**: Add URL and service role key
3. Update workflow IDs in Master Orchestrator
4. Activate all workflows

### 2. Supabase Configuration

1. Run the SQL schema in Supabase SQL Editor
2. Enable pgvector extension
3. Configure Storage bucket named `documents`
4. Set RLS policies as needed

### 3. Environment Variables

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# OpenAI
OPENAI_API_KEY=your-openai-key

# N8N
N8N_WEBHOOK_URL=https://your-n8n-instance.com
```

## Error Handling

- **Retry Logic**: Failed API requests retry up to 3 times
- **Error Logging**: Failed attempts logged to `error_notifications` table
- **Alerts**: Critical failures can trigger Slack/email notifications

## RAG Implementation

Document similarity search uses:
- **Embeddings**: OpenAI text-embedding-3-small (1536 dimensions)
- **Vector Store**: Supabase pgvector
- **Similarity**: Cosine similarity with configurable threshold

```javascript
// Example search query
const results = await supabase.rpc('match_documents', {
  query_embedding: embedding,
  match_threshold: 0.7,
  match_count: 10
});
```

## Challenges & Solutions

1. **OCR Accuracy**: Used GPT-4o Vision for superior text extraction vs traditional OCR
2. **Large Files**: Implemented chunking for documents exceeding context limits
3. **Entity Masking**: SSNs and TINs automatically masked for security
4. **MIME Type Detection**: Added robust detection for malformed base64 uploads

## AI Utilization

- **GPT-4o Vision**: Document OCR and classification
- **GPT-4o-mini**: Entity extraction from transcriptions
- **Whisper**: Audio transcription
- **text-embedding-3-small**: Semantic embeddings for RAG
