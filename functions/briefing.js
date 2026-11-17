// "The world, briefly": top headlines plus a few big market and interest-rate
// numbers for the Today page and the morning newsletter. Free public sources with
// no API key: NPR News and BBC World RSS for headlines, and FRED (Federal Reserve
// Bank of St. Louis) CSV series for markets and rates. Cached server-side so the
// app and the newsletter share one fetch every half hour.
export const FEEDS = [
  { source:'NPR', url:'https://feeds.npr.org/1001/rss.xml' },
  { source:'BBC World', url:'https://feeds.bbci.co.uk/news/world/rss.xml' }
];
// One uplifting story a day. Its recurring "Good News in History" column is skipped.
export const GOOD_FEED = { source:'Good News Network', url:'https://www.goodnewsnetwork.org/feed/' };
export const pickGoodNews = items => items.find(item => !/^good news in history\b/i.test(item.title)) || null;
export const SERIES = [
  { id:'SP500', name:'S&P 500', kind:'index' },
  { id:'DJIA', name:'Dow', kind:'index' },
  { id:'NASDAQCOM', name:'Nasdaq', kind:'index' },
  { id:'DGS10', name:'10-yr Treasury', kind:'rate' },
  { id:'DFF', name:'Fed funds', kind:'rate' },
  { id:'MORTGAGE30US', name:'30-yr mortgage', kind:'rate' }
];
export const HEADLINES = 6;
const MAX_AGE = 30 * 60000, TIMEOUT = 8000, USER_AGENT = 'Mozilla/5.0 (compatible; household-dashboard/1.0)';

const ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
export function decode(text = '') {
  return String(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
      ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
      : ENTITIES[code.toLowerCase()] ?? match)
    .replace(/<[^>]+>/g, '').replace(/(^|[\s(\[“"])'/g, '$1‘').replace(/'/g, '’').replace(/\s+/g, ' ').trim();
}
// A deliberately small RSS reader: title, link and date of each <item>, in the
// feed's own (editorial) order.
export function parseRSS(xml, source, limit = 10) {
  const items = [];
  for (const [, body] of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const field = name => decode(body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1] || '');
    const title = field('title'), link = field('link').replace(/[?&]at_medium=RSS.*$/, ''), published = Date.parse(field('pubDate'));
    if (!title || !/^https:\/\/[^\s"'<>]+$/.test(link)) continue;
    items.push({ title:title.slice(0, 200), link, source, published:Number.isFinite(published) ? new Date(published).toISOString() : null });
    if (items.length >= limit) break;
  }
  return items;
}
// FRED's CSV: "observation_date,SERIES" then "YYYY-MM-DD,value" (blank or "." on holidays).
export function parseFredCSV(csv) {
  return String(csv).trim().split(/\r?\n/).slice(1).map(line => line.split(','))
    .filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && value?.trim() && value.trim() !== '.')
    .map(([date, value]) => ({ date, value:Number(value) })).filter(row => Number.isFinite(row.value));
}
export function marketPoint(series, rows) {
  const [previous, latest] = rows.slice(-2);
  if (!latest) return null;
  const change = previous ? latest.value - previous.value : null;
  return { id:series.id, name:series.name, kind:series.kind, value:latest.value, date:latest.date,
    change:change == null ? null : Math.round(change * 100) / 100,
    changePct:change == null || series.kind !== 'index' ? null : Math.round(change / previous.value * 10000) / 100 };
}
async function fetchText(fetch, url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { signal:controller.signal, headers:{ 'user-agent':USER_AGENT, accept:'*/*' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.text()).slice(0, 2000000);
  } finally { clearTimeout(timer); }
}
// Alternate between feeds so both US and world stories make the top list.
export function topHeadlines(lists, count = HEADLINES) {
  const seen = new Set(), picked = [];
  for (let i = 0; picked.length < count && lists.some(list => i < list.length); i++) {
    for (const list of lists) {
      const item = list[i], key = item?.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!item || seen.has(key)) continue;
      seen.add(key); picked.push(item);
      if (picked.length >= count) break;
    }
  }
  return picked;
}
export async function buildBriefing({ fetch = globalThis.fetch, now = new Date() } = {}) {
  const since = new Date(+now - 45 * 86400000).toISOString().slice(0, 10);
  const [feeds, series, good] = await Promise.all([
    Promise.allSettled(FEEDS.map(async feed => parseRSS(await fetchText(fetch, feed.url), feed.source))),
    Promise.allSettled(SERIES.map(async item => marketPoint(item, parseFredCSV(await fetchText(fetch, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${item.id}&cosd=${since}`))))),
    fetchText(fetch, GOOD_FEED.url).then(xml => pickGoodNews(parseRSS(xml, GOOD_FEED.source, 5)), () => null)
  ]);
  const headlines = topHeadlines(feeds.filter(result => result.status === 'fulfilled').map(result => result.value));
  const markets = series.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
  if (!headlines.length && !markets.length) throw new Error('No briefing sources answered.');
  return { fetchedAt:new Date(+now).toISOString(), headlines, goodNews:good, markets, sources:[...FEEDS.map(feed => feed.source), GOOD_FEED.source, 'FRED'] };
}
// ---------- History for the market charts ----------
// Thinned so a series fits one small document: every close for the last 400 days
// (1W, 1M, 1Y), the last close of each week for six years (5Y), and the last close of
// each month for all of FRED's history (All). FRED shares only the last year of the
// S&P 500 and ten years of the Dow (licensing); the Nasdaq and rates go back decades.
export function thinHistory(rows, now = new Date()) {
  const lastOf = (list, key) => { const out = new Map(); for (const row of list) out.set(key(row.date), row); return [...out.values()]; };
  const ago = days => new Date(+now - days * 86400000).toISOString().slice(0, 10);
  const week = date => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const point = row => ({ d:row.date, v:row.value });
  return { daily:rows.filter(row => row.date >= ago(400)).map(point), weekly:lastOf(rows.filter(row => row.date >= ago(6 * 366)), week).map(point),
    monthly:lastOf(rows, date => date.slice(0, 7)).map(point), first:rows[0]?.date || null };
}
export async function buildHistory(id, { fetch = globalThis.fetch, now = new Date() } = {}) {
  const series = SERIES.find(item => item.id === id);
  if (!series) throw Object.assign(new Error('Choose a market series.'), { code:'invalid-argument' });
  const rows = parseFredCSV(await fetchText(fetch, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=1900-01-01`));
  if (rows.length < 2) throw new Error('No history returned.');
  return { id, name:series.name, kind:series.kind, fetchedAt:new Date(+now).toISOString(), ...thinHistory(rows, now) };
}

// Cached in a server-only document. A failed refresh falls back to the last good one.
export function createBriefingService({ db, fetch = globalThis.fetch, now = () => new Date(), maxAge = MAX_AGE }) {
  const ref = () => db.doc('privateBriefing/latest');
  let pending = null;
  const histories = new Map();
  // History changes once a day; keep it six hours.
  async function history(id) {
    if (!SERIES.some(item => item.id === id)) throw Object.assign(new Error('Choose a market series.'), { code:'invalid-argument' });
    const doc = db.doc(`privateBriefing/history-${id}`), cached = (await doc.get()).data() || null;
    if (cached && +now() - Date.parse(cached.fetchedAt) < 6 * 3600000) return cached;
    if (!histories.has(id)) histories.set(id, buildHistory(id, { fetch, now:now() }).then(async fresh => { await doc.set(fresh); return fresh; }).finally(() => histories.delete(id)));
    try { return await histories.get(id); }
    catch (error) { if (cached) return { ...cached, stale:true }; throw error; }
  }
  return async function briefing({ force = false, history:id } = {}) {
    if (id !== undefined) return history(id);
    const cached = (await ref().get()).data() || null;
    if (!force && cached && +now() - Date.parse(cached.fetchedAt) < maxAge) return cached;
    pending ||= buildBriefing({ fetch, now:now() }).then(async fresh => { await ref().set(fresh); return fresh; }).finally(() => { pending = null; });
    try { return await pending; }
    catch (error) { if (cached) return { ...cached, stale:true }; throw error; }
  };
}
