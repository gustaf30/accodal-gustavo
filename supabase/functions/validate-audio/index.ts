import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AudioData {
  filename: string;
  file_url?: string;
  duration_seconds?: number;
  mime_type?: string;
  transcription: string;
  extracted_entities?: Record<string, unknown>;
  confidence?: number;
  language?: string;
  user_id?: string;
}

interface EntityExtractionResult {
  ssn_mentions: string[];
  tax_id_mentions: string[];
  income_figures: Array<{ amount: number; context: string }>;
  dates: string[];
  names: string[];
  addresses: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedData?: AudioData;
  extractedEntities?: EntityExtractionResult;
}

const VALID_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/m4a",
  "audio/x-m4a",
];

function extractEntities(transcription: string): EntityExtractionResult {
  const result: EntityExtractionResult = {
    ssn_mentions: [],
    tax_id_mentions: [],
    income_figures: [],
    dates: [],
    names: [],
    addresses: [],
  };

  // Extract SSN patterns (XXX-XX-XXXX or spoken format)
  const ssnPattern = /\b(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/g;
  const ssnMatches = transcription.match(ssnPattern);
  if (ssnMatches) {
    result.ssn_mentions = ssnMatches.map((ssn) => {
      const digits = ssn.replace(/\D/g, "");
      return `XXX-XX-${digits.slice(-4)}`; // Masked
    });
  }

  // Extract Tax ID / EIN patterns (XX-XXXXXXX)
  const einPattern = /\b(\d{2}[-\s]?\d{7})\b/g;
  const einMatches = transcription.match(einPattern);
  if (einMatches) {
    result.tax_id_mentions = einMatches.map((ein) => {
      const digits = ein.replace(/\D/g, "");
      return `XX-XXX${digits.slice(-4)}`; // Masked
    });
  }

  // Extract dollar amounts
  const moneyPattern = /\$[\d,]+(?:\.\d{2})?|\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:dollars?|USD)/gi;
  let moneyMatch;
  while ((moneyMatch = moneyPattern.exec(transcription)) !== null) {
    const amountStr = moneyMatch[0].replace(/[$,a-zA-Z\s]/g, "");
    const amount = parseFloat(amountStr);
    if (!isNaN(amount)) {
      // Get surrounding context (30 chars before and after)
      const start = Math.max(0, moneyMatch.index - 30);
      const end = Math.min(transcription.length, moneyMatch.index + moneyMatch[0].length + 30);
      const context = transcription.slice(start, end).trim();
      result.income_figures.push({ amount, context });
    }
  }

  // Extract dates
  const datePatterns = [
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,
  ];
  for (const pattern of datePatterns) {
    const matches = transcription.match(pattern);
    if (matches) {
      result.dates.push(...matches);
    }
  }

  // Extract potential names (capitalized word pairs)
  const namePattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  const nameMatches = transcription.match(namePattern);
  if (nameMatches) {
    // Filter out common non-name phrases
    const nonNames = ["Social Security", "Internal Revenue", "Tax Return", "United States"];
    result.names = nameMatches.filter((name) => !nonNames.includes(name));
  }

  return result;
}

function sanitizeTranscription(transcription: string): string {
  let sanitized = transcription;

  // Redact full SSNs
  sanitized = sanitized.replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[SSN REDACTED]");

  // Redact EINs
  sanitized = sanitized.replace(/\b\d{2}[-\s]?\d{7}\b/g, "[EIN REDACTED]");

  return sanitized;
}

function validateAudio(data: AudioData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields validation
  if (!data.filename || typeof data.filename !== "string") {
    errors.push("filename is required and must be a string");
  }

  if (!data.transcription || typeof data.transcription !== "string") {
    errors.push("transcription is required and must be a string");
  } else if (data.transcription.trim().length === 0) {
    errors.push("transcription cannot be empty");
  } else if (data.transcription.length < 10) {
    warnings.push("Very short transcription - verify audio quality");
  }

  // Optional fields validation
  if (data.mime_type && !VALID_AUDIO_MIME_TYPES.includes(data.mime_type.toLowerCase())) {
    warnings.push(`Unusual audio mime type: ${data.mime_type}`);
  }

  if (data.duration_seconds !== undefined) {
    if (typeof data.duration_seconds !== "number" || data.duration_seconds < 0) {
      errors.push("duration_seconds must be a positive number");
    } else if (data.duration_seconds > 3600) {
      warnings.push("Audio longer than 1 hour - processing may be slower");
    }
  }

  if (data.confidence !== undefined) {
    if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) {
      errors.push("confidence must be a number between 0 and 1");
    } else if (data.confidence < 0.7) {
      warnings.push("Low transcription confidence - manual review recommended");
    }
  }

  if (data.language && typeof data.language !== "string") {
    errors.push("language must be a string");
  }

  // Extract and validate entities
  let extractedEntities: EntityExtractionResult | undefined;
  let sanitizedData: AudioData | undefined;

  if (errors.length === 0 && data.transcription) {
    extractedEntities = extractEntities(data.transcription);

    // Check for sensitive data
    if (extractedEntities.ssn_mentions.length > 0) {
      warnings.push(`Found ${extractedEntities.ssn_mentions.length} SSN mention(s) - data will be masked`);
    }
    if (extractedEntities.tax_id_mentions.length > 0) {
      warnings.push(`Found ${extractedEntities.tax_id_mentions.length} Tax ID mention(s) - data will be masked`);
    }

    sanitizedData = {
      ...data,
      transcription: sanitizeTranscription(data.transcription),
      extracted_entities: {
        ...data.extracted_entities,
        ...extractedEntities,
      },
    };
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedData,
    extractedEntities,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { audio, user_id } = body;

    if (!audio) {
      return new Response(
        JSON.stringify({ error: "audio data is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate audio data
    const validation = validateAudio(audio);

    if (!validation.valid) {
      await supabase.from("processing_logs").insert({
        resource_type: "audio",
        resource_id: null,
        user_id: user_id || null,
        action: "validate",
        status: "failed",
        details: { errors: validation.errors, warnings: validation.warnings },
        error_message: validation.errors.join("; "),
      });

      return new Response(
        JSON.stringify({
          success: false,
          errors: validation.errors,
          warnings: validation.warnings,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Store validated audio transcription
    const { data: insertedAudio, error: insertError } = await supabase
      .from("audio_transcriptions")
      .insert({
        filename: validation.sanitizedData!.filename,
        file_url: validation.sanitizedData!.file_url,
        duration_seconds: validation.sanitizedData!.duration_seconds,
        mime_type: validation.sanitizedData!.mime_type,
        transcription: validation.sanitizedData!.transcription,
        extracted_entities: validation.sanitizedData!.extracted_entities,
        confidence: validation.sanitizedData!.confidence,
        language: validation.sanitizedData!.language || "en",
        user_id: user_id || null,
        status: "completed",
        processed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    // Log successful validation
    await supabase.from("processing_logs").insert({
      resource_type: "audio",
      resource_id: insertedAudio.id,
      user_id: user_id || null,
      action: "validate",
      status: "completed",
      details: {
        warnings: validation.warnings,
        entities_found: validation.extractedEntities,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        audio_id: insertedAudio.id,
        warnings: validation.warnings,
        extracted_entities: validation.extractedEntities,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
