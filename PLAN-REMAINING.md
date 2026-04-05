# TaskForge — Remaining work (derived from PLAN.md)

> **Source of truth for scope:** [PLAN.md](./PLAN.md) (full product plan, history, and acceptance notes).  
> **This file:** a **backlog-only** view — items **not** fully done per §22 and follow-up notes. Update both when you ship features.  
> **Last synced:** 2026-04-05 (update this when you change backlog)

---

## How to use this doc

- Use **PLAN.md** for narrative context, file lists, and acceptance criteria per section.  
- Use **this file** to prioritize sprints; each line points back to a `PLAN.md` section (§).  
- Section headers in PLAN.md sometimes still say “INCOMPLETE” even when §22 marks the work **Done** — trust **§22 + repo** over stale headings.

---

## Phase 1 — still partial

| Item | PLAN § | Notes |
|------|--------|--------|
| Settings (remaining toggles) | §14.1 | Core prefs + ZIP + **reset preferences to defaults** + **danger-zone erase automation data** ✅. Still open: language, default priority, log retention preset/forever UI, log clear on startup, sound/position, theme/accent, developer default JSON, etc. |

---

## Phase 2 — still partial

| Item | PLAN § | Notes |
|------|--------|--------|
| `input_simulation` action | §15.1 | `kill_process` / `file_operation` ✅. Needs native input automation (`robotjs` / `@nut-tree/nut-js` or similar) + docs for rebuild. |

---

## Phase 3 — V2 / advanced (not ✅ in §22)

| # | Task | PLAN § | Status |
|---|------|--------|--------|
| 1 | Visual graph canvas builder (pan/zoom, edges, engine follows graph) | §3.3 | Not started (flagship V2). |
| 4 | AI conversation / multi-turn polish | §10.3 | Partial: history + trim ✅; **draft-edit** UX (“change trigger to 8 AM” without always creating a new workflow) open. |
| 5 | Multiple API keys + scopes | §12.1, §12.2 | Not done (see also §12.3 — some endpoints ✅; multi-key UI + enforcement still planned). |
| 8 | Trigger state persistence + missed-trigger replay | §16.2 | Not done. |
| 9 | Role-based UI (Viewer vs Editor/Admin) | §11.3 | Not done. |
| 11 | Settings — remainder after backup ZIP | §14.1 | Same as Phase 1 §14.1 row. |
| 12 | Online license validation (full product story) | §20.9 | Partial: client pieces (`license-remote.ts`, hybrid / `online_strict`, refresh IPC). **Hosted license API + full §20.9.6** out of repo. |

### Entitlement / commercial (§20.8 still open)

| Task | PLAN § |
|------|--------|
| Online validation — complete policy, UX, grace, revocation story | §20.9 |
| Per-seat enforcement (`seats` in payload + Team UI) | §20.8, §22 Phase 4 |
| `*appIsTier` / global license signal directive | §20.8 |
| Audit log when org key saved / cleared | §20.8 · ✅ `entitlement.saved` / `entitlement.cleared` |
| Settings: “Connected to license service / last verified …” copy | §20.7 future note |

---

## Phase 4 — future platform (§22)

| # | Task | PLAN § / note |
|---|------|----------------|
| 1 | Smart suggestions (repetitive behaviour) | §22 |
| 2 | Community marketplace submissions | §22 |
| 3 | Cloud sync (workflows + logs) | §22 |
| 4 | Team collaboration (real invites, shared workspace) | §22 |
| 5 | macOS support | §22 |
| 6 | Plugin / extension system | §22 |
| 7 | Mobile companion | §22 |
| 8 | **License server** (host HTTPS API, activations DB, revoke, rate limits) | §20.9.6, §22 |
| 9 | Per-seat enforcement (tie to server activations) | §20.9, §22 |

---

## Other gaps called out in PLAN.md (worth tracking)

| Area | PLAN § | Notes |
|------|--------|--------|
| AI heuristic parser breadth + confidence | §10.4 | **Expanded keywords + confidence score + UI hint** ✅; further tuning always possible. |
| Audit log filtering (action type, date range, resource type) | §13.2 | **Date range + status + existing filters + empty state + toast export** ✅. |
| §13.1 narrative vs code | §13.1 | Plan text predates `writeAuditLog`; treat “missing IPC coverage” as **verify + extend** if any mutation lacks audit. |
| App launch trigger efficiency | §16.1 | Reduce 5s polling where possible. |
| Loading states across pages | §21.3 | **`LoadingService` + shell bar** ✅ (wire `loading.run()` on more pages over time). |
| Empty states component on list pages | §21.4 | **Already on workflows/logs/variables**; **audit + marketplace search/catalog** ✅. |
| Logs UX | §6.1 | Optional: toast when new logs while scrolled down. |

---

## Explicitly **not** listed here (done per §22 — do not duplicate)

Examples: queue/stats, onboarding, toasts, confirm dialog, builder picker + schemas + validation + cron helper, variable interpolation + `{{var}}` / `{{context.*}}`, duplicate/bulk workflows, marketplace remote + installed state, Chart.js analytics, log filters URL + export, IPC typing/errors, most triggers/actions including Pro catalog, keyboard shortcuts, post-run refresh, last-run panel on cards, etc. See **PLAN.md §22** for the full done matrix.

---

*End of remaining-work index. When a row ships, remove or mark it here and update the corresponding §22 row in PLAN.md.*
