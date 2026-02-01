import { getSupabaseClient } from '../config/database';
import { generateEmbedding } from './embeddingService';
import {
  SearchRequest,
  SearchResult,
  SearchResponse,
  Document,
  DocumentType,
} from '../types';

const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export async function searchDocuments(
  request: SearchRequest
): Promise<SearchResponse> {
  const {
    query,
    user_id,
    document_type,
    threshold = DEFAULT_THRESHOLD,
    limit = DEFAULT_LIMIT,
    offset = 0,
  } = request;

  // Validate inputs
  if (!query || query.trim().length === 0) {
    throw new Error('Search query is required');
  }

  const effectiveLimit = Math.min(limit, MAX_LIMIT);

  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(query);
  console.log('Query embedding generated, length:', queryEmbedding.length);

  // Search using Supabase pgvector
  const supabase = getSupabaseClient();

  // Pass embedding for pgvector search using fetch directly
  const embeddingStr = '[' + queryEmbedding.join(',') + ']';
  console.log('Embedding string length:', embeddingStr.length);
  console.log('First 100 chars of embedding:', embeddingStr.substring(0, 100));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // First, debug the similarity scores
  const debugResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/debug_similarity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey!,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      query_embedding: embeddingStr,
    }),
  });

  const debugData = await debugResponse.json();
  console.log('DEBUG similarities:', JSON.stringify(debugData));

  // Now do the actual search
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/search_documents_by_similarity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey!,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      query_embedding: embeddingStr,
      match_threshold: threshold,
      match_count: effectiveLimit + offset,
      filter_user_id: user_id || null,
    }),
  });

  const responseData = await response.json();

  console.log('Search result - status:', response.status, 'data length:', Array.isArray(responseData) ? responseData.length : 'not array');

  if (!response.ok) {
    console.error('RPC error details:', responseData);
    throw new Error(`Search failed: ${(responseData as any).message || 'Unknown error'}`);
  }

  let results: SearchResult[] = (responseData as SearchResult[]) || [];

  // Apply offset
  if (offset > 0) {
    results = results.slice(offset);
  }

  // Filter by document type if specified
  if (document_type) {
    const documentIds = results.map((r) => r.document_id);

    const { data: documents } = await supabase
      .from('documents')
      .select('id, type')
      .in('id', documentIds)
      .eq('type', document_type);

    const validIds = new Set((documents || []).map((d) => d.id));
    results = results.filter((r) => validIds.has(r.document_id));
  }

  // Fetch full document details for top results
  const documentIds = results.slice(0, effectiveLimit).map((r) => r.document_id);

  if (documentIds.length > 0) {
    const { data: documents } = await supabase
      .from('documents')
      .select('*')
      .in('id', documentIds);

    const documentMap = new Map(
      (documents || []).map((d) => [d.id, d as Document])
    );

    results = results.map((r) => ({
      ...r,
      document: documentMap.get(r.document_id),
    }));
  }

  return {
    results: results.slice(0, effectiveLimit),
    total: results.length,
    query,
    threshold,
    debug: {
      embedding_length: queryEmbedding.length,
      embedding_first_5: queryEmbedding.slice(0, 5),
      supabase_url: supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'NOT SET',
      debug_response_status: debugResponse.status,
      debug_similarities: debugData,
      search_response_status: response.status,
      raw_results_count: Array.isArray(responseData) ? responseData.length : 0,
      raw_response_preview: JSON.stringify(responseData).substring(0, 200),
    },
  };
}

export async function findSimilarDocuments(
  documentId: string,
  limit: number = 5
): Promise<SearchResult[]> {
  const supabase = getSupabaseClient();

  // Get the document's embedding
  const { data: embeddings, error: embError } = await supabase
    .from('document_embeddings')
    .select('embedding, content')
    .eq('document_id', documentId)
    .limit(1);

  if (embError || !embeddings || embeddings.length === 0) {
    throw new Error('Document embedding not found');
  }

  const queryEmbedding = embeddings[0].embedding;

  // Search for similar documents (excluding the original)
  const { data, error } = await supabase.rpc('search_documents_by_similarity', {
    query_embedding: queryEmbedding,
    match_threshold: 0.6,
    match_count: limit + 1,
    filter_user_id: null,
  });

  if (error) {
    throw new Error(`Similarity search failed: ${error.message}`);
  }

  // Filter out the original document
  return (data || []).filter((r: SearchResult) => r.document_id !== documentId).slice(0, limit);
}

export async function searchByMetadata(
  filters: {
    user_id?: string;
    document_type?: DocumentType;
    status?: string;
    date_from?: string;
    date_to?: string;
  },
  pagination: { limit?: number; offset?: number } = {}
): Promise<{ documents: Document[]; total: number }> {
  const supabase = getSupabaseClient();
  const { limit = 20, offset = 0 } = pagination;

  let query = supabase.from('documents').select('*', { count: 'exact' });

  if (filters.user_id) {
    query = query.eq('user_id', filters.user_id);
  }

  if (filters.document_type) {
    query = query.eq('type', filters.document_type);
  }

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  if (filters.date_from) {
    query = query.gte('created_at', filters.date_from);
  }

  if (filters.date_to) {
    query = query.lte('created_at', filters.date_to);
  }

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    throw new Error(`Metadata search failed: ${error.message}`);
  }

  return {
    documents: (data || []) as Document[],
    total: count || 0,
  };
}

export async function flagInconsistencies(
  documentId: string
): Promise<{
  has_inconsistencies: boolean;
  inconsistencies: Array<{
    field: string;
    current_value: unknown;
    historical_value: unknown;
    similarity_score: number;
  }>;
}> {
  const supabase = getSupabaseClient();

  // Get the current document
  const { data: document, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (docError || !document) {
    throw new Error('Document not found');
  }

  // Find similar historical documents
  const similarDocs = await findSimilarDocuments(documentId, 10);

  // Get full details of similar documents
  const similarIds = similarDocs.map((d) => d.document_id);

  const { data: historicalDocs } = await supabase
    .from('documents')
    .select('*')
    .in('id', similarIds)
    .eq('type', document.type)
    .eq('user_id', document.user_id);

  const inconsistencies: Array<{
    field: string;
    current_value: unknown;
    historical_value: unknown;
    similarity_score: number;
  }> = [];

  // Compare key fields based on document type
  const currentData = document.extracted_data as Record<string, unknown>;

  for (const histDoc of historicalDocs || []) {
    const histData = histDoc.extracted_data as Record<string, unknown>;
    const simDoc = similarDocs.find((s) => s.document_id === histDoc.id);
    const similarity = simDoc?.similarity || 0;

    // Check for mismatches in critical fields
    const criticalFields = getCriticalFields(document.type);

    for (const field of criticalFields) {
      if (currentData[field] && histData[field]) {
        if (JSON.stringify(currentData[field]) !== JSON.stringify(histData[field])) {
          inconsistencies.push({
            field,
            current_value: currentData[field],
            historical_value: histData[field],
            similarity_score: similarity,
          });
        }
      }
    }
  }

  return {
    has_inconsistencies: inconsistencies.length > 0,
    inconsistencies,
  };
}

function getCriticalFields(documentType: string): string[] {
  const fieldMapping: Record<string, string[]> = {
    'W-2': ['employer_ein', 'employee_ssn', 'employer_name'],
    '1099': ['payer_tin', 'recipient_ssn', 'payer_name'],
    '1099-MISC': ['payer_tin', 'recipient_ssn'],
    '1099-INT': ['payer_tin', 'recipient_ssn'],
    '1099-DIV': ['payer_tin', 'recipient_ssn'],
    '1099-NEC': ['payer_tin', 'recipient_ssn'],
    Invoice: ['vendor_name', 'invoice_number'],
    Receipt: ['vendor_name'],
    'Bank Statement': ['account_number'],
  };

  return fieldMapping[documentType] || [];
}
