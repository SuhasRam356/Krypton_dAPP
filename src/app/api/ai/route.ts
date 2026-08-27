import { NextResponse } from 'next/server';
import { z } from 'zod';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(4_000),
});

const RequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(20),
  systemPrompt: z.string().max(2_000).optional(),
});

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const REQUEST_TIMEOUT_MS = 20_000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientId(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || req.headers.get('x-real-ip') || 'anonymous';
}

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientId);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function POST(req: Request) {
  const clientId = getClientId(req);
  if (isRateLimited(clientId)) {
    return NextResponse.json(
      { error: 'Too many AI requests. Please wait and try again.' },
      { status: 429 }
    );
  }

  try {
    const body: unknown = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid AI request payload' }, { status: 400 });
    }

    const payloadMessages = parsed.data.systemPrompt
      ? [{ role: 'system' as const, content: parsed.data.systemPrompt }, ...parsed.data.messages]
      : parsed.data.messages;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI assistant is not configured on this deployment.' },
        { status: 503 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer':
          process.env.OPENROUTER_HTTP_REFERER ??
          process.env.NEXT_PUBLIC_APP_URL ??
          'http://localhost:3000',
        'X-Title': 'Krypton dApp',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.1-8b-instruct',
        messages: payloadMessages,
        max_tokens: 500,
      }),
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.error('OpenRouter API error', response.status, await response.text());
      return NextResponse.json(
        { error: 'AI provider request failed. Please try again later.' },
        { status: 502 }
      );
    }

    const data = (await response.json()) as OpenRouterResponse;
    const result = data.choices?.[0]?.message?.content;

    if (!result) {
      return NextResponse.json(
        { error: 'AI provider returned an empty response.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error('AI Route Error:', getErrorMessage(error));
    return NextResponse.json({ error: 'Internal AI route error' }, { status: 500 });
  }
}
