export async function runHttpRequest(config: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const url = String(config['url'] ?? '');
  const method = String(config['method'] ?? 'GET').toUpperCase();
  const headersRaw = config['headers'];
  const body = config['body'] != null ? String(config['body']) : undefined;
  const headers: Record<string, string> =
    typeof headersRaw === 'object' && headersRaw !== null ? (headersRaw as Record<string, string>) : {};
  if (!url) return { status: 0, body: 'Missing url' };
  const res = await fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 8000) };
}
