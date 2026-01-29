import { Request, Response, NextFunction } from 'express';
import {
  classifyDocument,
  classifyBatch,
  buildTaxonomy,
  getConfidenceScore,
} from '../services/classificationService';
import { ClassificationRequest } from '../types';

export async function handleClassify(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { content, content_type, filename } = req.body;

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

    const request: ClassificationRequest = {
      content,
      content_type,
      filename,
    };

    const result = await classifyDocument(request);
    const confidence = await getConfidenceScore(result);

    res.json({
      success: true,
      data: {
        ...result,
        confidence_breakdown: confidence,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleBatchClassify(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { items } = req.body;

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

    // Validate all items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.content || !item.content_type) {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: `Item ${i} is missing required fields (content, content_type)`,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
    }

    const results = await classifyBatch(items);

    res.json({
      success: true,
      data: {
        total: results.length,
        results: results.map((result, index) => ({
          index,
          ...result,
        })),
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

// Webhook endpoint for N8N integration
export async function handleClassifyWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body;

    // Support both direct content and file references
    let classificationRequest: ClassificationRequest;

    if (payload.base64_content) {
      classificationRequest = {
        content: payload.base64_content,
        content_type: 'base64_image',
        filename: payload.filename,
      };
    } else if (payload.file_url) {
      classificationRequest = {
        content: payload.file_url,
        content_type: 'url',
        filename: payload.filename,
      };
    } else if (payload.text_content) {
      classificationRequest = {
        content: payload.text_content,
        content_type: 'text',
      };
    } else {
      res.status(400).json({
        success: false,
        error: 'No content provided (base64_content, file_url, or text_content required)',
      });
      return;
    }

    const result = await classifyDocument(classificationRequest);

    // Return in N8N-friendly format
    res.json({
      success: true,
      document_type: result.document_type,
      confidence: result.confidence,
      extracted_data: result.extracted_data,
      taxonomy: result.taxonomy,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Return error in N8N-friendly format
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Classification failed',
      timestamp: new Date().toISOString(),
    });
  }
}
