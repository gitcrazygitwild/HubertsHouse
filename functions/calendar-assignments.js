import { createHash } from 'node:crypto';
import { CalendarError } from './caldav.js';

export function validateAssignment(input) {
  if (!input || !['hanry','karena','both','custom'].includes(input.owner) || typeof input.withFrankie !== 'boolean' || (input.withFrankie && input.owner === 'custom')) throw new CalendarError('invalid-argument','Choose hanry, Karena, or both when Frankie is coming along.');
  if (typeof input.ownerCustom !== 'string' || input.ownerCustom.length > 100) throw new CalendarError('invalid-argument','Keep custom names under 100 characters.');
  const result={owner:input.owner,ownerCustom:input.owner === 'custom' ? input.ownerCustom.trim() : '',withFrankie:input.withFrankie};
  if (Object.hasOwn(input,'checklist')) {
    if (!Array.isArray(input.checklist) || input.checklist.length>200 || input.checklist.some(item=>!item || typeof item.text!=='string' || !item.text.trim() || item.text.length>500 || typeof item.done!=='boolean' || (item.id!==undefined && (typeof item.id!=='string' || item.id.length>100)))) throw new CalendarError('invalid-argument','Use up to 200 checklist items, each under 500 characters.');
    result.checklist=input.checklist.map(({id,text,done})=>({...((id) ? {id} : {}),text:text.trim(),done}));
  }
  return result;
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
      return events.map(event=>{const saved=valid(event) ? assignments.get(ref(event.calendarId,event.uid).path) : null;return {...event,checklist:[],...(saved ? validateAssignment(saved) : {}),assignmentVersion:saved?.version || 0};});
    },
    async save(calendarId,uid,input,expectedVersion,context) {
      const assignment=validateAssignment(input);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion<0) throw new CalendarError('invalid-argument','Refresh this event before assigning it.');
      const reference=ref(calendarId,uid);
      return db.runTransaction(async transaction=>{
        const snap=await transaction.get(reference),current=snap.exists?snap.data():null;
        const next={...(current ? validateAssignment(current) : {}),...assignment};
        if(current && JSON.stringify(validateAssignment(current))===JSON.stringify(next) && (!context || JSON.stringify(current.context)===JSON.stringify(context))) return {...next,assignmentVersion:current.version};
        if ((current?.version || 0)!==expectedVersion) throw new CalendarError('aborted','The household assignment or checklist changed. Refresh and reopen the event before saving.');
        const version=expectedVersion+1;
        transaction.set(reference,{...current,...next,calendarId,uid,...(context ? {context} : {}),version,updatedAt:new Date().toISOString()});
        return {...next,assignmentVersion:version};
      });
    },
    async lists(calendarIds) {
      if(!calendarIds.length)return [];
      const snapshots=await db.collection('privateCalendarAssignments').where('calendarId','in',calendarIds).get();
      return snapshots.docs.map(doc=>doc.data()).filter(item=>item.checklist?.length && item.context).map(item=>({...item.context,calendarId:item.calendarId,uid:item.uid,...validateAssignment(item),assignmentVersion:item.version,icloud:true,checklistOnly:true}));
    },
    async remove(calendarId,uid) { await ref(calendarId,uid).delete(); }
  };
}
