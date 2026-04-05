# TaskForge — Remaining work (derived from PLAN.md)

> **Source of truth for scope:** [PLAN.md](./PLAN.md) (full product plan, history, and acceptance notes).  
> **This file:** a **backlog-only** view — items **not** fully done per §22 and follow-up notes. Update both when you ship features.  
> **Last synced:** 2026-04-05 (MVP gaps pass: settings extensions, edges engine, cron replay, Windows input_simulation, API write, RBAC polish, entitlement fields, AI refine)

---

## How to use this doc

- Use **PLAN.md** for narrative context, file lists, and acceptance criteria per section.  
- Use **this file** to prioritize sprints; each line points back to a `PLAN.md` section (§).  
- Section headers in PLAN.md sometimes still say “INCOMPLETE” even when §22 marks the work **Done** — trust **§22 + repo** over stale headings.

---

## Phase 1 — still partial

| Item | PLAN § | Notes |
|------|--------|--------|
| Settings (remaining toggles) | §14.1 | **Shipped in this pass:** language (`ui_locale`), default workflow priority, log retention forever flag, clear logs on startup, replay missed cron, sound on failure, toast position, theme/accent, Builder default JSON, license “last verified” / valid-until / seats copy. **Still open:** server-side log purge by `log_retention_days` / forever (engine job not wired yet). |

---

## Phase 2 — still partial

| Item | PLAN § | Notes |
|------|--------|--------|
| `input_simulation` action | §15.1 | **Windows:** PowerShell `System.Windows.Forms.SendKeys` via UTF-8 base64 (no native addon). **Non-Windows:** still returns a clear “not implemented” error. |

---

## Phase 3 — V2 / advanced (not ✅ in §22)

| # | Task | PLAN § | Status |
|---|------|--------|--------|
| 1 | Visual graph canvas builder (pan/zoom, edges, engine follows graph) | §3.3 | **Partial:** list-order edges persisted + topological run order in engine when edges exist. **Not started:** free-form canvas / branching UI. |
| 4 | AI conversation / multi-turn polish | §10.3 | **Partial:** **“Refine last draft”** updates the same workflow via `workflows.update` (no new workflow). Further polish always possible. |
| 5 | Multiple API keys + scopes | §12.1, §12.2 | **Partial:** scoped keys + enforcement existed; **added** `workflows:write` + `POST /v1/workflows`. |
| 8 | Trigger state persistence + missed-trigger replay | §16.2 | **Partial:** `trigger_state` + **optional `replay_missed_cron`** (one catch-up vs previous cron tick after reload). |
| 9 | Role-based UI (Viewer vs Editor/Admin) | §11.3 | **Partial:** Builder + **Variables** route guard; **Logs** clear, **Team** invite, **Triggers/Actions** catalog create/append blocked for Viewers; Workflows already had viewer UX. |
| 11 | Settings — remainder after backup ZIP | §14.1 | Same as Phase 1 §14.1 row. |
| 12 | Online license validation (full product story) | §20.9 | Partial: **last verified** timestamp on successful online check + Settings/Team display of seats / valid-until. **Hosted license API + full §20.9.6** out of repo. |

### Entitlement / commercial (§20.8 still open)

| Task | PLAN § |
|------|--------|
| Online validation — complete policy, UX, grace, revocation story | §20.9 |
| Per-seat **enforcement** (active seats / activations) | §20.8, §22 Phase 4 |
| `*tfProIf` / global license signal directive | §20.8 · **directive added** (`TfProIfDirective`) — wire into templates as needed |
| Audit log when org key saved / cleared | §20.8 · ✅ `entitlement.saved` / `entitlement.cleared` |
| Settings: “Connected to license service / last verified …” copy | §20.7 future note · **partially addressed** via last-verified + valid-until lines |

---

## Phase 4 — future platform (§22)

(Unchanged — see prior PLAN-REMAINING / PLAN.md §22 for marketplace, cloud sync, license server, etc.)

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
