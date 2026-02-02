-- Part 2: Enhanced Database Schema with Indexes & Security
-- Tax Document Processing System

-- ============================================
-- Core Tables
-- ============================================

-- Documents table with optimized indexes
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  file_url TEXT,
  file_size INTEGER,
  mime_type TEXT,
  type TEXT, -- W-2, 1099-MISC, 1099-NEC, Invoice, etc.
  raw_text TEXT,
  extracted_data JSONB DEFAULT '{}',
  ocr_confidence DECIMAL(3,2),
  classification_confidence DECIMAL(3,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Taxonomy and classification
  taxonomy_id UUID,
  auto_classified BOOLEAN DEFAULT false,
  classification_source TEXT, -- 'ai', 'manual', 'rule'
  -- Additional metadata
  client_type TEXT,
  tax_year INTEGER,
  keywords TEXT[]
);

-- Performance indexes for documents
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_user_status ON documents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_processed_at ON documents(processed_at DESC) WHERE processed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_taxonomy ON documents(taxonomy_id) WHERE taxonomy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_extracted_data ON documents USING GIN (extracted_data jsonb_path_ops);

-- ============================================
-- Vector Embeddings for RAG
-- ============================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  chunk_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON document_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_embeddings_document ON document_embeddings(document_id);

-- ============================================
-- Audio Transcriptions
-- ============================================

CREATE TABLE IF NOT EXISTS audio_transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  file_url TEXT,
  transcribed_text TEXT,
  duration_seconds INTEGER,
  language TEXT DEFAULT 'en',
  extracted_entities JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audio_user_id ON audio_transcriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_audio_status ON audio_transcriptions(status);
CREATE INDEX IF NOT EXISTS idx_audio_created_at ON audio_transcriptions(created_at DESC);

-- ============================================
-- Text Extractions
-- ============================================

CREATE TABLE IF NOT EXISTS text_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  source_type TEXT, -- email, form, contract
  raw_text TEXT,
  extracted_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_text_user_id ON text_extractions(user_id);
CREATE INDEX IF NOT EXISTS idx_text_source_type ON text_extractions(source_type);

-- ============================================
-- Error Handling & DLQ
-- ============================================

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'failed' CHECK (status IN ('failed', 'retrying', 'resolved')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_queue(status);
CREATE INDEX IF NOT EXISTS idx_dlq_task_type ON dead_letter_queue(task_type);
CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON dead_letter_queue(created_at DESC);

CREATE TABLE IF NOT EXISTS error_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  details JSONB,
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_errors_severity ON error_notifications(severity);
CREATE INDEX IF NOT EXISTS idx_errors_acknowledged ON error_notifications(acknowledged);
CREATE INDEX IF NOT EXISTS idx_errors_created_at ON error_notifications(created_at DESC);

-- ============================================
-- Batch Processing
-- ============================================

CREATE TABLE IF NOT EXISTS batch_jobs (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  total_items INTEGER NOT NULL,
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_batch_user_id ON batch_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_status ON batch_jobs(status);

CREATE TABLE IF NOT EXISTS batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES batch_jobs(batch_id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_status ON batch_items(status);

-- ============================================
-- Taxonomy & Classification
-- ============================================

CREATE TABLE IF NOT EXISTS document_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  keywords TEXT[],
  extraction_rules JSONB DEFAULT '{}',
  parent_id UUID REFERENCES document_taxonomy(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_type ON document_taxonomy(document_type);
CREATE INDEX IF NOT EXISTS idx_taxonomy_category ON document_taxonomy(category);
CREATE INDEX IF NOT EXISTS idx_taxonomy_keywords ON document_taxonomy USING GIN (keywords);

-- ============================================
-- Rate Limiting Table
-- ============================================

CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL, -- user_id or IP
  endpoint TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(identifier, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- Auto-cleanup old rate limit entries
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Row Level Security (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;

-- Documents: Users can only see their own documents
CREATE POLICY documents_user_policy ON documents
  FOR ALL
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Audio: Users can only see their own transcriptions
CREATE POLICY audio_user_policy ON audio_transcriptions
  FOR ALL
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Text: Users can only see their own extractions
CREATE POLICY text_user_policy ON text_extractions
  FOR ALL
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Batch jobs: Users can only see their own jobs
CREATE POLICY batch_user_policy ON batch_jobs
  FOR ALL
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Service role bypass for N8N workers
CREATE POLICY service_role_documents ON documents
  FOR ALL
  TO service_role
  USING (true);

CREATE POLICY service_role_audio ON audio_transcriptions
  FOR ALL
  TO service_role
  USING (true);

CREATE POLICY service_role_embeddings ON document_embeddings
  FOR ALL
  TO service_role
  USING (true);

-- ============================================
-- Semantic Search Function
-- ============================================

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
SECURITY DEFINER
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

-- ============================================
-- Sensitive Data Masking Functions
-- ============================================

-- Mask SSN for display
CREATE OR REPLACE FUNCTION mask_ssn(ssn TEXT)
RETURNS TEXT AS $$
BEGIN
  IF ssn IS NULL OR LENGTH(ssn) < 4 THEN
    RETURN ssn;
  END IF;
  RETURN '***-**-' || RIGHT(ssn, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Mask EIN for display
CREATE OR REPLACE FUNCTION mask_ein(ein TEXT)
RETURNS TEXT AS $$
BEGIN
  IF ein IS NULL OR LENGTH(ein) < 4 THEN
    RETURN ein;
  END IF;
  RETURN '**-***' || RIGHT(ein, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- Updated At Trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Statistics Views
-- ============================================

CREATE OR REPLACE VIEW processing_stats AS
SELECT
  'documents' as entity_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'processing') as processing,
  COUNT(*) FILTER (WHERE status = 'pending') as pending
FROM documents
UNION ALL
SELECT
  'audio' as entity_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'processing') as processing,
  COUNT(*) FILTER (WHERE status = 'pending') as pending
FROM audio_transcriptions
UNION ALL
SELECT
  'dlq' as entity_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'resolved') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'retrying') as processing,
  0 as pending
FROM dead_letter_queue;
