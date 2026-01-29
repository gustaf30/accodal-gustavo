import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TextData {
  source: "email" | "chat" | "form" | "api" | "manual";
  source_identifier?: string;
  subject?: string;
  content: string;
  extracted_data?: Record<string, unknown>;
  user_id?: string;
}

interface ExtractedEntities {
  ssn_mentions: string[];
  tax_id_mentions: string[];
  income_figures: Array<{ amount: number; context: string }>;
  dates: string[];
  email_addresses: string[];
  phone_numbers: string[];
  addresses: string[];
  document_references: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedData?: TextData;
  extractedEntities?: ExtractedEntities;
}

const VALID_SOURCES = ["email", "chat", "form", "api", "manual"];

function extractEntitiesFromText(content: string): ExtractedEntities {
  const result: ExtractedEntities = {
    ssn_mentions: [],
    tax_id_mentions: [],
    income_figures: [],
    dates: [],
    email_addresses: [],
    phone_numbers: [],
    addresses: [],
    document_references: [],
  };

  // Extract SSN patterns
  const ssnPattern = /\b(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/g;
  const ssnMatches = content.match(ssnPattern);
  if (ssnMatches) {
    result.ssn_mentions = ssnMatches.map((ssn) => {
      const digits = ssn.replace(/\D/g, "");
      return `XXX-XX-${digits.slice(-4)}`;
    });
  }

  // Extract Tax ID / EIN patterns
  const einPattern = /\b(\d{2}[-\s]?\d{7})\b/g;
  const einMatches = content.match(einPattern);
  if (einMatches) {
    result.tax_id_mentions = einMatches.map((ein) => {
      const digits = ein.replace(/\D/g, "");
      return `XX-XXX${digits.slice(-4)}`;
    });
  }

  // Extract dollar amounts
  const moneyPattern = /\$[\d,]+(?:\.\d{2})?/g;
  let moneyMatch;
  while ((moneyMatch = moneyPattern.exec(content)) !== null) {
    const amountStr = moneyMatch[0].replace(/[$,]/g, "");
    const amount = parseFloat(amountStr);
    if (!isNaN(amount)) {
      const start = Math.max(0, moneyMatch.index - 50);
      const end = Math.min(content.length, moneyMatch.index + moneyMatch[0].length + 50);
      const context = content.slice(start, end).trim();
      result.income_figures.push({ amount, context });
    }
  }

  // Extract dates
  const datePatterns = [
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
  ];
  for (const pattern of datePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      result.dates.push(...matches);
    }
  }

  // Extract email addresses
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emailMatches = content.match(emailPattern);
  if (emailMatches) {
    result.email_addresses = [...new Set(emailMatches)];
  }

  // Extract phone numbers
  const phonePattern = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
  const phoneMatches = content.match(phonePattern);
  if (phoneMatches) {
    result.phone_numbers = [...new Set(phoneMatches)];
  }

  // Extract document references (W-2, 1099, etc.)
  const docRefPattern = /\b(W-2|1099(?:-[A-Z]+)?|Schedule [A-Z]|Form \d+)\b/gi;
  const docRefMatches = content.match(docRefPattern);
  if (docRefMatches) {
    result.document_references = [...new Set(docRefMatches.map((r) => r.toUpperCase()))];
  }

  return result;
}

function sanitizeTextContent(content: string): string {
  let sanitized = content;

  // Redact full SSNs
  sanitized = sanitized.replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[SSN REDACTED]");

  // Redact EINs
  sanitized = sanitized.replace(/\b\d{2}[-\s]?\d{7}\b/g, "[EIN REDACTED]");

  return sanitized;
}

function validateText(data: TextData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields validation
  if (!data.source || typeof data.source !== "string") {
    errors.push("source is required and must be a string");
  } else if (!VALID_SOURCES.includes(data.source)) {
    errors.push(`Invalid source. Must be one of: ${VALID_SOURCES.join(", ")}`);
  }

  if (!data.content || typeof data.content !== "string") {
    errors.push("content is required and must be a string");
  } else if (data.content.trim().length === 0) {
    errors.push("content cannot be empty");
  } else if (data.content.length > 100000) {
    errors.push("content exceeds maximum length of 100,000 characters");
  }

  // Optional fields validation
  if (data.source_identifier && typeof data.source_identifier !== "string") {
    errors.push("source_identifier must be a string");
  }

  if (data.subject && typeof data.subject !== "string") {
    errors.push("subject must be a string");
  }

  // Email-specific validation
  if (data.source === "email") {
    if (!data.subject) {
      warnings.push("Email missing subject line");
    }
    if (!data.source_identifier) {
      warnings.push("Email missing source identifier (message ID or sender)");
    }
  }

  // Extract entities and sanitize
  let extractedEntities: ExtractedEntities | undefined;
  let sanitizedData: TextData | undefined;

  if (errors.length === 0 && data.content) {
    extractedEntities = extractEntitiesFromText(data.content);

    // Check for sensitive data
    if (extractedEntities.ssn_mentions.length > 0) {
      warnings.push(`Found ${extractedEntities.ssn_mentions.length} SSN mention(s) - data will be masked`);
    }
    if (extractedEntities.tax_id_mentions.length > 0) {
      warnings.push(`Found ${extractedEntities.tax_id_mentions.length} Tax ID mention(s) - data will be masked`);
    }

    // Check for tax document references
    if (extractedEntities.document_references.length > 0) {
      const refs = extractedEntities.document_references.join(", ");
      warnings.push(`Document references found: ${refs}`);
    }

    sanitizedData = {
      ...data,
      content: sanitizeTextContent(data.content),
      extracted_data: {
        ...data.extracted_data,
        entities: extractedEntities,
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
    const { text, user_id } = body;

    if (!text) {
      return new Response(
        JSON.stringify({ error: "text data is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate text data
    const validation = validateText(text);

    if (!validation.valid) {
      await supabase.from("processing_logs").insert({
        resource_type: "text",
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

    // Store validated text extraction
    const { data: insertedText, error: insertError } = await supabase
      .from("text_extractions")
      .insert({
        source: validation.sanitizedData!.source,
        source_identifier: validation.sanitizedData!.source_identifier,
        subject: validation.sanitizedData!.subject,
        content: validation.sanitizedData!.content,
        extracted_data: validation.sanitizedData!.extracted_data,
        entities: validation.extractedEntities,
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
      resource_type: "text",
      resource_id: insertedText.id,
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
        text_id: insertedText.id,
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
