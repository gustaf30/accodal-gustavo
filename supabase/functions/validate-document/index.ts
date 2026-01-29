import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DocumentData {
  filename: string;
  file_url?: string;
  file_size?: number;
  mime_type?: string;
  type: string;
  extracted_data: Record<string, unknown>;
  ocr_confidence?: number;
  classification_confidence?: number;
  user_id?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedData?: DocumentData;
}

const VALID_DOCUMENT_TYPES = [
  "W-2",
  "1099",
  "1099-MISC",
  "1099-INT",
  "1099-DIV",
  "1099-NEC",
  "Invoice",
  "Receipt",
  "Bank Statement",
  "Other",
];

const VALID_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/webp",
];

function maskSSN(ssn: string): string {
  const digits = ssn.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `XXX-XX-${digits.slice(-4)}`;
  }
  return "XXX-XX-XXXX";
}

function maskTaxId(taxId: string): string {
  const digits = taxId.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `XX-XXX${digits.slice(-4)}`;
  }
  return "XX-XXXXXXX";
}

function sanitizeExtractedData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...data };

  // Mask SSN fields
  const ssnFields = ["ssn", "social_security_number", "employee_ssn", "recipient_ssn"];
  for (const field of ssnFields) {
    if (sanitized[field] && typeof sanitized[field] === "string") {
      sanitized[`${field}_masked`] = maskSSN(sanitized[field] as string);
      sanitized[`${field}_hash`] = btoa(sanitized[field] as string); // Base64 for now, use proper hash in production
      delete sanitized[field];
    }
  }

  // Mask Tax ID fields
  const taxIdFields = ["ein", "tax_id", "employer_ein", "payer_tin"];
  for (const field of taxIdFields) {
    if (sanitized[field] && typeof sanitized[field] === "string") {
      sanitized[`${field}_masked`] = maskTaxId(sanitized[field] as string);
      sanitized[`${field}_hash`] = btoa(sanitized[field] as string);
      delete sanitized[field];
    }
  }

  return sanitized;
}

function validateDocument(data: DocumentData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields validation
  if (!data.filename || typeof data.filename !== "string") {
    errors.push("filename is required and must be a string");
  }

  if (!data.type || typeof data.type !== "string") {
    errors.push("type is required and must be a string");
  } else if (!VALID_DOCUMENT_TYPES.includes(data.type)) {
    errors.push(`Invalid document type. Must be one of: ${VALID_DOCUMENT_TYPES.join(", ")}`);
  }

  if (!data.extracted_data || typeof data.extracted_data !== "object") {
    errors.push("extracted_data is required and must be an object");
  }

  // Optional fields validation
  if (data.mime_type && !VALID_MIME_TYPES.includes(data.mime_type)) {
    warnings.push(`Unusual mime type: ${data.mime_type}`);
  }

  if (data.ocr_confidence !== undefined) {
    if (typeof data.ocr_confidence !== "number" || data.ocr_confidence < 0 || data.ocr_confidence > 1) {
      errors.push("ocr_confidence must be a number between 0 and 1");
    } else if (data.ocr_confidence < 0.7) {
      warnings.push("Low OCR confidence - manual review recommended");
    }
  }

  if (data.classification_confidence !== undefined) {
    if (typeof data.classification_confidence !== "number" || data.classification_confidence < 0 || data.classification_confidence > 1) {
      errors.push("classification_confidence must be a number between 0 and 1");
    } else if (data.classification_confidence < 0.8) {
      warnings.push("Low classification confidence - verify document type");
    }
  }

  // Document type specific validation
  if (errors.length === 0 && data.extracted_data) {
    const extractedData = data.extracted_data as Record<string, unknown>;

    if (data.type === "W-2") {
      const requiredW2Fields = ["employer_name", "wages"];
      for (const field of requiredW2Fields) {
        if (!extractedData[field]) {
          warnings.push(`W-2 missing recommended field: ${field}`);
        }
      }
    } else if (data.type.startsWith("1099")) {
      const required1099Fields = ["payer_name", "amount"];
      for (const field of required1099Fields) {
        if (!extractedData[field]) {
          warnings.push(`1099 missing recommended field: ${field}`);
        }
      }
    } else if (data.type === "Invoice") {
      const requiredInvoiceFields = ["vendor_name", "total_amount"];
      for (const field of requiredInvoiceFields) {
        if (!extractedData[field]) {
          warnings.push(`Invoice missing recommended field: ${field}`);
        }
      }
    }
  }

  // Sanitize data if validation passed
  let sanitizedData: DocumentData | undefined;
  if (errors.length === 0) {
    sanitizedData = {
      ...data,
      extracted_data: sanitizeExtractedData(data.extracted_data),
    };
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedData,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { document, user_id } = body;

    if (!document) {
      return new Response(
        JSON.stringify({ error: "document data is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate document
    const validation = validateDocument(document);

    if (!validation.valid) {
      // Log validation failure
      await supabase.from("processing_logs").insert({
        resource_type: "document",
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

    // Store validated document
    const { data: insertedDoc, error: insertError } = await supabase
      .from("documents")
      .insert({
        ...validation.sanitizedData,
        user_id: user_id || null,
        status: validation.warnings.length > 0 ? "needs_review" : "completed",
        processed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    // Log successful validation
    await supabase.from("processing_logs").insert({
      resource_type: "document",
      resource_id: insertedDoc.id,
      user_id: user_id || null,
      action: "validate",
      status: "completed",
      details: { warnings: validation.warnings },
    });

    return new Response(
      JSON.stringify({
        success: true,
        document_id: insertedDoc.id,
        warnings: validation.warnings,
        status: insertedDoc.status,
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
