// Core Types for Tax Document Processing System

export interface Document {
  id: string;
  user_id: string | null;
  filename: string;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  type: DocumentType;
  extracted_data: Record<string, unknown>;
  ocr_confidence: number | null;
  classification_confidence: number | null;
  status: ProcessingStatus;
  error_message: string | null;
  retry_count: number;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentType =
  | 'W-2'
  | '1099'
  | '1099-MISC'
  | '1099-INT'
  | '1099-DIV'
  | '1099-NEC'
  | 'Invoice'
  | 'Receipt'
  | 'Bank Statement'
  | 'Other';

export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'needs_review';

export interface AudioTranscription {
  id: string;
  user_id: string | null;
  filename: string;
  file_url: string | null;
  duration_seconds: number | null;
  mime_type: string | null;
  transcription: string | null;
  extracted_entities: ExtractedEntities;
  confidence: number | null;
  language: string;
  status: ProcessingStatus;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TextExtraction {
  id: string;
  user_id: string | null;
  source: TextSource;
  source_identifier: string | null;
  subject: string | null;
  content: string;
  extracted_data: Record<string, unknown>;
  entities: ExtractedEntities;
  status: ProcessingStatus;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TextSource = 'email' | 'chat' | 'form' | 'api' | 'manual';

export interface ExtractedEntities {
  ssn_mentions?: string[];
  tax_id_mentions?: string[];
  income_figures?: { amount: number; context: string }[];
  dates?: string[];
  names?: string[];
  companies?: string[];
  addresses?: string[];
  phone_numbers?: string[];
  email_addresses?: string[];
  document_references?: string[];
}

export interface DocumentEmbedding {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProcessingLog {
  id: string;
  resource_type: ResourceType;
  resource_id: string;
  user_id: string | null;
  action: string;
  status: LogStatus;
  details: Record<string, unknown>;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export type ResourceType = 'document' | 'audio' | 'text' | 'embedding' | 'workflow';
export type LogStatus = 'started' | 'completed' | 'failed' | 'retrying';

// API Request/Response Types

export interface SearchRequest {
  query: string;
  user_id?: string;
  document_type?: DocumentType;
  threshold?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  id: string;
  document_id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
  document?: Document;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  threshold: number;
  debug?: {
    embedding_length: number;
    embedding_first_5: number[];
    supabase_url: string;
    existing_embeddings_count: number;
    existing_embeddings: unknown;
    debug_response_status: number;
    debug_similarities: unknown;
    search_response_status: number;
    raw_results_count: number;
    raw_response_preview: string;
  };
}

export interface ClassificationRequest {
  content: string;
  content_type: 'text' | 'base64_image' | 'url';
  filename?: string;
}

export interface ClassificationResult {
  document_type: DocumentType;
  confidence: number;
  extracted_data: Record<string, unknown>;
  taxonomy: TaxonomyMapping;
}

export interface TaxonomyMapping {
  category: string;
  subcategory: string;
  tax_year?: string;
  form_type?: string;
  keywords: string[];
}

export interface BatchProcessingRequest {
  items: Array<{
    type: 'document' | 'audio' | 'text';
    data: Record<string, unknown>;
  }>;
  user_id?: string;
  priority?: number;
}

export interface BatchProcessingResponse {
  job_id: string;
  total_items: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface JobStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  total_items: number;
  processed_items: number;
  failed_items: number;
  results?: Array<{
    item_index: number;
    status: 'completed' | 'failed';
    result_id?: string;
    error?: string;
  }>;
  started_at?: string;
  completed_at?: string;
}

// Webhook Types

export interface WebhookPayload {
  event: WebhookEvent;
  resource_type: ResourceType;
  resource_id: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export type WebhookEvent =
  | 'document.processed'
  | 'document.failed'
  | 'audio.transcribed'
  | 'text.extracted'
  | 'batch.completed'
  | 'batch.failed';

// Error Types

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ValidationError extends APIError {
  field: string;
  value?: unknown;
}

// Configuration Types

export interface AppConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  openaiApiKey: string;
  redisUrl?: string;
  jwtSecret: string;
  rateLimitRequests: number;
  rateLimitWindow: number;
}
