# Tax Document Processing System - Architecture Diagrams

## 1. Expected Architecture (From Description)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT PORTAL (WeWeb)                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │   Login     │  │  Dashboard  │  │   Upload    │  │  Messages   │                 │
│  │  (Auth)     │  │  (Status)   │  │  (Files)    │  │  (Support)  │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘                 │
└──────────────────────────────────────┬──────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              NODE.JS EXPRESS API                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │  /upload    │  │  /search    │  │  /classify  │  │  /batch     │                 │
│  │  (Files)    │  │   (RAG)     │  │   (KAG)     │  │ (Processing)│                 │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                                  │
│  │  JWT Auth   │  │Rate Limiter │  │Error Handler│                                  │
│  └─────────────┘  └─────────────┘  └─────────────┘                                  │
└──────────────────────────────────────┬──────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
┌───────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────────────┐
│   SUPABASE            │  │   MESSAGE QUEUE     │  │        N8N WORKFLOWS            │
│   ┌───────────────┐   │  │  (Redis/RabbitMQ)   │  │                                 │
│   │  PostgreSQL   │   │  │                     │  │  ┌─────────────────────────┐    │
│   │  + pgvector   │   │  │  ┌─────────────┐    │  │  │   MASTER ORCHESTRATOR   │    │
│   └───────────────┘   │  │  │ Task Queue  │    │  │  │   - Task Management     │    │
│   ┌───────────────┐   │  │  │ Priority    │    │  │  │   - Priority Queue      │    │
│   │   Storage     │   │  │  │ P0-P4       │    │  │  │   - Error Handling      │    │
│   │  (Documents)  │   │  │  └─────────────┘    │  │  └───────────┬─────────────┘    │
│   └───────────────┘   │  │                     │  │              │                  │
│   ┌───────────────┐   │  └─────────────────────┘  │   ┌─────────┴─────────┐        │
│   │ Edge Functions│   │                           │   ▼                   ▼        │
│   │  (Validation) │   │                           │ ┌─────────┐    ┌─────────┐     │
│   └───────────────┘   │                           │ │Document │    │  Audio  │     │
│   ┌───────────────┐   │                           │ │ Worker  │    │ Worker  │     │
│   │     Auth      │   │                           │ │ - OCR   │    │-Whisper │     │
│   │   (Supabase)  │   │                           │ │ - AI    │    │ - NLP   │     │
│   └───────────────┘   │                           │ └─────────┘    └─────────┘     │
└───────────────────────┘                           │       │              │         │
                                                    │   ┌───┴──────────────┴───┐     │
                                                    │   ▼                      ▼     │
                                                    │ ┌─────────┐    ┌─────────┐     │
                                                    │ │  Text   │    │Onboard  │     │
                                                    │ │ Worker  │    │ Worker  │     │
                                                    │ │ - NLP   │    │-Profiles│     │
                                                    │ │-Entities│    │-Packages│     │
                                                    │ └─────────┘    └─────────┘     │
                                                    │                                 │
                                                    │ ┌─────────────────────────┐    │
                                                    │ │   MONITORING DASHBOARD   │    │
                                                    │ │   - Success/Failure      │    │
                                                    │ │   - Processing Time      │    │
                                                    │ │   - Queue Length         │    │
                                                    │ │   - Anomaly Detection    │    │
                                                    │ └─────────────────────────┘    │
                                                    │                                 │
                                                    │ ┌─────────────────────────┐    │
                                                    │ │   QUALITY CONTROL        │    │
                                                    │ │   - Syntax Validation    │    │
                                                    │ │   - Semantic Validation  │    │
                                                    │ │   - Feedback System      │    │
                                                    │ └─────────────────────────┘    │
                                                    │                                 │
                                                    │ ┌─────────────────────────┐    │
                                                    │ │   ERROR HANDLING         │    │
                                                    │ │   - Dead Letter Queue    │    │
                                                    │ │   - Exponential Backoff  │    │
                                                    │ │   - Email/Slack Alerts   │    │
                                                    │ └─────────────────────────┘    │
                                                    └─────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL AI SERVICES                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │   OpenAI    │  │   Whisper   │  │  Tesseract  │  │   Cohere    │                 │
│  │  GPT-4o     │  │   (STT)     │  │   (OCR)     │  │   (NLP)     │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Expected Data Flow:
1. **Client** uploads document/audio via WeWeb portal
2. **API** validates, stores in Supabase Storage
3. **Message Queue** receives task with priority
4. **N8N Orchestrator** routes to appropriate worker
5. **Worker** processes (OCR/Whisper/NLP)
6. **Worker** generates embeddings for RAG
7. **Result** stored in Supabase (documents + embeddings)
8. **Client** queries via semantic search

---

## 2. Implemented Architecture (Current State)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (WeWeb / Postman)                                │
│                         [Not fully implemented - API ready]                          │
└──────────────────────────────────────┬──────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         NODE.JS EXPRESS API (TypeScript)                             │
│                              Deployed on Vercel                                      │
│                                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                              ROUTES                                            │  │
│  │  POST /upload          - File upload → Storage → N8N                          │  │
│  │  POST /upload/base64   - Base64 upload → Storage → N8N                        │  │
│  │  POST /process         - URL-based processing → N8N                           │  │
│  │  POST /batch/process   - Batch processing → N8N                               │  │
│  │  GET  /batch/jobs/:id  - Job status from Supabase                             │  │
│  │  POST /search          - Semantic search (RAG) via pgvector                   │  │
│  │  POST /classify        - Classification request → N8N                         │  │
│  │  POST /taxonomy/build  - Build taxonomy metadata                              │  │
│  │  GET  /documents       - List/query documents                                 │  │
│  │  GET  /audio           - List audio transcriptions                            │  │
│  │  GET  /text            - List text extractions                                │  │
│  │  GET  /stats           - Processing statistics                                │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                      │
│  │   JWT Auth      │  │  API Key Auth   │  │  Rate Limiter   │                      │
│  │  (Supabase)     │  │  (X-API-Key)    │  │  (DB-backed)    │                      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                      │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐    │
│  │                           SERVICES                                           │    │
│  │  embeddingService.ts  - Generate query embeddings (search only)             │    │
│  │  searchService.ts     - Semantic search via pgvector                        │    │
│  │  processingService.ts - Batch job management (DB-backed)                    │    │
│  │  classificationService.ts - Taxonomy building only                          │    │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────┬──────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
                    ▼                                     ▼
┌───────────────────────────────────┐    ┌────────────────────────────────────────────┐
│        SUPABASE                   │    │              N8N WORKFLOWS                  │
│                                   │    │                                             │
│  ┌─────────────────────────┐      │    │  ┌─────────────────────────────────────┐   │
│  │     PostgreSQL          │      │    │  │       MASTER ORCHESTRATOR           │   │
│  │                         │      │    │  │  POST /webhook/orchestrate          │   │
│  │  - documents            │      │    │  │                                     │   │
│  │  - audio_transcriptions │      │    │  │  • Receives task from API           │   │
│  │  - text_extractions     │      │    │  │  • Inserts to task_queue            │   │
│  │  - document_embeddings  │◄─────┼────┼──│  • Returns task_id immediately      │   │
│  │    (pgvector 1536d)     │      │    │  │                                     │   │
│  │  - task_queue           │      │    │  │  • Polls task_queue (1 min)         │   │
│  │  - batch_jobs           │      │    │  │  • Claims pending tasks             │   │
│  │  - batch_items          │      │    │  │  • Routes to appropriate worker     │   │
│  │  - dead_letter_queue    │      │    │  └──────────────┬──────────────────────┘   │
│  │  - worker_metrics       │      │    │                 │                          │
│  │  - rate_limit_tracking  │      │    │      ┌──────────┼──────────┐               │
│  │  - audit_log            │      │    │      ▼          ▼          ▼               │
│  │  - taxonomy             │      │    │  ┌────────┐ ┌────────┐ ┌────────┐          │
│  └─────────────────────────┘      │    │  │Document│ │ Audio  │ │ Text   │          │
│                                   │    │  │ Worker │ │ Worker │ │ Worker │          │
│  ┌─────────────────────────┐      │    │  └───┬────┘ └───┬────┘ └───┬────┘          │
│  │     Storage             │      │    │      │          │          │               │
│  │  - documents bucket     │      │    │      ▼          ▼          ▼               │
│  │  - audio bucket         │      │    │  ┌─────────────────────────────────────┐   │
│  └─────────────────────────┘      │    │  │         WORKER FLOW                 │   │
│                                   │    │  │                                     │   │
│  ┌─────────────────────────┐      │    │  │  1. Check Rate Limit (Supabase)     │   │
│  │     RPC Functions       │      │    │  │  2. Download/Decode File            │   │
│  │  - search_documents_    │      │    │  │  3. Call OpenAI GPT-4o Vision       │   │
│  │    by_similarity        │      │    │  │     (OCR + Classification)          │   │
│  │  - check_rate_limit     │      │    │  │  4. Mask Sensitive Data             │   │
│  │  - check_rate_limit_    │      │    │  │     (SSN, EIN, Account Numbers)     │   │
│  │    sliding              │      │    │  │  5. Store Document in Supabase      │   │
│  │  - get_dlq_items_       │      │    │  │  6. Generate Embedding (OpenAI)     │   │
│  │    for_retry            │      │    │  │  7. Store Embedding in pgvector     │   │
│  │  - auto_classify_       │      │    │  │  8. Log Metrics                     │   │
│  │    document             │      │    │  │  9. On Error → DLQ + Email Alert    │   │
│  └─────────────────────────┘      │    │  └─────────────────────────────────────┘   │
│                                   │    │                                             │
│  ┌─────────────────────────┐      │    │  ┌─────────────────────────────────────┐   │
│  │    Row Level Security   │      │    │  │      SUPPORT WORKFLOWS              │   │
│  │  - Users see own data   │      │    │  │                                     │   │
│  │  - Service role bypass  │      │    │  │  • DLQ Handler (every 5 min)        │   │
│  └─────────────────────────┘      │    │  │    - Retry failed tasks             │   │
└───────────────────────────────────┘    │  │    - Exponential backoff            │   │
                                         │  │    - Mark abandoned after max       │   │
                                         │  │                                     │   │
                                         │  │  • Batch Processor                  │   │
                                         │  │    - Process multiple items         │   │
                                         │  │    - Track in batch_jobs table      │   │
                                         │  │                                     │   │
                                         │  │  • Quality Control                  │   │
                                         │  │    - Confidence validation          │   │
                                         │  │    - Flag low confidence docs       │   │
                                         │  │                                     │   │
                                         │  │  • Data Aggregation                 │   │
                                         │  │    - Merge parallel results         │   │
                                         │  │    - Cross-validation               │   │
                                         │  │                                     │   │
                                         │  │  • Performance Dashboard            │   │
                                         │  │    - Metrics every 15 min           │   │
                                         │  │    - Health status alerts           │   │
                                         │  │                                     │   │
                                         │  │  • Error Notifications              │   │
                                         │  │    - Email alerts for failures      │   │
                                         │  └─────────────────────────────────────┘   │
                                         │                                             │
                                         │  ┌─────────────────────────────────────┐   │
                                         │  │      ADDITIONAL WORKERS             │   │
                                         │  │  • Onboarding Worker                │   │
                                         │  │  • Communication Worker             │   │
                                         │  └─────────────────────────────────────┘   │
                                         └─────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐    │
│  │                            OpenAI API                                        │    │
│  │  • GPT-4o Vision  - OCR + Document Classification (in N8N)                  │    │
│  │  • Whisper        - Audio Transcription (in N8N)                            │    │
│  │  • text-embedding-3-small - Embeddings for RAG (in N8N + API for search)    │    │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Implemented Data Flow:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          DOCUMENT PROCESSING FLOW                                    │
│                                                                                      │
│  Client                API                 N8N                  Supabase             │
│    │                    │                   │                      │                │
│    │  POST /upload      │                   │                      │                │
│    │  (file/base64)     │                   │                      │                │
│    ├───────────────────►│                   │                      │                │
│    │                    │  Store file       │                      │                │
│    │                    ├──────────────────────────────────────────►│ Storage       │
│    │                    │                   │                      │                │
│    │                    │  POST /webhook/   │                      │                │
│    │                    │  orchestrate      │                      │                │
│    │                    ├──────────────────►│                      │                │
│    │                    │                   │  Insert task_queue   │                │
│    │                    │                   ├─────────────────────►│                │
│    │                    │  { task_id }      │                      │                │
│    │                    │◄──────────────────┤                      │                │
│    │  { job_id, status: 'queued' }         │                      │                │
│    │◄───────────────────┤                   │                      │                │
│    │                    │                   │                      │                │
│    │                    │     [Poll every 1 min]                   │                │
│    │                    │                   │  Fetch pending       │                │
│    │                    │                   ├─────────────────────►│                │
│    │                    │                   │  Claim task          │                │
│    │                    │                   ├─────────────────────►│                │
│    │                    │                   │                      │                │
│    │                    │                   │  [Document Worker]   │                │
│    │                    │                   │  Download file       │                │
│    │                    │                   ├─────────────────────►│ Storage       │
│    │                    │                   │                      │                │
│    │                    │                   │  GPT-4o Vision       │                │
│    │                    │                   ├─────────────────────►│ OpenAI        │
│    │                    │                   │  (OCR + Classify)    │                │
│    │                    │                   │◄─────────────────────┤                │
│    │                    │                   │                      │                │
│    │                    │                   │  Mask sensitive data │                │
│    │                    │                   │  (SSN, EIN)          │                │
│    │                    │                   │                      │                │
│    │                    │                   │  Store document      │                │
│    │                    │                   ├─────────────────────►│ documents     │
│    │                    │                   │                      │                │
│    │                    │                   │  Generate embedding  │                │
│    │                    │                   ├─────────────────────►│ OpenAI        │
│    │                    │                   │◄─────────────────────┤                │
│    │                    │                   │                      │                │
│    │                    │                   │  Store embedding     │                │
│    │                    │                   ├─────────────────────►│ embeddings    │
│    │                    │                   │                      │                │
│    │                    │                   │  Update task_queue   │                │
│    │                    │                   ├─────────────────────►│ (completed)   │
│    │                    │                   │                      │                │
│    │  GET /documents/:id│                   │                      │                │
│    ├───────────────────►│                   │                      │                │
│    │                    │  Query            │                      │                │
│    │                    ├──────────────────────────────────────────►│                │
│    │  { document data } │◄──────────────────────────────────────────┤                │
│    │◄───────────────────┤                   │                      │                │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          SEMANTIC SEARCH FLOW (RAG)                                  │
│                                                                                      │
│  Client                API                                       Supabase            │
│    │                    │                                           │               │
│    │  POST /search      │                                           │               │
│    │  { query: "..." }  │                                           │               │
│    ├───────────────────►│                                           │               │
│    │                    │  Generate embedding (OpenAI)              │               │
│    │                    │  text-embedding-3-small                   │               │
│    │                    │                                           │               │
│    │                    │  RPC: search_documents_by_similarity      │               │
│    │                    │  (vector similarity search)               │               │
│    │                    ├──────────────────────────────────────────►│               │
│    │                    │                                           │               │
│    │                    │  Results with similarity scores           │               │
│    │                    │◄──────────────────────────────────────────┤               │
│    │                    │                                           │               │
│    │  { results: [...], metadata: {...} }                          │               │
│    │◄───────────────────┤                                           │               │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Comparison: Expected vs Implemented

| Feature | Expected | Implemented | Status |
|---------|----------|-------------|--------|
| **Document Processing** | N8N + OCR (Tesseract/AWS) | N8N + OpenAI GPT-4o Vision | ✅ Better |
| **Audio Processing** | Whisper AI | OpenAI Whisper in N8N | ✅ Complete |
| **Text Processing** | NLP extraction | OpenAI in N8N | ✅ Complete |
| **Message Queue** | Redis/RabbitMQ | Supabase task_queue table | ✅ Alternative |
| **Dead Letter Queue** | N8N DLQ | Supabase DLQ + N8N handler | ✅ Complete |
| **RAG (Semantic Search)** | pgvector | pgvector in Supabase | ✅ Complete |
| **KAG (Classification)** | AI classification | GPT-4o + taxonomy tables | ✅ Complete |
| **Batch Processing** | 50+ parallel | Supabase batch_jobs | ✅ Complete |
| **Rate Limiting** | API rate limiting | DB-backed rate limiting | ✅ Complete |
| **Data Masking** | SSN/Tax ID masking | SSN, EIN, Account masking | ✅ Complete |
| **Error Handling** | Retry + alerts | DLQ + Email + Exponential backoff | ✅ Complete |
| **Authentication** | JWT + API keys | JWT (Supabase) + API keys | ✅ Complete |
| **Monitoring Dashboard** | Success/failure rates | Performance dashboard workflow | ✅ Complete |
| **Quality Control** | Multi-level validation | Quality control workflow | ✅ Complete |
| **Client Portal (WeWeb)** | Full portal | API ready, portal pending | ⏳ Pending |
| **Serverless Deploy** | Vercel/AWS Lambda | Vercel | ✅ Complete |

### Key Architecture Decisions:

1. **API as Gateway**: The Express API acts as a thin gateway that:
   - Handles authentication and rate limiting
   - Stores files in Supabase Storage
   - Delegates all processing to N8N workflows
   - Provides semantic search (only place where API calls OpenAI for embeddings)

2. **N8N as Processing Engine**: All heavy processing happens in N8N:
   - OCR via GPT-4o Vision
   - Audio transcription via Whisper
   - Text extraction via GPT-4o
   - Embedding generation for documents
   - Sensitive data masking

3. **Supabase as Central Database**: Everything stored in Supabase:
   - Documents, audio, text (with embeddings)
   - Task queue (instead of Redis)
   - Dead letter queue
   - Metrics and audit logs
   - Rate limiting tracking

4. **No External Message Queue**: Used Supabase tables instead of Redis/RabbitMQ:
   - `task_queue` - for pending/processing tasks
   - `batch_jobs` / `batch_items` - for batch processing
   - Simpler architecture, fewer moving parts
