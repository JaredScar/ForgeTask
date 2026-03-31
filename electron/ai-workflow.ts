export type AiChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };

const WORKFLOW_SYSTEM =
  'You output only valid JSON for a workflow: {"name":string,"nodes":[{"node_type":"trigger"|"condition"|"action","kind":string,"config":object,"sort_order":number}]}. Use kinds: time_schedule, wifi_network, open_application, show_notification, device_connected. No markdown.';

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

export async function completeWorkflowJson(
  apiKey: string,
  messages: Array<{ role: string; content: string }>
): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  const json = JSON.parse(stripJsonFence(text)) as Record<string, unknown>;
  return json;
}

/** Streams assistant deltas; returns full concatenated assistant text. */
export async function streamWorkflowCompletion(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  onDelta: (chunk: string) => void
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `OpenAI HTTP ${res.status}`);
  }
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

export function parseWorkflowFromModelText(text: string): Record<string, unknown> {
  const trimmed = stripJsonFence(text);
  return JSON.parse(trimmed) as Record<string, unknown>;
}
