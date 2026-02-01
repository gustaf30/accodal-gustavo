/**
 * Queue Service
 *
 * Provides message queue functionality using Redis.
 * Falls back to Supabase task_queue if Redis is not available.
 *
 * Supports:
 * - Priority queues (P0-P4, where P0 is highest priority)
 * - Task status tracking
 * - Dead letter queue integration
 * - Retry with exponential backoff
 */

import { getRedisClient, isRedisConnected } from '../config/redis';
import { getSupabaseClient } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// Queue names
const QUEUE_PREFIX = 'queue:';
const TASK_PREFIX = 'task:';
const DLQ_PREFIX = 'dlq:';

// Priority levels (lower = higher priority)
export enum TaskPriority {
  URGENT = 0, // P0 - Immediate processing
  HIGH = 1, // P1 - High priority
  NORMAL = 2, // P2 - Normal priority (default)
  LOW = 3, // P3 - Low priority
  BATCH = 4, // P4 - Batch processing, lowest priority
}

export interface QueueTask {
  id: string;
  type: 'document' | 'audio' | 'text' | 'onboarding' | 'communication';
  priority: TaskPriority;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workerId?: string;
  retryCount: number;
  maxRetries: number;
  error?: string;
  result?: Record<string, unknown>;
  batchId?: string;
  itemIndex?: number;
}

export interface EnqueueOptions {
  priority?: TaskPriority;
  maxRetries?: number;
  batchId?: string;
  itemIndex?: number;
}

/**
 * Enqueue a task for processing
 * Uses Redis if available, otherwise falls back to Supabase
 */
export async function enqueueTask(
  type: QueueTask['type'],
  payload: Record<string, unknown>,
  options: EnqueueOptions = {}
): Promise<{ taskId: string; queue: 'redis' | 'supabase' }> {
  const taskId = uuidv4();
  const priority = options.priority ?? TaskPriority.NORMAL;
  const maxRetries = options.maxRetries ?? 3;

  const task: QueueTask = {
    id: taskId,
    type,
    priority,
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries,
    batchId: options.batchId,
    itemIndex: options.itemIndex,
  };

  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      // Store task data
      await redis.set(`${TASK_PREFIX}${taskId}`, JSON.stringify(task), 'EX', 86400 * 7); // 7 days TTL

      // Add to priority queue (sorted set with score = priority * 1e12 + timestamp)
      const score = priority * 1e12 + Date.now();
      await redis.zadd(`${QUEUE_PREFIX}pending`, score, taskId);

      return { taskId, queue: 'redis' };
    } catch (error) {
      console.error('Redis enqueue failed, falling back to Supabase:', error);
    }
  }

  // Fallback to Supabase
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('task_queue').insert({
    id: taskId,
    workflow_name: getWorkflowName(type),
    task_type: type,
    priority,
    payload,
    status: 'pending',
    retry_count: 0,
    max_retries: maxRetries,
  });

  if (error) {
    throw new Error(`Failed to enqueue task: ${error.message}`);
  }

  return { taskId, queue: 'supabase' };
}

/**
 * Dequeue the next task for processing
 * Returns null if no tasks are available
 */
export async function dequeueTask(
  workerId: string
): Promise<QueueTask | null> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      // Get the highest priority task (lowest score)
      const taskIds = await redis.zrange(`${QUEUE_PREFIX}pending`, 0, 0);

      if (taskIds.length === 0) {
        return null;
      }

      const taskId = taskIds[0];

      // Atomically move from pending to processing
      const removed = await redis.zrem(`${QUEUE_PREFIX}pending`, taskId);

      if (removed === 0) {
        // Task was claimed by another worker
        return null;
      }

      // Get task data
      const taskData = await redis.get(`${TASK_PREFIX}${taskId}`);

      if (!taskData) {
        return null;
      }

      const task: QueueTask = JSON.parse(taskData);
      task.status = 'processing';
      task.startedAt = new Date().toISOString();
      task.workerId = workerId;

      // Update task data
      await redis.set(`${TASK_PREFIX}${taskId}`, JSON.stringify(task), 'EX', 86400 * 7);

      // Add to processing set
      await redis.zadd(`${QUEUE_PREFIX}processing`, Date.now(), taskId);

      return task;
    } catch (error) {
      console.error('Redis dequeue failed, falling back to Supabase:', error);
    }
  }

  // Fallback to Supabase
  const supabase = getSupabaseClient();

  // Fetch and claim task atomically using RPC or manual update
  const { data: tasks, error: fetchError } = await supabase
    .from('task_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);

  if (fetchError || !tasks || tasks.length === 0) {
    return null;
  }

  const task = tasks[0];

  // Claim the task
  const { error: updateError } = await supabase
    .from('task_queue')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      worker_id: workerId,
    })
    .eq('id', task.id)
    .eq('status', 'pending'); // Ensure no race condition

  if (updateError) {
    return null;
  }

  return {
    id: task.id,
    type: task.task_type,
    priority: task.priority,
    payload: task.payload,
    status: 'processing',
    createdAt: task.created_at,
    startedAt: new Date().toISOString(),
    workerId,
    retryCount: task.retry_count,
    maxRetries: task.max_retries,
  };
}

/**
 * Mark a task as completed
 */
export async function completeTask(
  taskId: string,
  result?: Record<string, unknown>
): Promise<void> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      const taskData = await redis.get(`${TASK_PREFIX}${taskId}`);

      if (taskData) {
        const task: QueueTask = JSON.parse(taskData);
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        task.result = result;

        await redis.set(`${TASK_PREFIX}${taskId}`, JSON.stringify(task), 'EX', 86400 * 7);
        await redis.zrem(`${QUEUE_PREFIX}processing`, taskId);

        // Publish completion event
        await redis.publish('task:completed', JSON.stringify({ taskId, result }));

        return;
      }
    } catch (error) {
      console.error('Redis complete failed, falling back to Supabase:', error);
    }
  }

  // Fallback to Supabase
  const supabase = getSupabaseClient();
  await supabase
    .from('task_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result,
    })
    .eq('id', taskId);
}

/**
 * Mark a task as failed
 * Optionally retries by re-enqueuing with exponential backoff
 */
export async function failTask(
  taskId: string,
  error: string,
  shouldRetry: boolean = true
): Promise<{ retried: boolean; movedToDlq: boolean }> {
  const redis = getRedisClient();
  let task: QueueTask | null = null;

  if (redis && isRedisConnected()) {
    try {
      const taskData = await redis.get(`${TASK_PREFIX}${taskId}`);

      if (taskData) {
        task = JSON.parse(taskData);
      }
    } catch (err) {
      console.error('Redis get failed:', err);
    }
  }

  if (!task) {
    // Try Supabase
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('task_queue')
      .select('*')
      .eq('id', taskId)
      .single();

    if (data) {
      task = {
        id: data.id,
        type: data.task_type,
        priority: data.priority,
        payload: data.payload,
        status: data.status,
        createdAt: data.created_at,
        retryCount: data.retry_count,
        maxRetries: data.max_retries,
      };
    }
  }

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  task.retryCount++;
  task.error = error;

  const canRetry = shouldRetry && task.retryCount <= task.maxRetries;

  if (canRetry) {
    // Calculate backoff delay (exponential: 2^retryCount seconds)
    const delayMs = Math.pow(2, task.retryCount) * 1000;

    if (redis && isRedisConnected()) {
      try {
        // Remove from processing
        await redis.zrem(`${QUEUE_PREFIX}processing`, taskId);

        // Re-enqueue with delay using sorted set score
        const score = task.priority * 1e12 + Date.now() + delayMs;
        await redis.zadd(`${QUEUE_PREFIX}pending`, score, taskId);

        task.status = 'pending';
        await redis.set(`${TASK_PREFIX}${taskId}`, JSON.stringify(task), 'EX', 86400 * 7);

        return { retried: true, movedToDlq: false };
      } catch (err) {
        console.error('Redis retry failed:', err);
      }
    }

    // Fallback to Supabase retry
    const supabase = getSupabaseClient();
    await supabase
      .from('task_queue')
      .update({
        status: 'pending',
        retry_count: task.retryCount,
        error_message: error,
      })
      .eq('id', taskId);

    return { retried: true, movedToDlq: false };
  }

  // Move to DLQ
  await moveTaskToDlq(task, error);

  return { retried: false, movedToDlq: true };
}

/**
 * Move a task to the dead letter queue
 */
async function moveTaskToDlq(task: QueueTask, error: string): Promise<void> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      // Remove from processing queue
      await redis.zrem(`${QUEUE_PREFIX}processing`, task.id);

      // Add to DLQ
      const dlqEntry = {
        ...task,
        status: 'failed' as const,
        error,
        movedToDlqAt: new Date().toISOString(),
      };

      await redis.lpush(`${DLQ_PREFIX}${task.type}`, JSON.stringify(dlqEntry));
      await redis.del(`${TASK_PREFIX}${task.id}`);

      // Publish DLQ event
      await redis.publish('task:dlq', JSON.stringify({ taskId: task.id, type: task.type, error }));
    } catch (err) {
      console.error('Redis DLQ failed, falling back to Supabase:', err);
    }
  }

  // Also store in Supabase DLQ for persistence
  const supabase = getSupabaseClient();

  await supabase.from('dead_letter_queue').insert({
    resource_type: task.type,
    resource_id: task.id,
    payload: task.payload,
    error_message: error,
    error_code: 'MAX_RETRIES_EXCEEDED',
    retry_count: task.retryCount,
    max_retries: task.maxRetries,
    status: 'pending',
  });

  // Update task_queue status
  await supabase
    .from('task_queue')
    .update({
      status: 'failed',
      error_message: error,
    })
    .eq('id', task.id);
}

/**
 * Get task status
 */
export async function getTaskStatus(taskId: string): Promise<QueueTask | null> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      const taskData = await redis.get(`${TASK_PREFIX}${taskId}`);

      if (taskData) {
        return JSON.parse(taskData);
      }
    } catch (error) {
      console.error('Redis get status failed:', error);
    }
  }

  // Fallback to Supabase
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('task_queue')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    type: data.task_type,
    priority: data.priority,
    payload: data.payload,
    status: data.status,
    createdAt: data.created_at,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    workerId: data.worker_id,
    retryCount: data.retry_count,
    maxRetries: data.max_retries,
    error: data.error_message,
    result: data.result,
  };
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dlqSize: number;
  source: 'redis' | 'supabase';
}> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      const [pending, processing, dlqDocument, dlqAudio, dlqText] = await Promise.all([
        redis.zcard(`${QUEUE_PREFIX}pending`),
        redis.zcard(`${QUEUE_PREFIX}processing`),
        redis.llen(`${DLQ_PREFIX}document`),
        redis.llen(`${DLQ_PREFIX}audio`),
        redis.llen(`${DLQ_PREFIX}text`),
      ]);

      return {
        pending,
        processing,
        completed: 0, // Would need to track separately
        failed: 0,
        dlqSize: dlqDocument + dlqAudio + dlqText,
        source: 'redis',
      };
    } catch (error) {
      console.error('Redis stats failed:', error);
    }
  }

  // Fallback to Supabase
  const supabase = getSupabaseClient();

  const [taskStats, dlqStats] = await Promise.all([
    supabase.from('task_queue').select('status'),
    supabase.from('dead_letter_queue').select('status').eq('status', 'pending'),
  ]);

  const tasks = taskStats.data || [];
  const dlq = dlqStats.data || [];

  return {
    pending: tasks.filter((t) => t.status === 'pending').length,
    processing: tasks.filter((t) => t.status === 'processing').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    dlqSize: dlq.length,
    source: 'supabase',
  };
}

/**
 * Get workflow name for task type
 */
function getWorkflowName(type: QueueTask['type']): string {
  const mapping: Record<QueueTask['type'], string> = {
    document: 'Document Processing Worker',
    audio: 'Audio Processing Worker',
    text: 'Text Processing Worker',
    onboarding: 'Onboarding Worker',
    communication: 'Communication Worker',
  };

  return mapping[type] || 'Document Processing Worker';
}

/**
 * Enqueue multiple tasks as a batch
 */
export async function enqueueBatch(
  items: Array<{ type: QueueTask['type']; payload: Record<string, unknown> }>,
  options: { priority?: TaskPriority; maxRetries?: number } = {}
): Promise<{ batchId: string; taskIds: string[]; queue: 'redis' | 'supabase' }> {
  const batchId = uuidv4();
  const taskIds: string[] = [];
  let queue: 'redis' | 'supabase' = 'supabase';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = await enqueueTask(item.type, item.payload, {
      ...options,
      batchId,
      itemIndex: i,
    });
    taskIds.push(result.taskId);
    queue = result.queue;
  }

  return { batchId, taskIds, queue };
}
