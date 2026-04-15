/**
 * Non-secret markers for local UI development only.
 * Keep strings in sync with `src/app/core/local-dev-keys.ts`.
 */

export const LOCAL_DEV_OPENAI_API_KEY_PLACEHOLDER = 'sk-local-forgetask-dev-placeholder-not-real';

export const LOCAL_DEV_REST_API_KEY_PLACEHOLDER = 'tf_live_forgetask_dev_local_placeholder_only';

/** True if this value must never be sent to OpenAI (treat like “no key”). */
export function isLocalDevOpenAiPlaceholder(key: string | undefined | null): boolean {
  const k = (key ?? '').trim();
  return k === LOCAL_DEV_OPENAI_API_KEY_PLACEHOLDER || k.startsWith('sk-local-forgetask-dev-');
}

/** True if this bearer token must not authorize the local REST API. */
export function isLocalDevRestApiPlaceholder(token: string | undefined | null): boolean {
  const t = (token ?? '').trim();
  return t === LOCAL_DEV_REST_API_KEY_PLACEHOLDER;
}
