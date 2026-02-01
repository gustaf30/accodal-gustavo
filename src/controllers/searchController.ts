import { Request, Response, NextFunction } from 'express';
import {
  searchDocuments,
  findSimilarDocuments,
  searchByMetadata,
  flagInconsistencies,
} from '../services/searchService';
import { SearchRequest, DocumentType } from '../types';

export async function handleSearch(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const thresholdValue = req.body.threshold ?? req.query.threshold;
    const limitValue = req.body.limit ?? req.query.limit;
    const offsetValue = req.body.offset ?? req.query.offset;

    const searchRequest: SearchRequest = {
      query: req.body.query || req.query.query as string,
      user_id: req.body.user_id || req.query.user_id as string,
      document_type: req.body.document_type || req.query.document_type as DocumentType,
      threshold: thresholdValue !== undefined ? parseFloat(thresholdValue) : undefined,
      limit: limitValue !== undefined ? parseInt(limitValue, 10) : undefined,
      offset: offsetValue !== undefined ? parseInt(offsetValue, 10) : undefined,
    };

    if (!searchRequest.query) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Search query is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const results = await searchDocuments(searchRequest);

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleSimilarDocuments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { documentId } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 5;

    if (!documentId) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Document ID is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const results = await findSimilarDocuments(documentId, limit);

    res.json({
      success: true,
      data: {
        document_id: documentId,
        similar_documents: results,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleMetadataSearch(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const filters = {
      user_id: req.query.user_id as string,
      document_type: req.query.document_type as DocumentType,
      status: req.query.status as string,
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
    };

    const pagination = {
      limit: parseInt(req.query.limit as string, 10) || 20,
      offset: parseInt(req.query.offset as string, 10) || 0,
    };

    const results = await searchByMetadata(filters, pagination);

    res.json({
      success: true,
      data: results,
      pagination: {
        limit: pagination.limit,
        offset: pagination.offset,
        total: results.total,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleInconsistencyCheck(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Document ID is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const results = await flagInconsistencies(documentId);

    res.json({
      success: true,
      data: {
        document_id: documentId,
        ...results,
      },
    });
  } catch (error) {
    next(error);
  }
}
