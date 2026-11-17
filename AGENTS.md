# Working on Hubert’s House (for AI assistants)

Two AI assistants work on this repository: **Codex** and **Claude**. They never run at the same time, so they talk through a shared log.

## Start and finish every task with the handoff log

1. **Before you start:** read the latest notes. They say what the other AI just changed, what's half-done, and anything it asked you to do.
   ```sh
   npm run note -- --read
   ```
2. **When you finish** (before committing): leave a note for the other AI. Cover what you changed and why, anything unfinished or risky, and any questions. Commit the log with your change.
   ```sh
   npm run note -- --from codex "Short summary… Claude: please check X."
   ```
   Use `--from claude` if you are Claude. Notes are appended to `docs/AI_HANDOFF.md`, newest at the bottom; never edit earlier entries.

## How changes ship

- `main` is the single source of truth and **deploys automatically** (Hosting, Functions, Firestore rules) through `.github/workflows/deploy.yml` when it changes. **Never deploy by hand.**
- Start every task from the latest `main`, work on your own branch, open a pull request into `main`, and let the household (hanry/Karena) decide when to merge.
- Before pushing: `npm ci && npm --prefix functions ci && npm run check && npm test && npm run build`.
- If a change needs a new Google Cloud permission for the deployer, add it to `scripts/setup-github-deploy.sh` and tell the household to re-run it in Cloud Shell **before** merging, or the deploy fails.

## Things that bite

- **Don't upgrade `google-auth-library` in `functions/` past 9.x.** Firestore’s gRPC layer (google-gax) needs v9. v10 silently dropped the Huckleberry token (`tests/huckleberry-provider.test.js` guards this).
- **New public files must be listed in `scripts/build.mjs`** (images and other binary files go in its `binary` list, which is copied byte for byte) and new JS in the `check` script in `package.json`. The jsdom UI tests load modules by hand, so register new modules in `tests/app.test.js` (and `tests/frankie-ui.test.js` / `tests/baby-ui.test.js` where relevant).
- **`functions/shared/` is generated** by `scripts/share.mjs` (copies app modules the newsletter reuses). Don't edit or commit it; edit the root module instead.
- **The live calendar stays the first thing on Today** (a test enforces it; the household asked for it).
- **Never let a placeholder replace containers that later code fills.** The Frankie page once crashed that way. Toggle `hidden` instead. A global `[hidden] { display:none !important }` rule exists because components set `display:flex`.
- **Preview mode:** `?demo=1` runs the whole app on sample data with no Firebase, iCloud or Huckleberry calls. Use it for screenshots and UI checks.
- Firestore rules were verified in the Firestore emulator; there is no emulator step in CI yet. If you change `firestore.rules`, test it in the emulator (Java + `firebase emulators:exec`) before merging.
- Huckleberry is an unofficial, undocumented API (`functions/huckleberry-provider.js`). Keep requests minimal and never log tokens, emails or passwords.

## Map

| Area | Files |
|---|---|
| App shell, events, Firebase wiring | `app.js`, `index.html`, `household.js` |
| Baby tracking, Huckleberry UI | `baby.js`, `baby-model.js` (Purrfect Window, Mia’s Catnap Forecast), `frankie.js` (Frankie page), `baby-history.js`, `awards.js`, `prediction-log.js` (scoreboard) |
| Smart features | `upgrades.js` (quick add, ⌘K, Now & Next, sky, free nights), `quick-add.js`, `smart-home.js`, `free-nights.js`, `sky.js` |
| Daily content | `daily-content.js`, `jokes.js` |
| Server (Firebase Functions) | `functions/index.js`, `functions/huckleberry-*.js`, `functions/caldav.js`, `functions/newsletter.js` |
| Setup and deploys | `docs/SETUP.md`, `scripts/setup-github-deploy.sh`, `.github/workflows/` |
