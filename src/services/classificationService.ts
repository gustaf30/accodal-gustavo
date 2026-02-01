/**
 * Classification Service
 *
 * NOTE: Document classification is now handled by N8N workflows.
 * N8N document-worker calls OpenAI GPT-4o Vision directly for OCR and classification.
 *
 * This service only provides taxonomy building for categorization purposes.
 */

import { DocumentType, TaxonomyMapping } from '../types';

/**
 * Build taxonomy metadata for a document type
 */
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

function generateKeywords(
  documentType: DocumentType,
  extractedData: Record<string, unknown>
): string[] {
  const keywords: string[] = [documentType.toLowerCase()];

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
