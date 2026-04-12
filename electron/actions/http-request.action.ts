import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPrivateOrLoopbackIp(host: string): boolean {
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map((v) => Number(v));
    if (octets.length !== 4 || octets.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return true;
    if (octets[0] === 10) return true;
    if (octets[0] === 127) return true;
    if (octets[0] === 0) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    return false;
  }
  if (ipVersion === 6) {
    const normalized = host.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return true;
}

export async function assertPublicHttpUrl(rawUrl: string, allowPrivateNetwork: boolean): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs are allowed');
  }
  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) throw new Error('Invalid URL host');
  if (allowPrivateNetwork) return parsed;
  if (hostname === 'localhost') throw new Error('Loopback/private URLs are blocked');
  if (isPrivateOrLoopbackIp(hostname)) throw new Error('Loopback/private URLs are blocked');
  const resolved = await lookup(hostname, { all: true });
  if (resolved.some((entry) => isPrivateOrLoopbackIp(entry.address))) {
    throw new Error('Resolved host points to a private address');
  }
  return parsed;
}

export async function runHttpRequest(config: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const url = String(config['url'] ?? '').trim();
  const method = String(config['method'] ?? 'GET').toUpperCase();
  const headersRaw = config['headers'];
  const body = config['body'] != null ? String(config['body']) : undefined;
  const allowPrivateNetwork = config['allowPrivateNetwork'] === true;
  const timeoutMs = Math.min(30_000, Math.max(1_000, Number(config['timeoutMs'] ?? 10_000)));
  const headers: Record<string, string> =
    typeof headersRaw === 'object' && headersRaw !== null ? (headersRaw as Record<string, string>) : {};
  if (!url) return { status: 0, body: 'Missing url' };
  const safeUrl = await assertPublicHttpUrl(url, allowPrivateNetwork);
  const res = await fetch(safeUrl, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 8000) };
}
