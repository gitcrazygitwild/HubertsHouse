# Activate household sign-in, iCloud, and Huckleberry

The repository is configured for the existing Firebase project **huberts-house**. The live app is **https://huberts-house.web.app**. Authentication, membership rules, and the private calendar functions are deployed as of November 15, 2026. Existing users can start at step 4 to connect their Apple account. Steps 1–3 document provisioning a new deployment. No data migration is required: household events keep using the original `events` collection.

## 1. Enable real household accounts

1. In Firebase Console → Authentication, enable **Email/Password** sign-in.
2. Create one user for hanry and one for Karena, with their own email addresses and passwords. Set passwords outside chat and source control.
3. Add `gitcrazygitwild.github.io` (and any other frontend hostname you use) to Authentication → Settings → Authorized domains.
4. In Firestore Console, create a document for each account at `households/home/members/USER_UID`, where `USER_UID` is the exact UID shown in Authentication. Give it the boolean field `active: true`. Membership can only be managed through trusted admin access; visitors cannot enroll themselves.
5. Deploy `firestore.rules` below before enabling the iCloud UI. They restrict the existing events and new household lists to those members and deny all direct client access to the private connection, assignment, and baby snapshot collections.

These rules are for this household app. If this Firebase project also hosts other applications with additional collections, incorporate their existing rules before deployment.

## 2. Deploy the private calendar service

Firebase Functions requires the project’s Blaze plan. Use an authenticated Firebase CLI session with access to `huberts-house` on your own computer, or an authorized deployment environment. Node 22 is the Functions runtime.

```sh
npm ci
npm --prefix functions ci
npm test
npm run check
firebase login
firebase deploy --only firestore:rules --project huberts-house
```

For a **new deployment only**, create a 32-byte encryption key directly in Secret Manager without placing it in Git or a file. The live project already has `CALENDAR_ENCRYPTION_KEY` version 1; do not run the key-generation command again there:

```sh
openssl rand -base64 32 | firebase functions:secrets:set CALENDAR_ENCRYPTION_KEY --data-file=- --project huberts-house
firebase deploy --only functions:household-calendar --project huberts-house
```

Keep the generated secret intact for existing connections. Rotating it requires reconnecting the Apple and Huckleberry accounts (or a separate credential migration). The Functions service account needs its normal Firestore access and permission to read this secret; Firebase’s deployment prompts establish the secret binding.

The deployed runtime must be able to reach `https://caldav.icloud.com` and Apple's `https://pNN-caldav.icloud.com` calendar shards. The application refuses credentials on other hosts and checks redirect destinations before following them.

The calendar service includes `calendarAssign` for household-only event owners, Frankie accents, and checklists. It requires the same membership and Apple access checks as reading an event, then writes to `privateCalendarAssignments` without modifying Apple. Existing household data needs no migration. Keep this collection when redeploying or reconnecting accounts; assignments use the connected calendar ID and Apple UID, with version checks for concurrent edits. Checklist metadata includes a saved title/date/resource reference so Chores & Lists can display lists outside the loaded calendar window. No checklist text is written into Apple notes or calendar properties. Selected-calendar access limits which saved lists are returned.

## 3. Activate and publish the frontend

Change `calendarServiceEnabled` and `huckleberryServiceEnabled` to `true` in `config.js` only after the service has deployed. There are no private values in that file.

```sh
npm run check
npm test
npm run build
```

Publish the frontend through the repository’s existing GitHub Pages flow, or use the included optional Firebase Hosting configuration:

```sh
firebase deploy --only hosting --project huberts-house
```

The build copies only frontend files into `dist/`. It excludes server code, tests, dependencies and secrets. GitHub Pages can also serve the source root as before.

### Automatic deploys from GitHub

`.github/workflows/deploy.yml` deploys Hosting, Functions and Firestore rules to `huberts-house` on every push to `main`, after `npm run check`, `npm test` and `npm run build` pass. It can also be started from **Actions → Deploy to Firebase → Run workflow** (on `main`).

It signs in with Workload Identity Federation, so no Google key is stored in GitHub. Only this repository's `main` branch can use the `github-deployer` service account. One-time setup, in Google Cloud Shell as the project owner, from a clone of this repository:

```sh
bash scripts/setup-github-deploy.sh
```

The script is safe to re-run. To turn automatic deploys off, disable the workflow in the Actions tab, or delete the `github` workload identity pool in Google Cloud (IAM → Workload Identity Federation).

Re-run the script whenever it gains a permission. The morning newsletter added Cloud Scheduler (`roles/cloudscheduler.admin` and the Cloud Scheduler API); without it, the deploy of the scheduled `morningNewsletter` function fails.

### Morning newsletter

`morningNewsletter` runs at 6:30am America/New_York and emails each active household member (to their Firebase login email) a digest of the home page: Richmond weather and rain warnings, today’s and tomorrow’s plans (household events plus that member’s selected iCloud calendars), Frankie’s current status, yesterday’s sleep and ounces, the nap predictions and scoreboard leader, Monday’s weekly awards, chores due, groceries, free date nights, and the daily quote, fact, word and dad joke. A log document per member per day (`newsletterLog`) prevents duplicates.

1. Pick one Gmail account to send from. Turn on 2-Step Verification for it and create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
2. In **Settings → Morning newsletter**, enter that Gmail address and app password under the sending account. The server checks them with Gmail, then stores the password encrypted with the existing calendar encryption key (`privateNewsletterSender`, server-only). No Cloud Shell secret is needed.
3. Each person chooses whether to receive it, the name to be greeted by, and whether to include the after-dark joke (off by default) — stored server-side in `newsletterPrefs/{uid}`.
4. Use **Send me one now** to preview it in your inbox.

The digest is built from the same modules as the app: `scripts/share.mjs` copies them into `functions/shared/` before tests, builds and deploys (a Firebase `predeploy` step covers manual deploys too). `functions/shared/` is generated and not committed.

## 4. Connect Apple Calendar in the app

1. Sign in to Hubert’s House with a household account.
2. Open **Settings → Apple Calendar**.
3. At [account.apple.com](https://account.apple.com), create an app-specific password named “Hubert’s House” under Sign-In and Security. Apple requires two-factor authentication for app-specific passwords. Use an app-specific password, not the Apple Account password.
4. Enter the Apple Account email and app-specific password in the app. The password is cleared from the form after submission and is never retained in browser storage.
5. Select the calendars to show and save the selection. No calendars are selected automatically on a first connection.
6. Optionally choose the iCloud calendar under **Default for new events** (saved for this account on this device). When adding an event, choose a writable iCloud calendar in the **Calendar** field. “Hubert’s House” continues to mean an event stored only in the household database.

Connect each household member’s Apple account under their own sign-in. An iCloud calendar already shared between members can be selected by either member. A tablet left signed in can access that member’s selected calendars; choose a shared household calendar if that is the intended display audience.

Disconnect removes the encrypted credential from the service without changing Apple events. To revoke the password at Apple as well, delete it at account.apple.com.

## Live acceptance checks

Use a disposable test calendar and event for the initial checks:

- Create an event in Apple Calendar; refresh the dashboard and see it appear.
- Add an event in Hubert’s House using that iCloud calendar; see it appear in Apple Calendar.
- Edit title, notes, date/time, and an all-day span in Hubert’s House; verify the Apple result.
- Change only the owner or Frankie assignment, refresh, and confirm it persists. Repeat on a read-only or recurring Apple event; its Apple details must remain unchanged. An assignment on a recurring event applies to the whole series.
- Open the same event in two sessions, change its assignment in one, and try a different assignment from the stale editor. Confirm the newer assignment survives and the stale session is asked to refresh.
- Open an event editor, edit that event in Apple Calendar, then save the older dashboard editor. Confirm the conflict message and verify the newer Apple version survives.
- Delete the disposable event from either app and confirm it disappears on refresh in the other.
- Verify a repeating event across a daylight-saving transition, including an excluded/moved occurrence. Confirm the app routes recurrence and invitation edits to Apple Calendar.
- Open phone and display sessions, add a grocery item, complete a recurring chore, and confirm the other session updates. Verify that completing the same item from stale sessions reports a conflict.
- Check signed-out reads are denied, a non-member Firebase account is denied, and members cannot directly read `privateCalendarConnections` or `privateCalendarAssignments`.

The deployed functions are ACTIVE with zero minimum instances and a maximum of one instance per function. Build-image cleanup is set to one day. The private Apple connection and the live Apple round trip still require the account owner to connect in the app. Automated tests use simulated provider responses and never contact or modify real calendars. The deployment environment allows Google APIs but blocks direct calls to the public `cloudfunctions.net` URLs, so the live callable response must also be confirmed from the app. These usage controls are not a spending cap.


## 5. Connect Huckleberry in the app

The `huckleberry` callable uses the same existing encryption secret and household membership check as the calendar service. It is deployed with zero minimum instances, at most one instance, and concurrency one. The runtime needs outbound HTTPS/gRPC access to Google Identity Toolkit, Secure Token, and Firestore for Huckleberry’s `simpleintervals` project. The public API configuration is not a credential; each request uses the connected user's Huckleberry ID token, never this project's service account.

1. Open **Settings → Huckleberry** while signed in to Hubert’s House.
2. Enter the Huckleberry email/password in that form, never in chat. Apple/Google-only sign-ins need an email/password login established with Huckleberry first. This is a community integration using an undocumented API, not an official Huckleberry partnership; provider changes may interrupt it.
3. Check the baby's IANA time zone (for example `America/New_York`). With multiple child profiles, choose one and save. A single profile is selected automatically.
4. On Home, use **Start sleep / Finish sleep**, **Bottle**, **Diaper**, or **Finished sleep**. Manual entries use the device's time zone, which the dialog displays. Writes go directly to the selected Huckleberry child. Edit/delete existing logs in Huckleberry.
5. Confirm a real intended entry appears in Huckleberry, then change a log there and refresh Home. No real baby logs are created by automated tests or deployment.

The password is cleared from the form immediately and is not stored. Only the ID/refresh session is encrypted, bound to the household user's UID with a Huckleberry-specific authentication context, in `privateHuckleberryConnections/{uid}`. A normalized snapshot containing only the selected child's recent tracking data is cached in `privateBabySnapshots/{uid}`. Both collections deny all direct client reads/writes; member-only callable access is required. Child membership is rechecked before reads/writes. Nothing is saved in browser storage. Disconnect deletes the local connection and cached snapshot and leaves Huckleberry's records untouched.

Visible Home/Settings sessions check at most every two minutes, with history refreshed at most every 15 minutes during passive checks; explicit refreshes and completed writes load fresh history. Background/hidden pages do not poll. Sleep and bottle history reads are bounded to 60 days, with at most 1,000 regular entries and 80 archived batch documents per tracker; reaching a limit marks that history incomplete. Writes use stable request IDs and atomic batches with document-version checks to avoid duplicates and conflicting updates. Finishing sleep checks the timer's UUID/start to avoid stopping a different session. Backdated entries do not replace a newer last-entry summary.

Huckleberry rejects the server SDK's locking read/write transactions when authenticated with the customer's Firebase user token, even though ordinary reads succeed. Saves therefore use ordinary reads followed by an atomic write batch: interval documents are create-only, and tracker updates require the exact `lastUpdateTime` that was read. A conflicting write retries the reads and timer/newest-summary checks up to three times. This prevents partial logs, duplicate entries on retry, and overwriting a timer or summary changed in the Huckleberry app. Permission errors identify whether child lookup, tracking-data loading, or saving failed; only an unauthenticated session recommends reconnecting. Diagnostics contain only the operation, allowlisted reason, and numeric status, never raw errors or account data.

**SweetSpot:** displays the selected stored Huckleberry prediction, with expired/stale states. SweetSpot requires an eligible Huckleberry plan; this connection does not unlock it. Huckleberry can wait until its app opens to recalculate, so refreshing this dashboard is not a promise of a newly calculated time.

**Hubert’s Purrfect Window:** a transparent personal-history daytime estimate, independent of Huckleberry's algorithm. It merges overlapping/duplicate sleeps, filters overnight and obvious missing-log gaps, then uses up to 20 recent daytime wake gaps from the last 14 days. It prefers gaps beginning within three local clock hours of the latest wake, falling back to other daytime gaps when needed. At least three gaps across two days are required. The center is the median and the range is the interquartile range extended to at least ±10 minutes. The UI shows sample counts, varied/early patterns, passed windows, missing history, and active sleep. No age-based prescription or population model is claimed; this is a convenience estimate, not medical advice.

If sign-in fails, the time zone does not alter the email/password request. Use `America/New_York` for Eastern time; daylight saving is automatic. Invalid zone names are checked before attempting login. Authentication errors distinguish rejected credentials, temporary throttling (including HTTP 400 rate-limit responses), API restrictions, additional sign-in challenges, and service/network failures. Only allowlisted reason codes and HTTP status are returned as diagnostics and logged; passwords, emails, tokens, and raw provider error payloads are excluded. Check the new error after a single retry before changing account credentials.

This adds no separately billed API or AI model. An existing eligible Huckleberry subscription is still needed for SweetSpot, and ordinary Firebase Blaze usage applies. Instance limits and caching reduce usage but do not impose a dollar cap.

## Family display acceptance checks

- Switch Home between day/week/month, navigate across a month boundary, reload, and confirm the selected view persists.
- Toggle dark mode, reload, and check the event editor, baby forms, and sidebar.
- Enter monitor mode and use every sidebar destination. Return Home and confirm the quote, fact, word, joke, weather, missions, and cat crew remain available.
- Save an event with hanry, Karena, or both plus Frankie. Confirm the adult color and pink stripe in both calendars and after reopening the editor. Other/custom assignments disable Frankie.
- For iCloud events, verify the owner/Frankie assignment survives a save/refresh. These fields are stored in Hubert’s House and do not add an owner or stripe in Apple Calendar.
- Click an empty day in both calendars to create an event; drag across days in either direction and verify the last selected day is included. On the full calendar, long-press then drag for touch selection; Home retains normal touch scrolling and its add buttons.
- Click an event and confirm the editor opens directly. Change its start date and verify duration is preserved; test a timed overnight plan, an all-day multi-day span, and the Today/Tomorrow and duration shortcuts.
- Confirm Frankie appears in the calendar legend and filters to events with Frankie alongside an adult.
- Toggle **U.S. holidays** in Calendar and confirm both calendars update. Check Christmas Eve, Thanksgiving, and an observed holiday; household counts and overlap warnings must remain unaffected.

## Checklist acceptance checks

- Open a household or Apple event, add two checklist steps, and save. In **Chores & Lists → Checklists**, confirm the same steps appear under **From your calendar**. Complete a step there, reopen the event, and verify its completion and calendar progress badge.
- Repeat on a read-only Apple event. Apple details must stay unchanged; the checklist belongs to Hubert’s House. Recurring events share one list for the series, rather than resetting tasks for every occurrence.
- Browse the calendar to a different month and confirm the Apple checklist remains in Chores & Lists. Saved event dates are labeled when the original event is outside the loaded range; a freshly loaded event provides its current title/date.
- Use **New checklist** to create “Clean shower” with several steps. Confirm it adds shared list items and no calendar event. **Add a checklist item** still supports single tasks or another item in a named list. Batch creation is atomic.
- Check source, person, search, timing, and completed filters. Edit an event checklist using **Edit checklist → Save checklist**; canceling leaves the saved list untouched.
- Open a checklist in two sessions, save one, then try a conflicting save from the old editor. Confirm it asks to reopen rather than overwriting the newer checklist.
- Disconnect or deselect an Apple calendar and confirm its saved lists disappear from this session while provider events and saved metadata remain intact.

### Hey Siri, ping Hubert

The `siri` HTTPS function (`functions/siri.js`) accepts `POST {text, confirm}` with `Authorization: Bearer <key>` from an Apple Shortcut named **Ping Hubert**. It parses the text with the app’s own `parseBabyLog` (copied into `functions/shared/` by `scripts/share.mjs`). With `confirm:false` it returns `{speak}` for Siri to read back; with `confirm:true` it saves through the existing guarded Huckleberry write path and returns what was logged. Requests use the key owner’s Huckleberry connection, or another member’s if theirs isn’t connected. A stable request ID per key, text and 10-minute slot keeps a double-run from saving twice.

1. In **Settings → “Hey Siri, ping Hubert”**, press **Make my Siri key**. The key is shown once; only its SHA-256 is stored, in server-only `siriKeys`. **Make a new key** replaces it; **Turn off Siri** deletes it.
2. Follow the on-screen steps to build the shortcut (Ask for Input → Get Contents of URL → Get Dictionary Value `speak` → Choose from Menu Yes/No → confirm request → Show Result).
3. Say “Hey Siri, Ping Hubert”, then for example “5 ounces at 5:15”, then “Yes”.

Treat the key like a password: anyone who has it can log entries for Frankie. Revoke it from Settings if a phone is lost.
