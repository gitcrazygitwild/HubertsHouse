# Hubert’s House

A household dashboard for hanry, Karena, and Hubert, designed for a phone and a shared display.

- Today: upcoming plans, chores, and a grocery count.
- Calendar: the existing month/week/day/agenda views, household events, event checklists, search, and owner filters.
- Chores and checklists: assignments, due dates, named lists, recurring chores, completion and undo.
- Groceries: a shared list with quantities, aisle grouping, check-off, and clearing bought items.
- Display mode: larger text, compact navigation, and a screen wake lock when the browser supports it.
- iCloud: choose calendars, display Apple events, and create/edit/delete ordinary events with ETag conflict protection.

## Current activation status

The implementation is in source; the Firebase backend and new sign-in configuration still need deployment. `calendarServiceEnabled` defaults to `false`. No Apple account is connected and no existing household records are migrated or changed by the build.

**[Complete the one-time setup](docs/SETUP.md)** before deploying the new frontend to replace the existing site. The old cosmetic password gate has been replaced with Firebase Authentication and explicit household membership.

`?demo=1` opens a labeled sample-data preview. All demo changes live in memory and reset on reload. It never reads or writes the household database or calls iCloud.

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

## Calendar behavior

Apple is the source of truth for connected events. Reads query the selected calendars. Edits and deletions go directly to iCloud with the previously read ETag; an intervening change produces a conflict instead of being overwritten. Refresh runs when navigating the calendar, returning to the page, manually, and every minute while visible. Calendar changes are never written to the existing shared Firestore `events` collection.

All-day date boundaries, Apple timezone definitions, recurrence exceptions, alarms, locations, and unknown properties are preserved. Recurring events and invitations are shown but are edited in Apple Calendar in this release; the UI and server enforce that limit. Household events retain their existing repeating-series editor and event checklists. iCloud event checklists are not supported. A selected calendar belongs to the signed-in member’s connection; other household members connect their own account or the same shared iCloud calendar.

Apple app-specific passwords are sent over HTTPS to the private backend, encrypted using AES-256-GCM with a Secret Manager key and a per-user authenticated context, and stored in a server-only collection. No credentials go in the frontend bundle, Git, localStorage, or Firestore documents readable by clients.

## Verification

`npm test` exercises recurrence and date behavior, conflict preconditions, preservation of Apple event properties, credential isolation, URL restrictions, and DOM interactions using the real FullCalendar bundle with in-memory sample data. Mocked provider tests do not establish live Apple account connectivity. See the acceptance checklist in the setup guide for the final live round trip.
