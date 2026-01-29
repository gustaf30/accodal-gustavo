import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database';
import {
  createBatchJob,
  getJobStatus,
  reprocessDocument,
  getProcessingStats,
} from '../services/processingService';
import { BatchProcessingRequest, Document } from '../types';

export async function handleGetDocument(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Document not found',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.json({
      success: true,
      data: data as Document,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleListDocuments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    const userId = req.query.user_id as string;
    const status = req.query.status as string;
    const type = req.query.type as string;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    let query = supabase
      .from('documents')
      .select('*', { count: 'exact' });

    if (userId) query = query.eq('user_id', userId);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      data: data as Document[],
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleDeleteDocument(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    // Delete embeddings first
    await supabase
      .from('document_embeddings')
      .delete()
      .eq('document_id', id);

    // Delete the document
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

export async function handleBatchProcess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const request: BatchProcessingRequest = {
      items: req.body.items,
      user_id: req.body.user_id,
      priority: req.body.priority,
    };

    if (!request.items || !Array.isArray(request.items) || request.items.length === 0) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Items array is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (request.items.length > 100) {
      res.status(400).json({
        error: {
          code: 'BATCH_LIMIT_EXCEEDED',
          message: 'Maximum 100 items per batch',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const response = await createBatchJob(request);

    res.status(202).json({
      success: true,
      data: response,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleGetJobStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { jobId } = req.params;

    const status = await getJobStatus(jobId);

    if (!status) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Job not found',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleReprocess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const document = await reprocessDocument(id);

    res.json({
      success: true,
      data: document,
      message: 'Document reprocessing completed',
    });
  } catch (error) {
    next(error);
  }
}

export async function handleGetStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.query.user_id as string;

    const stats = await getProcessingStats(userId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}

// Audio endpoints
export async function handleGetAudio(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('audio_transcriptions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Audio transcription not found',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleListAudio(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    const userId = req.query.user_id as string;
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    let query = supabase
      .from('audio_transcriptions')
      .select('*', { count: 'exact' });

    if (userId) query = query.eq('user_id', userId);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      data,
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

// Text extraction endpoints
export async function handleGetText(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('text_extractions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Text extraction not found',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleListText(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    const userId = req.query.user_id as string;
    const source = req.query.source as string;
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    let query = supabase
      .from('text_extractions')
      .select('*', { count: 'exact' });

    if (userId) query = query.eq('user_id', userId);
    if (source) query = query.eq('source', source);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      data,
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}
