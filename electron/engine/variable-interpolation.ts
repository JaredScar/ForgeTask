import type Database from 'better-sqlite3';
import { decryptOptional } from '../secret-store';

const VAR_TOKEN = /\{\{([a-zA-Z0-9_]+)\}\}/g;
const CTX_TOKEN = /\{\{context\.([a-zA-Z0-9_]+)\}\}/g;

/** Load global variables for `{{name}}` substitution in node configs. */
export function loadVariableMap(db: Database.Database): Record<string, string> {
  const rows = db.prepare(`SELECT name, value FROM variables ORDER BY name`).all() as { name: string; value: string }[];
  const m: Record<string, string> = {};
  for (const r of rows) {
    if (r.name) m[r.name] = decryptOptional(r.value);
  }
  return m;
}

/** Escape a value that is substituted into a JSON string. */
function jsonStringContent(value: string): string {
  return value.replace(/[\u0000-\u001F\\"]/g, (ch) => {
    if (ch === '\\') return '\\\\';
    if (ch === '"') return '\\"';
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return '\\t';
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

/**
 * Replace `{{context.key}}` then `{{var}}` in a JSON config string before parsing.
 * Inserted text is escaped so quotes and newlines do not break the JSON.
 * Unknown tokens are left unchanged so validation can surface them.
 */
export function interpolateConfigString(
  configJson: string,
  vars: Record<string, string>,
  context: Record<string, string> = {}
): string {
  let s = configJson.replace(CTX_TOKEN, (_, key: string) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) return jsonStringContent(context[key]!);
    return `{{context.${key}}}`;
  });
  s = s.replace(VAR_TOKEN, (_, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return jsonStringContent(vars[name]!);
    return `{{${name}}}`;
  });
  return s;
}
