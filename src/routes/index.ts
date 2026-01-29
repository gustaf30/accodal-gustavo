import { Router } from 'express';
import {
  handleSearch,
  handleSimilarDocuments,
  handleMetadataSearch,
  handleInconsistencyCheck,
} from '../controllers/searchController';
import {
  handleClassify,
  handleBatchClassify,
  handleBuildTaxonomy,
  handleClassifyWebhook,
} from '../controllers/classificationController';
import {
  handleGetDocument,
  handleListDocuments,
  handleDeleteDocument,
  handleBatchProcess,
  handleGetJobStatus,
  handleReprocess,
  handleGetStats,
  handleGetAudio,
  handleListAudio,
  handleGetText,
  handleListText,
} from '../controllers/documentController';
import { authMiddleware, optionalAuthMiddleware, apiKeyMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ============================================
// Search Routes (RAG)
// ============================================

// Semantic search
router.post(
  '/search',
  rateLimiter({ limit: 50, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleSearch
);

router.get(
  '/search',
  rateLimiter({ limit: 50, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleSearch
);

// Find similar documents
router.get(
  '/documents/:documentId/similar',
  rateLimiter({ limit: 30, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleSimilarDocuments
);

// Metadata search
router.get(
  '/documents/metadata',
  rateLimiter({ limit: 100, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleMetadataSearch
);

// Check for inconsistencies
router.get(
  '/documents/:documentId/inconsistencies',
  rateLimiter({ limit: 20, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleInconsistencyCheck
);

// ============================================
// Classification Routes (KAG)
// ============================================

// Classify single document
router.post(
  '/classify',
  rateLimiter({ limit: 30, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleClassify
);

// Batch classification
router.post(
  '/classify/batch',
  rateLimiter({ limit: 10, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleBatchClassify
);

// Build taxonomy
router.post(
  '/taxonomy/build',
  rateLimiter({ limit: 50, windowMs: 60000 }),
  handleBuildTaxonomy
);

// Webhook endpoint for N8N
router.post(
  '/webhook/classify',
  apiKeyMiddleware,
  handleClassifyWebhook
);

// ============================================
// Document Routes
// ============================================

// Get single document
router.get(
  '/documents/:id',
  optionalAuthMiddleware,
  handleGetDocument
);

// List documents
router.get(
  '/documents',
  optionalAuthMiddleware,
  handleListDocuments
);

// Delete document
router.delete(
  '/documents/:id',
  authMiddleware,
  handleDeleteDocument
);

// Reprocess document
router.post(
  '/documents/:id/reprocess',
  authMiddleware,
  handleReprocess
);

// ============================================
// Batch Processing Routes
// ============================================

// Create batch job
router.post(
  '/batch/process',
  rateLimiter({ limit: 10, windowMs: 60000 }),
  optionalAuthMiddleware,
  handleBatchProcess
);

// Get job status
router.get(
  '/batch/jobs/:jobId',
  handleGetJobStatus
);

// ============================================
// Audio Routes
// ============================================

// Get single audio transcription
router.get(
  '/audio/:id',
  optionalAuthMiddleware,
  handleGetAudio
);

// List audio transcriptions
router.get(
  '/audio',
  optionalAuthMiddleware,
  handleListAudio
);

// ============================================
// Text Extraction Routes
// ============================================

// Get single text extraction
router.get(
  '/text/:id',
  optionalAuthMiddleware,
  handleGetText
);

// List text extractions
router.get(
  '/text',
  optionalAuthMiddleware,
  handleListText
);

// ============================================
// Stats & Monitoring Routes
// ============================================

// Get processing stats
router.get(
  '/stats',
  optionalAuthMiddleware,
  handleGetStats
);

export default router;
