# Activate household sign-in and iCloud

The repository is configured for the existing Firebase project **huberts-house**. The new frontend needs the steps below before replacing the live GitHub Pages version. Keep the current live frontend in place until sign-in, membership, and rules are ready. No data migration is required: household events keep using the original `events` collection.

## 1. Enable real household accounts

1. In Firebase Console → Authentication, enable **Email/Password** sign-in.
2. Create one user for hanry and one for Karena, with their own email addresses and passwords. Set passwords outside chat and source control.
3. Add `gitcrazygitwild.github.io` (and any other frontend hostname you use) to Authentication → Settings → Authorized domains.
4. In Firestore Console, create a document for each account at `households/home/members/USER_UID`, where `USER_UID` is the exact UID shown in Authentication. Give it the boolean field `active: true`. Membership can only be managed through trusted admin access; visitors cannot enroll themselves.
5. Deploy `firestore.rules` below before enabling the iCloud UI. They restrict the existing events and new household lists to those members and deny all direct client access to `privateCalendarConnections`.

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

Create a 32-byte encryption key directly in Secret Manager without placing it in Git or a file:

```sh
openssl rand -base64 32 | firebase functions:secrets:set CALENDAR_ENCRYPTION_KEY --data-file=- --project huberts-house
firebase deploy --only functions:household-calendar --project huberts-house
```

Keep the generated secret intact for existing connections. Rotating it requires reconnecting the Apple accounts (or a separate credential migration). The Functions service account needs its normal Firestore access and permission to read this secret; Firebase’s deployment prompts establish the secret binding.

The deployed runtime must be able to reach `https://caldav.icloud.com` and Apple's `https://pNN-caldav.icloud.com` calendar shards. The application refuses credentials on other hosts and checks redirect destinations before following them.

## 3. Activate and publish the frontend

Change `calendarServiceEnabled` to `true` in `config.js` only after the service has deployed. There are no private values in that file.

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

## 4. Connect Apple Calendar in the app

1. Sign in to Hubert’s House with a household account.
2. Open **Settings → Apple Calendar**.
3. At [account.apple.com](https://account.apple.com), create an app-specific password named “Hubert’s House” under Sign-In and Security. Apple requires two-factor authentication for app-specific passwords. Use an app-specific password, not the Apple Account password.
4. Enter the Apple Account email and app-specific password in the app. The password is cleared from the form after submission and is never retained in browser storage.
5. Select the calendars to show and save the selection. No calendars are selected automatically on a first connection.
6. When adding an event, choose a writable iCloud calendar in the **Calendar** field. “Hubert’s House” continues to mean an event stored only in the household database.

Connect each household member’s Apple account under their own sign-in. An iCloud calendar already shared between members can be selected by either member. A tablet left signed in can access that member’s selected calendars; choose a shared household calendar if that is the intended display audience.

Disconnect removes the encrypted credential from the service without changing Apple events. To revoke the password at Apple as well, delete it at account.apple.com.

## Live acceptance checks

Use a disposable test calendar and event for the initial checks:

- Create an event in Apple Calendar; refresh the dashboard and see it appear.
- Add an event in Hubert’s House using that iCloud calendar; see it appear in Apple Calendar.
- Edit title, notes, date/time, and an all-day span in Hubert’s House; verify the Apple result.
- Open an event editor, edit that event in Apple Calendar, then save the older dashboard editor. Confirm the conflict message and verify the newer Apple version survives.
- Delete the disposable event from either app and confirm it disappears on refresh in the other.
- Verify a repeating event across a daylight-saving transition, including an excluded/moved occurrence. Confirm the app routes recurrence and invitation edits to Apple Calendar.
- Open phone and display sessions, add a grocery item, complete a recurring chore, and confirm the other session updates. Verify that completing the same item from stale sessions reports a conflict.
- Check signed-out reads are denied, a non-member Firebase account is denied, and members cannot directly read `privateCalendarConnections`.

No live Apple credentials or Firebase deployment credentials were available during implementation, so these live checks remain required. Automated tests use simulated provider responses and never contact or modify real calendars.
