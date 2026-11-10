import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { NextRequest, NextResponse } from "next/server";
import { appendLog } from "@/lib/generation-log";

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/** Parse keys from env: comma- or newline-separated (so 16 keys on 16 lines = 16 threads). */
function getApiKeys(): string[] {
  const raw = process.env.OPENAI_API_KEY;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Pick a random key so each thread gets equal pressure across instances and time. */
function getNextApiKey(keys: string[]): { key: string; threadIndex: number } {
  const i = Math.floor(Math.random() * keys.length);
  return { key: keys[i], threadIndex: i };
}

/** OpenAI model to use. Override with OPENAI_MODEL. */
const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

function createClient(apiKey: string) {
  return new OpenAI({ apiKey });
}

export async function POST(request: NextRequest) {
  const keys = getApiKeys();
  if (keys.length === 0) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: { message?: string; generatedFileName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "Missing or empty message" },
      { status: 400 }
    );
  }

  const clientIp = getClientIp(request);
  const generatedFileName =
    typeof body.generatedFileName === "string"
      ? body.generatedFileName.trim()
      : "";

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { key: currentKey, threadIndex: currentThread } = getNextApiKey(keys);
    const attemptClient = createClient(currentKey);
    if (attempt === 1) {
      console.log(`[chat] Using thread ${currentThread + 1} of ${keys.length}`);
    } else {
      console.log(`[chat] Retry ${attempt}/${maxAttempts}, thread ${currentThread + 1}`);
    }

    try {
      const stream = await attemptClient.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: message }],
        stream: true,
      } as Parameters<typeof attemptClient.chat.completions.create>[0]);
      

      let fullContent = "";
      let lastFinishReason: string | null = null;
      const encoder = new TextEncoder();

      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
              const delta = chunk.choices?.[0]?.delta;
              const content = delta?.content;
              if (typeof content === "string" && content) {
                fullContent += content;
                controller.enqueue(encoder.encode(JSON.stringify({ content }) + "\n"));
              }
              if (chunk.choices?.[0]?.finish_reason != null) {
                lastFinishReason = chunk.choices[0].finish_reason;
              }
            }
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  done: true,
                  reasoning_details: undefined,
                  role: "assistant",
                  finish_reason: lastFinishReason ?? "stop",
                }) + "\n"
              )
            );
            if (generatedFileName) {
              await appendLog({
                requested_datetime: new Date().toISOString(),
                ip: clientIp,
                generated_filename: generatedFileName,
                threadIndex: currentThread,
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Stream error";
            controller.enqueue(encoder.encode(JSON.stringify({ error: msg }) + "\n"));
          } finally {
            controller.close();
          }
        },
      });

      return new NextResponse(readable, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("LLM request failed");
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  const errorMessage = lastError?.message ?? "LLM request failed";
  return NextResponse.json(
    { error: errorMessage },
    { status: 502 }
  );
}
