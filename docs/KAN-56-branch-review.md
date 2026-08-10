# Branch Review — feat/KAN-56-cron-harness

**Reviewed:** `15f1a894` (37b5ed1e implement → b179c1c9 audit remediations → 15f1a894 error registry)
**Method:** 5 senior-engineer standards reviews (web-verified: RFC 6750/9110, OWASP, CWE-117, Vercel docs, MDN, TS handbook) + 5 senior-engineer scope reviews (AC-by-AC) + 2 report passes. Suite re-run at HEAD: 224/224 in the four audited files, 1329/1329 full branch.
**Verdict: APPROVE WITH CONDITIONS** — six small must-fixes (~1 day), none touching the security posture.

---

## 1. Executive summary

The branch delivers a genuinely well-engineered Vercel cron harness: RFC 6750-compliant secret auth (SHA-256 pre-hash + `timingSafeEqual`, no length leak), an abort-based timeout design (deliberately not `Promise.race`), PII-safe error extraction with whitelisted `dealId`/`campaignId` context, a fully registered `ErrorEnvelope` surface (no ad-hoc strings), and a deliberate, mostly locking test suite. All 9 findings from the first audit are remediated and pinned by tests. The security posture is **PASS**. Two structural weaknesses stop it short of its own acceptance criteria: (1) the 290s timeout is advisory, not enforced — an uncooperative job blocks until the platform kill, so **AC-006 is only partially satisfied**; (2) the logging layer is human-readable prose, which defeats Vercel structured logging/Log Drains and carries an unescaped-CR/LF log-injection risk (CWE-117). Both are small fixes, and both must land before KAN-38 registers its first job.

## 2. Branch provenance & scope control

| Commit | Content |
|---|---|
| `37b5ed1e` | Cron harness: `0 0 * * *` schedule, secret auth, timeout-safe runner, PII-safe logs. Also committed stray `commit_msg.txt` + `scratch/` artifacts. |
| `b179c1c9` | Remediated 9 audit findings; removed the stray artifacts. |
| `15f1a894` | Registered `CRON_TIMEOUT`, `CRON_PARTIAL_FAILURE`, `UNAUTHORIZED`, `INTERNAL_SERVER_ERROR` in the ErrorCode registry; all responses via `errorResponse()`/`ErrorHttpStatus`. |

8 files touched, all attributable to KAN-56 (route, harness, barrel, `vercel.json`, errors registry, 2 test files, +3-line authz exemption). No pre-existing endpoint modified. Secret history audit clean. Minor drift: commit message says "enum count 20→24", actual delta 19→23 (test asserts 23 — code consistent); `state-machine.ts:138` cites "AC-008" vs the ticket's "AC-005" (cosmetic).

## 3. Findings by severity (deduplicated across 10 reviews)

### HIGH

| # | Domain | Finding | Evidence | Fix |
|---|---|---|---|---|
| H1 | Reliability | **290s deadline is advisory, not enforced.** `await job.run(signal)` (harness.ts:130) is never raced against an abort promise; a job that ignores the signal and never settles blocks the run until the platform kills it at 300s. The platform does still return `504 FUNCTION_INVOCATION_TIMEOUT`, but the harness envelope, summary, and ABORTED markers are lost — the ticket's "proper 504 before the platform kills it" holds only for cooperative jobs. | route.ts:14,21,47-49; harness.ts:130 | Race each job against an abort promise (settled flag; discard/relabel late results); forward the signal into pg queries in KAN-38 jobs. |
| H2 | Observability | **Prose logging defeats Vercel structured logging/Log Drain, and unescaped CR/LF in `err.message` enables log injection (CWE-117).** Multi-arg `console.error('...[Scheduler]...', JSON.stringify(...))` is space-joined into prose; fields (`jobName`, `durationMs`, `code`) are unsearchable for drains, and an embedded `\n` forges log lines. | harness.ts:153-155,172-174; route.ts:78-81,88-91,118-120 | One `JSON.stringify`'d object per console call (JSON escapes control chars by construction). Zero production impact today (empty job list) — but gate for KAN-38. |
| H3 | Tests | **Route catch→504 branch (route.ts:107-111) has zero coverage.** The timeout-vs-crash distinction is only reachable when `runJobs` *rejects* while the signal is aborted; both 504 tests exit via the post-run `signal.aborted` path instead. A regression mapping timeouts to 500 would ship. | route.ts:107-111 vs cron-harness.test.ts:504-525,527-576 | One test: rejecting `runJobs` under an aborted signal → 504. |

### MEDIUM

| # | Domain | Finding | Evidence | Fix |
|---|---|---|---|---|
| M1 | Auth/API | `WWW-Authenticate: Bearer` violates RFC 6750 §3 (challenge MUST carry ≥1 auth-param). Correctly omitting `error=` for no-credentials is right; add `realm`. | route.ts:65; test :413 | `Bearer realm="cron"` + update assertion. |
| M2 | Reliability | Vercel never retries failed crons and **can deliver duplicates**; a duplicate run's `transitionDeal` on an already-terminal row throws `TransitionError` → naive KAN-38 job becomes CRON_PARTIAL_FAILURE. Jobs must be reconciliation-based and treat already-terminal as skip. | state-machine.ts:135-146; harness.ts:163 | Harness contract + classification helper before KAN-38. |
| M3 | Observability | `JSON.stringify(context)` can THROW inside the catch (circular ref, BigInt `dealId`), destroying the failure log and escaping as a bare 500. Repo already has the hardened pattern in `lib/audit/redact.ts:89-148`. | harness.ts:150; route.ts:115 | Coerce/guard; reuse redact.ts serializer; add BigInt/circular test. |
| M4 | Tests | Timeout boundary asymmetric: no sub-ceiling completion test, so a premature-abort regression ships silently; `CRON_TIMEOUT_MS` module-private. | route.ts:21; cron-harness.test.ts:527 | Sub-ceiling fake-timer test (200, not 504); export the constant. |
| M5 | Tests | The fluent-node `transitionDeal` mock in the cron suite (cron-harness.test.ts:601-699) is a redundant, **weaker** duplicate of `deal-state-machine.test.ts`'s strict chain (which asserts `.for('update')` at :202-203). It re-tests code this branch doesn't own; its exact-10-element chain assertion is brittle. | cron-harness.test.ts:604-687 | Delete the duplicate block. |
| M6 | Tests | `vi.spyOn(console,'error')` restored at test-body end, not `afterEach` (`restoreMocks` unset) — a failing assertion leaves console silenced for the rest of the file. | cron-harness.test.ts:405,479,501,575 | `restoreMocks: true` in vitest.config.ts. |
| M7 | Observability | Email-only redaction is narrower than the repo's own PII taxonomy (`lib/audit/redact.ts:36-55` covers phone/ssn/birth/address); GDPR-identifiable handles pass (deliberate, documented). Divergence itself should be decided and documented. | harness.ts:36-43 | Document accepted limit (or extend). |

### LOW / NIT

- **L1** Residual µs-scale timing differentiation on the unconfigured-secret path (returns before hashing) — dummy-hash equalization is cheap insurance; also, the per-request "CRON_SECRET is not configured" `console.error` fires on every unauthenticated probe (log-spam vector) — demote/warn-level.
- **L2** `.env.example` CRON_SECRET placeholder is a deployable-looking footgun — leave empty with a "must generate" comment.
- **L3** Result-classification races at the abort boundary (job resolving after abort recorded `success: true`; real error same-tick as abort labeled ABORTED) — route's 504 is signal-based and correct; re-check `signal.aborted` before recording success.
- **L4** Stringly-typed `JobResult.error` — narrow to a union; `summary ?? {}` is type-dead.
- **L5** Hobby fires ±59 min inside the scheduled hour → KAN-38 expiry must be run-time-relative ("expired as of run time"), never midnight math.
- **L6** `AbortSignal.any` fallback is dead code (Node ≥20.9 required by Next 16); double `clearTimeout` harmless — drop inner.
- **L7** Over-scrubbing false positives (`nginx@v1.2.3` → `***@***.***`) vs `notifications/redact.ts`'s domain-preserving scheme — align in KAN-38 logging pass.
- **L8** No message-length cap (Vercel: 256 lines/1MB per request; `MAX_STRING_LENGTH=512` precedent); no runId/stack (platform `requestId` partially covers); 3 ad-hoc log prefixes.
- **N1** ~20 hand-rolled `{ status: ErrorHttpStatus[...] }` pairings across `app/api/*` — one `jsonError(code)` helper would remove the boilerplate.
- **N2** Doc drift: `errors.ts` comments reference an error table in **CLAUDE.md, which does not exist** in the repo.
- **N3** `fetchCache: 'force-no-store'` redundant with `force-dynamic`; `runtime: 'nodejs'` is default.
- **N4** Test nits: `logger.warn` branch untested (mock logger lacks `warn`); enum duplicate values unguarded (add Set uniqueness); empty-jobs unit missing; `null`/`undefined` rejections untested; test comment "loop breaks" contradicts actual `continue` semantics; exact-log-line coupling brittle by design.

## 4. Ticket-scope compliance matrix

| Criterion | Status | Evidence | Test | Gap |
|---|---|---|---|---|
| AC-001 (cron schedule) | ✅ Satisfied | vercel.json:5 `0 0 * * *` | cron-harness.test.ts:375 | Hobby max-duration verified as 300s (see §7); keep on deploy checklist |
| AC-002 (secret auth) | ✅ Satisfied | SHA-256+timingSafeEqual, RFC 6750, oracle-free uniform 401 | :385, :408 + 8 units | M1 (realm); L1/L2 |
| AC-003 (job isolation) | ✅ Satisfied | per-job try/catch | :241 | throwing logger breaks isolation (edge) |
| AC-005 (idempotency) | ✅ Satisfied | FOR UPDATE re-read + to→to rejection | deal-state-machine.test.ts:292-310 | real-Postgres concurrency untested (conceded in escrow-ledger.test.ts:95-96) |
| AC-006 (timeout/abort) | ⚠️ **Partial** | loop + ABORTED classification + 504 mapping | :153-221, :504, :527 | **H1: no watchdog for non-settling jobs**; H3: catch→504 untested |
| AC-007 (PII-safe context) | ✅ Satisfied | whitelist context + unicode email scrub | :302, :331 | M7, L7 |
| FR-007 (single transition writer) | ✅ Satisfied | structural invariant scans lib/+app/ incl. scheduler files; zero deal writes in cron layer | deal-state-machine.test.ts:515-570 | no negative type test pins `db` ⊄ `Tx` |
| NFR-003/012 (atomicity/audit) | ✅ Satisfied | single-tx status+event; `for('update')` asserted | deal-state-machine.test.ts:196-237 | — |
| NFR-010 (no PII) | ✅ Satisfied | message-body level | :277, :302, :331 | job.name/error.name/code unsanitized (low) |

Every AC has ≥1 test; 224/224 pass. Coverage gaps: catch→504 (H3), timeout lower bound (M4), empty-jobs unit, `.for('update')` arg in cron mock (M5), `logger.warn`, enum duplicates, circular/BigInt context (M3), non-Error `null`/`undefined` rejections, `AbortSignal.any` fallback, `maxDuration` export.

## 5. Audit-remediation verification (all 9 findings → Remediated)

Type narrowing without casts (harness.ts:14-34) ✔ · envelope/status consistency through `errorResponse`+`ErrorHttpStatus` ✔ · CRON_* codes registered with messages/statuses (errors.ts:89-111) ✔ · timing-safe compare with SHA-256 pre-hash, unreachable throw ✔ · config-oracle closed (uniform 401, server-side log only) ✔ · unicode PII regex with IDN/single-letter-TLD tests ✔ · abort loop `continue`-with-markers semantics ✔ · RFC 6750 scheme/SP + WWW-Authenticate ✔ · enum count 23 consistent with test ✔ · no regressions from 15f1a894 ✔.

## 6. Test suite assessment

Strong, deliberate suite: structural source-scans (deal-state-machine.test.ts:515-570), 81-pair legal-transition sweep, deterministic leak-free fake-timer test, exact-log assertions, single injection seam (`CronRouteDeps`). Weaknesses are the four items above (H3, M4, M5, M6) plus the nits. The "loop breaks" prose in the mid-flight abort test contradicts the (correct) `continue` semantics.

## 7. Adjudications

1. **Hobby maxDuration — resolved: 300s is correct.** Current Vercel docs (2026-07-01 duration, 2026-08-02 limits): with Fluid Compute (default since Apr 2025), Hobby is 300s default **and** maximum. The 60s claim is the stale pre-Fluid table. `maxDuration = 300` is valid — and sits exactly at the ceiling, so the 290s timer is the only headroom; the watchdog (H1) makes behavior correct under any ceiling. Re-verify the table before any KAN-38 duration change.
2. **CRON_PARTIAL_FAILURE = 500 — keep, and document.** Vercel doesn't retry failed crons, so the usual 5xx-double-execution argument doesn't apply; a partial failure is a failure (next-day reconciliation is the retry), and a 500 is the honest signal for the Cron dashboard and 5xx monitors. Record the RFC 9110 deviation in the code comment.
3. **Route catch→504 gap — not a merge blocker.** Near-unreachable in production (runSchedulerJobs catches every per-job error), the platform still 504s at the ceiling, and the job list is empty. Blocking merge over it buys nothing; shipping KAN-38 without the tests would buy a silent regression vector — so the test lands now.

## 8. Prioritized actions

**Must-fix before merge (~1 day):** H1 watchdog race (0.5d) · H2 structured one-JSON-object-per-line logging + CR/LF-safe (0.25d) · H3 catch→504 test (0.5h) · M3 hardened context serialization + test (1h) · M1 `realm="cron"` (15min) · M6 `restoreMocks: true` (15min).

**Should-fix before KAN-38 (~1 day):** M2 duplicate/TransitionError-as-skip contract · M4 sub-ceiling test + export `CRON_TIMEOUT_MS` · M5 delete duplicate mock block · M7/L2 document redaction limit + empty placeholder · L3/L4 classification races + union type.

**Defer:** L1 dummy-hash, L5 run-time-relative expiry contract, L6 dead fallback, L7 scrubber alignment, L8 runId/length caps/stacks, N1 jsonError helper, N2 CLAUDE.md doc drift, N3 redundant segment config, N4 test nits, real-Postgres concurrency test (needs CI Postgres).

## 9. KAN-38 gate checklist (before the first real job is registered)

- [ ] Reconciliation-based sweep, run-time-relative (`expires_at <= now()`), never midnight math
- [ ] `TransitionError` on already-terminal rows = skip, not failure
- [ ] Signal cooperation proven by test (mid-sweep abort stops the sweep; partial count in summary)
- [ ] Per-job pace budget asserted (< ~250s worst case) to protect the 10s margin
- [ ] In-branch conditions landed (structured logging, hardened serialization, catch→504 + lower-bound tests)
- [ ] `CRON_SECRET` set in prod/preview env; placeholder never deployed; first real run observed 200 in the Cron dashboard with parseable JSON summary
- [ ] Manual duplicate-delivery acceptance: second manual run reports 0 acted, `success: true`, no duplicate `deal_event` rows
- [ ] Verify the Hobby max-duration table again at deploy time
