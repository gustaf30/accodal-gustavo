import { getSupabaseClient } from '../config/database';
import { generateChunkedEmbeddings } from './embeddingService';
import { classifyDocument } from './classificationService';
import {
  BatchProcessingRequest,
  BatchProcessingResponse,
  JobStatus,
  Document,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

interface JobData {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  total_items: number;
  processed_items: number;
  failed_items: number;
  results: Array<{
    item_index: number;
    status: 'completed' | 'failed';
    result_id?: string;
    error?: string;
  }>;
  started_at?: string;
  completed_at?: string;
}

// In-memory job storage (use Redis in production)
const jobStorage = new Map<string, JobData>();

export async function createBatchJob(
  request: BatchProcessingRequest
): Promise<BatchProcessingResponse> {
  const jobId = uuidv4();

  const jobData: JobData = {
    job_id: jobId,
    status: 'queued',
    total_items: request.items.length,
    processed_items: 0,
    failed_items: 0,
    results: [],
  };

  jobStorage.set(jobId, jobData);

  // Start processing asynchronously
  processBatchAsync(jobId, request).catch(console.error);

  return {
    job_id: jobId,
    total_items: request.items.length,
    status: 'queued',
    created_at: new Date().toISOString(),
  };
}

async function processBatchAsync(
  jobId: string,
  request: BatchProcessingRequest
): Promise<void> {
  const jobData = jobStorage.get(jobId);
  if (!jobData) return;

  jobData.status = 'processing';
  jobData.started_at = new Date().toISOString();

  const supabase = getSupabaseClient();

  for (let i = 0; i < request.items.length; i++) {
    const item = request.items[i];

    try {
      let resultId: string | undefined;

      if (item.type === 'document') {
        resultId = await processDocumentItem(
          item.data,
          request.user_id,
          supabase
        );
      } else if (item.type === 'audio') {
        resultId = await processAudioItem(
          item.data,
          request.user_id,
          supabase
        );
      } else if (item.type === 'text') {
        resultId = await processTextItem(
          item.data,
          request.user_id,
          supabase
        );
      }

      jobData.results.push({
        item_index: i,
        status: 'completed',
        result_id: resultId,
      });
      jobData.processed_items++;
    } catch (error) {
      jobData.results.push({
        item_index: i,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      jobData.failed_items++;
    }

    // Update job status
    jobStorage.set(jobId, { ...jobData });
  }

  jobData.status = jobData.failed_items === jobData.total_items ? 'failed' : 'completed';
  jobData.completed_at = new Date().toISOString();
  jobStorage.set(jobId, jobData);
}

async function processDocumentItem(
  data: Record<string, unknown>,
  userId: string | undefined,
  supabase: ReturnType<typeof getSupabaseClient>
): Promise<string> {
  // Classify the document
  const classification = await classifyDocument({
    content: data.base64_content as string || data.file_url as string || '',
    content_type: data.base64_content ? 'base64_image' : 'url',
    filename: data.filename as string,
  });

  // Store the document
  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId || null,
      filename: data.filename,
      file_url: data.file_url,
      mime_type: data.mime_type,
      type: classification.document_type,
      extracted_data: classification.extracted_data,
      classification_confidence: classification.confidence,
      status: 'completed',
      processed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  // Generate and store embeddings
  const content =
    JSON.stringify(classification.extracted_data) ||
    (data.raw_text as string) ||
    '';
  if (content) {
    const embeddings = await generateChunkedEmbeddings(content, {
      document_type: classification.document_type,
    });

    for (const emb of embeddings) {
      await supabase.from('document_embeddings').insert({
        document_id: doc.id,
        chunk_index: emb.chunk_index,
        content: emb.content,
        embedding: emb.embedding,
        metadata: emb.metadata,
      });
    }
  }

  return doc.id;
}

async function processAudioItem(
  data: Record<string, unknown>,
  userId: string | undefined,
  supabase: ReturnType<typeof getSupabaseClient>
): Promise<string> {
  // Store audio transcription (transcription should be provided)
  const { data: audio, error } = await supabase
    .from('audio_transcriptions')
    .insert({
      user_id: userId || null,
      filename: data.filename,
      file_url: data.file_url,
      mime_type: data.mime_type,
      transcription: data.transcription,
      extracted_entities: data.extracted_entities || {},
      duration_seconds: data.duration_seconds,
      language: data.language || 'en',
      status: 'completed',
      processed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return audio.id;
}

async function processTextItem(
  data: Record<string, unknown>,
  userId: string | undefined,
  supabase: ReturnType<typeof getSupabaseClient>
): Promise<string> {
  // Store text extraction
  const { data: text, error } = await supabase
    .from('text_extractions')
    .insert({
      user_id: userId || null,
      source: data.source || 'api',
      source_identifier: data.source_identifier,
      subject: data.subject,
      content: data.content,
      extracted_data: data.extracted_data || {},
      entities: data.entities || {},
      status: 'completed',
      processed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return text.id;
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  const jobData = jobStorage.get(jobId);

  if (!jobData) {
    return null;
  }

  return {
    job_id: jobData.job_id,
    status: jobData.status,
    total_items: jobData.total_items,
    processed_items: jobData.processed_items,
    failed_items: jobData.failed_items,
    results: jobData.results,
    started_at: jobData.started_at,
    completed_at: jobData.completed_at,
  };
}

export async function reprocessDocument(documentId: string): Promise<Document> {
  const supabase = getSupabaseClient();

  // Get the document
  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (fetchError || !doc) {
    throw new Error('Document not found');
  }

  // Update status to processing
  await supabase
    .from('documents')
    .update({ status: 'processing', retry_count: (doc.retry_count || 0) + 1 })
    .eq('id', documentId);

  try {
    // Re-classify if we have the content
    if (doc.file_url) {
      const classification = await classifyDocument({
        content: doc.file_url,
        content_type: 'url',
        filename: doc.filename,
      });

      // Update with new classification
      const { data: updated, error: updateError } = await supabase
        .from('documents')
        .update({
          type: classification.document_type,
          extracted_data: classification.extracted_data,
          classification_confidence: classification.confidence,
          status: 'completed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .select('*')
        .single();

      if (updateError) throw new Error(updateError.message);

      // Regenerate embeddings
      await regenerateEmbeddings(documentId, classification.extracted_data);

      return updated as Document;
    }

    throw new Error('No file URL available for reprocessing');
  } catch (error) {
    // Mark as failed
    await supabase
      .from('documents')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Reprocessing failed',
      })
      .eq('id', documentId);

    throw error;
  }
}

async function regenerateEmbeddings(
  documentId: string,
  extractedData: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();

  // Delete existing embeddings
  await supabase
    .from('document_embeddings')
    .delete()
    .eq('document_id', documentId);

  // Generate new embeddings
  const content = JSON.stringify(extractedData);
  if (content) {
    const embeddings = await generateChunkedEmbeddings(content, {
      document_id: documentId,
      regenerated: true,
    });

    for (const emb of embeddings) {
      await supabase.from('document_embeddings').insert({
        document_id: documentId,
        chunk_index: emb.chunk_index,
        content: emb.content,
        embedding: emb.embedding,
        metadata: emb.metadata,
      });
    }
  }
}

export async function getProcessingStats(
  userId?: string
): Promise<{
  documents: { total: number; by_status: Record<string, number>; by_type: Record<string, number> };
  audio: { total: number; by_status: Record<string, number> };
  text: { total: number; by_status: Record<string, number> };
}> {
  const supabase = getSupabaseClient();

  // Get document stats
  let docQuery = supabase.from('documents').select('status, type');
  if (userId) docQuery = docQuery.eq('user_id', userId);
  const { data: docs } = await docQuery;

  const docStats = {
    total: docs?.length || 0,
    by_status: {} as Record<string, number>,
    by_type: {} as Record<string, number>,
  };

  for (const doc of docs || []) {
    docStats.by_status[doc.status] = (docStats.by_status[doc.status] || 0) + 1;
    docStats.by_type[doc.type] = (docStats.by_type[doc.type] || 0) + 1;
  }

  // Get audio stats
  let audioQuery = supabase.from('audio_transcriptions').select('status');
  if (userId) audioQuery = audioQuery.eq('user_id', userId);
  const { data: audio } = await audioQuery;

  const audioStats = {
    total: audio?.length || 0,
    by_status: {} as Record<string, number>,
  };

  for (const a of audio || []) {
    audioStats.by_status[a.status] = (audioStats.by_status[a.status] || 0) + 1;
  }

  // Get text stats
  let textQuery = supabase.from('text_extractions').select('status');
  if (userId) textQuery = textQuery.eq('user_id', userId);
  const { data: text } = await textQuery;

  const textStats = {
    total: text?.length || 0,
    by_status: {} as Record<string, number>,
  };

  for (const t of text || []) {
    textStats.by_status[t.status] = (textStats.by_status[t.status] || 0) + 1;
  }

  return {
    documents: docStats,
    audio: audioStats,
    text: textStats,
  };
}
