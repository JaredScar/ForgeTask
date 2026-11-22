/** Shared by the local API. Every enabled webhook node must accept the caller. */

export function webhookAuthorization(
  configs: Array<Record<string, unknown>>,
  providedSecret: string
): { ok: true } | { ok: false; status: 404 | 401; error: string } {
  if (configs.length === 0) {
    return { ok: false, status: 404, error: 'No enabled webhook trigger found for this workflow' };
  }
  for (const config of configs) {
    const secret = String(config['secret'] ?? '').trim();
    if (secret && providedSecret !== secret) {
      return { ok: false, status: 401, error: 'Invalid webhook secret' };
    }
  }
  return { ok: true };
}

export function webhookSecretFromHeaders(headers: Record<string, unknown>): string {
  const raw = headers['x-webhook-secret'] ?? headers['authorization'] ?? '';
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}
