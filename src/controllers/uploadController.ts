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
        success: false,
        error: 'filename and file_url are required',
      });
      return;
    }

    // Determine task type based on mime_type or filename
    const isAudio = mime_type?.startsWith('audio/') ||
      /\.(mp3|wav|m4a|ogg)$/i.test(filename);
    const taskType = isAudio ? 'audio' : 'document';

    // Get n8n webhook URL from environment or use default
    const n8nBaseUrl = process.env.N8N_WEBHOOK_URL ||
      'https://exopoditic-emersyn-unblushing.ngrok-free.dev';

    // Call appropriate n8n workflow based on task type
    const webhookPath = taskType === 'audio' ? '/webhook/process-audio' : '/webhook/process-document';
    const n8nWebhookUrl = n8nBaseUrl + webhookPath;

    // Call n8n document/audio processing webhook
    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        file_url,
        mime_type: mime_type || 'application/octet-stream',
        user_id: userId,
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
        success: false,
        error: 'filename and base64_content are required',
      });
      return;
    }

    const supabase = getSupabaseClient();

    // Decode base64 to buffer
    const buffer = Buffer.from(base64_content, 'base64');

    // Generate unique filename
    const ext = filename.split('.').pop();
    const uniqueFilename = `${uuidv4()}.${ext}`;
    const storagePath = `uploads/${userId || 'anonymous'}/${uniqueFilename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: mime_type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      res.status(500).json({
        success: false,
        error: `Storage upload failed: ${uploadError.message}`,
      });
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);

    const fileUrl = urlData.publicUrl;

    // Determine item type
    const isAudio = mime_type?.startsWith('audio/');
    const itemType = isAudio ? 'audio' : 'document';

    // Create batch job with single item
    const job = await createBatchJob({
      items: [
        {
          type: itemType,
          data: {
            filename,
            file_url: fileUrl,
            mime_type,
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
        success: false,
        error: 'No file provided',
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
        success: false,
        error: `Storage upload failed: ${uploadError.message}`,
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
        success: false,
        error: 'No files provided',
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
        success: false,
        error: 'All file uploads failed',
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
