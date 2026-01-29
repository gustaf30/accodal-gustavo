-- Tax Document Processing System - Initial Schema
-- Part 1: Core Tables and Extensions

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- CORE TABLES
-- ============================================

-- Documents table for storing processed tax documents
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_url TEXT,
    file_size INTEGER,
    mime_type TEXT,
    type TEXT NOT NULL CHECK (type IN ('W-2', '1099', '1099-MISC', '1099-INT', '1099-DIV', '1099-NEC', 'Invoice', 'Receipt', 'Bank Statement', 'Other')),
    extracted_data JSONB DEFAULT '{}',
    ocr_confidence DECIMAL(5,4),
    classification_confidence DECIMAL(5,4),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'needs_review')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audio transcriptions table
CREATE TABLE IF NOT EXISTS audio_transcriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_url TEXT,
    duration_seconds INTEGER,
    mime_type TEXT,
    transcription TEXT,
    extracted_entities JSONB DEFAULT '{}',
    confidence DECIMAL(5,4),
    language TEXT DEFAULT 'en',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Text extractions table for emails and other text content
CREATE TABLE IF NOT EXISTS text_extractions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('email', 'chat', 'form', 'api', 'manual')),
    source_identifier TEXT,
    subject TEXT,
    content TEXT NOT NULL,
    extracted_data JSONB DEFAULT '{}',
    entities JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Processing logs for audit trail
CREATE TABLE IF NOT EXISTS processing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_type TEXT NOT NULL CHECK (resource_type IN ('document', 'audio', 'text', 'embedding', 'workflow')),
    resource_id UUID NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'retrying')),
    details JSONB DEFAULT '{}',
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document embeddings for RAG
CREATE TABLE IF NOT EXISTS document_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PART 2: ERROR HANDLING & DLQ
-- ============================================

-- Dead Letter Queue for failed processing
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_type TEXT NOT NULL CHECK (resource_type IN ('document', 'audio', 'text')),
    resource_id UUID NOT NULL,
    payload JSONB NOT NULL,
    error_message TEXT,
    error_code TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    last_retry_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'abandoned')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Error notifications log
CREATE TABLE IF NOT EXISTS error_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_type TEXT NOT NULL,
    resource_id UUID,
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    notification_channels JSONB DEFAULT '[]',
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by UUID REFERENCES auth.users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PART 2: SECURITY & COMPLIANCE
-- ============================================

-- Audit log for compliance
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API rate limiting tracking
CREATE TABLE IF NOT EXISTS rate_limit_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(identifier, endpoint, window_start)
);

-- ============================================
-- PART 3: WORKFLOW ORCHESTRATION
-- ============================================

-- Task queue for orchestration
CREATE TABLE IF NOT EXISTS task_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_name TEXT NOT NULL,
    task_type TEXT NOT NULL,
    priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 0 AND 4),
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    worker_id TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    result JSONB,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow execution history
CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_name TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    input_data JSONB,
    output_data JSONB,
    metrics JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER
);

-- Worker performance metrics
CREATE TABLE IF NOT EXISTS worker_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_name TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    value DECIMAL(12,4) NOT NULL,
    tags JSONB DEFAULT '{}',
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Documents indexes
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_type ON documents(type);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX idx_documents_user_status ON documents(user_id, status);
CREATE INDEX idx_documents_type_status ON documents(type, status);

-- Audio transcriptions indexes
CREATE INDEX idx_audio_user_id ON audio_transcriptions(user_id);
CREATE INDEX idx_audio_status ON audio_transcriptions(status);
CREATE INDEX idx_audio_created_at ON audio_transcriptions(created_at DESC);

-- Text extractions indexes
CREATE INDEX idx_text_user_id ON text_extractions(user_id);
CREATE INDEX idx_text_source ON text_extractions(source);
CREATE INDEX idx_text_status ON text_extractions(status);
CREATE INDEX idx_text_created_at ON text_extractions(created_at DESC);

-- Processing logs indexes
CREATE INDEX idx_logs_resource ON processing_logs(resource_type, resource_id);
CREATE INDEX idx_logs_created_at ON processing_logs(created_at DESC);
CREATE INDEX idx_logs_status ON processing_logs(status);

-- Document embeddings indexes
CREATE INDEX idx_embeddings_document_id ON document_embeddings(document_id);
CREATE INDEX idx_embeddings_vector ON document_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- DLQ indexes
CREATE INDEX idx_dlq_status ON dead_letter_queue(status);
CREATE INDEX idx_dlq_next_retry ON dead_letter_queue(next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_dlq_resource ON dead_letter_queue(resource_type, resource_id);

-- Task queue indexes
CREATE INDEX idx_task_queue_status_priority ON task_queue(status, priority DESC);
CREATE INDEX idx_task_queue_workflow ON task_queue(workflow_name);
CREATE INDEX idx_task_queue_pending ON task_queue(priority DESC, created_at) WHERE status = 'pending';

-- Audit log indexes
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_created_at ON audit_log(created_at DESC);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function for similarity search
CREATE OR REPLACE FUNCTION search_documents_by_similarity(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10,
    filter_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    content TEXT,
    similarity FLOAT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        de.id,
        de.document_id,
        de.content,
        1 - (de.embedding <=> query_embedding) AS similarity,
        de.metadata
    FROM document_embeddings de
    JOIN documents d ON de.document_id = d.id
    WHERE
        1 - (de.embedding <=> query_embedding) > match_threshold
        AND (filter_user_id IS NULL OR d.user_id = filter_user_id)
    ORDER BY de.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate exponential backoff
CREATE OR REPLACE FUNCTION calculate_next_retry(retry_count INTEGER)
RETURNS TIMESTAMPTZ AS $$
BEGIN
    -- Exponential backoff: 1s, 2s, 4s, 8s, 16s, etc.
    RETURN NOW() + (POWER(2, retry_count) * INTERVAL '1 second');
END;
$$ LANGUAGE plpgsql;

-- Function to mask sensitive data (SSN, Tax ID)
CREATE OR REPLACE FUNCTION mask_sensitive_data(data TEXT, data_type TEXT)
RETURNS TEXT AS $$
BEGIN
    IF data_type = 'ssn' THEN
        -- Mask SSN: XXX-XX-1234
        RETURN 'XXX-XX-' || RIGHT(REGEXP_REPLACE(data, '[^0-9]', '', 'g'), 4);
    ELSIF data_type = 'tax_id' THEN
        -- Mask Tax ID: XX-XXX1234
        RETURN 'XX-XXX' || RIGHT(REGEXP_REPLACE(data, '[^0-9]', '', 'g'), 4);
    ELSE
        RETURN data;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to add audit log entry
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (user_id, action, resource_type, resource_id, old_values, new_values)
    VALUES (
        COALESCE(auth.uid(), NULL),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier TEXT,
    p_endpoint TEXT,
    p_limit INTEGER DEFAULT 100,
    p_window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
    v_count INTEGER;
    v_window_start TIMESTAMPTZ;
BEGIN
    v_window_start := date_trunc('minute', NOW());

    SELECT COALESCE(SUM(request_count), 0) INTO v_count
    FROM rate_limit_tracking
    WHERE identifier = p_identifier
        AND endpoint = p_endpoint
        AND window_start >= NOW() - (p_window_seconds * INTERVAL '1 second');

    IF v_count >= p_limit THEN
        RETURN FALSE;
    END IF;

    INSERT INTO rate_limit_tracking (identifier, endpoint, window_start, request_count)
    VALUES (p_identifier, p_endpoint, v_window_start, 1)
    ON CONFLICT (identifier, endpoint, window_start)
    DO UPDATE SET request_count = rate_limit_tracking.request_count + 1;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to process DLQ items
CREATE OR REPLACE FUNCTION get_dlq_items_for_retry(p_limit INTEGER DEFAULT 10)
RETURNS SETOF dead_letter_queue AS $$
BEGIN
    RETURN QUERY
    UPDATE dead_letter_queue
    SET status = 'processing',
        last_retry_at = NOW(),
        retry_count = retry_count + 1
    WHERE id IN (
        SELECT id FROM dead_letter_queue
        WHERE status = 'pending'
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
            AND retry_count < max_retries
        ORDER BY created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Updated_at triggers
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_audio_updated_at
    BEFORE UPDATE ON audio_transcriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_text_updated_at
    BEFORE UPDATE ON text_extractions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dlq_updated_at
    BEFORE UPDATE ON dead_letter_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_task_queue_updated_at
    BEFORE UPDATE ON task_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit triggers for sensitive tables
CREATE TRIGGER audit_documents
    AFTER INSERT OR UPDATE OR DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audio
    AFTER INSERT OR UPDATE OR DELETE ON audio_transcriptions
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_text
    AFTER INSERT OR UPDATE OR DELETE ON text_extractions
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all user-facing tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;

-- Documents policies
CREATE POLICY "Users can view their own documents"
    ON documents FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents"
    ON documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents"
    ON documents FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents"
    ON documents FOR DELETE
    USING (auth.uid() = user_id);

-- Service role bypass for backend operations
CREATE POLICY "Service role can access all documents"
    ON documents FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- Audio transcriptions policies
CREATE POLICY "Users can view their own audio"
    ON audio_transcriptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own audio"
    ON audio_transcriptions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own audio"
    ON audio_transcriptions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can access all audio"
    ON audio_transcriptions FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- Text extractions policies
CREATE POLICY "Users can view their own text"
    ON text_extractions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own text"
    ON text_extractions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own text"
    ON text_extractions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can access all text"
    ON text_extractions FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- Document embeddings policies
CREATE POLICY "Users can view embeddings of their documents"
    ON document_embeddings FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_embeddings.document_id
        AND d.user_id = auth.uid()
    ));

CREATE POLICY "Service role can access all embeddings"
    ON document_embeddings FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- Processing logs policies
CREATE POLICY "Users can view their own logs"
    ON processing_logs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can access all logs"
    ON processing_logs FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- ============================================
-- STORAGE BUCKETS
-- ============================================

-- Note: Execute these in Supabase Dashboard or via API
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('audio', 'audio', false);

-- Storage policies would be created via Supabase Dashboard

COMMENT ON TABLE documents IS 'Stores processed tax documents with OCR results';
COMMENT ON TABLE audio_transcriptions IS 'Stores audio file transcriptions';
COMMENT ON TABLE text_extractions IS 'Stores extracted text from emails and other sources';
COMMENT ON TABLE processing_logs IS 'Audit trail for all processing operations';
COMMENT ON TABLE document_embeddings IS 'Vector embeddings for RAG similarity search';
COMMENT ON TABLE dead_letter_queue IS 'Failed processing items for retry';
COMMENT ON TABLE task_queue IS 'Task orchestration queue';
