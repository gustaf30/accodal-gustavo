import { Request, Response, NextFunction } from 'express';
import { buildTaxonomy } from '../services/classificationService';

// Get N8N orchestrator URL from environment
function getN8nOrchestratorUrl(): string {
  const baseUrl = process.env.N8N_WEBHOOK_URL;
  if (!baseUrl) {
    throw new Error('N8N_WEBHOOK_URL environment variable not configured');
  }
  return `${baseUrl}/webhook/orchestrate`;
}

/**
 * Classification is handled by N8N workflows, not directly by the API.
 * This endpoint triggers N8N to process the document.
 */
export async function handleClassify(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { content, content_type, filename, user_id } = req.body;
    const userId = user_id || (req as any).userId;

    if (!content) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Content is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (!content_type || !['text', 'base64_image', 'url'].includes(content_type)) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Valid content_type is required (text, base64_image, or url)',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Determine task type based on content_type
    const taskType = content_type === 'text' ? 'text' : 'document';

    // Build payload for N8N
    const payload: Record<string, unknown> = {
      user_id: userId,
      filename: filename || 'uploaded_content',
    };

    if (content_type === 'base64_image') {
      payload.base64_content = content;
      payload.mime_type = 'image/png'; // Default, could be detected
    } else if (content_type === 'url') {
      payload.file_url = content;
    } else {
      payload.content = content;
    }

    // Send to N8N Master Orchestrator
    const n8nUrl = getN8nOrchestratorUrl();
    const n8nResponse = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_type: taskType,
        priority: 2,
        payload,
      }),
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      throw new Error(`N8N orchestrator error: ${errorText}`);
    }

    const n8nResult = await n8nResponse.json() as {
      success?: boolean;
      task_id?: string;
      status?: string;
      error?: string;
    };

    res.json({
      success: true,
      message: 'Classification task queued in N8N',
      data: {
        task_id: n8nResult.task_id,
        status: n8nResult.status || 'queued',
        note: 'Document will be processed asynchronously. Check task status or query documents table.',
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Batch classification is handled by N8N workflows.
 * This endpoint queues multiple items for N8N processing.
 */
export async function handleBatchClassify(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { items, user_id } = req.body;
    const userId = user_id || (req as any).userId;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Items array is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (items.length > 50) {
      res.status(400).json({
        error: {
          code: 'BATCH_LIMIT_EXCEEDED',
          message: 'Maximum 50 items per batch',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const n8nUrl = getN8nOrchestratorUrl();
    const results: Array<{ index: number; task_id?: string; status: string; error?: string }> = [];

    // Queue each item in N8N
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.content || !item.content_type) {
        results.push({
          index: i,
          status: 'failed',
          error: 'Missing required fields (content, content_type)',
        });
        continue;
      }

      try {
        const taskType = item.content_type === 'text' ? 'text' : 'document';
        const payload: Record<string, unknown> = {
          user_id: userId,
          filename: item.filename || `batch_item_${i}`,
        };

        if (item.content_type === 'base64_image') {
          payload.base64_content = item.content;
        } else if (item.content_type === 'url') {
          payload.file_url = item.content;
        } else {
          payload.content = item.content;
        }

        const n8nResponse = await fetch(n8nUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task_type: taskType,
            priority: 2,
            payload,
          }),
        });

        if (n8nResponse.ok) {
          const n8nResult = await n8nResponse.json() as { task_id?: string };
          results.push({
            index: i,
            task_id: n8nResult.task_id,
            status: 'queued',
          });
        } else {
          results.push({
            index: i,
            status: 'failed',
            error: 'Failed to queue in N8N',
          });
        }
      } catch (error) {
        results.push({
          index: i,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    res.json({
      success: true,
      message: 'Batch classification tasks queued in N8N',
      data: {
        total: items.length,
        queued: results.filter(r => r.status === 'queued').length,
        failed: results.filter(r => r.status === 'failed').length,
        results,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleBuildTaxonomy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { document_type, extracted_data } = req.body;

    if (!document_type) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'document_type is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const taxonomy = buildTaxonomy(document_type, extracted_data || {});

    res.json({
      success: true,
      data: taxonomy,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Webhook endpoint for N8N integration (DEPRECATED)
 *
 * NOTE: N8N document-worker now calls OpenAI GPT-4o Vision directly for OCR/classification.
 * This endpoint is kept for backwards compatibility but is not used in the current workflow.
 *
 * If you want N8N to delegate classification to the API:
 * 1. Update document-worker to call this endpoint instead of OpenAI directly
 * 2. This would centralize classification logic in the API
 *
 * Current architecture: N8N handles all processing directly (recommended for performance)
 */
export async function handleClassifyWebhook(
  _req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  // Return deprecation notice - N8N should process directly
  res.status(410).json({
    success: false,
    error: 'This endpoint is deprecated. N8N document-worker handles classification directly via OpenAI GPT-4o Vision.',
    recommendation: 'Use N8N workflows for document processing. API endpoints /classify and /classify/batch now trigger N8N.',
    timestamp: new Date().toISOString(),
  });
}
