# Hubert’s House

A household dashboard for hanry, Karena, and Hubert, designed for a phone and a shared display.

- Today: upcoming plans, chores, and a grocery count.
- App links: Miateorology with a daily forecast icon and Flapurr with a flying-cat icon, available on phones and shared displays.
- Weather: Richmond high/low, rain chance, wind, and a three-day outlook from Miateorology's published forecast feed; Fahrenheit/Celsius is a device preference.
- Weekly brief: seven-day plan counts, dated to-dos (including overdue items), the busiest day, open evenings, and overlapping timed events for the same household members.
- Calendar: the existing month/week/day/agenda views, household events, event checklists, search, and owner filters.
- Chores and checklists: assignments, due dates, named lists, recurring chores, completion and undo.
- Groceries: a shared list with quantities, aisle grouping, check-off, and clearing bought items.
- Display mode: larger text, compact navigation, and a screen wake lock when the browser supports it.
- Appearance: compact spacing by default, an optional comfortable layout, and coordinated Sage, Coast, and Clay palettes in Settings. Calendar cards show checklist progress without opening the event.
- Quick plans: Date night, Appointment, and Day off templates open an editable draft. Press **N** for a new event or **/** to search the calendar; shortcuts pause in editors and can be disabled in Settings.
- Task focus: All, Today, Overdue, and Anytime filters, plus search by task title or checklist name. These combine with the existing person and completion filters.
- Daily moments: an original encouragement quote, fun fact, word with a usage example, and a tap-to-reveal joke beside the welcome message. Hubert’s tiny mission adds an optional small daily challenge.
- iCloud: choose calendars, display Apple events, and create/edit/delete ordinary events with ETag conflict protection.

## Current activation status

The frontend is deployed at **https://huberts-house.web.app**, with Firebase Authentication and household membership rules enabled. `calendarServiceEnabled` is `false`; the private iCloud service has not been deployed. No Apple account is connected and no existing household records are migrated or changed by the build.

**[Complete the one-time setup](docs/SETUP.md)** before deploying the new frontend to replace the existing site. The old cosmetic password gate has been replaced with Firebase Authentication and explicit household membership.

`?demo=1` opens a labeled sample-data preview. All demo changes live in memory and reset on reload. It never reads or writes the household database or calls iCloud.

The weather card selects today's date in `America/New_York`, refreshes every 15 minutes while visible, and labels the forecast's issue time. It can use a saved forecast when a refresh fails; forecasts older than 72 hours or missing today's date are shown as unavailable. It requires no new Firebase service or paid API. Preview mode uses a labeled sample forecast.

The weekly brief uses the display's local time. Open evenings have no calendar events between 5 and 10 pm. Overlap checks exclude all-day events and separate members' plans; an event assigned to both members participates in either member's overlap check. The brief reads existing data without changing it.

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

Apple is the source of truth for connected events. Reads query the selected calendars. Edits and deletions go directly to iCloud with the previously read ETag; an intervening change produces a conflict instead of being overwritten. Refresh runs when navigating the calendar, returning to the page, manually, and every minute while visible. Calendar changes are never written to the existing shared Firestore `events` collection.

All-day date boundaries, Apple timezone definitions, recurrence exceptions, alarms, locations, and unknown properties are preserved. Recurring events and invitations are shown but are edited in Apple Calendar in this release; the UI and server enforce that limit. Household events retain their existing repeating-series editor and event checklists. iCloud event checklists are not supported. A selected calendar belongs to the signed-in member’s connection; other household members connect their own account or the same shared iCloud calendar.

Apple app-specific passwords are sent over HTTPS to the private backend, encrypted using AES-256-GCM with a Secret Manager key and a per-user authenticated context, and stored in a server-only collection. No credentials go in the frontend bundle, Git, localStorage, or Firestore documents readable by clients.

## Verification

`npm test` exercises recurrence and date behavior, conflict preconditions, preservation of Apple event properties, credential isolation, URL restrictions, and DOM interactions using the real FullCalendar bundle with in-memory sample data. Mocked provider tests do not establish live Apple account connectivity. See the acceptance checklist in the setup guide for the final live round trip.
