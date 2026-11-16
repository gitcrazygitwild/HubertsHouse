import { createHash } from 'node:crypto';
import { CalendarError } from './caldav.js';

export function validateAssignment(input) {
  if (!input || !['hanry','karena','both','custom'].includes(input.owner) || typeof input.withFrankie !== 'boolean' || (input.withFrankie && input.owner === 'custom')) throw new CalendarError('invalid-argument','Choose hanry, Karena, or both when Frankie is coming along.');
  if (typeof input.ownerCustom !== 'string' || input.ownerCustom.length > 100) throw new CalendarError('invalid-argument','Keep custom names under 100 characters.');
  return {owner:input.owner,ownerCustom:input.owner === 'custom' ? input.ownerCustom.trim() : '',withFrankie:input.withFrankie};
}
export function assignmentKey(calendarId,uid) {
  if (typeof uid !== 'string' || !uid || uid.length>2048) throw new CalendarError('failed-precondition','This Apple event has no usable identifier.');
  return createHash('sha256').update(`${calendarId}\0${uid}`).digest('hex');
}
export function createAssignmentStore(db) {
  const ref=(calendarId,uid)=>db.doc(`privateCalendarAssignments/${assignmentKey(calendarId,uid)}`);
  return {
    async apply(events) {
      const valid=event=>typeof event.uid==='string' && event.uid.length>0 && event.uid.length<=2048;
      const keys=[...new Map(events.filter(valid).map(event=>{const r=ref(event.calendarId,event.uid);return [r.path,r];})).values()],assignments=new Map();
      for (let index=0;index<keys.length;index+=250) {
        for (const snap of await db.getAll(...keys.slice(index,index+250))) if (snap.exists) assignments.set(snap.ref.path,snap.data());
      }
      return events.map(event=>{const saved=valid(event) ? assignments.get(ref(event.calendarId,event.uid).path) : null;return {...event,...(saved ? validateAssignment(saved) : {}),assignmentVersion:saved?.version || 0};});
    },
    async save(calendarId,uid,input,expectedVersion) {
      const assignment=validateAssignment(input);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion<0) throw new CalendarError('invalid-argument','Refresh this event before assigning it.');
      const reference=ref(calendarId,uid);
      return db.runTransaction(async transaction=>{
        const snap=await transaction.get(reference),current=snap.exists?snap.data():null;
        if(current && current.owner===assignment.owner && current.ownerCustom===assignment.ownerCustom && current.withFrankie===assignment.withFrankie) return {...assignment,assignmentVersion:current.version};
        if ((current?.version || 0)!==expectedVersion) throw new CalendarError('aborted','The household assignment changed. Refresh and reopen the event before saving.');
        const version=expectedVersion+1;
        transaction.set(reference,{...assignment,version,updatedAt:new Date().toISOString()});
        return {...assignment,assignmentVersion:version};
      });
    },
    async remove(calendarId,uid) { await ref(calendarId,uid).delete(); }
  };
}
