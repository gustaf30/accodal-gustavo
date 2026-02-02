# Tax Document Processing System

A comprehensive tax document processing system built with N8N, Supabase, OpenAI, Redis, and Node.js — designed to automate the extraction, classification, and retrieval of tax-related documents, audio recordings, and text data.

## Live Demo

- **API**: https://accodal-gustavo.vercel.app/api/v1
- **WeWeb Portal**: https://c13915f5-e1e8-42de-89a2-a7fc500781d1.weweb-preview.io/register

---

## Features

| Feature | Description |
|---------|-------------|
| **Document OCR** | Extract text from W-2, 1099, invoices using GPT-4 Vision |
| **Audio Transcription** | Convert recordings to text with OpenAI Whisper |
| **AI Classification** | Automatic document type detection and categorization |
| **RAG Search** | Semantic search using pgvector embeddings |
| **Batch Processing** | Process 50+ documents in parallel |
| **Priority Queue** | Redis-based queue with P0-P4 priority levels |
| **Error Handling** | Dead Letter Queue with exponential backoff |
| **Client Portal** | WeWeb-based interface for end users |

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  WeWeb Portal   │────▶│   Node.js API   │────▶│    Supabase     │
│  (Client UI)    │     │   (Vercel)      │     │   PostgreSQL    │
└─────────────────┘     └────────┬────────┘     │   + pgvector    │
                                 │              └─────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
             ┌─────────────┐          ┌─────────────┐
             │    Redis    │          │     N8N     │
             │   Queue     │◀────────▶│  Workflows  │
             │  (Priority) │          │  (Workers)  │
             └─────────────┘          └──────┬──────┘
                                             │
                                             ▼
                                      ┌─────────────┐
                                      │   OpenAI    │
                                      │ GPT-4/Whisper│
                                      └─────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | WeWeb (No-code) |
| API | Node.js, Express, TypeScript |
| Database | Supabase (PostgreSQL + pgvector) |
| Queue | Redis Cloud |
| Workflows | N8N (Self-hosted) |
| AI/ML | OpenAI GPT-4 Vision, Whisper, Embeddings |
| Deployment | Vercel (Serverless) |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Supabase account
- OpenAI API key
- Redis instance (optional)
- N8N instance

### Installation

```bash
# Clone repository
git clone https://github.com/gustaf30/accodal-gustavo.git
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
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-key
SUPABASE_ANON_KEY=your-anon-key
OPENAI_API_KEY=your-openai-key
REDIS_URL=redis://user:pass@host:port
N8N_WEBHOOK_URL=https://your-n8n.com
```

---

## API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/search` | Semantic search (RAG) |
| POST | `/classify` | Document classification (KAG) |
| POST | `/upload/base64` | Upload via base64 |
| GET | `/documents` | List documents |
| GET | `/documents/:id` | Get document details |
| POST | `/batch/process` | Batch processing |
| GET | `/stats` | Processing statistics |

### Example: Semantic Search

```bash
curl -X POST https://accodal-gustavo.vercel.app/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "invoice total", "threshold": 0.3, "limit": 10}'
```

---

## Project Structure

```
├── src/
│   ├── controllers/      # Request handlers
│   ├── services/         # Business logic
│   ├── middleware/       # Auth, rate limiting
│   ├── routes/           # API routes
│   └── types/            # TypeScript interfaces
├── submissions/          # Assessment deliverables
│   ├── part-1/          # Core processing
│   ├── part-2/          # Error handling
│   ├── part-3/          # Distributed processing
│   ├── part-4/          # Node.js API
│   └── part-5/          # WeWeb portal
├── scripts/              # Utility scripts
├── docs/                 # Documentation
└── assets/               # Test files
```

---

## How AI Accelerated Development

> **Note**: This section explains how AI tools were leveraged to speed up the development process while maintaining code quality and architectural decisions.

### 1. N8N Workflow Design

AI assistance was particularly valuable for designing N8N workflows. Instead of manually configuring each node, I described the desired flow in natural language and used AI to:

- Generate initial JSON workflow structures
- Suggest optimal node configurations for OpenAI integration
- Debug complex expression syntax in N8N function nodes
- Create error handling patterns with proper retry logic

**Example prompt used:**
> "Create an N8N workflow that receives a webhook, downloads a file, sends it to GPT-4 Vision for OCR, extracts structured data, and saves to Supabase"

This saved approximately **3-4 hours** of manual workflow configuration and trial-and-error debugging.

### 2. Database Schema Design

For the PostgreSQL schema with pgvector, AI helped:

- Design the optimal table structure for document storage
- Create the `match_documents` function for vector similarity search
- Generate proper indexes (HNSW) for fast embedding queries
- Implement Row Level Security (RLS) policies

I provided the requirements and AI generated the SQL, which I then reviewed and adapted to our specific needs.

### 3. TypeScript API Development

The Node.js API development was accelerated by using AI for:

- **Boilerplate generation**: Controllers, services, and middleware structure
- **Type definitions**: Complex TypeScript interfaces for API responses
- **Error handling patterns**: Consistent error response format across endpoints
- **Rate limiting logic**: Redis-based sliding window implementation

I wrote the core business logic myself, but AI helped with repetitive patterns and best practices implementation.

### 4. OpenAI Integration

AI was instrumental in crafting effective prompts for:

- **Document OCR**: Optimizing GPT-4 Vision prompts for accurate text extraction
- **Classification**: Creating prompts that reliably identify document types (W-2, 1099, Invoice)
- **Entity extraction**: Extracting structured data like SSNs, amounts, dates

**Iterative prompt refinement example:**
```
Initial: "Extract text from this document"
Final: "You are a document OCR expert. Extract ALL text from this tax document.
        Classify as W-2, 1099-MISC, 1099-NEC, Invoice, or Other.
        Return JSON with raw_text, document_type, confidence, and extracted_data."
```

### 5. Documentation & Diagrams

AI significantly reduced documentation time:

- Generated ASCII workflow diagrams from descriptions
- Created OpenAPI/Swagger specifications from endpoint descriptions
- Wrote initial README drafts that I then customized
- Produced the WeWeb integration guide

### 6. Debugging & Troubleshooting

When issues arose, AI helped:

- Analyze error logs and suggest root causes
- Debug OpenAI connection timeouts in serverless environments
- Fix MIME type detection issues for base64 uploads
- Resolve pgvector query performance problems

### What AI Didn't Do

To be clear, AI was a tool, not a replacement for engineering decisions:

- **Architecture decisions** were made by me based on requirements
- **Security implementation** was carefully reviewed and tested manually
- **Business logic** for tax document processing was designed with domain knowledge
- **Testing and validation** was done manually with real documents
- **WeWeb UI/UX** was designed and built in the visual editor
- **Production debugging** required human judgment and system understanding

---

## Submission Contents

| Part | Description | Key Files |
|------|-------------|-----------|
| **Part 1** | Core document/audio/text processing | N8N workflows, Supabase schema |
| **Part 2** | Error handling & optimization | DLQ workflow, indexes, RLS |
| **Part 3** | Distributed AI workflows | Architecture diagrams, API docs |
| **Part 4** | Node.js API (RAG/KAG) | Source code, OpenAPI spec |
| **Part 5** | WeWeb client portal | Screenshots, integration guide |

---

## Security

- **Authentication**: Supabase Auth + JWT tokens
- **Authorization**: Row Level Security (RLS) on all tables
- **Rate Limiting**: Redis-based sliding window (50 req/min)
- **Data Masking**: SSNs and TINs automatically masked (***-**-1234)
- **API Keys**: Secure webhook authentication

### Time Spent

| 01/28 | 01/29 | 01/30 | 02/01 |
| 6 hours | 7 hours | 8 hours | 10 hours |
|------|-----------|---------|---------|
| **Total** | **31 hours** |
---

## License

MIT

---

## Author

Gustavo Ferraz

Built with Node.js, N8N, Supabase, OpenAI, and WeWeb.
