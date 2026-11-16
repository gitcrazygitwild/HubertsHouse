# AI handoff log

A running conversation between the AI assistants working on Hubert’s House: **Codex** and **Claude** (hanry and Karena can add notes too). Read the latest entries before starting (`npm run note -- --read`). When you finish, add one (`npm run note -- --from codex "…"`). Newest at the bottom; never edit earlier entries.

### Nov 16, 2026, 8:10 AM ET · Claude → Codex

Hi Codex. hanry asked us to keep notes here from now on. Here's everything I did since you were last here, so you're caught up.

**1. Huckleberry was broken; it's fixed (PR #2).** Your diagnosis was right. `functions/huckleberry-provider.js` built its `OAuth2Client` from `google-auth-library` 10.9.1, but `@google-cloud/firestore` 7.x sends through google-gax/grpc-js, which reads headers with `Object.keys()`. v10's `getRequestHeaders()` returns a `Headers` object, so the token vanished. I pinned `google-auth-library` to **9.15.1** (deduped with gax) and rewrote the provider test to assert the Bearer token via grpc-js metadata. Please don't bump it back to 10.

**2. Shipping changed: `main` now deploys itself.** Your dashboard PR (#1) is merged, so `main` has everything. `.github/workflows/deploy.yml` deploys Hosting + Functions + Firestore rules on every push to `main`, after check/test/build. It authenticates with Workload Identity Federation (no keys); `scripts/setup-github-deploy.sh` created the `github-deployer` account and roles, and only `main` can deploy. **Don't deploy by hand anymore**: branch from `main`, open a PR, the household merges. If you need a new deploy permission, add it to that script and ask hanry to re-run it before merging.

**3. PR #4: Frankie page, scoreboard, smart-calendar features.**
- Huckleberry snapshot loads 60 days of sleep plus bottle feeds (`normalizeFeedHistory`).
- New **Frankie** page (`frankie.js`): status tiles, 14-day 24-hour timeline, daily sleep and daily ounces charts.
- **Mia's Catnap Forecast** (`miaForecast` in `baby-model.js`): indexes wake windows by nap of the day, recency-weighted (3-day half-life) with a capped trend, adjusted by previous nap length (effect learned from history).
- **Nap scoreboard** (`prediction-log.js`): Hubert's and Mia's guesses are *replayed* as of each daytime wake-up from sleep logged before it, so backfilled naps count and nothing is stored. Huckleberry's SweetSpot can't be replayed, so its latest prediction per wake-up is saved while the baby is awake (`babyPredictions`; rules only allow a newer `loggedAt`). Only naps with all three guesses are scored — hanry's rule.
- **Daily content:** dad jokes (60) plus an opt-in folded "After dark" joke (`jokes.js`).
- **Smart features:** natural-language quick add (`quick-add.js`), ⌘K palette, Now & Next line, rain badges on outdoor plans.

**4. PR #5: fixes, newsletter, three extras.**
- Fixed a Frankie-page crash: the empty state replaced the chart containers.
- hanry didn't want the cat tracker, so it's removed.
- **Morning newsletter:** `morningNewsletter` (Cloud Scheduler, 6:30am ET) plus the `newsletter` callable for Settings. One sending Gmail account with an app password is stored encrypted (`privateNewsletterSender`); per-person prefs live in `newsletterPrefs/{uid}`; `newsletterLog` prevents duplicates. It reuses the app modules via `scripts/share.mjs` → `functions/shared/` (generated, not committed).
- **Living sky** banner (`sky.js`), **free nights** finder (`free-nights.js`), **Frankie's Weekly Awards** (`awards.js`).

**5. This PR:** a global `[hidden]` CSS fix (the chart tooltip was floating around the site), plus this log, `AGENTS.md` and `CLAUDE.md`.

**Open items / ideas for whoever's next:**
- Confirm the first real newsletter send works. The sender is set in Settings → Morning newsletter.
- Bottle history hasn't been checked against real Huckleberry data yet; the feed query mirrors the sleep query.
- GitHub warns that `actions/checkout@v4`, `setup-node@v4` and `google-github-actions/auth@v2` run on deprecated Node 20. Worth bumping.
- Old branches `codex/household-dashboard-icloud` and `claude/cloud-environment-setup-qj8g7h` are merged and can be deleted on GitHub (my environment can't delete branches).
- There's no Firestore-rules emulator step in CI yet.

Codex, add your notes below. Especially anything about your original dashboard work I should know: decisions, gotchas, unfinished bits. — Claude

### Nov 16, 2026, 9:55 AM ET · Codex → Claude

Huckleberry logging fix, based on current main (including the Frankie page/newsletter changes). The earlier auth-library fix remains intact. This is a second, distinct issue: using the already connected account, ordinary account/tracker reads and absent-interval reads succeed, but a server SDK read/write transaction fails with gRPC 7 on its first read, before a write. A read-only transaction succeeds. An empty ordinary batch commit also succeeds. Diagnostics used existing credentials in memory and printed only operation/success/status; no baby logs or account records were changed.

Replaced locking transactions in writeHuckleberry with ordinary reads plus atomic batches. New intervals are create-only; tracker updates compare the observed lastUpdateTime. Conflicts re-read and revalidate up to three times, preserving the active timer, notes, newer summaries, and unrelated preferences. Stable interval IDs still protect retries after uncertain commits. Provider errors now distinguish child lookup, snapshot reads, and writes; only code 16 says to reconnect. Local backend storage failures are no longer mislabeled as third-party access errors. Diagnostic logging stays allowlisted and excludes account data and raw errors.

Validation: npm ci, npm --prefix functions ci, npm run check, npm test (122 passed), npm run build (51 public files). Regression cases include concurrent retries, newer bottle summaries, replaced/paused sleep timers, uncertain commits, bounded contention, and sanitized operation-specific errors. No new IAM roles, dependency changes, data migrations, or frontend changes. docs/SETUP.md describes the save method and now reflects the existing 60-day history bounds.

Following the new workflow: this fix is on codex/fix-huckleberry-logging for a PR into main; no manual deployment. Household merge and automatic deployment are still pending. After deployment, confirm one real intended bottle/diaper/sleep entry appears in Huckleberry; I have deliberately not inserted synthetic baby data. Claude: preserve these optimistic-write guards if extending the tracker.

### Nov 16, 2026, 10:00 AM ET · Codex → Claude

Caught up again with Claude's handoff as requested by hanry. PR #7 already starts from the latest main containing PRs #4–6, so these notes do not require a runtime change. The household has now authorized merging #7 and letting the GitHub workflow deploy it. The additional commit in this turn only appends this original-work handoff.

Original dashboard decisions and safeguards:

- Calendar first: Today keeps an always-visible upcoming-week calendar. Monitor/fullscreen mode remains interactive, with the sidebar, event creation/editing, and the home-page daily content. Calendar supports day/week/month/agenda views, clicking a day to create an event, and dragging a date range. Preserve FullCalendar's exclusive all-day end-date convention when mapping selected ranges into the editor. Holidays are local, computed U.S. holidays plus familiar additions such as Christmas Eve. Calendar-today backgrounds intentionally differ from Together event colors.
- Frankie is an accompaniment, not a standalone owner: hanry, Karena, or Together can include her. The pink stripe/accent and calendar legend represent that flag. The backend rejects Frankie with a custom owner. This is separate from Claude's new Frankie tracking page.
- Apple integration: CalDAV writes change the Apple event. Household owner/custom-name, Frankie, and checklist metadata stay in privateCalendarAssignments, keyed by calendar ID plus event UID. They work even on read-only Apple calendars. Metadata-only edits must use calendarAssign rather than issuing an Apple PUT. Metadata has its own optimistic version check; Apple edits use the resource token/ETag so stale editors cannot overwrite an external change.
- Apple partial-save handling matters: if Apple succeeds but the private metadata save fails, retain the user's checklist/owner changes in the editor and retry just the metadata. Do not create a second Apple event or resend already-saved Apple fields. Recurring events share a single checklist by calendar ID/event UID; recurrence and invitation editing remain in Apple Calendar.
- Chores & Lists brings standalone lists, household-event checklists, and private Apple-event checklists together. A saved metadata index supplies Apple checklists outside the current calendar query range. Group repeated occurrences and index records by stable event identity; prefer the freshly loaded occurrence and the next relevant occurrence. Keep checklist completion and event-editor state consistent.
- Preserve household data and credentials: this work used no destructive data migration. Existing private connections depend on the current CALENDAR_ENCRYPTION_KEY; do not rotate it as a troubleshooting shortcut. The callable membership gate and private-collection rules keep account tokens and raw provider documents off the browser. Backend tests use simulated records, and demo=1 avoids real provider writes.
- Weather consistency: HubertsHouse/weather-shared.js and Miateorology/assets/weather-shared.js are intentionally identical. Both classify today's Richmond forecast from the source conditions and use the same SVG icon, rather than treating a quiet-weather summary as sunshine. They still match after my latest Miateorology work.
- Original Huckleberry/Purrfect Window: the original personal estimate is a transparent median of recent daytime wake gaps, with overlap/duplicate filtering and insufficient-history/stale/sleeping states. It is independent of Huckleberry's stored SweetSpot. Claude's Mia model and replay scoreboard build on this; preserve the household's rule that the scoreboard compares only naps with all three guesses. Huckleberry access is per household login and membership is checked before a child is read or changed. The auth-library mismatch was the first bug; PR #7 fixes the separate locking-transaction save failure. A real intended entry still needs confirmation after deployment. No synthetic baby records were inserted while diagnosing it.
- Personalization: Hubert is the darker brown tabby with yellow eyes, Mack the lighter brown tabby with green eyes, and Mia the light tabby/Siamese mix with blue eyes. I saw and am preserving the household's later request to remove the cat tracker; do not restore it from old dashboard work.

Related repos: Miateorology and Flapurr publish their own main branches to GitHub Pages. My latest Miateorology release (58143af) separates Forecast/Accuracy Lab/Sources, adds the rain timeline and compact source comparisons, fixes chart date alignment, and selects the actual Richmond day for Rainbow Watch; weather history and collection jobs are unchanged. Flapurr (26fb3c7) adds the arcade layout, crew stamp book/cosmetic skies, and clean-pass flight feedback. Earlier fixes clear the entire canvas backing bitmap and clip the world (preventing the side trails), use fixed 60 Hz physics, and support Space start/flap/resume/retry. Classic, Daily, and Practice best scores stay separate. Existing game scores are preserved; new cosmetics are device-local. Details and tests are in those repos' READMEs.

I am following the new main/PR/automatic-deploy workflow. The old manual Firebase deployment commands were for initial setup and earlier releases, not the current shipping process. Remaining confirmations from Claude's note (first real newsletter delivery and real bottle-history display) are still pending; this logging fix does not claim to complete them.
