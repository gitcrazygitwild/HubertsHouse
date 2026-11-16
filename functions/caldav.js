import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
export class CalendarError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false });
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[c]);
export function appleURL(value, base = 'https://caldav.icloud.com/') {
  let url; try { url = new URL(value, base); } catch { throw new CalendarError('invalid-argument', 'Invalid calendar address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !/^(?:caldav|p\d+-caldav)\.icloud\.com$/i.test(url.hostname)) {
    throw new CalendarError('permission-denied', 'The calendar address must belong to Apple iCloud.');
  }
  return url.href;
}
export function resourceURL(calendar, token) {
  if (typeof token !== 'string' || token.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new CalendarError('invalid-argument', 'Invalid event reference.');
  const url = appleURL(Buffer.from(token, 'base64url').toString('utf8'));
  const base = appleURL(calendar.url).replace(/\/?$/, '/');
  if (!url.startsWith(base) || url.slice(base.length).includes('/') || !url.endsWith('.ics')) throw new CalendarError('permission-denied', 'This event belongs to a different calendar.');
  let filename;
  try { filename = decodeURIComponent(url.slice(base.length)); } catch { throw new CalendarError('invalid-argument', 'Invalid event reference.'); }
  if (/[\\/]/.test(filename) || filename.includes('..') || filename.includes('%')) throw new CalendarError('permission-denied', 'Invalid event path.');
  return url;
}
export const resourceToken = url => Buffer.from(url).toString('base64url');
export function parseResponses(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new CalendarError('data-loss', 'Unexpected response from iCloud.');
  let parsed; try { parsed = parser.parse(text); } catch { throw new CalendarError('data-loss', 'Could not read the iCloud response.'); }
  if (!parsed.multistatus) throw new CalendarError('data-loss', 'iCloud returned an incomplete calendar response.');
  return list(parsed.multistatus.response).map(response => ({ href: response.href, status: response.status, props: Object.assign({}, ...list(response.propstat).filter(s => /\s200\b/.test(s.status)).map(s => s.prop)) }));
}
export class CalDAV {
  constructor(credentials, fetcher = fetch) {
    this.fetcher = fetcher;
    this.authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
  }
  async request(url, options = {}, redirects = 0) {
    url = appleURL(url);
    const response = await this.fetcher(url, { ...options, headers: { Authorization: this.authorization, ...options.headers }, redirect: 'manual', signal: AbortSignal.timeout(25000) });
    if ([301,302,307,308].includes(response.status)) {
      if (redirects >= 4 || !response.headers.get('location')) throw new CalendarError('unavailable', 'iCloud redirected too many times.');
      return this.request(appleURL(response.headers.get('location'), url), options, redirects + 1);
    }
    if (response.status === 401) throw new CalendarError('unauthenticated', 'iCloud rejected the connection. Check your Apple Account email and app-specific password.');
    if (response.status === 403) throw new CalendarError('permission-denied', 'iCloud did not allow this action. The calendar may be read-only.');
    if (response.status === 412) throw new CalendarError('aborted', 'This event changed in Apple Calendar. Refresh your calendars, reopen the event, and try again.');
    if (response.status === 404) throw new CalendarError('not-found', 'This event or calendar is no longer available. Refresh your calendars.');
    if (!response.ok) throw new CalendarError('unavailable', `iCloud could not complete this request (${response.status}). Try again shortly.`);
    return response;
  }
  async body(response) {
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 8_000_000) throw new CalendarError('resource-exhausted', 'This calendar is too large to load at once. Choose a shorter date range.');
    const reader = response.body.getReader(); const parts = []; let size = 0;
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 8_000_000) { await reader.cancel(); throw new CalendarError('resource-exhausted','This calendar is too large to load at once.'); } parts.push(value); }
    return Buffer.concat(parts).toString('utf8');
  }
  async propfind(url, properties, depth = '0') {
    const response = await this.request(url, { method: 'PROPFIND', headers: { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' }, body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>${properties}</d:prop></d:propfind>` });
    return { url: response.url || url, rows: parseResponses(await this.body(response)) };
  }
  async discover() {
    const principalResponse = await this.propfind('https://caldav.icloud.com/', '<d:current-user-principal/>');
    const principal = principalResponse.rows.find(r => r.props['current-user-principal']?.href)?.props['current-user-principal'].href;
    if (!principal) throw new CalendarError('failed-precondition', 'iCloud did not return a calendar account. Make sure iCloud Calendar is enabled.');
    const principalURL = appleURL(principal, principalResponse.url);
    const homeResponse = await this.propfind(principalURL, '<c:calendar-home-set/>');
    const home = homeResponse.rows.find(r => r.props['calendar-home-set']?.href)?.props['calendar-home-set'].href;
    if (!home) throw new CalendarError('failed-precondition', 'No iCloud calendar home was found.');
    const homeURL = appleURL(home, homeResponse.url);
    const result = await this.propfind(homeURL, '<d:resourcetype/><d:displayname/><a:calendar-color/><d:current-user-privilege-set/><c:supported-calendar-component-set/>', '1');
    const calendars = result.rows.filter(r => Object.hasOwn(r.props.resourcetype || {}, 'calendar')).filter(r => !r.props['supported-calendar-component-set'] || list(r.props['supported-calendar-component-set'].comp).some(c => c['@_name'] === 'VEVENT')).map(r => {
      const url = appleURL(r.href, result.url);
      const privileges = JSON.stringify(r.props['current-user-privilege-set'] || {});
      return { id: createHash('sha256').update(url).digest('hex').slice(0,24), url, name: String(r.props.displayname || 'iCloud calendar'), color: String(r.props['calendar-color'] || '#8ba475'), writable: /"(?:write|all)":/.test(privileges) || ['write-content','bind','unbind'].every(p => privileges.includes(`"${p}":`)) };
    });
    if (!calendars.length) throw new CalendarError('failed-precondition', 'No event calendars were found in this iCloud account.');
    return calendars;
  }
  async events(calendar, start, end) {
    const stamp = value => new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const response = await this.request(calendar.url, { method:'REPORT', headers:{ Depth:'1', 'Content-Type':'application/xml; charset=utf-8' }, body:`<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${xml(stamp(start))}" end="${xml(stamp(end))}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>` });
    return parseResponses(await this.body(response)).filter(r => r.props['calendar-data']).map(r => {
      const url = appleURL(r.href, calendar.url); resourceURL(calendar, resourceToken(url));
      return { token:resourceToken(url), etag:r.props.getetag, data:r.props['calendar-data'] };
    });
  }
  async read(calendar, token) {
    const response = await this.request(resourceURL(calendar, token));
    return { data:await this.body(response), etag:response.headers.get('etag') };
  }
  async put(calendar, token, data, etag, create = false) {
    if (!calendar.writable) throw new CalendarError('permission-denied','This iCloud calendar is read-only.');
    if (!create && (!etag || typeof etag !== 'string')) throw new CalendarError('failed-precondition','Refresh this event before saving it.');
    return this.request(resourceURL(calendar,token), { method:'PUT', headers:{ 'Content-Type':'text/calendar; charset=utf-8', ...(create ? {'If-None-Match':'*'} : {'If-Match':etag}) }, body:data });
  }
  async remove(calendar, token, etag) {
    if (!calendar.writable) throw new CalendarError('permission-denied','This iCloud calendar is read-only.');
    if (!etag || typeof etag !== 'string') throw new CalendarError('failed-precondition','Refresh this event before deleting it.');
    await this.request(resourceURL(calendar,token), { method:'DELETE', headers:{'If-Match':etag} });
  }
}
