import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { getSupabaseClient } from '../config/database';
import { createBatchJob } from '../services/processingService';
import { v4 as uuidv4 } from 'uuid';

// Configure multer for memory storage
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'audio/mpeg',
      'audio/wav',
      'audio/mp4',
      'audio/x-m4a',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported`));
    }
  },
});

// Handle URL-based processing (file already in Storage)
// Sends to n8n for processing instead of processing directly
export async function handleProcessFromUrl(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { filename, file_url, mime_type, user_id } = req.body;
    const userId = user_id || (req as any).userId;

    if (!filename || !file_url) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'filename and file_url are required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Determine task type based on mime_type or filename
    const isAudio = mime_type?.startsWith('audio/') ||
      /\.(mp3|wav|m4a|ogg)$/i.test(filename);
    const taskType = isAudio ? 'audio' : 'document';

    // Get n8n orchestrator URL from environment
    const n8nBaseUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nBaseUrl) {
      res.status(500).json({
        error: {
          code: 'CONFIGURATION_ERROR',
          message: 'N8N_WEBHOOK_URL environment variable not configured',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Use the master orchestrator endpoint (handles all task types)
    const n8nWebhookUrl = `${n8nBaseUrl}/webhook/orchestrate`;

    // Call n8n master orchestrator
    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        task_type: taskType,
        priority: 2,
        payload: {
          filename,
          file_url,
          mime_type: mime_type || 'application/octet-stream',
          user_id: userId,
        },
      }),
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      throw new Error(`n8n webhook failed: ${errorText}`);
    }

    const n8nResult = await n8nResponse.json() as {
      document_id?: string;
      type?: string;
      document_type?: string;
      status?: string;
      success?: boolean;
    };

    res.json({
      success: true,
      data: {
        document_id: n8nResult.document_id,
        document_type: n8nResult.type || n8nResult.document_type,
        filename,
        file_url,
        status: n8nResult.status || 'processed',
        message: 'Document processed via n8n',
      },
    });
  } catch (error) {
    next(error);
  }
}

// Detect MIME type from filename extension
function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/x-m4a',
    'ogg': 'audio/ogg',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

// Clean base64 content - remove data URL prefix if present
function cleanBase64Content(content: string): { base64: string; detectedMime?: string } {
  // Handle various malformed formats from WeWeb
  // Format: "data:image/png;base64,iVBORw0..." or "dataimage/pngbase64iVBORw0..."

  // Standard data URL format
  const dataUrlMatch = content.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (dataUrlMatch) {
    return {
      base64: dataUrlMatch[2],
      detectedMime: dataUrlMatch[1] || undefined,
    };
  }

  // Malformed format without colons/semicolons: "dataimage/pngbase64..."
  const malformedMatch = content.match(/^data?(image\/\w+|audio\/\w+|application\/\w+)base64,?(.*)$/i);
  if (malformedMatch) {
    return {
      base64: malformedMatch[2],
      detectedMime: malformedMatch[1],
    };
  }

  // Already clean base64
  return { base64: content };
}

// Handle base64 upload (easier for WeWeb)
export async function handleBase64Upload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { filename, mime_type, base64_content, user_id } = req.body;
    const userId = user_id || (req as any).userId;

    if (!filename || !base64_content) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'filename and base64_content are required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const supabase = getSupabaseClient();

    // Clean base64 content and detect MIME type
    const { base64: cleanedBase64, detectedMime } = cleanBase64Content(base64_content);

    // Determine final MIME type (priority: detected from base64 > provided > from filename)
    let finalMimeType = mime_type;
    if (!finalMimeType || finalMimeType === 'application/octet-stream') {
      finalMimeType = detectedMime || getMimeTypeFromFilename(filename);
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(cleanedBase64, 'base64');

    // Generate unique filename
    const ext = filename.split('.').pop();
    const uniqueFilename = `${uuidv4()}.${ext}`;
    const storagePath = `uploads/${userId || 'anonymous'}/${uniqueFilename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: finalMimeType,
        upsert: false,
      });

    if (uploadError) {
      res.status(500).json({
        error: {
          code: 'STORAGE_ERROR',
          message: `Storage upload failed: ${uploadError.message}`,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);

    const fileUrl = urlData.publicUrl;

    // Determine item type
    const isAudio = finalMimeType.startsWith('audio/');
    const itemType = isAudio ? 'audio' : 'document';

    // Create batch job with single item
    const job = await createBatchJob({
      items: [
        {
          type: itemType,
          data: {
            filename,
            file_url: fileUrl,
            mime_type: finalMimeType,
            storage_path: storagePath,
          },
        },
      ],
      user_id: userId,
    });

    res.json({
      success: true,
      data: {
        job_id: job.job_id,
        filename,
        file_url: fileUrl,
        storage_path: storagePath,
        status: 'queued',
      },
    });
  } catch (error) {
    next(error);
  }
}

// Handle batch base64 upload (multiple files at once)
export async function handleBatchBase64Upload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { files, user_id } = req.body;
    const userId = user_id || (req as any).userId;

    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'files array is required with at least one file',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (files.length > 20) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Maximum 20 files allowed per batch',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const supabase = getSupabaseClient();

    // Upload all files in parallel
    const uploadPromises = files.map(async (file: { filename: string; base64_content: string; mime_type?: string }) => {
      if (!file.filename || !file.base64_content) {
        return { success: false, filename: file.filename, error: 'Missing filename or base64_content' };
      }

      try {
        // Clean base64 content and detect MIME type
        const { base64: cleanedBase64, detectedMime } = cleanBase64Content(file.base64_content);

        // Determine final MIME type
        let finalMimeType = file.mime_type;
        if (!finalMimeType || finalMimeType === 'application/octet-stream') {
          finalMimeType = detectedMime || getMimeTypeFromFilename(file.filename);
        }

        // Decode base64 to buffer
        const buffer = Buffer.from(cleanedBase64, 'base64');

        // Generate unique filename
        const ext = file.filename.split('.').pop();
        const uniqueFilename = `${uuidv4()}.${ext}`;
        const storagePath = `uploads/${userId || 'anonymous'}/${uniqueFilename}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, buffer, {
            contentType: finalMimeType,
            upsert: false,
          });

        if (uploadError) {
          return { success: false, filename: file.filename, error: uploadError.message };
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('documents')
          .getPublicUrl(storagePath);

        const isAudio = finalMimeType.startsWith('audio/');

        return {
          success: true,
          filename: file.filename,
          type: isAudio ? 'audio' : 'document',
          data: {
            filename: file.filename,
            file_url: urlData.publicUrl,
            mime_type: finalMimeType,
            storage_path: storagePath,
          },
        };
      } catch (err) {
        return {
          success: false,
          filename: file.filename,
          error: err instanceof Error ? err.message : 'Upload failed'
        };
      }
    });

    const uploadResults = await Promise.all(uploadPromises);

    // Filter successful uploads
    const successfulUploads = uploadResults.filter((r) => r.success) as Array<{
      success: true;
      filename: string;
      type: 'document' | 'audio';
      data: Record<string, unknown>;
    }>;

    const failedUploads = uploadResults.filter((r) => !r.success);

    if (successfulUploads.length === 0) {
      res.status(500).json({
        error: {
          code: 'STORAGE_ERROR',
          message: 'All file uploads failed',
          failures: failedUploads,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Create batch job with all items
    const job = await createBatchJob({
      items: successfulUploads.map((u) => ({
        type: u.type,
        data: u.data,
      })),
      user_id: userId,
    });

    res.json({
      success: true,
      data: {
        job_id: job.job_id,
        total_files: successfulUploads.length,
        failed_files: failedUploads.length,
        files: successfulUploads.map((u) => ({
          filename: u.filename,
          file_url: u.data.file_url,
        })),
        failures: failedUploads.length > 0 ? failedUploads : undefined,
        status: 'queued',
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleFileUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    const userId = req.body.user_id || (req as any).userId;

    if (!file) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'No file provided',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const supabase = getSupabaseClient();

    // Generate unique filename
    const ext = file.originalname.split('.').pop();
    const uniqueFilename = `${uuidv4()}.${ext}`;
    const storagePath = `uploads/${userId || 'anonymous'}/${uniqueFilename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      res.status(500).json({
        error: {
          code: 'STORAGE_ERROR',
          message: `Storage upload failed: ${uploadError.message}`,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);

    const fileUrl = urlData.publicUrl;

    // Determine item type
    const isAudio = file.mimetype.startsWith('audio/');
    const itemType = isAudio ? 'audio' : 'document';

    // Create batch job with single item
    const job = await createBatchJob({
      items: [
        {
          type: itemType,
          data: {
            filename: file.originalname,
            file_url: fileUrl,
            mime_type: file.mimetype,
            storage_path: storagePath,
          },
        },
      ],
      user_id: userId,
    });

    res.json({
      success: true,
      data: {
        job_id: job.job_id,
        filename: file.originalname,
        file_url: fileUrl,
        storage_path: storagePath,
        status: 'queued',
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleMultipleFileUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files as Express.Multer.File[];
    const userId = req.body.user_id || (req as any).userId;

    if (!files || files.length === 0) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'No files provided',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const supabase = getSupabaseClient();
    const uploadedItems: Array<{
      type: 'document' | 'audio' | 'text';
      data: Record<string, unknown>;
    }> = [];

    for (const file of files) {
      // Generate unique filename
      const ext = file.originalname.split('.').pop();
      const uniqueFilename = `${uuidv4()}.${ext}`;
      const storagePath = `uploads/${userId || 'anonymous'}/${uniqueFilename}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error(`Failed to upload ${file.originalname}:`, uploadError);
        continue;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(storagePath);

      const isAudio = file.mimetype.startsWith('audio/');

      uploadedItems.push({
        type: isAudio ? 'audio' : 'document',
        data: {
          filename: file.originalname,
          file_url: urlData.publicUrl,
          mime_type: file.mimetype,
          storage_path: storagePath,
        },
      });
    }

    if (uploadedItems.length === 0) {
      res.status(500).json({
        error: {
          code: 'STORAGE_ERROR',
          message: 'All file uploads failed',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Create batch job
    const job = await createBatchJob({
      items: uploadedItems,
      user_id: userId,
    });

    res.json({
      success: true,
      data: {
        job_id: job.job_id,
        total_files: uploadedItems.length,
        files: uploadedItems.map((item) => ({
          filename: item.data.filename,
          file_url: item.data.file_url,
        })),
        status: 'queued',
      },
    });
  } catch (error) {
    next(error);
  }
}
