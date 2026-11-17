import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRSS, parseFredCSV, marketPoint, topHeadlines, buildBriefing, createBriefingService, decode, SERIES, pickGoodNews, thinHistory, buildHistory } from '../functions/briefing.js';
import { rangePoints, rangeChange, chartSVG, chartPanelHTML, briefingHTML, sampleBriefing } from '../world-view.js';

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

test('one good-news story a day, skipping the recurring history column', async () => {
  const good = `<rss><channel><item><title>Good News in History, November 16</title><link>https://www.goodnewsnetwork.org/h</link></item>
    <item><title>Climbers rescue an orphaned seal pup</title><link>https://www.goodnewsnetwork.org/seal</link></item></channel></rss>`;
  assert.equal(pickGoodNews(parseRSS(good, 'Good News Network')).title, 'Climbers rescue an orphaned seal pup');
  assert.equal(pickGoodNews([]), null);
  const fetch = async url => url.includes('goodnews') ? {ok:true, text:async () => good} : url.includes('npr') ? {ok:true, text:async () => npr} : url.includes('bbc') ? {ok:true, text:async () => bbc} : {ok:true, text:async () => csv('X', [['2026-11-13', '1'], ['2026-11-16', '2']])};
  const briefing = await buildBriefing({fetch});
  assert.equal(briefing.goodNews.link, 'https://www.goodnewsnetwork.org/seal');
  // The good-news feed failing never breaks the rest.
  const without = await buildBriefing({fetch:async url => url.includes('goodnews') ? {ok:false, status:500, text:async () => ''} : fetch(url)});
  assert.equal(without.goodNews, null); assert.ok(without.headlines.length);
  assert.match(briefingHTML(briefing), /☀ Good news<\/span><strong>Climbers rescue an orphaned seal pup/);
});

test('market history is thinned to daily, weekly and monthly closes and cached for six hours', async () => {
  const rows = []; for (let t = Date.parse('2019-01-01T12:00:00Z'); t <= Date.parse('2026-11-16T12:00:00Z'); t += 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) rows.push({date:d.toISOString().slice(0, 10), value:t / 1e10}); }
  const now = new Date('2026-11-17T12:00:00Z'), thin = thinHistory(rows, now);
  assert.equal(thin.first, '2019-01-01'); assert.equal(thin.daily[0].d >= '2025-10-13', true); assert.equal(thin.daily.at(-1).d, '2026-11-16');
  assert.ok(thin.weekly.length > 300 && thin.weekly.length < 320); assert.equal(thin.weekly.at(-1).d, '2026-11-16');
  assert.equal(thin.monthly.length, 95); assert.equal(thin.monthly[0].d, '2019-01-31');
  let fetches = 0; const fetch = async url => { fetches++; assert.match(url, /id=DGS10&cosd=1900-01-01/); return {ok:true, text:async () => csv('DGS10', rows.map(row => [row.date, row.value.toFixed(2)]))}; };
  const history = await buildHistory('DGS10', {fetch, now});
  assert.equal(history.name, '10-yr Treasury'); assert.equal(history.kind, 'rate');
  await assert.rejects(buildHistory('NOPE', {fetch}), {code:'invalid-argument'});
  const docs = new Map(), db = {doc:path => ({get:async () => ({data:() => docs.get(path)}), set:async value => docs.set(path, value)})};
  let clock = +now; const service = createBriefingService({db, fetch, now:() => new Date(clock)});
  await service({history:'DGS10'}); await service({history:'DGS10'}); assert.equal(fetches, 2, 'second call served from cache');
  assert.ok(docs.has('privateBriefing/history-DGS10'));
  clock += 7 * 3600000; await service({history:'DGS10'}); assert.equal(fetches, 3);
  await assert.rejects(service({history:'../x'}), {code:'invalid-argument'});
});

test('chart ranges pick the right points and always end on the latest close', () => {
  const daily = [], weekly = [], monthly = [];
  for (let i = 0; i < 400; i++) daily.push({d:new Date(Date.parse('2025-10-13T12:00:00Z') + i * 86400000).toISOString().slice(0, 10), v:100 + i});
  for (let i = 0; i < 300; i++) weekly.push({d:new Date(Date.parse('2021-01-04T12:00:00Z') + i * 7 * 86400000).toISOString().slice(0, 10), v:50 + i});
  for (let i = 0; i < 120; i++) monthly.push({d:`${2016 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-28`, v:10 + i});
  const history = {name:'S&P 500', kind:'index', first:'2016-01-04', daily, weekly, monthly};
  assert.equal(rangePoints(history, '1W').length, 8); assert.equal(rangePoints(history, '1M').length, 32); assert.equal(rangePoints(history, '1Y').length, 367);
  const five = rangePoints(history, '5Y'), all = rangePoints(history, 'All');
  assert.equal(five.at(-1).d, daily.at(-1).d); assert.equal(all[0].d, '2016-01-28'); assert.equal(all.at(-1).d, daily.at(-1).d);
  // A weekly series still gets two points in 1W.
  assert.equal(rangePoints({kind:'rate', daily:[{d:'2026-11-05', v:7.18}, {d:'2026-11-12', v:7.11}], weekly:[], monthly:[]}, '1W').length, 2);
  assert.deepEqual(rangeChange([{v:100}, {v:110}], 'index'), {text:'▲ 10.00%', tone:'up'});
  assert.deepEqual(rangeChange([{v:7.18}, {v:7.11}], 'rate'), {text:'▼ 0.07 pt', tone:'flat'});
  const svg = chartSVG(rangePoints(history, '1M'), 'index', 600);
  assert.match(svg, /class="world-chart-line"/); assert.match(svg, /world-crosshair/); assert.match(svg, /role="img"/);
  const panel = chartPanelHTML(history, 'All', all, 600);
  assert.match(panel, /since Jan 2016/); assert.match(panel, /aria-pressed="true" title="All history">All/); assert.match(panel, /Show as a table/);
});
