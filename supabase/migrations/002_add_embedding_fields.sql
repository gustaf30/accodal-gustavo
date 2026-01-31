-- Migration: Add missing fields for document embeddings and RAG support
-- Part 1 RAG Requirements: Store document embeddings in Supabase pgvector

-- ============================================
-- ADD MISSING COLUMNS TO DOCUMENTS TABLE
-- ============================================

-- Add raw_text column to store full OCR text for embedding
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS raw_text TEXT;

COMMENT ON COLUMN documents.raw_text IS 'Full OCR extracted text from the document';

-- ============================================
-- ADD MISSING COLUMNS TO DOCUMENT_EMBEDDINGS
-- ============================================

-- Add user_id for filtering embeddings by user
ALTER TABLE document_embeddings
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add document_type for filtering by document type
ALTER TABLE document_embeddings
ADD COLUMN IF NOT EXISTS document_type TEXT;

-- Add embedding_model to track which model generated the embedding
ALTER TABLE document_embeddings
ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'text-embedding-3-small';

-- Add updated_at for tracking changes
ALTER TABLE document_embeddings
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================
-- ADD INDEXES FOR NEW COLUMNS
-- ============================================

CREATE INDEX IF NOT EXISTS idx_embeddings_user_id
ON document_embeddings(user_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_document_type
ON document_embeddings(document_type);

CREATE INDEX IF NOT EXISTS idx_embeddings_user_doctype
ON document_embeddings(user_id, document_type);

-- ============================================
-- UPDATE SIMILARITY SEARCH FUNCTION
-- ============================================

-- Drop and recreate with enhanced filtering options
DROP FUNCTION IF EXISTS search_documents_by_similarity(vector(1536), FLOAT, INT, UUID);

CREATE OR REPLACE FUNCTION search_documents_by_similarity(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10,
    filter_user_id UUID DEFAULT NULL,
    filter_document_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    content TEXT,
    document_type TEXT,
    similarity FLOAT,
    metadata JSONB,
    filename TEXT,
    file_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        de.id,
        de.document_id,
        de.content,
        de.document_type,
        1 - (de.embedding <=> query_embedding) AS similarity,
        de.metadata,
        d.filename,
        d.file_url
    FROM document_embeddings de
    JOIN documents d ON de.document_id = d.id
    WHERE
        1 - (de.embedding <=> query_embedding) > match_threshold
        AND (filter_user_id IS NULL OR de.user_id = filter_user_id)
        AND (filter_document_type IS NULL OR de.document_type = filter_document_type)
    ORDER BY de.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_documents_by_similarity IS 'Semantic search for similar documents using vector similarity';

-- ============================================
-- FUNCTION TO FIND DOCUMENT INCONSISTENCIES (RAG Requirement)
-- ============================================

-- Function to flag documents that differ significantly from historical records
CREATE OR REPLACE FUNCTION find_document_inconsistencies(
    p_document_id UUID,
    p_threshold FLOAT DEFAULT 0.5,
    p_limit INT DEFAULT 5
)
RETURNS TABLE (
    similar_document_id UUID,
    similar_filename TEXT,
    similar_document_type TEXT,
    similarity_score FLOAT,
    is_inconsistent BOOLEAN,
    inconsistency_reason TEXT
) AS $$
DECLARE
    v_embedding vector(1536);
    v_document_type TEXT;
    v_user_id UUID;
BEGIN
    -- Get the embedding for the target document
    SELECT de.embedding, de.document_type, de.user_id
    INTO v_embedding, v_document_type, v_user_id
    FROM document_embeddings de
    WHERE de.document_id = p_document_id
    LIMIT 1;

    IF v_embedding IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        de.document_id AS similar_document_id,
        d.filename AS similar_filename,
        de.document_type AS similar_document_type,
        1 - (de.embedding <=> v_embedding) AS similarity_score,
        CASE
            WHEN de.document_type = v_document_type AND 1 - (de.embedding <=> v_embedding) < p_threshold THEN TRUE
            WHEN de.document_type != v_document_type AND 1 - (de.embedding <=> v_embedding) > 0.8 THEN TRUE
            ELSE FALSE
        END AS is_inconsistent,
        CASE
            WHEN de.document_type = v_document_type AND 1 - (de.embedding <=> v_embedding) < p_threshold
                THEN 'Same document type but content differs significantly'
            WHEN de.document_type != v_document_type AND 1 - (de.embedding <=> v_embedding) > 0.8
                THEN 'Different document type but content is very similar - possible misclassification'
            ELSE NULL
        END AS inconsistency_reason
    FROM document_embeddings de
    JOIN documents d ON de.document_id = d.id
    WHERE de.document_id != p_document_id
        AND de.user_id = v_user_id
    ORDER BY de.embedding <=> v_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_document_inconsistencies IS 'Flags documents that differ significantly from historical records for validation';

-- ============================================
-- TRIGGER FOR UPDATED_AT ON EMBEDDINGS
-- ============================================

CREATE TRIGGER update_embeddings_updated_at
    BEFORE UPDATE ON document_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RLS POLICY UPDATE FOR NEW COLUMNS
-- ============================================

-- Allow service role to insert embeddings with user_id
DROP POLICY IF EXISTS "Service role can access all embeddings" ON document_embeddings;
CREATE POLICY "Service role can access all embeddings"
    ON document_embeddings FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- Users can view embeddings by their user_id or through document ownership
DROP POLICY IF EXISTS "Users can view embeddings of their documents" ON document_embeddings;
CREATE POLICY "Users can view their embeddings"
    ON document_embeddings FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM documents d
            WHERE d.id = document_embeddings.document_id
            AND d.user_id = auth.uid()
        )
    );

-- ============================================
-- ANALYTICS VIEW FOR EMBEDDING STATISTICS
-- ============================================

CREATE OR REPLACE VIEW embedding_statistics AS
SELECT
    document_type,
    COUNT(*) as embedding_count,
    COUNT(DISTINCT document_id) as document_count,
    COUNT(DISTINCT user_id) as user_count,
    AVG(LENGTH(content)) as avg_content_length,
    MIN(created_at) as first_embedding,
    MAX(created_at) as last_embedding
FROM document_embeddings
GROUP BY document_type;

COMMENT ON VIEW embedding_statistics IS 'Statistics about document embeddings by type';
