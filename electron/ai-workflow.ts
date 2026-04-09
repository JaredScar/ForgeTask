export type AiChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };

/** Default TaskForge local gateway (see local-ai-gateway/). */
export const DEFAULT_LOCAL_AI_BASE_URL = 'http://127.0.0.1:11435';
export const DEFAULT_LOCAL_AI_MODEL = 'llama3.2';

export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_WORKFLOW_MODEL = 'gpt-4o-mini';

/**
 * System prompt for workflow JSON generation (OpenAI path).
 * Keep in sync with `local-ai-gateway/workflow-ai.mjs` (local path builds messages in the gateway).
 */
const WORKFLOW_SYSTEM =
  'You output only valid JSON for a workflow: {"name":string,"nodes":[{"node_type":"trigger"|"condition"|"action","kind":string,"config":object,"sort_order":number}]}. Use kinds: time_schedule, wifi_network, open_application, show_notification, device_connected. No markdown.';

export type WorkflowMode = 'local_gateway' | 'openai';

export type ChatCompletionsCall = {
  /** Full URL for POST: OpenAI `/v1/chat/completions` or gateway `/v1/taskforge/workflow-completion`. */
  endpointUrl: string;
  model: string;
  apiKey?: string | null;
  /** When true, `endpointUrl` host must be loopback (local gateway). */
  requireLoopback: boolean;
  workflowMode: WorkflowMode;
};

export function chatCompletionsUrlFromBase(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, '');
  return `${u}/v1/chat/completions`;
}

/** TaskForge workflow endpoint on the local gateway (builds system prompt + messages server-side). */
export function taskforgeWorkflowCompletionUrl(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, '');
  return `${u}/v1/taskforge/workflow-completion`;
}

/** Reject non-loopback hosts when using local AI (SSRF hardening). */
export function assertLoopbackChatEndpoint(endpointUrl: string): void {
  let url: URL;
  try {
    url = new URL(endpointUrl);
  } catch {
    throw new Error('Invalid local AI URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Local AI URL must use http or https');
  }
  const host = url.hostname.toLowerCase();
  const ok = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!ok) {
    throw new Error('Local AI must use a loopback host (127.0.0.1, localhost, or ::1)');
  }
}

function authHeaders(apiKey: string | null | undefined): Record<string, string> {
  const t = apiKey?.trim();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

export function buildWorkflowParseMessages(
  prompt: string,
  history?: AiChatMsg[]
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: WORKFLOW_SYSTEM }];
  if (history?.length) {
    for (const m of history.slice(-12)) {
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function stripJsonFence(text: string): string {
  return text.replace(/^```json\s*|\s*```$/g, '').trim();
}

async function parseWorkflowJsonFromChatResponse(res: Response): Promise<Record<string, unknown>> {
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  const json = JSON.parse(stripJsonFence(text)) as Record<string, unknown>;
  return json;
}

/** Shared SSE reader for OpenAI-compatible streaming responses. */
async function readOpenAiSseStream(res: Response, onDelta: (chunk: string) => void): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.replace(/^data:\s*/, '').trim();
      if (!s || s === '[DONE]') continue;
      if (!s.startsWith('{')) continue;
      try {
        const j = JSON.parse(s) as { choices?: { delta?: { content?: string } }[] };
        const c = j.choices?.[0]?.delta?.content;
        if (c) {
          full += c;
          onDelta(c);
        }
      } catch {
        /* ignore partial JSON lines */
      }
    }
  }
  return full;
}

export async function completeWorkflowJson(
  call: ChatCompletionsCall,
  messages: Array<{ role: string; content: string }>
): Promise<Record<string, unknown>> {
  if (call.requireLoopback) {
    assertLoopbackChatEndpoint(call.endpointUrl);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(call.apiKey),
  };
  const res = await fetch(call.endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: call.model,
      messages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    throw new Error(`Chat completions HTTP ${res.status}`);
  }
  return parseWorkflowJsonFromChatResponse(res);
}

/** Local gateway: sends prompt + history only; gateway injects system prompt and forwards to Ollama. */
export async function completeWorkflowJsonLocal(
  call: ChatCompletionsCall,
  payload: { prompt: string; messages?: AiChatMsg[] }
): Promise<Record<string, unknown>> {
  assertLoopbackChatEndpoint(call.endpointUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(call.apiKey),
  };
  const res = await fetch(call.endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: payload.prompt,
      messages: payload.messages,
      model: call.model,
      stream: false,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    throw new Error(`Workflow completion HTTP ${res.status}`);
  }
  return parseWorkflowJsonFromChatResponse(res);
}

/** Streams assistant deltas; returns full concatenated assistant text. */
export async function streamWorkflowCompletion(
  call: ChatCompletionsCall,
  messages: Array<{ role: string; content: string }>,
  onDelta: (chunk: string) => void
): Promise<string> {
  if (call.requireLoopback) {
    assertLoopbackChatEndpoint(call.endpointUrl);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(call.apiKey),
  };
  const res = await fetch(call.endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: call.model,
      messages,
      stream: true,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Chat completions HTTP ${res.status}`);
  }
  return readOpenAiSseStream(res, onDelta);
}

export async function streamWorkflowCompletionLocal(
  call: ChatCompletionsCall,
  payload: { prompt: string; messages?: AiChatMsg[] },
  onDelta: (chunk: string) => void
): Promise<string> {
  assertLoopbackChatEndpoint(call.endpointUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(call.apiKey),
  };
  const res = await fetch(call.endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: payload.prompt,
      messages: payload.messages,
      model: call.model,
      stream: true,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Workflow completion HTTP ${res.status}`);
  }
  return readOpenAiSseStream(res, onDelta);
}

export function parseWorkflowFromModelText(text: string): Record<string, unknown> {
  const trimmed = stripJsonFence(text);
  return JSON.parse(trimmed) as Record<string, unknown>;
}
