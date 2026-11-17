// Household-shared Apple Calendar. A member without their own Apple connection
// uses the one member connection shared with the household: the calendars that
// member selected, with view-and-edit access. Unselected calendars stay
// private, only the connecting account can change the selection or disconnect,
// and the Apple credential stays encrypted to its owner. Owners, Frankie labels
// and checklists already live in privateCalendarAssignments keyed by calendar +
// event UID, so both adults see the same ones.
import { CalendarError } from './caldav.js';

export const sharesWithHousehold = data => data?.shareWithHousehold !== false;

// → { ownerUid, data, shared }  (shared: true when borrowing another member's connection)
export async function resolveCalendarConnection({ db, uid, members }) {
  const own = await db.doc(`privateCalendarConnections/${uid}`).get();
  if (own.exists) return { ownerUid:uid, data:own.data(), shared:false };
  const others = (await members()).filter(member => member !== uid);
  const offers = [];
  for (const member of others) {
    const snap = await db.doc(`privateCalendarConnections/${member}`).get();
    if (snap.exists && sharesWithHousehold(snap.data())) offers.push({ ownerUid:member, data:snap.data(), shared:true });
  }
  if (offers.length === 1) return offers[0];
  if (!offers.length) throw new CalendarError('failed-precondition', 'Connect your iCloud account first.');
  // Never guess between two people's Apple accounts.
  throw new CalendarError('failed-precondition', 'More than one household member shares an Apple calendar. Connect your own Apple account here to choose.');
}

// What a borrowing member is allowed to see: only the owner's selected calendars.
export function sharedView(data) {
  const calendars = (data.calendars || []).filter(calendar => data.selected?.includes(calendar.id)).map(({ url, ...calendar }) => calendar);
  return { connected:true, shared:true, calendars, selected:calendars.map(calendar => calendar.id) };
}
