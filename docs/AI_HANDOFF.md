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
