// Publix weekly BOGOs. Publix has no public API; this reads the same JSON its own
// website loads for the weekly ad (services.publix.com), for one store. Unofficial:
// it can change without notice, so parsing is defensive and the last good copy is
// kept. No account or credentials are involved; the ad is public.

export const DEFAULT_STORE = { number:'1588', name:'Carytown Exchange', address:'3535 Ellwood Ave, Richmond', zip:'23221' };
const BASE = 'https://services.publix.com/api';
const MAX_AGE = 6 * 3600000, TIMEOUT = 15000, USER_AGENT = 'Mozilla/5.0 (compatible; household-dashboard/1.0)';
export class PublixError extends Error { constructor(code, message) { super(message); this.code = code; } }

// Category slugs → short labels. The most specific one is listed last
// (["grocery","beverages","bogo"]), so the last known slug wins.
const LABELS = { dairy:'Dairy', deli:'Deli', 'frozen-food':'Frozen', grocery:'Pantry', meat:'Meat', protein:'Meat', seafood:'Seafood', produce:'Produce',
  beverages:'Drinks', snacks:'Snacks', bakery:'Bakery', 'non-foods':'Household', housewares:'Household', 'beauty-and-personal-care':'Personal care',
  pet:'Pet', baby:'Baby', 'health-and-nutrition':'Health' };
export const FOOD = new Set(['Dairy', 'Deli', 'Frozen', 'Pantry', 'Meat', 'Seafood', 'Produce', 'Drinks', 'Snacks', 'Bakery']);
const label = categories => [...(Array.isArray(categories) ? categories : [])].reverse().map(slug => LABELS[slug]).find(Boolean) || 'Other';
// The feed's text is HTML-escaped ("Pr&eacute;sident", "Stacy&#39;s").
const ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', rsquo:'’', lsquo:'‘', ldquo:'“', rdquo:'”', ndash:'–', mdash:'—', hellip:'…', reg:'®', trade:'™', copy:'©', deg:'°',
  eacute:'é', egrave:'è', ecirc:'ê', euml:'ë', aacute:'á', agrave:'à', acirc:'â', auml:'ä', iacute:'í', icirc:'î', oacute:'ó', ocirc:'ô', ouml:'ö', uacute:'ú', uuml:'ü', ntilde:'ñ', ccedil:'ç' };
export const plain = text => String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => code[0] === '#'
    ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
    : ENTITIES[code.toLowerCase()] ?? match)
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const storeNumber = value => { const n = String(value ?? DEFAULT_STORE.number).replace(/^0+/, ''); if (!/^\d{1,5}$/.test(n)) throw new PublixError('invalid-argument', 'Choose a Publix store.'); return n; };

// Only "Buy 1 Get 1" deals that are still running, one per product name.
export function parseBogos(json, now = new Date()) {
  const savings = Array.isArray(json?.Savings) ? json.Savings : [];
  const seen = new Set(), items = [];
  for (const deal of savings) {
    if (!/buy\s*1\s*get\s*1/i.test(String(deal?.savings || ''))) continue;
    const title = plain(deal.title).slice(0, 120), key = title.toLowerCase();
    const ends = Date.parse(deal.wa_endDate || deal.dc_endDate || '');
    if (!title || seen.has(key) || (Number.isFinite(ends) && ends < +now)) continue;
    seen.add(key);
    const save = plain(deal.additionalDealInfo).match(/\$\d+(?:\.\d{2})?/)?.[0] || null;
    const image = /^https:\/\/[a-z0-9.-]+\/[^\s"'<>]+$/i.test(deal.imageUrl || '') ? deal.imageUrl : null;
    items.push({ title, detail:plain(deal.description).replace(/^free item of equal or lesser price\.?\s*/i, '').slice(0, 160),
      save, category:label(deal.categories), ends:Number.isFinite(ends) ? new Date(ends).toISOString() : null, image });
  }
  return items;
}
async function getJSON(fetch, url, headers = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { signal:controller.signal, headers:{ 'user-agent':USER_AGENT, accept:'application/json', ...headers } });
    if (!response.ok) throw new PublixError('unavailable', 'Publix’s weekly ad didn’t answer. Try again later.');
    return await response.json();
  } finally { clearTimeout(timer); }
}
export async function fetchWeeklyBogos(store, { fetch = globalThis.fetch, now = new Date() } = {}) {
  const number = storeNumber(store);
  // The PublixStore header matters: without it the weekly ad comes back empty.
  const json = await getJSON(fetch, `${BASE}/v4/savings?page=1&pageSize=0&includePersonalizedDeals=false&languageID=1&isWeb=true&getSavingType=WeeklyAd&storeNumber=${number}`, { PublixStore:number });
  const items = parseBogos(json, now);
  if (!items.length) throw new PublixError('unavailable', 'Publix’s weekly ad came back without any BOGOs. Try again later.');
  return { store:number, fetchedAt:new Date(+now).toISOString(), adUpdated:typeof json.WeeklyAdLatestUpdatedDateTime === 'string' ? json.WeeklyAdLatestUpdatedDateTime : null, items };
}
export async function findStores(zip, { fetch = globalThis.fetch } = {}) {
  if (!/^\d{5}$/.test(String(zip || ''))) throw new PublixError('invalid-argument', 'Enter a 5-digit ZIP code.');
  const json = await getJSON(fetch, `${BASE}/v1/storelocation?types=R,G,H,N,S&option=&count=5&includeOpenAndCloseDates=true&isWebsite=true&zipCode=${zip}`);
  return (Array.isArray(json?.Stores) ? json.Stores : []).filter(s => /^\d{1,5}$/.test(String(s.KEY || ''))).slice(0, 5)
    .map(s => ({ number:String(s.KEY).replace(/^0+/, ''), name:plain(s.NAME).slice(0, 80), address:`${plain(s.ADDR)}, ${plain(s.CITY)}`.slice(0, 120), distance:Number(s.DISTANCE) || 0 }));
}

// Cached per store in a server-only document; a failed refresh falls back to the last good copy.
export function createPublix({ db, fetch = globalThis.fetch, now = () => new Date(), maxAge = MAX_AGE }) {
  const pending = new Map();
  async function deals({ store, force = false } = {}) {
    const number = storeNumber(store), ref = db.doc(`privatePublixDeals/store-${number}`);
    const cached = (await ref.get()).data() || null;
    if (!force && cached && +now() - Date.parse(cached.fetchedAt) < maxAge) return cached;
    if (!pending.has(number)) pending.set(number, fetchWeeklyBogos(number, { fetch, now:now() }).then(async fresh => { await ref.set(fresh); return fresh; }).finally(() => pending.delete(number)));
    try { return await pending.get(number); }
    catch (error) { if (cached) return { ...cached, stale:true }; throw error instanceof PublixError ? error : new PublixError('unavailable', 'Publix’s weekly ad didn’t answer. Try again later.'); }
  }
  return { deals, stores:zip => findStores(zip, { fetch }) };
}
