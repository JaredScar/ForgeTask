import type Database from 'better-sqlite3';

const TOKEN = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/** Load global variables for `{{name}}` substitution in node configs. */
export function loadVariableMap(db: Database.Database): Record<string, string> {
  const rows = db.prepare(`SELECT name, value FROM variables ORDER BY name`).all() as { name: string; value: string }[];
  const m: Record<string, string> = {};
  for (const r of rows) {
    if (r.name) m[r.name] = r.value ?? '';
  }
  return m;
}

/** Replace `{{var}}` tokens in a JSON config string before parsing. */
export function interpolateConfigString(configJson: string, vars: Record<string, string>): string {
  return configJson.replace(TOKEN, (_, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    return `{{${name}}}`;
  });
}
