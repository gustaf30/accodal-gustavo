import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmbeddingRequest {
  document_id: string;
  content: string;
  chunk_index?: number;
  metadata?: Record<string, unknown>;
  generate_embedding?: boolean;
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

async function generateEmbedding(text: string, openaiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data: OpenAIEmbeddingResponse = await response.json();
  return data.data[0].embedding;
}

function chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChunkSize;

    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const breakPoints = ["\n\n", "\n", ". ", "! ", "? "];
      for (const breakPoint of breakPoints) {
        const lastBreak = text.lastIndexOf(breakPoint, end);
        if (lastBreak > start + maxChunkSize / 2) {
          end = lastBreak + breakPoint.length;
          break;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;

    if (start < 0) start = 0;
    if (chunks.length > 100) break; // Safety limit
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const {
      document_id,
      content,
      chunk_index = 0,
      metadata = {},
      generate_embedding = true,
      chunk_text = false,
      embedding,
    }: EmbeddingRequest & { chunk_text?: boolean; embedding?: number[] } = body;

    // Validation
    if (!document_id) {
      return new Response(
        JSON.stringify({ error: "document_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "content is required and must be a non-empty string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify document exists
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id, user_id, type")
      .eq("id", document_id)
      .single();

    if (docError || !document) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startTime = Date.now();
    const embeddingsToStore: Array<{
      document_id: string;
      chunk_index: number;
      content: string;
      embedding: number[];
      metadata: Record<string, unknown>;
    }> = [];

    if (chunk_text) {
      // Chunk the text and generate embeddings for each chunk
      const chunks = chunkText(content);

      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];
        let chunkEmbedding: number[];

        if (generate_embedding) {
          chunkEmbedding = await generateEmbedding(chunkContent, openaiKey);
        } else {
          throw new Error("embedding must be provided when generate_embedding is false");
        }

        embeddingsToStore.push({
          document_id,
          chunk_index: i,
          content: chunkContent,
          embedding: chunkEmbedding,
          metadata: {
            ...metadata,
            document_type: document.type,
            chunk_total: chunks.length,
            original_length: content.length,
          },
        });
      }
    } else {
      // Single embedding
      let finalEmbedding: number[];

      if (embedding && Array.isArray(embedding)) {
        if (embedding.length !== 1536) {
          return new Response(
            JSON.stringify({ error: "embedding must have 1536 dimensions" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        finalEmbedding = embedding;
      } else if (generate_embedding) {
        finalEmbedding = await generateEmbedding(content, openaiKey);
      } else {
        return new Response(
          JSON.stringify({ error: "Either embedding must be provided or generate_embedding must be true" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      embeddingsToStore.push({
        document_id,
        chunk_index,
        content,
        embedding: finalEmbedding,
        metadata: {
          ...metadata,
          document_type: document.type,
        },
      });
    }

    // Store all embeddings
    const { data: insertedEmbeddings, error: insertError } = await supabase
      .from("document_embeddings")
      .insert(embeddingsToStore)
      .select("id, chunk_index");

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    const durationMs = Date.now() - startTime;

    // Log the operation
    await supabase.from("processing_logs").insert({
      resource_type: "embedding",
      resource_id: document_id,
      user_id: document.user_id,
      action: "store_embedding",
      status: "completed",
      details: {
        chunks_stored: embeddingsToStore.length,
        chunking_enabled: chunk_text,
        embedding_generated: generate_embedding,
      },
      duration_ms: durationMs,
    });

    return new Response(
      JSON.stringify({
        success: true,
        document_id,
        embeddings_stored: insertedEmbeddings.length,
        embedding_ids: insertedEmbeddings.map((e) => e.id),
        duration_ms: durationMs,
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
