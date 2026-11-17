# Hubert’s House

A household dashboard for hanry, Karena, Frankie, Hubert, Mack, and Mia, designed for a phone and a shared display.

- Today: a calendar at the top with day, week, and month toggles (week by default), with event titles, times, household colors, and checklist counts. Open or add a plan directly from the week; browse previous/next weeks or return to Today. Weather, daily moments, chores, and groceries follow below.
- App links: Miateorology with a daily forecast icon and Flapurr with a flying-cat icon, available on phones and shared displays.
- Weather: Richmond high/low, rain chance, wind, and a three-day outlook from Miateorology's published forecast feed; Fahrenheit/Celsius is a device preference.
- Weekly brief: seven-day plan counts, dated to-dos (including overdue items), the busiest day, open evenings, and overlapping timed events for the same household members.
- Calendar: month/week/day/agenda views, household events, event checklists, search, and owner filters including Frankie. Click an empty day to create a plan, drag across days for an inclusive all-day span, or click an event to edit it directly.
- Calendar clarity: warm neutral day backgrounds separate from mint shared-event cards, one compact people label including Frankie, a contained holiday toggle, and time views that open near the current hour.
- Event editor: separate date and time fields, Today/Tomorrow shortcuts, duration presets, and a readable range summary. Moving the start preserves the duration; all-day spans clearly include their last day.
- Holidays: U.S. federal holidays, their observed dates, and familiar dates such as Christmas Eve, Easter, and Halloween. A device-level toggle controls both calendars; holiday labels never count as household plans or conflicts.
- Chores and checklists: create a standalone named checklist with several steps at once, or add an individual task. The Checklists view also shows household and Apple event checklists, with source, date, progress, people, and shared completion. Search and timing/person filters apply to both; switch between all, standalone, and event lists.
- Groceries: a shared list with quantities, aisle grouping, check-off, and clearing bought items.
- Monitor mode: the complete app in fullscreen, with sidebar navigation, editing, baby tracking, and every home-page extra. Keeps supported screens awake; Exit monitor or Escape leaves fullscreen.
- Appearance: a persistent light/dark toggle, compact spacing by default, an optional comfortable layout, and coordinated Sage, Coast, and Clay palettes in Settings. Calendar cards show checklist progress without opening the event.
- Quick plans: Date night, Appointment, and Day off templates open an editable draft. Press **N** for a new event or **/** to search the calendar; shortcuts pause in editors and can be disabled in Settings.
- Task focus: All, Today, Overdue, and Anytime filters, plus search by task title or checklist name. These combine with the existing person and completion filters.
- Daily moments: an original encouragement quote, fun fact, word with a usage example, and a tap-to-reveal joke beside the welcome message. Hubert’s tiny mission adds an optional small daily challenge.
- Shared Apple Calendar: the member who connects Apple Calendar shares their selected calendars with the household by default (view and edit, including owners, Frankie labels and checklists). Others need no Apple sign-in; unselected calendars stay private; only the connecting member can change the selection, turn sharing off, or disconnect. A member can still connect their own Apple account instead.
- iCloud: choose calendars, display Apple events, and create/edit/delete ordinary events with ETag conflict protection. Choose a default calendar per account and device; nonblocking overlap warnings check the loaded events for the same people before saving.
- Frankie: an optional pink striped accent on events and chores, always alongside hanry, Karena, or both. Apple event owners and Frankie assignments are stored privately in Hubert’s House, including for read-only or repeating Apple events.
- Baby tracking: an unofficial Huckleberry connection for sleep timers, finished sleeps, bottles, and diapers. Compare the stored Huckleberry SweetSpot with Hubert’s independent Purrfect Window estimate.
- Shared Huckleberry: connect once for the household. Both adults see the same child and can log entries, change the profile/time zone/nap plan, or manage the connection. Existing single-user connections carry over automatically; stale forms and disconnected sessions cannot overwrite newer settings.
- Frankie page: live awake/asleep status, sleep today, bottles today and a 7-day ounce average; a 14-day 24-hour sleep timeline; daily sleep (night vs. naps) and daily bottle-ounce charts for 14, 30 or 60 days, each with hover details and a table view. Huckleberry history now covers 60 days of sleep and bottle feeds.
- Recent logs (Frankie page, “Fix a mistake”): the last 7 days of sleeps, bottles and diapers from Huckleberry, newest first, with Edit (opens the usual log window prefilled) and Delete (asks first). It loads only when opened. Each change carries the entry’s Huckleberry version, so an entry changed meanwhile in the Huckleberry app is never overwritten. Huckleberry’s “last sleep / bottle / diaper” summary is moved to the next-newest entry so a deleted log doesn’t reappear. Older entries that Huckleberry has archived into batches, breast feeds and notes are edited in the Huckleberry app.
- Three nap predictions: Huckleberry’s SweetSpot, Hubert’s Purrfect Window and Mia’s Catnap Forecast. Mia uses a different method from Purrfect Window: it compares the same nap of the day (wake → nap 1, nap 1 → nap 2…), weights recent days with a three-day half-life plus a capped growth trend, and adjusts for a shorter or longer previous nap using an effect learned from Frankie’s own history. Nap 1 is also adjusted for last night’s total sleep versus her usual night (a waking in the night still counts as one night). After her usual number of naps, or when another nap would run into bedtime, Mia forecasts bedtime: the usual last-nap → night gap blended with her usual bedtime clock time, weighted toward whichever has been steadier. Nap vs night is learned rather than fixed: the evening line sits 30 minutes before Frankie’s earlier recent bedtimes (7 PM until three nights are logged), so a late catnap before a 9–11 PM bedtime counts as a nap. The Frankie page’s charts, the weekly awards and the scoreboard use the same line.
- Nap prediction scoreboard: Hubert’s and Mia’s guesses are recomputed for every daytime wake-up from the sleep logged before it, so backfilled naps get guesses too and nothing is stored for them. Huckleberry’s SweetSpot can’t be replayed, so its latest prediction is saved per wake-up while Frankie is awake (Firestore `babyPredictions`; a newer capture may replace an older one, nothing can be deleted). A nap is scored only when all three have a guess, against when the next sleep actually started. Every model is judged on one time (SweetSpot’s time or the middle of each window): average miss, hits within ±15 minutes, early/late bias and who was closest — so a wide window earns no easier hits. Each card also shows the model’s average window width. SweetSpot follows the household’s nap plan (Settings → Huckleberry; 4 naps by default, or 3, or whatever the Huckleberry app has selected), since Huckleberry keeps one SweetSpot per plan.
- Jokes: a dad joke of the day from a 60-joke rotation, with an optional folded-away “After dark” grown-up joke underneath (hide it per device in Settings).
- Log for Frankie in plain words from the same bar or ⌘K: “frankie bottle 10:30am 4oz”, “frankie 120ml breast milk at 3:15”, “frankie diaper poop”, “frankie nap 1–2:15pm”, “frankie napped 45 min”, “frankie fell asleep 3:40”, “frankie woke up”. Text must name Frankie (or “baby”) plus a log word, so “Frankie swim class Tue 3pm” stays a calendar plan. Logs open the prefilled log window; timer starts/stops act directly. Times lean to the past (“11pm” at 4pm means last night).
- “Hey Siri, Frankie log”: an Apple Shortcut (set up once per phone from Settings) lets you log by voice: Siri asks what to log, you say “5 ounces at 5:15”, “dirty diaper”, “fell asleep at 2:40” or “woke up”, Siri reads it back, and “Yes” saves it to Huckleberry. Each person gets a personal key (only its hash is stored; revocable). It works from Apple Watch too. Setup: [docs/SETUP.md](docs/SETUP.md#hey-siri-frankie-log).
- Log window: quick time chips (Now, 15/30 min, 1 hr ago), an amount stepper with presets, tap-to-choose milk and diaper types, a live nap length, and notes tucked away. A new bottle starts from the most recent bottle’s amount, units and milk (“Same as last” restores it).
- Quick add in plain words: “Pediatrician Tue 3pm with Frankie”, “Dinner with friends Fri 7–9pm”, “Yoga for Karena tomorrow 8am for 90 min”. It understands days, dates, times, ranges, durations, people and Frankie, and opens a prefilled editor so nothing saves unseen.
- ⌘K / Ctrl+K command palette: jump anywhere, find upcoming plans, log a bottle or sleep, add groceries, search the calendar, or type a plan to create it.
- Now & Next: one quiet line under the page title with what’s happening now and next (with a countdown), Frankie’s awake/asleep time and next nap, time since the last bottle, and rain warnings.
- Weather-aware plans: outdoor-sounding plans (park, walk, market, picnic, zoo…) on days with a 40%+ rain chance get a ☔ badge on the home calendar and a heads-up in Now & Next.
- Morning newsletter: at 6:30am each member gets an email digest of the home page — weather, today’s plans, Frankie’s night and yesterday’s ounces, the nap challenge, chores, free date nights and the dad joke. Per-person on/off, greeting name and optional after-dark joke in Settings, plus “Send me one now”. Setup: [docs/SETUP.md](docs/SETUP.md#morning-newsletter).
- Living sky: the welcome banner follows the real time of day and today’s forecast — dawn, midday, golden hour, dusk, stars at night, clouds, rain or snow.
- Free nights: the welcome banner lists the next evenings (5–10pm) with nothing planned for hanry or Karena, weekends first; tap one to draft a date night.
- Frankie’s Weekly Awards: Nap of the Week, Longest Stretch, Early Bird, Thirstiest Day, Big Gulp, Nap Queen and Milk Mileage from the last seven full days (also in Monday’s newsletter).
- Resident supervisors: personalized tabby portraits for Hubert (darker brown, yellow eyes), Mack (brown, green eyes), and Mia (light tabby/Siamese mix, blue eyes). Tap a cat for a little note.

## Current activation status

The frontend is deployed at **https://huberts-house.web.app**, with Firebase Authentication and household membership rules enabled. `calendarServiceEnabled` is `true`; the eight private calendar functions and the `huckleberry` callable are deployed in `us-central1`. `huckleberryServiceEnabled` is `true`; connect under **Settings → Huckleberry**. Connect an Apple account in **Settings → Apple Calendar** using an app-specific password, select calendars, then choose the default for new events. No existing household records are migrated or changed by the build.

**[Setup and connection instructions](docs/SETUP.md)** cover new deployments and the account-specific Apple and Huckleberry connections. Firebase Authentication and explicit household membership protect the app.

`?demo=1` opens a labeled sample-data preview. All demo changes live in memory and reset on reload. It never reads or writes the household database or calls iCloud/Huckleberry. Sample baby logs reset on reload.

The weather card selects today's date in `America/New_York`, refreshes every five minutes while visible, and labels the forecast's issue time. It can use a saved forecast when a refresh fails; forecasts older than 72 hours or missing today's date are shown as unavailable. It requires no new Firebase service or paid API. Preview mode uses a labeled sample forecast.

The weekly brief uses the display's local time. Open evenings have no calendar events between 5 and 10 pm. Overlap checks exclude all-day events and separate members' plans; an event assigned to both members participates in either member's overlap check. The brief reads existing data without changing it.

The home calendar shows today plus the following six local dates, including all-day, overnight, and repeating events. It reads the same household event snapshot as the full calendar and stays independent of its search and person filters. Clock refreshes advance the week after local midnight; a manually browsed week stays selected until **Today** is pressed. Seven columns fit desktop and landscape displays, with a readable week agenda on phones. **Monitor mode** fills the screen with the complete app and requests a screen wake lock. All sidebar destinations, forms, daily moments, and cat interactions remain available. The home calendar view and theme are device preferences. Fullscreen requires a click; a saved monitor preference restores the layout on reload, and the browser may require its own fullscreen shortcut afterward.

Daily moments follow the device's local calendar date and rotate through a curated 14-day collection; tiny missions repeat weekly. Quotes are original encouragement attributed to Hubert’s House. The daily content works offline without an API; appearance, shortcut preferences, and mission completion stay on the device. Templates save nothing until you submit the event form.

## Development

Use Node 22 (the deployed Functions runtime).

```sh
npm ci
npm --prefix functions ci
npm test
npm run check
npm run build
```

`dist/` contains only public frontend files. The source remains compatible with static hosting, including the existing GitHub Pages site; private iCloud requests run in Firebase Functions.

`calendar-model.js` shares local-date and exclusive-end handling between the calendar, today view, and weekly brief, including daylight-saving boundaries. Unchanged list markup is reused during background updates to retain keyboard focus, and clock refreshes pause while the page is hidden.

## Calendar behavior

Apple is the source of truth for connected events. Reads query the selected calendars. Edits and deletions go directly to iCloud with the previously read ETag; an intervening change produces a conflict instead of being overwritten. Refresh runs when navigating the calendar, returning to the page, manually, and every five minutes while visible (passive checks are deduplicated; manual refresh and completed writes refresh immediately). Calendar changes are never written to the existing shared Firestore `events` collection.

All-day date boundaries, Apple timezone definitions, recurrence exceptions, alarms, locations, and unknown properties are preserved. Recurring events and invitations are shown but are edited in Apple Calendar in this release; the UI and server enforce that limit. Household events retain their existing repeating-series editor and event checklists. Apple event checklists are stored in Hubert’s House and can also be edited from Chores & Lists. A selected calendar belongs to the signed-in member’s connection; other household members connect their own account or the same shared iCloud calendar.

Owners, Frankie assignments, and event checklists live in the server-only `privateCalendarAssignments` collection, keyed by the connected calendar and Apple event UID. Changing only these fields verifies access to the Apple event and writes only to Hubert’s House, so even read-only events can have people and checklists. Assignments and checklists apply to the entire Apple series and survive event date/resource changes. Version checks prevent silently replacing another session’s assignment or checklist. Owner-only saves from older clients preserve the checklist. A saved event label/date indexes Apple checklists independently of the visible calendar range; a loaded event takes precedence over that saved context. Disconnecting or deselecting a calendar hides its lists without deleting them. Existing Apple extension properties remain a fallback until an assignment is saved here; they are preserved but no longer written. If Apple saves an event but its household details fail to save, the editor retains the checklist draft, locks the already-saved Apple fields, and retries only the household metadata. It never resubmits the Apple event.

Apple app-specific passwords are sent over HTTPS to the private backend, encrypted using AES-256-GCM with a Secret Manager key and a per-user authenticated context, and stored in a server-only collection. No credentials go in the frontend bundle, Git, localStorage, or Firestore documents readable by clients.

## Verification

`npm test` exercises recurrence and date behavior, conflict preconditions, preservation of Apple event properties, credential isolation, URL restrictions, and DOM interactions using the real FullCalendar bundle with in-memory sample data. Tests also exercise private Apple assignments and partial saves, holiday/observed dates, duration-preserving date editing, shared event/standalone checklists, stale checklist protection, encrypted Huckleberry session isolation, child access, idempotent writes, changed timers, backdated summaries, stored SweetSpot freshness, the history model, and all three home calendar ranges. Mocked provider tests do not establish live Apple or Huckleberry account connectivity. See the acceptance checklist in the setup guide for the final live round trip.

## Usage controls

Calendar and Huckleberry functions use fractional CPU, zero minimum instances, concurrency one, and at most one instance **per function**. The Artifact Registry build repository deletes deployment images older than one day. These reduce usage; they are **not a hard dollar cap**. Firebase/Google Cloud billing budgets still need to be managed in the billing console.

Weather classification and SVG geometry live in `weather-shared.js`, with an identical copy in Miateorology's `assets/weather-shared.js`. Update both together. Forecast icons describe today's daily Richmond outlook, not a live observation.
