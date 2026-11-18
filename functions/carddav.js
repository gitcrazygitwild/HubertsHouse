// Birthdays from iCloud Contacts (CardDAV). Apple's "Birthdays" calendar is made on
// each device from Contacts and isn't served over CalDAV, so we read the BDAY field
// from the contacts themselves, with the same app-specific password as the calendar.
// Only names and birthdays are kept; everything else in a contact card is dropped.
import { CalendarError, parseResponses } from './caldav.js';

const MAX_BYTES = 8_000_000, BATCH = 40, MAX_CONTACTS = 4000;
// address-data arrives as text (or {#text} when the element has attributes); carriage
// returns may come through as character references.
const cardText = rows => rows.map(r => { const v = r.props['address-data']; return String(typeof v === 'string' ? v : v?.['#text'] || '').replace(/&#(?:13|x[dD]);/g, ''); }).join('\n');
const xmlEscape = value => String(value).replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[c]);
export function contactsURL(value, base = 'https://contacts.icloud.com/') {
  let url; try { url = new URL(value, base); } catch { throw new CalendarError('invalid-argument', 'Invalid contacts address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !/^(?:contacts|p\d+-contacts)\.icloud\.com$/i.test(url.hostname)) throw new CalendarError('permission-denied', 'The contacts address must belong to Apple iCloud.');
  return url.href;
}

// ---------- vCard → { name, month, day, year } ----------
const unescapeText = value => value.replace(/\\([nN])/g, ' ').replace(/\\([,;\\])/g, '$1').trim();
// Apple writes a birthday without a year as 1604-MM-DD with X-APPLE-OMIT-YEAR=1604.
export function readBirthday(value, params = '') {
  const match = String(value || '').trim().match(/^(?:(\d{4})|--)-?(\d{2})-?(\d{2})/);
  if (!match) return null;
  const month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || day > new Date(2024, month, 0).getDate()) return null;
  let year = match[1] ? Number(match[1]) : null;
  const omit = /X-APPLE-OMIT-YEAR=(\d{4})/i.exec(params)?.[1];
  if (year && (String(year) === omit || year < 1900 || year > new Date().getFullYear())) year = null;
  return { month, day, year };
}
export function parseBirthdays(cards) {
  const out = [], seen = new Set();
  for (const card of String(cards || '').split(/BEGIN:VCARD/i).slice(1)) {
    const lines = card.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const field = name => { for (const line of lines) { const m = line.match(new RegExp(`^(?:[\\w-]+\\.)?${name}((?:;[^:]*)?):(.*)$`, 'i')); if (m) return { params:m[1], value:m[2] }; } return null; };
    const bday = field('BDAY'); if (!bday) continue;
    const date = readBirthday(bday.value, bday.params); if (!date) continue;
    const n = field('N')?.value.split(';').map(unescapeText) || [];
    const name = (unescapeText(field('FN')?.value || '') || [n[1], n[0]].filter(Boolean).join(' ') || unescapeText(field('ORG')?.value || '')).replace(/\s+/g, ' ').slice(0, 60);
    if (!name) continue;
    const key = `${name.toLowerCase()}|${date.month}|${date.day}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ name, ...date });
  }
  return out.sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name));
}

// ---------- CardDAV client ----------
export class CardDAV {
  constructor(credentials, fetcher = fetch) {
    this.fetcher = fetcher;
    this.authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
  }
  async request(url, options = {}, redirects = 0) {
    url = contactsURL(url);
    const response = await this.fetcher(url, { ...options, headers:{ Authorization:this.authorization, ...options.headers }, redirect:'manual', signal:AbortSignal.timeout(25000) });
    if ([301, 302, 307, 308].includes(response.status)) {
      if (redirects >= 4 || !response.headers.get('location')) throw new CalendarError('unavailable', 'iCloud redirected too many times.');
      return this.request(contactsURL(response.headers.get('location'), url), options, redirects + 1);
    }
    if (response.status === 401) throw new CalendarError('unauthenticated', 'iCloud rejected the connection. Reconnect Apple Calendar with a new app-specific password.');
    if (!response.ok) throw new CalendarError('unavailable', `iCloud Contacts could not complete this request (${response.status}). Try again shortly.`);
    return response;
  }
  async text(response) {
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new CalendarError('resource-exhausted', 'Too many contacts to read at once.');
    const reader = response.body.getReader(), parts = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new CalendarError('resource-exhausted', 'Too many contacts to read at once.'); } parts.push(value); }
    return Buffer.concat(parts).toString('utf8');
  }
  async dav(url, method, body, depth) {
    const response = await this.request(url, { method, headers:{ Depth:depth, 'Content-Type':'application/xml; charset=utf-8' }, body:`<?xml version="1.0"?>${body}` });
    return { url:response.url || url, rows:parseResponses(await this.text(response)) };
  }
  propfind(url, props, depth = '0') { return this.dav(url, 'PROPFIND', `<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop>${props}</d:prop></d:propfind>`, depth); }
  async addressBooks() {
    const principal = await this.propfind('https://contacts.icloud.com/', '<d:current-user-principal/>');
    const principalHref = principal.rows.find(r => r.props['current-user-principal']?.href)?.props['current-user-principal'].href;
    if (!principalHref) throw new CalendarError('failed-precondition', 'iCloud did not return a contacts account. Make sure Contacts is turned on in iCloud.');
    const home = await this.propfind(contactsURL(principalHref, principal.url), '<card:addressbook-home-set/>');
    const homeHref = home.rows.find(r => r.props['addressbook-home-set']?.href)?.props['addressbook-home-set'].href;
    if (!homeHref) throw new CalendarError('failed-precondition', 'No iCloud address book was found.');
    const homeURL = contactsURL(homeHref, home.url), books = await this.propfind(homeURL, '<d:resourcetype/>', '1');
    return books.rows.filter(r => Object.hasOwn(r.props.resourcetype || {}, 'addressbook')).map(r => contactsURL(r.href, books.url));
  }
  // Ask for only contacts with a birthday, and only the fields we use. If iCloud won't
  // filter (or sends whole cards with photos), list the cards and fetch them in batches.
  async birthdays() {
    const out = [];
    for (const book of await this.addressBooks()) {
      const fields = '<card:address-data><card:prop name="FN"/><card:prop name="N"/><card:prop name="ORG"/><card:prop name="BDAY"/></card:address-data>';
      try {
        const query = await this.dav(book, 'REPORT', `<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop>${fields}</d:prop><card:filter><card:prop-filter name="BDAY"/></card:filter></card:addressbook-query>`, '1');
        out.push(cardText(query.rows));
        continue;
      } catch (error) { if (error.code === 'unauthenticated') throw error; }
      const listing = await this.propfind(book, '<d:getetag/>', '1');
      const cards = listing.rows.map(r => r.href).filter(href => /\.vcf$/i.test(href || '')).slice(0, MAX_CONTACTS);
      for (let i = 0; i < cards.length; i += BATCH) {
        const hrefs = cards.slice(i, i + BATCH).map(href => `<d:href>${xmlEscape(href)}</d:href>`).join('');
        const batch = await this.dav(book, 'REPORT', `<card:addressbook-multiget xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop>${fields}</d:prop>${hrefs}</card:addressbook-multiget>`, '1');
        out.push(cardText(batch.rows));
      }
    }
    return parseBirthdays(out.join('\n')).slice(0, 1500);
  }
}
