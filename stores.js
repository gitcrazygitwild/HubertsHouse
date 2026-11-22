// The household's shared Firestore data, one small store per kind (subscribe + save/add/remove).
// Each takes the Firestore handle from app.js. Moved out of app.js unchanged (cleanup plan, step 1).
import { collection, doc, onSnapshot, query, orderBy, limit, runTransaction, serverTimestamp, addDoc, deleteDoc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { sweetspotPatch } from './prediction-log.js';

// Nap scoreboard: the latest SweetSpot per wake-up (Hubert and Mia are replayed).
export function predictionStore(db) {
  const col = collection(db,'babyPredictions');
  return {
    subscribe(next) { return onSnapshot(query(col,orderBy('lastWake','desc'),limit(400)),snap => next(snap.docs.map(d => ({id:d.id,...d.data()}))),() => next(null)); },
    async record(entry) {
      const { id, ...data } = entry, ref = doc(col,id);
      await runTransaction(db,async transaction => {
        const current = await transaction.get(ref), patch = sweetspotPatch(current.exists() ? current.data() : null, data);
        if (!patch) return;
        if (current.exists()) transaction.update(ref,{...patch,updatedAt:serverTimestamp()}); else transaction.set(ref,{...patch,createdAt:serverTimestamp()});
      });
    }
  };
}
// "Got a hunch?" on the Frankie page: the household's hypotheses, shared.
export function hypothesisStore(db) {
  const col = collection(db,'babyHypotheses');
  return {
    subscribe(next) { return onSnapshot(query(col,orderBy('createdAt','desc'),limit(100)),snap => next(snap.docs.map(d => ({id:d.id,...d.data()}))),() => next(null)); },
    async add(hunch) { await addDoc(col,{...hunch,createdAt:serverTimestamp()}); },
    async remove(id) { await deleteDoc(doc(col,id)); }
  };
}
// The one shared settings document (householdSettings/home): Frankie's bath days.
export function settingsStore(db) {
  const ref = doc(db,'householdSettings','home');
  return {
    subscribe(next) { return onSnapshot(ref,snap => next(snap.exists() ? snap.data().bathDays ?? null : null),() => next(null)); },
    async save(bathDays) { await setDoc(ref,{bathDays,updatedAt:serverTimestamp()},{merge:true}); }
  };
}
// Trash and recycling days live in the same settings document.
export function trashStore(db) {
  const ref = doc(db,'householdSettings','home');
  return {
    subscribe(next) { return onSnapshot(ref,snap => next(snap.exists() ? snap.data().trash ?? null : null),() => next(null)); },
    async save(trash) { await setDoc(ref,{trash,updatedAt:serverTimestamp()},{merge:true}); }
  };
}
export function firestoreStore(db, name = 'householdItems') {
  const col = collection(db,name);
  const check = (snapshot,item) => { if (!snapshot.exists() || snapshot.data().version !== item.version) throw new Error('This item changed on another device. Try again.'); };
  return {
    subscribe(next,status) {
      return onSnapshot(col,{includeMetadataChanges:true},snap => {
        next(snap.docs.map(d => ({id:d.id,...d.data()})));
        status(snap.metadata.hasPendingWrites ? 'Saving changes…' : snap.metadata.fromCache ? 'Offline · showing cached items' : 'Shared household · up to date');
      },() => status('Could not sync household lists. Check your connection and household access.',true));
    },
    async add(data) { const ref = await addDoc(col,{...data,version:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}); return { ...data,id:ref.id,version:0 }; },
    async addMany(items) {
      const batch=writeBatch(db);for(const item of items)batch.set(doc(col),{...item,version:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await batch.commit();
    },
    async update(item,patch) {
      return runTransaction(db,async transaction => {
        const ref = doc(col,item.id); const snapshot = await transaction.get(ref); check(snapshot,item);
        const next = {...patch,version:item.version+1,updatedAt:serverTimestamp()}; transaction.update(ref,next);
        return {...item,...next};
      });
    },
    async remove(item) { await runTransaction(db,async t => { const ref=doc(col,item.id); check(await t.get(ref),item); t.delete(ref); }); },
    async removeMany(items) { await runTransaction(db,async t => {
      if (items.length > 400) throw new Error('Clear fewer than 400 bought items at a time.');
      const snapshots = await Promise.all(items.map(item => t.get(doc(col,item.id))));
      items.forEach((item,i) => check(snapshots[i],item)); items.forEach(item => t.delete(doc(col,item.id)));
    }); }
  };
}
