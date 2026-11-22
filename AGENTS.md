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
- **New public files must be listed in `scripts/build.mjs`** (images and other binary files go in its `binary` list, which is copied byte for byte). `npm run check` syntax-checks every `.js`/`.mjs` file on its own, and the jsdom UI tests expose every export of the modules they load. A brand-new module still has to be added, in order, to the module lists in `tests/app.test.js` (and `tests/frankie-ui.test.js` / `tests/baby-ui.test.js` where relevant), but its export names don't.
- **`functions/shared/` is generated** by `scripts/share.mjs` (copies app modules the newsletter reuses). Don't edit or commit it; edit the root module instead.
- **The live calendar stays the first thing on Today** (a test enforces it; the household asked for it).
- **Never let a placeholder replace containers that later code fills.** The Frankie page once crashed that way. Toggle `hidden` instead. A global `[hidden] { display:none !important }` rule exists because components set `display:flex`.
- **Preview mode:** `?demo=1` runs the whole app on sample data with no Firebase, iCloud or Huckleberry calls. Use it for screenshots and UI checks.
- **Firestore rules are tested in CI** (`npm run rules`: `scripts/rules-check.mjs` against the Firestore emulator; needs Java). Add cases there with every change to `firestore.rules`.
- **Refactors must not change the screen:** `npm run build && node scripts/visual.mjs capture <dir>` on main and on your branch, then `node scripts/visual.mjs compare <before> <after>` (preview mode, frozen clock, three widths, light and dark, every page). Same machine for both captures.
- Huckleberry is an unofficial, undocumented API (`functions/huckleberry-provider.js`). Keep requests minimal and never log tokens, emails or passwords.

## Map

| Area | Files |
|---|---|
| App shell, events, Firebase wiring | `app.js`, `index.html`, `household.js` |
| Baby tracking, Huckleberry UI | `baby.js`, `baby-model.js` (Purrfect Window, Mia’s Catnap Forecast), `frankie.js` (Frankie page), `baby-history.js`, `awards.js`, `prediction-log.js` (scoreboard) |
| Smart features | `upgrades.js` (quick add, ⌘K, Now & Next, sky, free nights), `quick-add.js`, `smart-home.js`, `free-nights.js`, `sky.js` |
| Life page (to-dos, groceries, meals) | `household.js` (tabs; `#tasks`/`#groceries`/`#meals` open the right tab), `meals.js`, `meals-view.js`, `meal-ideas.js` (ideas library, BOGO matching), `functions/publix.js` (unofficial Publix weekly ad, store 1588 Carytown by default) |
| Daily content | `daily-content.js`, `jokes.js` |
| Server (Firebase Functions) | `functions/index.js`, `functions/huckleberry-*.js`, `functions/caldav.js`, `functions/newsletter.js` |
| Setup and deploys | `docs/SETUP.md`, `scripts/setup-github-deploy.sh`, `.github/workflows/` |
