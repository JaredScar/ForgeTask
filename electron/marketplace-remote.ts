import type Database from 'better-sqlite3';
import type { MarketplaceTemplate } from './marketplace-data';
import { MARKETPLACE_ITEMS } from './marketplace-data';

const CACHE_KEY = 'marketplace_cache_json';

function isTemplate(x: unknown): x is MarketplaceTemplate {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o['id'] !== 'string' ||
    typeof o['title'] !== 'string' ||
    typeof o['author'] !== 'string' ||
    typeof o['description'] !== 'string' ||
    typeof o['pro'] !== 'boolean' ||
    !Array.isArray(o['nodes'])
  ) {
    return false;
  }
  for (const n of o['nodes']) {
    if (typeof n !== 'object' || n === null) return false;
    const nn = n as Record<string, unknown>;
    if (typeof nn['node_type'] !== 'string' || typeof nn['kind'] !== 'string') return false;
  }
  return true;
}

function normalizeRemote(raw: unknown): MarketplaceTemplate[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const arr = Array.isArray(o['templates']) ? o['templates'] : Array.isArray(raw) ? (raw as unknown[]) : [];
  const out: MarketplaceTemplate[] = [];
  for (const item of arr) {
    if (!isTemplate(item)) continue;
    const nodes = item.nodes.map((n) => ({
      node_type: String(n.node_type),
      kind: String(n.kind),
      config: typeof n.config === 'object' && n.config !== null ? (n.config as Record<string, unknown>) : {},
    }));
    out.push({ ...item, nodes });
  }
  return out;
}

function mergeById(local: MarketplaceTemplate[], remote: MarketplaceTemplate[]): MarketplaceTemplate[] {
  const map = new Map(local.map((t) => [t.id, t]));
  for (const t of remote) {
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return [...map.values()];
}

/**
 * Optional `TASKFORGE_MARKETPLACE_URL` — JSON `{ "templates": [...] }` or a bare array.
 * Remote templates are merged with built-ins (remote wins on same `id`). Failed fetch uses SQLite cache.
 */
export async function resolveMarketplaceCatalog(db: Database.Database): Promise<MarketplaceTemplate[]> {
  const url = process.env.TASKFORGE_MARKETPLACE_URL?.trim();
  if (url) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      const r = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (r.ok) {
        const j = (await r.json()) as unknown;
        const remote = normalizeRemote(j);
        if (remote.length) {
          db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(CACHE_KEY, JSON.stringify(remote));
          return mergeById(MARKETPLACE_ITEMS, remote);
        }
      }
    } catch {
      /* fall through to cache */
    }
  }
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(CACHE_KEY) as { value: string } | undefined;
  if (row?.value) {
    try {
      const remote = normalizeRemote(JSON.parse(row.value));
      if (remote.length) return mergeById(MARKETPLACE_ITEMS, remote);
    } catch {
      /* ignore */
    }
  }
  return MARKETPLACE_ITEMS;
}

export function findMarketplaceTemplate(catalog: MarketplaceTemplate[], id: string): MarketplaceTemplate | undefined {
  return catalog.find((m) => m.id === id);
}
