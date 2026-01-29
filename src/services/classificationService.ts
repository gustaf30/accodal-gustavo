import OpenAI from 'openai';
import { getConfig } from '../config/database';
import {
  ClassificationRequest,
  ClassificationResult,
  DocumentType,
  TaxonomyMapping,
} from '../types';

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const config = getConfig();
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
    });
  }
  return openaiClient;
}

const CLASSIFICATION_PROMPT = `You are a tax document classification expert. Analyze the provided content and classify it.

Respond ONLY with valid JSON:
{
  "document_type": "W-2|1099|1099-MISC|1099-INT|1099-DIV|1099-NEC|Invoice|Receipt|Bank Statement|Other",
  "confidence": 0.95,
  "extracted_data": {
    // Key fields based on document type
  },
  "taxonomy": {
    "category": "tax_form|financial_statement|invoice|receipt|other",
    "subcategory": "more specific classification",
    "tax_year": "2024",
    "form_type": "W-2",
    "keywords": ["keyword1", "keyword2"]
  }
}`;

export async function classifyDocument(
  request: ClassificationRequest
): Promise<ClassificationResult> {
  const openai = getOpenAIClient();

  let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];

  if (request.content_type === 'text') {
    messages = [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      { role: 'user', content: `Classify this document:\n\n${request.content}` },
    ];
  } else if (request.content_type === 'base64_image') {
    const mimeType = detectMimeType(request.filename || 'image.png');
    messages = [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Classify this document:' },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${request.content}` },
          },
        ],
      },
    ];
  } else {
    messages = [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Classify this document:' },
          { type: 'image_url', image_url: { url: request.content } },
        ],
      },
    ];
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 2048,
    temperature: 0.1,
  });

  const responseText = response.choices[0]?.message?.content || '{}';

  try {
    let jsonText = responseText;
    if (jsonText.includes('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const result = JSON.parse(jsonText.trim());

    return {
      document_type: result.document_type || 'Other',
      confidence: result.confidence || 0.5,
      extracted_data: result.extracted_data || {},
      taxonomy: result.taxonomy || getDefaultTaxonomy(result.document_type),
    };
  } catch {
    return {
      document_type: 'Other',
      confidence: 0.3,
      extracted_data: {},
      taxonomy: getDefaultTaxonomy('Other'),
    };
  }
}

export async function classifyBatch(
  items: ClassificationRequest[]
): Promise<ClassificationResult[]> {
  // Process in parallel with concurrency limit
  const concurrencyLimit = 5;
  const results: ClassificationResult[] = [];

  for (let i = 0; i < items.length; i += concurrencyLimit) {
    const batch = items.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map((item) => classifyDocument(item))
    );
    results.push(...batchResults);
  }

  return results;
}

export function buildTaxonomy(
  documentType: DocumentType,
  extractedData: Record<string, unknown>
): TaxonomyMapping {
  const taxonomy: TaxonomyMapping = {
    category: getCategoryForType(documentType),
    subcategory: documentType,
    keywords: [],
  };

  // Extract tax year if available
  const taxYear =
    extractedData.tax_year ||
    extractedData.year ||
    extractYearFromData(extractedData);
  if (taxYear) {
    taxonomy.tax_year = String(taxYear);
  }

  // Set form type for tax documents
  if (documentType.startsWith('1099') || documentType === 'W-2') {
    taxonomy.form_type = documentType;
  }

  // Generate keywords based on document type and data
  taxonomy.keywords = generateKeywords(documentType, extractedData);

  return taxonomy;
}

function getCategoryForType(documentType: DocumentType): string {
  const categoryMapping: Record<string, string> = {
    'W-2': 'tax_form',
    '1099': 'tax_form',
    '1099-MISC': 'tax_form',
    '1099-INT': 'tax_form',
    '1099-DIV': 'tax_form',
    '1099-NEC': 'tax_form',
    Invoice: 'invoice',
    Receipt: 'receipt',
    'Bank Statement': 'financial_statement',
    Other: 'other',
  };

  return categoryMapping[documentType] || 'other';
}

function getDefaultTaxonomy(documentType: string): TaxonomyMapping {
  return {
    category: getCategoryForType(documentType as DocumentType),
    subcategory: documentType || 'unclassified',
    keywords: [],
  };
}

function generateKeywords(
  documentType: DocumentType,
  extractedData: Record<string, unknown>
): string[] {
  const keywords: string[] = [documentType.toLowerCase()];

  // Add common keywords based on document type
  const typeKeywords: Record<string, string[]> = {
    'W-2': ['wages', 'salary', 'tax withholding', 'employer'],
    '1099': ['income', 'contractor', 'tax form'],
    '1099-MISC': ['miscellaneous income', 'royalties', 'rents'],
    '1099-INT': ['interest', 'savings', 'bank'],
    '1099-DIV': ['dividends', 'capital gains', 'investment'],
    '1099-NEC': ['non-employee compensation', 'freelance', 'contractor'],
    Invoice: ['payment', 'billing', 'vendor'],
    Receipt: ['purchase', 'expense', 'transaction'],
    'Bank Statement': ['account', 'balance', 'transactions'],
  };

  keywords.push(...(typeKeywords[documentType] || []));

  // Add keywords from extracted data
  if (extractedData.employer_name) {
    keywords.push(String(extractedData.employer_name).toLowerCase());
  }
  if (extractedData.payer_name) {
    keywords.push(String(extractedData.payer_name).toLowerCase());
  }
  if (extractedData.vendor_name) {
    keywords.push(String(extractedData.vendor_name).toLowerCase());
  }

  return [...new Set(keywords)];
}

function extractYearFromData(data: Record<string, unknown>): string | null {
  // Check common date fields
  const dateFields = ['date', 'invoice_date', 'statement_date', 'created_at'];

  for (const field of dateFields) {
    if (data[field]) {
      const dateStr = String(data[field]);
      const yearMatch = dateStr.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        return yearMatch[1];
      }
    }
  }

  return null;
}

function detectMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    tiff: 'image/tiff',
    tif: 'image/tiff',
  };

  return mimeTypes[ext || ''] || 'image/png';
}

export async function getConfidenceScore(
  result: ClassificationResult
): Promise<{
  overall: number;
  breakdown: Record<string, number>;
}> {
  const breakdown: Record<string, number> = {
    classification: result.confidence,
    data_completeness: calculateDataCompleteness(
      result.document_type,
      result.extracted_data
    ),
    taxonomy_accuracy: calculateTaxonomyAccuracy(result.taxonomy),
  };

  const overall =
    Object.values(breakdown).reduce((a, b) => a + b, 0) /
    Object.keys(breakdown).length;

  return { overall, breakdown };
}

function calculateDataCompleteness(
  documentType: DocumentType,
  data: Record<string, unknown>
): number {
  const requiredFields: Record<string, string[]> = {
    'W-2': ['employer_name', 'wages', 'federal_tax_withheld'],
    '1099': ['payer_name', 'amount'],
    Invoice: ['vendor_name', 'total_amount', 'invoice_number'],
    Receipt: ['vendor_name', 'total_amount'],
  };

  const required = requiredFields[documentType] || [];
  if (required.length === 0) return 0.5;

  const present = required.filter((field) => data[field] !== undefined).length;
  return present / required.length;
}

function calculateTaxonomyAccuracy(taxonomy: TaxonomyMapping): number {
  let score = 0;

  if (taxonomy.category && taxonomy.category !== 'other') score += 0.3;
  if (taxonomy.subcategory) score += 0.3;
  if (taxonomy.tax_year) score += 0.2;
  if (taxonomy.keywords && taxonomy.keywords.length > 0) score += 0.2;

  return score;
}
