import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRSS, parseFredCSV, marketPoint, topHeadlines, buildBriefing, createBriefingService, decode, SERIES } from '../functions/briefing.js';

const npr = `<?xml version="1.0"?><rss><channel><title>NPR</title>
  <item><title>Storm closes schools &amp; roads</title><link>https://www.npr.org/a</link><pubDate>Mon, 16 Nov 2026 17:06:22 -0500</pubDate></item>
  <item><title>U.N. talks on &apos;killer robots&apos;</title><link>https://www.npr.org/b</link></item>
  <item><title>No link here</title></item>
  <item><title>Unsafe link</title><link>javascript:alert(1)</link></item></channel></rss>`;
const bbc = `<rss><channel><item>
  <title><![CDATA[Five countries announce a new plan ]]></title>
  <link>https://www.bbc.co.uk/news/articles/x1?at_medium=RSS&amp;at_campaign=rss</link><pubDate>Mon, 16 Nov 2026 23:20:45 GMT</pubDate></item>
  <item><title>Storm closes schools &amp; roads</title><link>https://www.bbc.co.uk/news/x2</link></item>
  <item><title>Markets slide</title><link>https://www.bbc.co.uk/news/x3</link></item></channel></rss>`;
const csv = (id, rows) => `observation_date,${id}\n${rows.map(([d, v]) => `${d},${v}`).join('\n')}\n`;

test('RSS items are read in order with entities, CDATA and quotes cleaned, and unsafe links dropped', () => {
  const items = parseRSS(npr, 'NPR');
  assert.deepEqual(items.map(item => item.title), ['Storm closes schools & roads', 'U.N. talks on ‘killer robots’']);
  assert.equal(items[0].published, '2026-11-16T22:06:22.000Z'); assert.equal(items[1].published, null);
  assert.equal(parseRSS(bbc, 'BBC World')[0].link, 'https://www.bbc.co.uk/news/articles/x1');
  assert.equal(decode('A <b>bold</b> &#8220;quote&#8221; &#x2014; it&#39;s'), 'A bold “quote” — it’s');
});

test('top headlines alternate between feeds and skip the same story twice', () => {
  const picked = topHeadlines([parseRSS(npr, 'NPR'), parseRSS(bbc, 'BBC World')], 4);
  assert.deepEqual(picked.map(item => `${item.source}: ${item.title}`), ['NPR: Storm closes schools & roads', 'BBC World: Five countries announce a new plan', 'NPR: U.N. talks on ‘killer robots’', 'BBC World: Markets slide']);
});

test('FRED series skip holidays and give the latest value with its change', () => {
  const rows = parseFredCSV(csv('DGS10', [['2026-11-11', ''], ['2026-11-12', '5.10'], ['2026-11-13', '.'], ['2026-11-14', '5.15']]));
  assert.deepEqual(rows, [{date:'2026-11-12', value:5.1}, {date:'2026-11-14', value:5.15}]);
  assert.deepEqual(marketPoint(SERIES[3], rows), {id:'DGS10', name:'10-yr Treasury', kind:'rate', value:5.15, date:'2026-11-14', change:0.05, changePct:null});
  const index = marketPoint(SERIES[0], parseFredCSV(csv('SP500', [['2026-11-13', '7561.67'], ['2026-11-16', '7416.59']])));
  assert.equal(index.change, -145.08); assert.equal(index.changePct, -1.92);
  assert.equal(marketPoint(SERIES[4], []), null);
  // A zero rate is a real value, not a blank.
  assert.deepEqual(parseFredCSV(csv('DFF', [['2021-01-04', '0.00']])), [{date:'2021-01-04', value:0}]);
});

test('the briefing uses whatever sources answer and fails only when none do', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(url);
    if (url.includes('npr')) return {ok:true, text:async () => npr};
    if (url.includes('bbc')) return {ok:false, status:503, text:async () => ''};
    const id = new URL(url).searchParams.get('id');
    return {ok:true, text:async () => csv(id, [['2026-11-13', '100'], ['2026-11-16', '101']])};
  };
  const briefing = await buildBriefing({fetch, now:new Date('2026-11-17T11:00:00Z')});
  assert.deepEqual(briefing.headlines.map(item => item.source), ['NPR', 'NPR']);
  assert.equal(briefing.markets.length, 6); assert.equal(briefing.markets[0].changePct, 1);
  assert.ok(urls.some(url => url.includes('id=MORTGAGE30US&cosd=2026-10-03')));
  await assert.rejects(buildBriefing({fetch:async () => ({ok:false, status:500, text:async () => ''})}));
});

test('the briefing is cached for half an hour and a failed refresh serves the last good one', async () => {
  const docs = new Map(), db = {doc:path => ({get:async () => ({data:() => docs.get(path)}), set:async value => docs.set(path, value)})};
  let clock = Date.parse('2026-11-17T11:00:00Z'), calls = 0, up = true;
  const fetch = async url => { calls++; if (!up) return {ok:false, status:500, text:async () => ''}; return {ok:true, text:async () => url.includes('fred') ? csv('X', [['2026-11-16', '1']]) : npr}; };
  const briefing = createBriefingService({db, fetch, now:() => new Date(clock)});
  const first = await briefing(); const used = calls;
  assert.equal(first.headlines.length, 2);
  clock += 10 * 60000; await briefing(); assert.equal(calls, used, 'served from cache');
  clock += 25 * 60000; up = false;
  const stale = await briefing(); assert.equal(stale.stale, true); assert.equal(stale.fetchedAt, first.fetchedAt);
});

test('market numbers read the same on the Today card and in the newsletter', async () => {
  const { marketValue, marketChange, marketLine } = await import('../briefing-format.js');
  const index = {name:'S&P 500', kind:'index', value:7416.59, change:-145.08, changePct:-1.92}, rate = {name:'30-yr mortgage', kind:'rate', value:7.11, change:-0.07, changePct:null};
  assert.equal(marketValue(index), '7,416.59'); assert.equal(marketValue(rate), '7.11%');
  assert.deepEqual(marketChange(index), {text:'▼ 1.92%', direction:'down', tone:'down'});
  assert.deepEqual(marketChange(rate), {text:'▼ 0.07 pt', direction:'down', tone:'flat'});
  assert.equal(marketChange({...rate, change:0}).text, 'unchanged');
  assert.equal(marketLine(rate), '30-yr mortgage 7.11% ▼ 0.07 pt');
});
