import { getSupabaseClient } from '../config/database';
import {
  BatchProcessingRequest,
  BatchProcessingResponse,
  JobStatus,
  Document,
} from '../types';
import { v4 as uuidv4 } from 'uuid';
import {
  enqueueTask,
  getTaskStatus,
  getQueueStats,
  TaskPriority,
} from './queueService';

// Get N8N orchestrator URL from environment
function getN8nOrchestratorUrl(): string {
  const baseUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678';
  return `${baseUrl}/webhook/orchestrate`;
}

/**
 * Create a batch job for processing multiple items
 * Sends directly to N8N for processing
 */
export async function createBatchJob(
  request: BatchProcessingRequest
): Promise<BatchProcessingResponse> {
  const supabase = getSupabaseClient();
  const batchId = uuidv4();

  // Create batch job record in database for tracking
  const { error: jobError } = await supabase.from('batch_jobs').insert({
    batch_id: batchId,
    total_items: request.items.length,
    status: 'pending',
  });

  if (jobError) {
    throw new Error(`Failed to create batch job: ${jobError.message}`);
  }

  // Create batch items records
  const batchItems = request.items.map((item, index) => ({
    batch_id: batchId,
    item_index: index,
    task_type: item.type,
    status: 'pending',
  }));

  const { error: itemsError } = await supabase.from('batch_items').insert(batchItems);

  if (itemsError) {
    throw new Error(`Failed to create batch items: ${itemsError.message}`);
  }

  // Always send to N8N for processing
  // Redis is used only for rate limiting, not for document processing queue
  // N8N handles the actual document/audio/text processing
  processBatchViaN8n(batchId, request).catch(console.error);

  return {
    job_id: batchId,
    total_items: request.items.length,
    status: 'queued',
    created_at: new Date().toISOString(),
    queue_source: 'n8n',
  };
}

/**
 * Process batch items by delegating to N8N Master Orchestrator
 * N8N handles all OCR, transcription, classification, and embedding generation
 * Items are processed in PARALLEL for maximum throughput
 */
async function processBatchViaN8n(
  batchId: string,
  request: BatchProcessingRequest
): Promise<void> {
  const supabase = getSupabaseClient();
  const n8nUrl = getN8nOrchestratorUrl();

  // Update job status to processing
  await supabase
    .from('batch_jobs')
    .update({ status: 'processing' })
    .eq('batch_id', batchId);

  // Process all items in PARALLEL
  const processingPromises = request.items.map(async (item, i) => {
    try {
      // Send to N8N Master Orchestrator
      const response = await fetch(n8nUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({
          task_type: item.type,
          priority: 2,
          payload: {
            ...item.data,
            user_id: request.user_id,
            batch_id: batchId,
            item_index: i,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`N8N orchestrator error: ${errorText}`);
      }

      const result = (await response.json()) as {
        success?: boolean;
        task_id?: string;
        status?: string;
        error?: string;
      };

      if (result.success === false) {
        throw new Error(result.error || 'N8N processing failed');
      }

      // Update batch item status to queued
      await supabase
        .from('batch_items')
        .update({
          status: 'queued',
          result: { task_id: result.task_id },
        })
        .eq('batch_id', batchId)
        .eq('item_index', i);

      return { success: true, index: i };
    } catch (error) {
      // Update batch item as failed
      await supabase
        .from('batch_items')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('batch_id', batchId)
        .eq('item_index', i);

      return { success: false, index: i, error };
    }
  });

  // Wait for all items to be sent to N8N
  await Promise.all(processingPromises);

  // Check final status
  const { data: items } = await supabase
    .from('batch_items')
    .select('status')
    .eq('batch_id', batchId);

  const allFailed = items?.every((item) => item.status === 'failed');
  const anyFailed = items?.some((item) => item.status === 'failed');

  const finalStatus = allFailed ? 'failed' : anyFailed ? 'partial' : 'processing';

  await supabase
    .from('batch_jobs')
    .update({
      status: finalStatus,
      completed_at: allFailed ? new Date().toISOString() : null,
    })
    .eq('batch_id', batchId);
}

/**
 * Get job status - checks Redis queue first, then Supabase
 */
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  const supabase = getSupabaseClient();

  // Get batch job from database
  const { data: job, error: jobError } = await supabase
    .from('batch_jobs')
    .select('*')
    .eq('batch_id', jobId)
    .single();

  if (jobError || !job) {
    return null;
  }

  // Get batch items
  const { data: items } = await supabase
    .from('batch_items')
    .select('*')
    .eq('batch_id', jobId)
    .order('item_index');

  // Enhance with Redis queue status if available
  const enhancedItems = await Promise.all(
    (items || []).map(async (item) => {
      const taskId = item.result?.task_id;

      if (taskId) {
        try {
          const queueStatus = await getTaskStatus(taskId);

          if (queueStatus) {
            return {
              item_index: item.item_index,
              status: queueStatus.status as 'completed' | 'failed' | 'queued',
              task_id: taskId,
              result_id: queueStatus.result?.document_id as string | undefined,
              error: queueStatus.error,
            };
          }
        } catch (error) {
          // Ignore Redis errors, use database status
        }
      }

      return {
        item_index: item.item_index,
        status: item.status as 'completed' | 'failed' | 'queued',
        task_id: item.result?.task_id,
        result_id: item.result?.result_id,
        error: item.error_message,
      };
    })
  );

  return {
    job_id: job.batch_id,
    status: job.status,
    total_items: job.total_items,
    processed_items: job.completed_count + job.failed_count,
    failed_items: job.failed_count,
    results: enhancedItems,
    started_at: job.created_at,
    completed_at: job.completed_at,
  };
}

/**
 * Enqueue a single task for processing
 */
export async function enqueueProcessingTask(
  type: 'document' | 'audio' | 'text',
  payload: Record<string, unknown>,
  priority: TaskPriority = TaskPriority.NORMAL
): Promise<{ taskId: string; queue: 'redis' | 'supabase' | 'n8n' }> {
  const useRedisQueue = process.env.REDIS_HOST || process.env.REDIS_URL;

  if (useRedisQueue) {
    try {
      const result = await enqueueTask(type, payload, { priority });
      return { taskId: result.taskId, queue: result.queue };
    } catch (error) {
      console.error('Redis enqueue failed, falling back to N8N:', error);
    }
  }

  // Fallback to N8N webhook
  const n8nUrl = getN8nOrchestratorUrl();
  const response = await fetch(n8nUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({
      task_type: type,
      priority,
      payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`N8N webhook failed: ${await response.text()}`);
  }

  const result = (await response.json()) as { task_id?: string };

  return { taskId: result.task_id || uuidv4(), queue: 'n8n' };
}

/**
 * Reprocess a document by sending it back to N8N for OCR/classification
 * N8N will handle all processing and update Supabase directly
 */
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

  if (!doc.file_url) {
    throw new Error('No file URL available for reprocessing');
  }

  // Update status to processing
  await supabase
    .from('documents')
    .update({ status: 'processing', retry_count: (doc.retry_count || 0) + 1 })
    .eq('id', documentId);

  // Delete existing embeddings before reprocessing
  await supabase.from('document_embeddings').delete().eq('document_id', documentId);

  try {
    // Enqueue for reprocessing with high priority
    const { taskId, queue } = await enqueueProcessingTask(
      'document',
      {
        document_id: documentId,
        filename: doc.filename,
        file_url: doc.file_url,
        mime_type: doc.mime_type,
        user_id: doc.user_id,
        reprocess: true,
      },
      TaskPriority.HIGH
    );

    console.log(`Reprocess task ${taskId} queued via ${queue}`);

    // Return current doc with processing status
    return {
      ...doc,
      status: 'processing',
    } as Document;
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

/**
 * Get processing statistics including queue stats
 */
export async function getProcessingStats(userId?: string): Promise<{
  documents: {
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  };
  audio: { total: number; by_status: Record<string, number> };
  text: { total: number; by_status: Record<string, number> };
  queue: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    dlqSize: number;
    source: 'redis' | 'supabase';
  };
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

  // Get queue stats from Redis/Supabase
  const queueStats = await getQueueStats();

  return {
    documents: docStats,
    audio: audioStats,
    text: textStats,
    queue: queueStats,
  };
}
