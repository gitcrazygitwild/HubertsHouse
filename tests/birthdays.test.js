import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'America/New_York';
const { parseBirthdays, readBirthday, CardDAV, contactsURL } = await import('../functions/carddav.js');
const model = await import('../birthdays-model.js');
const { buildDigest, composeEmail } = await import('../functions/newsletter.js');

const card = lines => `BEGIN:VCARD\r\nVERSION:3.0\r\n${lines.join('\r\n')}\r\nEND:VCARD\r\n`;
test('birthdays are read from vCards in every format Apple writes', () => {
  const cards = [
    card(['N:Rivera;Sam;;;', 'FN:Sam Rivera', 'BDAY;VALUE=date:1990-03-14']),
    card(['FN:Grandma June', 'BDAY:19540101']),
    card(['N:Lou;Aunt;;;', 'FN:Aunt Lou', 'BDAY;X-APPLE-OMIT-YEAR=1604:1604-07-04']), // no year
    card(['N:Nguyen;Theo;;;', 'BDAY:--1105']), // no FN, year left out
    card(['FN:No Birthday Person', 'TEL:555']),
    card(['FN:Bad Date', 'BDAY:2020-02-31']),
    card(['FN:Long\r\n  Name\\, Jr.', 'item1.BDAY:2001-12-25']), // folded line, escaped comma, grouped field
    card(['FN:Sam Rivera', 'BDAY:1990-03-14']) // duplicate from a second address book
  ].join('');
  assert.deepEqual(parseBirthdays(cards), [
    { name:'Grandma June', month:1, day:1, year:1954 },
    { name:'Sam Rivera', month:3, day:14, year:1990 },
    { name:'Aunt Lou', month:7, day:4, year:null },
    { name:'Theo Nguyen', month:11, day:5, year:null },
    { name:'Long Name, Jr.', month:12, day:25, year:2001 }
  ]);
  assert.equal(readBirthday('2024-02-29').day, 29);
  assert.equal(readBirthday('1900-13-01'), null);
  assert.equal(readBirthday(`${new Date().getFullYear() + 3}-01-01`).year, null, 'future years are dropped');
});

test('contacts addresses must be Apple iCloud', () => {
  assert.equal(contactsURL('/123/carddav/', 'https://p42-contacts.icloud.com:443/'), 'https://p42-contacts.icloud.com/123/carddav/');
  assert.throws(() => contactsURL('https://evil.example/'), /must belong to Apple/);
  assert.throws(() => contactsURL('https://contacts.icloud.com.evil.example/'), /must belong to Apple/);
});

const multistatus = rows => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">${rows.map(([href, props]) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
const reply = (status, text) => ({ ok:status < 400, status, url:'', headers:new Headers(), body:new Response(text).body });
const xmlText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r/g, '&#13;');
function icloud({ queryWorks }) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method:init.method, body:init.body, auth:init.headers.Authorization });
    if (init.method === 'PROPFIND' && url === 'https://contacts.icloud.com/') return reply(207, multistatus([['/', '<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>']]));
    if (init.method === 'PROPFIND' && url.endsWith('/123/principal/')) return reply(207, multistatus([['/123/principal/', '<card:addressbook-home-set><d:href>https://p42-contacts.icloud.com:443/123/carddav/</d:href></card:addressbook-home-set>']]));
    if (init.method === 'PROPFIND' && url === 'https://p42-contacts.icloud.com/123/carddav/') return reply(207, multistatus([['/123/carddav/', '<d:resourcetype><d:collection/></d:resourcetype>'], ['/123/carddav/card/', '<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>']]));
    if (init.method === 'REPORT' && /addressbook-query/.test(init.body)) return queryWorks ? reply(207, multistatus([['/123/carddav/card/a.vcf', `<card:address-data>${xmlText(card(['FN:Sam Rivera', 'BDAY:1990-03-14']))}</card:address-data>`]])) : reply(403, 'nope');
    if (init.method === 'PROPFIND' && url.endsWith('/card/')) return reply(207, multistatus([['/123/carddav/card/', '<d:getetag/>'], ['/123/carddav/card/a.vcf', '<d:getetag>"1"</d:getetag>'], ['/123/carddav/card/b.vcf', '<d:getetag>"2"</d:getetag>']]));
    if (init.method === 'REPORT' && /addressbook-multiget/.test(init.body)) return reply(207, multistatus([['/123/carddav/card/a.vcf', `<card:address-data>${xmlText(card(['FN:Sam Rivera', 'BDAY:1990-03-14']))}</card:address-data>`], ['/123/carddav/card/b.vcf', `<card:address-data>${xmlText(card(['FN:Nobody']))}</card:address-data>`]]));
    return reply(404, '');
  };
  return { fetch, calls };
}
test('CardDAV finds the address book and asks only for contacts with birthdays', async () => {
  const { fetch, calls } = icloud({ queryWorks:true });
  assert.deepEqual(await new CardDAV({ username:'a@b.c', password:'abcd-efgh-ijkl-mnop' }, fetch).birthdays(), [{ name:'Sam Rivera', month:3, day:14, year:1990 }]);
  const query = calls.find(call => /addressbook-query/.test(call.body || ''));
  assert.match(query.body, /prop-filter name="BDAY"/); assert.match(query.body, /prop name="FN"/);
  assert.ok(!calls.some(call => /multiget/.test(call.body || '')));
  assert.ok(calls.every(call => call.auth.startsWith('Basic ')));
});
test('if iCloud refuses the filtered query, cards are fetched in batches instead', async () => {
  const { fetch, calls } = icloud({ queryWorks:false });
  assert.deepEqual(await new CardDAV({ username:'a@b.c', password:'abcd-efgh-ijkl-mnop' }, fetch).birthdays(), [{ name:'Sam Rivera', month:3, day:14, year:1990 }]);
  const multiget = calls.find(call => /multiget/.test(call.body || ''));
  assert.match(multiget.body, /a\.vcf<\/d:href><d:href>\/123\/carddav\/card\/b\.vcf/);
});

test('birthdays land on the right days, with ages, Feb 29 and the new year', () => {
  const list = [{ name:'Sam', month:3, day:14, year:1990 }, { name:'Leap', month:2, day:29, year:2000 }, { name:'Lou', month:1, day:2, year:null }];
  const range = model.birthdaysInRange(new Date(2026, 11, 20), new Date(2027, 2, 20), list);
  assert.deepEqual(range.map(b => [b.date, b.title]), [['2027-01-02', '🎂 Lou’s birthday'], ['2027-02-28', '🎂 Leap turns 27'], ['2027-03-14', '🎂 Sam turns 37']]);
  model.setBirthdayList(list);
  const events = model.birthdayEvents(new Date(2026, 2, 1), new Date(2026, 3, 1));
  assert.equal(events.length, 1); assert.equal(events[0].start, '2026-03-14'); assert.equal(events[0].end, '2026-03-15');
  assert.equal(events[0].editable, false); assert.equal(events[0].extendedProps.birthday, true);
  const soon = model.upcomingBirthdays(new Date(2026, 2, 14, 6, 30), 7);
  assert.deepEqual([soon.today.map(b => b.name), soon.soon.length], [['Sam'], 0]);
  assert.equal(model.setBirthdayList([{ name:'', month:1, day:1 }, null, { name:'Ok', month:13, day:1 }]).length, 0);
  model.setBirthdayList([]);
});

test('the morning email leads with today’s birthdays and lists the week’s', () => {
  const now = new Date(2026, 2, 14, 6, 30);
  const digest = buildDigest({ now, birthdays:[{ name:'Sam Rivera', month:3, day:14, year:1990 }, { name:'Aunt Lou', month:3, day:17, year:null }, { name:'Later', month:4, day:30, year:null }] });
  assert.deepEqual(digest.birthdays.today.map(b => b.name), ['Sam Rivera']);
  assert.deepEqual(digest.birthdays.soon.map(b => b.name), ['Aunt Lou']);
  const email = composeEmail(digest);
  assert.match(email.subject, /🎂 Sam Rivera/);
  assert.match(email.html, /Sam Rivera turns 36<\/strong> today!/);
  assert.match(email.html, /Birthdays this week:<\/strong> Aunt Lou/);
  assert.match(email.text, /Birthdays this week: Aunt Lou Tue, Mar 17/);
  assert.ok(!/Later/.test(email.html));
  assert.ok(!/Birthdays this week/.test(composeEmail(buildDigest({ now })).html), 'nothing when there are none');
});
