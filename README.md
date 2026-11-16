# Hubert’s House

A household dashboard for hanry, Karena, Frankie, Hubert, Mack, and Mia, designed for a phone and a shared display.

- Today: a calendar at the top with day, week, and month toggles (week by default), with event titles, times, household colors, and checklist counts. Open or add a plan directly from the week; browse previous/next weeks or return to Today. Weather, daily moments, chores, and groceries follow below.
- App links: Miateorology with a daily forecast icon and Flapurr with a flying-cat icon, available on phones and shared displays.
- Weather: Richmond high/low, rain chance, wind, and a three-day outlook from Miateorology's published forecast feed; Fahrenheit/Celsius is a device preference.
- Weekly brief: seven-day plan counts, dated to-dos (including overdue items), the busiest day, open evenings, and overlapping timed events for the same household members.
- Calendar: month/week/day/agenda views, household events, event checklists, search, and owner filters including Frankie. Click an empty day to create a plan, drag across days for an inclusive all-day span, or click an event to edit it directly.
- Event editor: separate date and time fields, Today/Tomorrow shortcuts, duration presets, and a readable range summary. Moving the start preserves the duration; all-day spans clearly include their last day.
- Holidays: U.S. federal holidays, their observed dates, and familiar dates such as Christmas Eve, Easter, and Halloween. A device-level toggle controls both calendars; holiday labels never count as household plans or conflicts.
- Chores and checklists: assignments, due dates, named lists, recurring chores, completion and undo.
- Groceries: a shared list with quantities, aisle grouping, check-off, and clearing bought items.
- Monitor mode: the complete app in fullscreen, with sidebar navigation, editing, baby tracking, and every home-page extra. Keeps supported screens awake; Exit monitor or Escape leaves fullscreen.
- Appearance: a persistent light/dark toggle, compact spacing by default, an optional comfortable layout, and coordinated Sage, Coast, and Clay palettes in Settings. Calendar cards show checklist progress without opening the event.
- Quick plans: Date night, Appointment, and Day off templates open an editable draft. Press **N** for a new event or **/** to search the calendar; shortcuts pause in editors and can be disabled in Settings.
- Task focus: All, Today, Overdue, and Anytime filters, plus search by task title or checklist name. These combine with the existing person and completion filters.
- Daily moments: an original encouragement quote, fun fact, word with a usage example, and a tap-to-reveal joke beside the welcome message. Hubert’s tiny mission adds an optional small daily challenge.
- iCloud: choose calendars, display Apple events, and create/edit/delete ordinary events with ETag conflict protection. Choose a default calendar per account and device; nonblocking overlap warnings check the loaded events for the same people before saving.
- Frankie: an optional pink striped accent on events and chores, always alongside hanry, Karena, or both. Apple event owners and Frankie assignments are stored privately in Hubert’s House, including for read-only or repeating Apple events.
- Baby tracking: an unofficial Huckleberry connection for sleep timers, finished sleeps, bottles, and diapers. Compare the stored Huckleberry SweetSpot with Hubert’s independent Purrfect Window estimate.
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

All-day date boundaries, Apple timezone definitions, recurrence exceptions, alarms, locations, and unknown properties are preserved. Recurring events and invitations are shown but are edited in Apple Calendar in this release; the UI and server enforce that limit. Household events retain their existing repeating-series editor and event checklists. iCloud event checklists are not supported. A selected calendar belongs to the signed-in member’s connection; other household members connect their own account or the same shared iCloud calendar.

Owners and Frankie assignments live in the server-only `privateCalendarAssignments` collection, keyed by the connected calendar and Apple event UID. Changing only these fields verifies access to the Apple event and writes only to Hubert’s House, so even read-only events can be assigned. Assignments apply to the entire Apple series and survive event date/resource changes. Version checks prevent silently replacing another session’s assignment. Existing Apple extension properties remain a fallback until an assignment is saved here; they are preserved but no longer written. If Apple saves an event but the assignment write fails, the app reports that partial success and asks you to refresh and reopen it rather than submit another Apple event.

Apple app-specific passwords are sent over HTTPS to the private backend, encrypted using AES-256-GCM with a Secret Manager key and a per-user authenticated context, and stored in a server-only collection. No credentials go in the frontend bundle, Git, localStorage, or Firestore documents readable by clients.

## Verification

`npm test` exercises recurrence and date behavior, conflict preconditions, preservation of Apple event properties, credential isolation, URL restrictions, and DOM interactions using the real FullCalendar bundle with in-memory sample data. Tests also exercise private Apple assignments and partial saves, holiday/observed dates, duration-preserving date editing, encrypted Huckleberry session isolation, child access, idempotent writes, changed timers, backdated summaries, stored SweetSpot freshness, the history model, and all three home calendar ranges. Mocked provider tests do not establish live Apple or Huckleberry account connectivity. See the acceptance checklist in the setup guide for the final live round trip.

## Usage controls

Calendar and Huckleberry functions use fractional CPU, zero minimum instances, concurrency one, and at most one instance **per function**. The Artifact Registry build repository deletes deployment images older than one day. These reduce usage; they are **not a hard dollar cap**. Firebase/Google Cloud billing budgets still need to be managed in the billing console.

Weather classification and SVG geometry live in `weather-shared.js`, with an identical copy in Miateorology's `assets/weather-shared.js`. Update both together. Forecast icons describe today's daily Richmond outlook, not a live observation.
