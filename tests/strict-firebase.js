// A stand-in for the Firebase SDK that is as strict as the real one about arguments, so the
// signed-in startup path can run in tests. collection()/doc() reject anything but a database
// or reference as the first argument and check the path length, like the real SDK does
// ("invalid-argument"). Reads come back empty; writes are recorded. No network.
const fail = message => { const error = new Error(message); error.code = 'invalid-argument'; error.name = 'FirebaseError'; throw error; };

export function strictFirebase({ uid = 'member-1', email = 'member@example.com', active = true } = {}) {
  class Db { constructor() { this.type = 'firestore'; } }
  class Ref { constructor(db, path) { this.firestore = db; this.path = path; this.id = path.at(-1); } }
  class CollectionRef extends Ref { get type() { return 'collection'; } }
  class DocRef extends Ref { get type() { return 'document'; } }
  class Query { constructor(ref, constraints) { this.ref = ref; this.constraints = constraints; this.type = 'query'; } }
  const db = new Db(), writes = [], listeners = [];
  let autoId = 0;
  const segments = parts => parts.flatMap(part => { if (typeof part !== 'string' || !part) fail(`Path segments must be non-empty strings (got ${typeof part}).`); return part.split('/').filter(Boolean); });
  const base = parent => parent instanceof Db ? [parent, []] : parent instanceof Ref ? [parent.firestore, parent.path] : fail('Expected first argument to be a Firestore, CollectionReference or DocumentReference.');
  const snapshot = (ref, data = null) => ({ id:ref.id, ref, exists:() => data != null, data:() => data, metadata:{ hasPendingWrites:false, fromCache:false } });
  const memberPath = ['households', 'home', 'members', uid].join('/');
  const api = {
    initializeApp:() => ({ name:'[test]' }),
    getFirestore:() => db,
    collection(parent, ...parts) {
      const [owner, path] = base(parent), full = [...path, ...segments(parts)];
      if (full.length % 2 !== 1) fail(`Invalid collection path (${full.length} segments).`);
      return new CollectionRef(owner, full);
    },
    doc(parent, ...parts) {
      const [owner, path] = base(parent), full = parts.length ? [...path, ...segments(parts)] : [...path, `auto${++autoId}`];
      if (full.length % 2 !== 0) fail(`Invalid document path (${full.length} segments).`);
      return new DocRef(owner, full);
    },
    query(ref, ...constraints) { if (!(ref instanceof CollectionRef || ref instanceof Query)) fail('query() needs a collection or query.'); return new Query(ref, constraints); },
    orderBy:(field, direction = 'asc') => (typeof field === 'string' ? { orderBy:field, direction } : fail('orderBy() needs a field name.')),
    limit:count => (Number.isInteger(count) && count > 0 ? { limit:count } : fail('limit() needs a positive whole number.')),
    where:(field, op, value) => ({ where:[field, op, value] }),
    serverTimestamp:() => ({ serverTimestamp:true }),
    onSnapshot(ref, ...rest) {
      if (!(ref instanceof Ref || ref instanceof Query)) fail('onSnapshot() needs a reference or query.');
      const next = rest.find(arg => typeof arg === 'function');
      listeners.push(ref);
      setTimeout(() => next?.(ref instanceof DocRef ? snapshot(ref) : { docs:[], empty:true, size:0, forEach() {}, metadata:{ hasPendingWrites:false, fromCache:false } }), 0);
      return () => {};
    },
    async getDoc(ref) {
      if (!(ref instanceof DocRef)) fail('getDoc() needs a document reference.');
      return snapshot(ref, ref.path.join('/') === memberPath ? { active, role:'member' } : null);
    },
    async getDocs(ref) { if (!(ref instanceof Ref || ref instanceof Query)) fail('getDocs() needs a reference or query.'); return { docs:[], empty:true, size:0, forEach() {} }; },
    async setDoc(ref, data) { if (!(ref instanceof DocRef)) fail('setDoc() needs a document reference.'); writes.push(['set', ref.path.join('/'), data]); },
    async updateDoc(ref, data) { if (!(ref instanceof DocRef)) fail('updateDoc() needs a document reference.'); writes.push(['update', ref.path.join('/'), data]); },
    async deleteDoc(ref) { if (!(ref instanceof DocRef)) fail('deleteDoc() needs a document reference.'); writes.push(['delete', ref.path.join('/')]); },
    async addDoc(ref, data) { if (!(ref instanceof CollectionRef)) fail('addDoc() needs a collection reference.'); const made = api.doc(ref); writes.push(['add', made.path.join('/'), data]); return made; },
    writeBatch(target) { if (!(target instanceof Db)) fail('writeBatch() needs the database.'); const ops = []; return { set:(ref, data) => ops.push(['set', ref.path.join('/'), data]), update:(ref, data) => ops.push(['update', ref.path.join('/'), data]), delete:ref => ops.push(['delete', ref.path.join('/')]), commit:async () => { writes.push(...ops); } }; },
    async runTransaction(target, run) { if (!(target instanceof Db)) fail('runTransaction() needs the database.'); return run({ get:api.getDoc, set:(ref, data) => writes.push(['set', ref.path.join('/'), data]), update:(ref, data) => writes.push(['update', ref.path.join('/'), data]), delete:ref => writes.push(['delete', ref.path.join('/')]) }); },
    getAuth:() => ({ currentUser:{ uid, email } }),
    onAuthStateChanged:(_auth, callback) => { setTimeout(() => callback({ uid, email }), 0); return () => {}; },
    setPersistence:async () => {}, signInWithEmailAndPassword:async () => {}, signOut:async () => {},
    browserLocalPersistence:{}, browserSessionPersistence:{},
    getFunctions:() => ({ region:'test' }),
    // Server functions answer "unavailable" (as if offline), which every caller must handle.
    httpsCallable:(_functions, name) => async () => { const error = new Error(`${name} is offline in tests`); error.code = 'functions/unavailable'; throw error; }
  };
  return { api, writes, listeners, db };
}
