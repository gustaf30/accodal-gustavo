-- Tax Document Processing System - Part 2 Enhancements
-- Batch Processing, Rate Limiting, Data Masking, Classification

-- ============================================
-- BATCH PROCESSING
-- ============================================

-- Batch jobs tracking table
CREATE TABLE IF NOT EXISTS batch_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id TEXT UNIQUE NOT NULL,
    total_items INTEGER NOT NULL,
    queued_count INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batch items tracking
CREATE TABLE IF NOT EXISTS batch_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id TEXT NOT NULL REFERENCES batch_jobs(batch_id) ON DELETE CASCADE,
    item_index INTEGER NOT NULL,
    task_id UUID REFERENCES task_queue(id),
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed')),
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(batch_id, item_index)
);

-- Indexes for batch processing
CREATE INDEX idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX idx_batch_jobs_created_at ON batch_jobs(created_at DESC);
CREATE INDEX idx_batch_items_batch_id ON batch_items(batch_id);
CREATE INDEX idx_batch_items_status ON batch_items(status);

-- ============================================
-- METADATA-BASED CLASSIFICATION (KAG)
-- ============================================

-- Add classification columns to documents
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS client_type TEXT CHECK (client_type IN ('individual', 'business', 'trust', 'nonprofit', 'government')),
ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS tax_year INTEGER,
ADD COLUMN IF NOT EXISTS taxonomy_id UUID,
ADD COLUMN IF NOT EXISTS auto_classified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS classification_source TEXT CHECK (classification_source IN ('ai', 'manual', 'rule_based'));

-- Taxonomy table for hierarchical document categories
CREATE TABLE IF NOT EXISTS taxonomy (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    parent_id UUID REFERENCES taxonomy(id) ON DELETE SET NULL,
    level INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    description TEXT,
    keywords TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Taxonomy indexes
CREATE INDEX idx_taxonomy_parent ON taxonomy(parent_id);
CREATE INDEX idx_taxonomy_level ON taxonomy(level);
CREATE INDEX idx_taxonomy_path ON taxonomy(path);
CREATE INDEX idx_taxonomy_slug ON taxonomy(slug);
CREATE INDEX idx_taxonomy_keywords ON taxonomy USING GIN(keywords);

-- Document to taxonomy mapping
ALTER TABLE documents
ADD CONSTRAINT fk_documents_taxonomy
FOREIGN KEY (taxonomy_id) REFERENCES taxonomy(id) ON DELETE SET NULL;

CREATE INDEX idx_documents_taxonomy ON documents(taxonomy_id);
CREATE INDEX idx_documents_client_type ON documents(client_type);
CREATE INDEX idx_documents_keywords ON documents USING GIN(keywords);
CREATE INDEX idx_documents_tax_year ON documents(tax_year);

-- ============================================
-- ENHANCED DATA MASKING
-- ============================================

-- Function to mask sensitive data in JSON objects
CREATE OR REPLACE FUNCTION mask_sensitive_json(data JSONB)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    key TEXT;
    value JSONB;
    sensitive_keys TEXT[] := ARRAY['ssn', 'social_security', 'tax_id', 'ein', 'tin', 'itin', 'account_number', 'routing_number', 'credit_card', 'bank_account'];
BEGIN
    result := data;

    FOR key IN SELECT jsonb_object_keys(data)
    LOOP
        value := data->key;

        -- Check if key matches sensitive patterns
        IF key = ANY(sensitive_keys) OR
           key ILIKE '%ssn%' OR
           key ILIKE '%social_security%' OR
           key ILIKE '%tax_id%' OR
           key ILIKE '%ein%' OR
           key ILIKE '%account%' THEN

            IF jsonb_typeof(value) = 'string' THEN
                -- Mask the value, keeping last 4 digits
                result := jsonb_set(result, ARRAY[key],
                    to_jsonb('***-**-' || RIGHT(REGEXP_REPLACE(value::text, '[^0-9]', '', 'g'), 4)));
            END IF;

        ELSIF jsonb_typeof(value) = 'object' THEN
            -- Recursively mask nested objects
            result := jsonb_set(result, ARRAY[key], mask_sensitive_json(value));
        END IF;
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to detect and mask SSNs in text
CREATE OR REPLACE FUNCTION mask_ssn_in_text(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Match patterns like 123-45-6789, 123 45 6789, 123456789
    RETURN REGEXP_REPLACE(
        input_text,
        '\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})\b',
        'XXX-XX-\3',
        'g'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to mask EIN/Tax ID in text
CREATE OR REPLACE FUNCTION mask_ein_in_text(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Match patterns like 12-3456789
    RETURN REGEXP_REPLACE(
        input_text,
        '\b(\d{2})[-]?(\d{7})\b',
        'XX-XXX\2',
        'g'
    );
END;
$$ LANGUAGE plpgsql;

-- Comprehensive masking function
CREATE OR REPLACE FUNCTION apply_all_masks(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN mask_ein_in_text(mask_ssn_in_text(input_text));
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RATE LIMITING ENHANCEMENTS
-- ============================================

-- Enhanced rate limit function with sliding window
CREATE OR REPLACE FUNCTION check_rate_limit_sliding(
    p_identifier TEXT,
    p_endpoint TEXT,
    p_limit INTEGER DEFAULT 100,
    p_window_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
    allowed BOOLEAN,
    current_count INTEGER,
    remaining INTEGER,
    reset_at TIMESTAMPTZ
) AS $$
DECLARE
    v_count INTEGER;
    v_cutoff TIMESTAMPTZ;
    v_next_window TIMESTAMPTZ;
BEGIN
    v_cutoff := NOW() - (p_window_seconds * INTERVAL '1 second');
    v_next_window := NOW() + (p_window_seconds * INTERVAL '1 second');

    -- Clean up old entries
    DELETE FROM rate_limit_tracking
    WHERE identifier = p_identifier
        AND endpoint = p_endpoint
        AND window_start < v_cutoff;

    -- Count requests in window
    SELECT COALESCE(SUM(request_count), 0) INTO v_count
    FROM rate_limit_tracking
    WHERE identifier = p_identifier
        AND endpoint = p_endpoint
        AND window_start >= v_cutoff;

    IF v_count >= p_limit THEN
        RETURN QUERY SELECT FALSE, v_count, 0, v_next_window;
        RETURN;
    END IF;

    -- Record request
    INSERT INTO rate_limit_tracking (identifier, endpoint, window_start, request_count)
    VALUES (p_identifier, p_endpoint, NOW(), 1)
    ON CONFLICT (identifier, endpoint, window_start)
    DO UPDATE SET request_count = rate_limit_tracking.request_count + 1;

    RETURN QUERY SELECT TRUE, v_count + 1, p_limit - v_count - 1, v_next_window;
END;
$$ LANGUAGE plpgsql;

-- API endpoints rate limits configuration
CREATE TABLE IF NOT EXISTS rate_limit_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint TEXT UNIQUE NOT NULL,
    requests_per_minute INTEGER DEFAULT 60,
    requests_per_hour INTEGER DEFAULT 1000,
    requests_per_day INTEGER DEFAULT 10000,
    burst_limit INTEGER DEFAULT 20,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default rate limits
INSERT INTO rate_limit_config (endpoint, requests_per_minute, requests_per_hour, burst_limit) VALUES
('orchestrate', 60, 1000, 20),
('batch-process', 10, 100, 5),
('document-worker', 30, 500, 10),
('audio-worker', 20, 200, 5),
('text-worker', 30, 500, 10)
ON CONFLICT (endpoint) DO NOTHING;

-- ============================================
-- TAXONOMY SEED DATA
-- ============================================

-- Insert default taxonomy hierarchy
INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords) VALUES
-- Root categories
('Income Documents', 'income', NULL, 0, '/income', 'Documents related to income reporting', ARRAY['income', 'wages', 'salary', 'earnings']),
('Investment Documents', 'investment', NULL, 0, '/investment', 'Documents related to investments', ARRAY['investment', 'dividend', 'interest', 'capital gains']),
('Business Documents', 'business', NULL, 0, '/business', 'Business and self-employment documents', ARRAY['business', 'self-employment', 'schedule c']),
('Deduction Documents', 'deductions', NULL, 0, '/deductions', 'Documents for tax deductions', ARRAY['deduction', 'expense', 'charitable']),
('Other Tax Documents', 'other', NULL, 0, '/other', 'Miscellaneous tax documents', ARRAY['other', 'misc'])
ON CONFLICT (slug) DO NOTHING;

-- Income subcategories
INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords)
SELECT 'W-2 Forms', 'w2', id, 1, '/income/w2', 'Employee wage and tax statements', ARRAY['w-2', 'w2', 'wages', 'withholding']
FROM taxonomy WHERE slug = 'income'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords)
SELECT '1099-NEC', '1099-nec', id, 1, '/income/1099-nec', 'Non-employee compensation', ARRAY['1099-nec', 'contractor', 'freelance']
FROM taxonomy WHERE slug = 'income'
ON CONFLICT (slug) DO NOTHING;

-- Investment subcategories
INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords)
SELECT '1099-DIV', '1099-div', id, 1, '/investment/1099-div', 'Dividend income', ARRAY['1099-div', 'dividend', 'distribution']
FROM taxonomy WHERE slug = 'investment'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords)
SELECT '1099-INT', '1099-int', id, 1, '/investment/1099-int', 'Interest income', ARRAY['1099-int', 'interest', 'savings']
FROM taxonomy WHERE slug = 'investment'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords)
SELECT '1099-B', '1099-b', id, 1, '/investment/1099-b', 'Broker transactions', ARRAY['1099-b', 'broker', 'stock', 'capital gains']
FROM taxonomy WHERE slug = 'investment'
ON CONFLICT (slug) DO NOTHING;

-- Business subcategories
INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords)
SELECT 'Invoices', 'invoices', id, 1, '/business/invoices', 'Business invoices', ARRAY['invoice', 'billing', 'payment']
FROM taxonomy WHERE slug = 'business'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO taxonomy (name, slug, parent_id, level, path, description, keywords)
SELECT 'Receipts', 'receipts', id, 1, '/business/receipts', 'Business expense receipts', ARRAY['receipt', 'expense', 'purchase']
FROM taxonomy WHERE slug = 'business'
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- HELPER FUNCTIONS FOR TAXONOMY
-- ============================================

-- Get all descendants of a taxonomy node
CREATE OR REPLACE FUNCTION get_taxonomy_descendants(p_slug TEXT)
RETURNS SETOF taxonomy AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE descendants AS (
        SELECT * FROM taxonomy WHERE slug = p_slug
        UNION ALL
        SELECT t.* FROM taxonomy t
        INNER JOIN descendants d ON t.parent_id = d.id
    )
    SELECT * FROM descendants;
END;
$$ LANGUAGE plpgsql;

-- Get taxonomy path as array
CREATE OR REPLACE FUNCTION get_taxonomy_path(p_id UUID)
RETURNS TEXT[] AS $$
DECLARE
    result TEXT[] := '{}';
    current_id UUID := p_id;
    current_name TEXT;
BEGIN
    WHILE current_id IS NOT NULL LOOP
        SELECT name, parent_id INTO current_name, current_id
        FROM taxonomy WHERE id = current_id;

        IF current_name IS NOT NULL THEN
            result := array_prepend(current_name, result);
        END IF;
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Auto-classify document based on keywords
CREATE OR REPLACE FUNCTION auto_classify_document(p_extracted_data JSONB)
RETURNS UUID AS $$
DECLARE
    v_text TEXT;
    v_taxonomy_id UUID;
    v_best_score INTEGER := 0;
    v_current_score INTEGER;
    v_taxonomy_row RECORD;
BEGIN
    -- Extract all text from the JSON
    v_text := LOWER(p_extracted_data::TEXT);

    -- Find best matching taxonomy based on keywords
    FOR v_taxonomy_row IN SELECT * FROM taxonomy LOOP
        v_current_score := 0;

        -- Count keyword matches
        FOR i IN 1..array_length(v_taxonomy_row.keywords, 1) LOOP
            IF v_text LIKE '%' || LOWER(v_taxonomy_row.keywords[i]) || '%' THEN
                v_current_score := v_current_score + 1;
            END IF;
        END LOOP;

        IF v_current_score > v_best_score THEN
            v_best_score := v_current_score;
            v_taxonomy_id := v_taxonomy_row.id;
        END IF;
    END LOOP;

    RETURN v_taxonomy_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS FOR AUTO-CLASSIFICATION
-- ============================================

-- Auto-classify and mask data on document insert/update
CREATE OR REPLACE FUNCTION process_document_data()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-classify if not manually set
    IF NEW.taxonomy_id IS NULL AND NEW.extracted_data IS NOT NULL THEN
        NEW.taxonomy_id := auto_classify_document(NEW.extracted_data);
        NEW.auto_classified := TRUE;
        NEW.classification_source := 'ai';
    END IF;

    -- Mask sensitive data in extracted_data
    IF NEW.extracted_data IS NOT NULL THEN
        NEW.extracted_data := mask_sensitive_json(NEW.extracted_data);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for document processing
DROP TRIGGER IF EXISTS process_document_trigger ON documents;
CREATE TRIGGER process_document_trigger
    BEFORE INSERT OR UPDATE OF extracted_data ON documents
    FOR EACH ROW EXECUTE FUNCTION process_document_data();

-- ============================================
-- BATCH TRIGGERS
-- ============================================

-- Update batch_jobs on batch_items changes
CREATE OR REPLACE FUNCTION update_batch_counts()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE batch_jobs
    SET
        queued_count = (SELECT COUNT(*) FROM batch_items WHERE batch_id = COALESCE(NEW.batch_id, OLD.batch_id) AND status = 'queued'),
        completed_count = (SELECT COUNT(*) FROM batch_items WHERE batch_id = COALESCE(NEW.batch_id, OLD.batch_id) AND status = 'completed'),
        failed_count = (SELECT COUNT(*) FROM batch_items WHERE batch_id = COALESCE(NEW.batch_id, OLD.batch_id) AND status = 'failed'),
        updated_at = NOW()
    WHERE batch_id = COALESCE(NEW.batch_id, OLD.batch_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_batch_counts_trigger
    AFTER INSERT OR UPDATE OR DELETE ON batch_items
    FOR EACH ROW EXECUTE FUNCTION update_batch_counts();

-- Updated_at triggers for new tables
CREATE TRIGGER update_batch_jobs_updated_at
    BEFORE UPDATE ON batch_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_taxonomy_updated_at
    BEFORE UPDATE ON taxonomy
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE batch_jobs IS 'Tracks batch processing jobs for parallel document processing';
COMMENT ON TABLE batch_items IS 'Individual items within a batch job';
COMMENT ON TABLE taxonomy IS 'Hierarchical document classification taxonomy';
COMMENT ON TABLE rate_limit_config IS 'Configuration for API rate limiting per endpoint';
COMMENT ON FUNCTION mask_sensitive_json IS 'Recursively masks sensitive data in JSON objects';
COMMENT ON FUNCTION auto_classify_document IS 'Automatically classifies documents based on keyword matching';
