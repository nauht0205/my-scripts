// ==UserScript==
// @name         Transfer Schedule
// @namespace    martin.transfer
// @version      6.9
// @updateURL    https://raw.githubusercontent.com/nauht0205/my-scripts/main/transfer-schedule.user.js
// @downloadURL  https://raw.githubusercontent.com/nauht0205/my-scripts/main/transfer-schedule.user.js
// @description  Watches internal-transfer schedules (new schedules + spots opening) at chosen sites, matches them against your preferences, and sends phone alerts via Pushover. Read-only: never applies. Hands-off: never reloads, redirects or intercepts anything on the page (safe alongside the VTO scripts). Reload-proof.
// @match        https://atoz.amazon.work/*
// @match        https://atoz-apps.amazon.work/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @connect      api.pushover.net
// ==/UserScript==

(function () {
  'use strict';

  // Pushover keys live in Tampermonkey's storage on this machine, not in the file (the file is hosted for auto-updates).
  // The private Script Shelf copy carries them once as a seed; to change them, use "Set Pushover keys" in the Tampermonkey menu.
  function pushoverKey(id, seed, label) {
    let v = String(GM_getValue(id, '') || '').trim();
    if (!v && seed) { v = seed; GM_setValue(id, v); }
    if (!v && window.top === window.self) {
      let asked = false;
      try { asked = !!sessionStorage.getItem('pushoverAsked_' + id); sessionStorage.setItem('pushoverAsked_' + id, '1'); } catch (_) {}
      if (!asked) { v = String(prompt(label + ' (asked once, saved in Tampermonkey):') || '').trim(); if (v) GM_setValue(id, v); }
    }
    return v;
  }
  try {
    GM_registerMenuCommand('Set Pushover keys', function () {
      const u = prompt('Pushover User Key:', GM_getValue('pushoverUser', '')); if (u != null && u.trim()) GM_setValue('pushoverUser', u.trim());
      const t = prompt('Pushover API Token:', GM_getValue('pushoverToken', '')); if (t != null && t.trim()) GM_setValue('pushoverToken', t.trim());
      location.reload();
    });
  } catch (_) {}
  const W = unsafeWindow;
  const IS_TOP = W.top === W.self;
  const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '6.9';

  // ======================= CONFIG (edit here) =======================
  // Pushover (your phone alert channel). Paste YOUR OWN keys - User Key + an Application's API Token from pushover.net.
  // Keep both PRIVATE. While either is left as the PASTE_... placeholder, nothing is sent.
  const PUSHOVER_USER = pushoverKey('pushoverUser', '', 'Pushover User Key');
  const PUSHOVER_TOKEN = pushoverKey('pushoverToken', '', 'Pushover API Token');   // its own "Transfer" app, so transfer alerts are grouped apart from VTO
  const INTERVAL_MIN = 300;          // 6.6: every 5 hours. Minutes between automatic checks (jitter added); "check" button runs one now
  const DAILY_SUMMARY = true;        // one quiet "still watching" message per day
  // Links to a site's schedule list (both confirmed working):
  //  SITE_LINK - web page, used by the box's open / copy buttons on the PC
  //  APP_LINK  - opens the A to Z APP on iPhone straight to that site (A to Z's app links cover /m/*);
  //              used as the alert's "Open <site>" tappable link (tapping the alert itself just opens Pushover)
  const SITE_LINK = id => 'https://atoz.amazon.work/transfers?locationId=' + encodeURIComponent(id);
  const APP_LINK = id => 'https://atoz.amazon.work/m/transfers?locationId=' + encodeURIComponent(id);

  // Sites in priority order (rank 1 = most wanted).
  // onlyFlex: true -> only flex schedules at that site are reported.
  const SITES = [
    { rank: 1, name: 'SAH2', id: '724a62c4-e102-44b5-aceb-0c47c860a30d' },
    { rank: 2, name: 'DHX1', id: 'fe73d011-309b-4520-a77e-6b0835021a2b' },
    { rank: 3, name: 'STX4', id: 'f2516a75-5cf0-4238-b686-48a62b2b23fd' },
    { rank: 4, name: 'HOU8', id: '937b9275-3e99-4dea-904d-9927f2c34c21', onlyFlex: true },
  ];

  // Your schedule preferences (fixed schedules; flex always matches).
  const PREFS = {
    shiftTypes: ['DAY', 'SWING', 'NIGHT'],  // any shift type; the time window below decides
    blockedDays: ['FRIDAY', 'SATURDAY'],  // also blocks an OT day on these days
    earliestStart: '06:00',               // Mon-Thu shifts start at 6:00 AM or later
    sundayEarliestStart: '13:00',         // a Sunday shift must start at 1:00 PM or later
    latestEnd: '01:30',                   // a time after midnight means the next day
    maxDaysPerWeek: 4,                    // 5+ working days = no match (part time and full time)
    // 6.8: full time no longer has to be 10-hour shifts; days and times above still decide a match
  };

  // VTO protection: no transfer requests from 30 s before :00 to 60 s after (:59:30 - :01:00).
  // 6.6: only around the 8 AM - 2 PM VTO drops (7:59:30 - 2:01 PM), like VTO Auto Accept; other hours run freely.
  const DROP_FIRST_HOUR = 8, DROP_LAST_HOUR = 14;
  const QUIET_BEFORE_SEC = 30;
  const QUIET_AFTER_SEC = 60;
  const CLIENT_ID = 'ATOZ_HITS_SERVICE';
  const EMPLOYEE_ID_OVERRIDE = '';
  // ==================================================================

  const GQL_URL = 'https://atoz-apps.amazon.work/apis/AtoZTransferApp/graphql';
  const JOBS_QUERY = "query ListPersonalizedJobs($locationId: String!, $cutoffDate: String!, $pagination: PaginationParameters) {\n  ListPersonalizedJobs(\n    locationId: $locationId\n    cutoffDate: $cutoffDate\n    pagination: $pagination\n  ) {\n    jobs {\n      ...JobV2ListFields\n      __typename\n    }\n    pagination {\n      nextToken\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment JobV2ListFields on JobV2 {\n  id\n  responsibilityId\n  responsibility\n  departmentName\n  peoplesoftLocationName\n  businessLine\n  locationId\n  isRotatingSchedule\n  requiresDigitalSignature\n  scheduleCode\n  shiftPattern\n  scheduleClass\n  scheduleCycleLength\n  scheduleMetadata {\n    averageShiftLength\n    description\n    employeeClass\n    normalWorkingDays {\n      day\n      startTime\n      endTime\n      __typename\n    }\n    overtimeDays {\n      day\n      startTime\n      endTime\n      __typename\n    }\n    shiftType\n    type\n    weeklyHoursRequirement {\n      type\n      value\n      doublePrecisionValue\n      __typename\n    }\n    breaks {\n      startTime\n      endTime\n      __typename\n    }\n    __typename\n  }\n  __typename\n}";
  const AVAIL_QUERY = "query HeatMaps($locationId: String!, $refreshedAfter: String) {\n  ListJobAvailabilityByLocation(\n    locationId: $locationId\n    refreshedAfter: $refreshedAfter\n  ) {\n    availabilityList {\n      locationId\n      jobId\n      availabilityType\n      __typename\n    }\n    __typename\n  }\n  ListSiteLaborDemandMetadata(\n    locationId: $locationId\n    refreshedAfter: $refreshedAfter\n  ) {\n    metadata {\n      locationId\n      refreshedAt\n      status\n      isOverstaffed\n      __typename\n    }\n    __typename\n  }\n}";

  // ---------- storage ----------
  const loadJSON = (k, d) => { try { const v = JSON.parse(GM_getValue(k, '')); return v == null ? d : v; } catch (e) { return d; } };
  const saveJSON = (k, v) => GM_setValue(k, JSON.stringify(v));
  // 6.7: check log for the copy button (newest last, last 200 lines kept)
  const stamp = () => { const d = new Date(); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); };
  function log(line) { const l = loadJSON('twLog', []); l.push(stamp() + ' ' + line); saveJSON('twLog', l.slice(-200)); }

  // ---------- employee id: learned passively from the browser's request log ----------
  let employeeId = EMPLOYEE_ID_OVERRIDE || GM_getValue('employeeId', '');
  const ID_RE = /AtoZTransferApp\/graphql\?(?:.*&)?employeeId=([^&]+)/;
  function learnFrom(url) {
    if (employeeId) return;
    const m = url && url.match(ID_RE);
    if (m) { employeeId = decodeURIComponent(m[1]); GM_setValue('employeeId', employeeId); }
  }
  if (!employeeId) {
    try { performance.getEntriesByType('resource').forEach(e => learnFrom(e.name)); } catch (e) {}
    try {
      const obs = new PerformanceObserver(list => {
        list.getEntries().forEach(e => learnFrom(e.name));
        if (employeeId) obs.disconnect();
      });
      obs.observe({ type: 'resource', buffered: true });
    } catch (e) {}
  }

  const pageFetch = W.fetch.bind(W);

  // ---------- time helpers ----------
  function chicagoNow() {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
      minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const g = t => (p.find(x => x.type === t) || {}).value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, minute: parseInt(g('minute'), 10) };
  }
  // seconds from the nearest :00 (-1800 .. +1799): -30 = :59:30, +60 = :01:00
  const secFromHour = () => { const d = new Date(); const s = d.getMinutes() * 60 + d.getSeconds(); return s >= 1800 ? s - 3600 : s; };
  // the :00 nearest to now is one of the drop hours (8 AM - 2 PM, this computer's clock)
  const dropHour = () => { const d = new Date(); const h = d.getMinutes() >= 30 ? (d.getHours() + 1) % 24 : d.getHours(); return h >= DROP_FIRST_HOUR && h <= DROP_LAST_HOUR; };
  const inQuietWindow = (lead = 0) => { const r = secFromHour(); return dropHour() && r >= -QUIET_BEFORE_SEC - lead && r < QUIET_AFTER_SEC; };
  // a whole check takes ~15 s and one site ~5 s, so starts are held back early enough that no request
  // is still out when the pause begins at :59:30
  const CHECK_LEAD_SEC = 20, SITE_LEAD_SEC = 8;
  const toMin = t => { const [h, m] = String(t || '').split(':').map(Number); return h * 60 + (m || 0); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
  }

  // ---------- Amazon requests ----------
  async function gql(operationName, variables, query) {
    const res = await pageFetch(`${GQL_URL}?employeeId=${encodeURIComponent(employeeId)}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'accept': '*/*',
        'x-atoz-client-id': CLIENT_ID,
        'x-atoz-client-request-id': uuid(),
      },
      body: JSON.stringify({ operationName, variables, query }),
    });
    // 6.7: every error carries what Amazon actually sent back (cut to 300 characters), for the copy button
    const text = await res.text().catch(() => '');
    const said = t => ' | Amazon said: ' + String(t || '(nothing)').replace(/\s+/g, ' ').slice(0, 300);
    if (!res.ok) throw new Error(operationName + ': HTTP ' + res.status + (res.status === 401 || res.status === 403 ? ' (signed out?)' : '') + said(text));
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error(operationName + ': non-JSON reply (signed out?)' + said(text)); }
    if (json.errors && json.errors.length) throw new Error(operationName + ': ' + (json.errors[0].message || 'API error') + said(JSON.stringify(json.errors)));
    if (!json.data) throw new Error(operationName + ': empty reply' + said(text));
    return json.data;
  }

  async function fetchJobs(locationId) {
    const all = [];
    let nextToken = null;
    for (let page = 0; page < 5; page++) {
      const pagination = { maxResults: 1000 };
      if (nextToken) pagination.nextToken = nextToken;
      const d = await gql('ListPersonalizedJobs', { locationId, cutoffDate: chicagoNow().date, pagination }, JOBS_QUERY);
      const r = d.ListPersonalizedJobs;
      if (!r || !Array.isArray(r.jobs)) throw new Error('unexpected schedule list');
      all.push(...r.jobs);
      nextToken = r.pagination && r.pagination.nextToken;
      if (!nextToken) break;
    }
    return all;
  }

  // { statusMode, open: Map(jobId -> availabilityType) }. statusMode=false: site publishes no spots, listed = open.
  async function fetchAvailability(locationId) {
    const refreshedAfter = new Date(Date.now() - 28 * 864e5).toISOString();
    const d = await gql('HeatMaps', { locationId, refreshedAfter }, AVAIL_QUERY);
    const list = (d.ListJobAvailabilityByLocation && d.ListJobAvailabilityByLocation.availabilityList) || [];
    const meta = (d.ListSiteLaborDemandMetadata && d.ListSiteLaborDemandMetadata.metadata) || [];
    const open = new Map();
    list.forEach(a => {
      const t = String(a.availabilityType || '').toUpperCase();
      if (a.jobId && !['NONE', 'ZERO', 'UNAVAILABLE', 'FULL'].includes(t)) open.set(a.jobId, t);
    });
    const statusMode = list.length > 0 || meta.some(m => m.status === 'SUCCESS');
    return { statusMode, open };
  }

  // ---------- matching ----------
  const cap = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
  const meta = j => (j.scheduleMetadata && j.scheduleMetadata[0]) || {};
  const isFlex = j => j.scheduleClass === 'FLEXIBLE' || /^FLEX/.test(meta(j).type || '');
  // Inbound/Outbound from the schedule code ending (-IB / -OB). Any other ending is already visible in the
  // code itself, so nothing extra is added for it.
  function dept(j) {
    const c = j.scheduleCode || '';
    if (/-OB$/i.test(c)) return 'Outbound';
    if (/-IB$/i.test(c)) return 'Inbound';
    return '';
  }

  function evaluate(j) {
    const m = meta(j);
    if (isFlex(j)) return { match: true, reasons: [], sunday: false };
    const reasons = [];
    if (!PREFS.shiftTypes.includes(m.shiftType)) reasons.push(cap(m.shiftType || 'unknown') + ' shift');
    const days = m.normalWorkingDays || [];
    if (!days.length) reasons.push('no fixed days listed');
    const blocked = days.filter(d => PREFS.blockedDays.includes(d.day)).map(d => cap(d.day.slice(0, 3)));
    if (blocked.length) reasons.push('works ' + blocked.join('/'));
    const otBlocked = (m.overtimeDays || []).filter(d => PREFS.blockedDays.includes(d.day)).map(d => cap(d.day.slice(0, 3)));
    if (otBlocked.length) reasons.push('OT day ' + otBlocked.join('/'));
    const startMin = toMin(PREFS.earliestStart), endLimit = 1440 + toMin(PREFS.latestEnd);
    let earlyDay = '', earlySun = '';   // one combined "starts too early" reason instead of two
    days.forEach(d => {
      const s = toMin(d.startTime); let e = toMin(d.endTime);
      if (e <= s) e += 1440;
      if (d.day === 'SUNDAY') { if (s < toMin(PREFS.sundayEarliestStart)) earlySun = d.startTime; }
      else if (s < startMin) earlyDay = d.startTime;
      if (e > endLimit) reasons.push('ends ' + d.endTime);
    });
    if (earlyDay && earlySun && earlyDay === earlySun) reasons.push('starts ' + earlyDay + ' (too early)');
    else {
      if (earlyDay) reasons.push('starts ' + earlyDay + ' (needs ' + PREFS.earliestStart + '+)');
      if (earlySun) reasons.push('Sun starts ' + earlySun + ' (needs ' + PREFS.sundayEarliestStart + '+)');
    }
    if (days.length > PREFS.maxDaysPerWeek) reasons.push(days.length + ' days/wk');
    return { match: reasons.length === 0, reasons: [...new Set(reasons)], sunday: days.some(d => d.day === 'SUNDAY') };
  }

  // Lower = better: flex > part time > full time, outbound > unknown > inbound, Sunday off first.
  function rankKey(j, ev) {
    const t = meta(j).type || '';
    const typeR = isFlex(j) ? 0 : t === 'PART_TIME' ? 1 : t === 'FULL_TIME' ? 2 : 3;
    const d = dept(j);
    const dR = d === 'Outbound' ? 0 : d === 'Inbound' ? 2 : 1;
    return typeR * 100 + dR * 10 + (ev.sunday ? 1 : 0);
  }

  // Everything Amazon sends about one schedule, in a compact form (used by the phone alerts and the box list).
  // activity = the card's "Shift activity" (responsibility); dept = departmentName (not shown on the card);
  // dir = Inbound/Outbound, read from the schedule code ending (-IB / -OB).
  // Order work days the way the A to Z page does: one continuous run, starting from the first day of the
  // work block (e.g. Wed, Thu, Fri, Sat, Sun - not Sun, Wed, Thu, Fri, Sat). The block starts right after
  // the longest gap in the week.
  const WEEK = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  function inWeekOrder(list) {
    const ds = (list || []).slice().sort((a, b) => WEEK.indexOf(a.day) - WEEK.indexOf(b.day));
    if (ds.length < 2) return ds;
    let start = 0, bestGap = -1;
    ds.forEach((d, k) => {
      const prev = ds[(k - 1 + ds.length) % ds.length];
      const gap = (WEEK.indexOf(d.day) - WEEK.indexOf(prev.day) + 7) % 7;
      if (gap > bestGap) { bestGap = gap; start = k; }
    });
    return ds.slice(start).concat(ds.slice(0, start));
  }

  function info(j) {
    const m = meta(j);
    const flex = isFlex(j);
    const nd = inWeekOrder(m.normalWorkingDays);
    const d0 = nd[0] || {};
    const hrs = (m.weeklyHoursRequirement || [])[0];
    const activity = j.responsibility || '';
    return {
      code: j.scheduleCode || '?',
      flex,
      type: flex ? 'Flex' : cap((m.type || '').split('_')[0]) + (m.type && m.type.includes('_') ? '-time' : ''),
      shift: flex ? '' : cap(m.shiftType),
      days: nd.map(x => cap(x.day.slice(0, 3))).join('/'),
      start: d0.startTime || '', end: d0.endTime || '',
      len: m.averageShiftLength || 0,
      wk: hrs ? hrs.value : 0,
      ot: (m.overtimeDays || []).map(x => cap(x.day.slice(0, 3))).join('/'),
      brk: (m.breaks || []).map(b => b.startTime + '-' + b.endTime).join(', '),
      dir: dept(j),
      activity,
      dept: j.departmentName && j.departmentName !== activity ? j.departmentName : '',
    };
  }
  // Pieces of one schedule, each tagged with what it is (the box colors them by tag; the phone alert joins
  // the text). Department name and break times are left out on purpose: the activity covers the first,
  // and the second isn't needed.
  function headParts(i) {
    return [
      { k: i.flex ? 'flex' : /^Part/.test(i.type) ? 'part' : /^Full/.test(i.type) ? 'full' : 'text', t: i.type },
      i.shift ? { k: 'text', t: i.shift, join: ' ' } : null,
      i.dir ? { k: i.dir === 'Outbound' ? 'out' : i.dir === 'Inbound' ? 'in' : 'text', t: i.dir } : null,
      i.activity ? { k: 'act', t: i.activity } : null,
    ].filter(Boolean);
  }
  function detailParts(i, spotsText) {
    const spots = spotsText ? { k: /^spots:/.test(spotsText) ? 'spotsOpen' : 'text', t: spotsText } : null;
    if (i.flex) return [{ k: 'main', t: 'you pick your shifts' }, i.wk ? { k: 'extra', t: i.wk + 'h/wk' } : null, spots].filter(Boolean);
    return [
      { k: 'main', t: `${i.days} ${i.start || '?'}-${i.end || '?'}` },
      i.len ? { k: 'extra', t: i.len + 'h shifts' } : null,
      i.wk ? { k: 'extra', t: i.wk + 'h/wk' } : null,
      i.ot ? { k: 'text', t: 'OT day ' + i.ot } : null,
      spots,
    ].filter(Boolean);
  }
  // plain text of a list of pieces (pieces marked join:' ' stick to the previous one)
  function partsText(parts, sep) {
    return parts.reduce((s, p, n) => s + (n ? (p.join || sep) : '') + p.t, '');
  }

  // Two-line description for the phone alert:
  //   SM1-1000-OB · Part-time Swing · Outbound · Picking
  //   Tue/Wed/Thu 10:00-18:30 · 8h shifts · 24h/wk · spots: Many
  function describe(j, spots) {
    const i = info(j);
    return {
      head: i.code + ' · ' + partsText(headParts(i), ' · '),
      detail: partsText(detailParts(i, spots ? 'spots: ' + cap(spots) : ''), ' · '),
    };
  }

  // ---------- Pushover ----------
  // The old ntfy "tags" become the emoji shown before the title; the "Open <site>" button becomes a
  // tappable link at the TOP of the message (html=1), so a long schedule list never pushes it off-screen.
  // Pushover never uses the emergency priority here - the VTO wake alarm is separate.
  const TAG_EMOJI = { star: '⭐', x: '❌', wastebasket: '🗑️', eyes: '👀', warning: '⚠️', green_circle: '🟢', calendar: '📅' };
  const PRIO_MAP = { 2: 0, 3: 0, 4: 0, 5: 0 };    // 6.5: every transfer alert is a normal notification (sound, or vibrate on Silent); never critical
  const htmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function notify(title, message, priority, tags, site) {
    if (!PUSHOVER_USER || PUSHOVER_USER === 'PASTE_YOUR_USER_KEY' ||
        !PUSHOVER_TOKEN || PUSHOVER_TOKEN === 'PASTE_YOUR_APP_TOKEN') return;
    const emoji = TAG_EMOJI[tags] || '';
    const p = PRIO_MAP[priority] != null ? PRIO_MAP[priority] : 0;
    // Pushover caps title at 250 and message at 1024 chars, so trim to stay under the API limit.
    const ttl = ((emoji ? emoji + ' ' : '') + title).slice(0, 250);
    // html=1: tappable "Open <site>" link first, then the message (newlines -> <br>). Everything escaped.
    // 6.5: each <br> also keeps a real newline, so the lock-screen banner (which drops the tags) still breaks lines.
    const link = site ? '<a href="' + APP_LINK(site.id) + '">Open ' + htmlEsc(site.name) + '</a><br>\n' : '';
    const msg = (link + htmlEsc(message).replace(/\n/g, '<br>\n')).slice(0, 1024);
    let body = 'token=' + encodeURIComponent(PUSHOVER_TOKEN) +
      '&user=' + encodeURIComponent(PUSHOVER_USER) +
      '&title=' + encodeURIComponent(ttl) +
      '&message=' + encodeURIComponent(msg) +
      '&html=1' +
      '&priority=' + p;
    GM_xmlhttpRequest({
      method: 'POST',
      url: 'https://api.pushover.net/1/messages.json',
      data: body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      onerror: () => setStatus('err', 'phone alert failed to send'),
    });
  }

  // ================= STATUS BOX =================
  // 6.9: A to Z look like VTO Auto Accept 4.69: light (white box, navy text) or dark (the dark A to Z page).
  // Its own Light / Dark button in the header (saved as twTheme, default light; not tied to the VTO box). Same color for the same thing as before;
  // on white, each color is a deeper shade of it so it stays readable. Last / next check times are A to Z orange.
  const THEMES = {
    light: { bg: '#ffffff', border: '#d1d1d9', btnLine: '#cfd0d8', shadow: 'rgba(22,30,45,.18)', text: '#161e2d', onWarn: '#ffffff',
      green: '#009d34', red: '#cc0c39', blue: '#1d5bd8', pink: '#c2187a', cyan: '#0a7f99', yellow: '#8a6d00', orange: '#c75a12',
      purple: '#7a3fd1', gray: '#5c6471', azOrange: '#ef6c28' },
    dark: { bg: '#15151d', border: '#3a3a45', btnLine: '#5a5a66', shadow: 'rgba(0,0,0,.5)', text: '#ffffff', onWarn: '#15151d',
      green: '#50fa7b', red: '#ff5555', blue: '#4d9fff', pink: '#ff92df', cyan: '#8be9fd', yellow: '#f6ff9c', orange: '#ffa94d',
      purple: '#bd93f9', gray: '#a3a3ae', azOrange: '#ff9f5a' },
  };
  const C = {}, PART_COLOR = {};
  let themeNow = '';
  const wantTheme = () => GM_getValue('twTheme', 'light') === 'dark' ? 'dark' : 'light';
  function applyTheme() {
    themeNow = wantTheme();
    Object.assign(C, THEMES[themeNow]);
    // schedule list colors, by piece tag (see headParts / detailParts)
    Object.assign(PART_COLOR, {
      flex: C.blue, part: C.cyan, full: C.purple,   // type, in your priority order
      out: C.green, in: C.orange,                    // Outbound / Inbound
      act: C.yellow,                                 // shift activity
      main: C.text, extra: C.gray,                   // days + times (bold) / shift length, hours per week
      spotsOpen: C.green, text: C.text,
    });
  }
  applyTheme();
  const STAR = '★';   // match mark in the box (green)
  // 6.9: A to Z's own font: whatever the page itself uses (read from the page), Amazon Ember if that can't be read
  const FONT = (() => { try { const f = getComputedStyle(document.body || document.documentElement).fontFamily; if (f && !/^\s*(serif|"?Times)/i.test(f)) return f; } catch (e) {} return '"Amazon Ember", "Amazon Ember Display", Arial, Helvetica, sans-serif'; })();
  let box = null, headLabel = null, bodyEl = null, lastHtml = '', lastHead = '';
  let collapsed = !!GM_getValue('boxCollapsed', false);

  function setStatus(kind, text) { saveJSON('status2', { kind, text, t: Date.now() }); render(); }
  function setSite(name, data) { const s = loadJSON('siteStat', {}); s[name] = data; saveJSON('siteStat', s); render(); }

  // 6.9: header buttons outlined like the VTO box (A to Z tiles)
  function mkBtn(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:' + C.bg + ';color:' + C.text + ';border:1px solid ' + C.btnLine + ';border-radius:6px;font:600 12px/1.5 ' + FONT + ';padding:2px 9px;cursor:pointer;';
    b.addEventListener('mouseenter', () => { b.style.filter = 'brightness(0.94)'; });
    b.addEventListener('mouseleave', () => { b.style.filter = ''; });
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  }
  function buildBox() {
    if (box || !IS_TOP || !document.body) return;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483646;width:max-content;max-width:min(96vw,1100px);max-height:90vh;overflow:auto;background:' + C.bg + ';color:' + C.text + ';font:14px/1.6 ' + FONT + ';font-variant-numeric:tabular-nums;border:1px solid ' + C.border + ';border-radius:8px;box-shadow:0 2px 12px ' + C.shadow + ';';
    const head = document.createElement('div');
    head.style.cssText = 'padding:8px 10px 8px 14px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid ' + C.border + ';';
    headLabel = document.createElement('span');
    const btns = document.createElement('span');
    btns.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const modeBtn = mkBtn(themeNow === 'dark' ? '☾ Dark' : '☀ Light', () => { GM_setValue('twTheme', themeNow === 'dark' ? 'light' : 'dark'); render(); });
    modeBtn.title = 'switch the Transfer box between light and dark';
    if (themeNow === 'dark') modeBtn.style.background = '#2c2c38';
    btns.appendChild(modeBtn);
    btns.appendChild(mkBtn('check', checkNow));
    btns.appendChild(mkBtn('copy', () => copyText(report()).then(ok => setStatus(ok ? 'ok' : 'err', ok ? 'copied - paste it to Claude' : 'copy failed'))));
    btns.appendChild(mkBtn('test', () => {
      notify('Transfer Schedule · test', 'Alerts are working. This was sent at the same priority as a real match.\n\nThe "Open ' + SITES[0].name + '" button should open the A to Z app on ' + SITES[0].name + '\'s schedule list.', 5, 'star', SITES[0]);
      setStatus('ok', 'test alert sent ' + clock(Date.now()));
    }));
    // 6.6: minimize button shows − while open and + while minimized
    const minBtn = mkBtn(collapsed ? '+' : '−', () => {
      collapsed = !collapsed; GM_setValue('boxCollapsed', collapsed);
      minBtn.textContent = collapsed ? '+' : '−'; minBtn.title = collapsed ? 'expand' : 'minimize';
      lastHtml = ''; render();
    });
    minBtn.title = collapsed ? 'expand' : 'minimize';
    btns.appendChild(minBtn);
    head.appendChild(headLabel);
    head.appendChild(btns);
    bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'padding:8px 14px 10px;white-space:pre;';
    // click ▸ / site name: open that site's list (click again to close; only one open at a time)
    bodyEl.addEventListener('click', e => {
      // "open" / "copy" next to a site: open its schedule list in a NEW tab (never this VTO tab), or copy its link
      const act = e.target && e.target.closest && e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        const site = SITES.find(x => x.name === act.getAttribute('data-name'));
        if (!site) return;
        const url = SITE_LINK(site.id);
        if (act.getAttribute('data-act') === 'open') {
          window.open(url, '_blank', 'noopener');
          setStatus('ok', site.name + ' opened in a new tab - close it when done');
        } else {
          copyText(url).then(ok => setStatus(ok ? 'ok' : 'err', ok ? site.name + ' link copied - paste it in main Chrome' : 'copy failed'));
        }
        return;
      }
      const t = e.target && e.target.closest && e.target.closest('[data-site]');
      if (!t) return;
      e.stopPropagation();
      const name = t.getAttribute('data-site');
      GM_setValue('openSite', GM_getValue('openSite', '') === name ? '' : name);
      render();
    });
    box.appendChild(head);
    box.appendChild(bodyEl);
    box.__head = head;
    document.body.appendChild(box);
    render();
    if (!buildBox.timer) buildBox.timer = setInterval(render, 15000);   // 6.9: once, even when the box is rebuilt for Light / Dark
  }

  // small "open" / "copy" buttons at the end of a site row (handled by the click listener in buildBox)
  const siteBtn = (act, name) => `<span data-act="${act}" data-name="${esc(name)}" style="margin-left:6px;padding:0 8px;border:1px solid ${C.btnLine};border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;color:${C.text}">${act}</span>`;
  function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(() => true, () => fallbackCopy(t)); } catch (e) {}
    return Promise.resolve(fallbackCopy(t));
  }
  function fallbackCopy(t) {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 6.9: only fixed-width cells are blocks; the rest stay plain text so spaces around " | " are kept
  const cell = (t, w, color, bold) => `<span style="${w ? 'display:inline-block;width:' + w + 'ch;' : ''}color:${color || C.text}${bold ? ';font-weight:700' : ''}">${esc(t)}</span>`;
  const flexText = (open, listed) => cell(open + '/' + listed + ' flex open', 0, open ? C.blue : C.text, open > 0);

  // The schedule list shown under a site when its ▸ is clicked. Built only from data already saved by the
  // last check: opening it sends nothing to Amazon.
  function siteList(s) {
    const jobs = loadJSON('siteJobs', {})[s.name];
    // lines wrap (at the " | " gaps) instead of running off the right edge, so the box stays narrow
    const wrap = inner => `<div style="border-left:2px solid ${C.border};margin:4px 0 6px 8px;padding-left:10px;max-height:45vh;overflow:auto;white-space:normal;max-width:50ch;">${inner}</div>`;
    if (!jobs) return wrap(cell('no details yet - press check', 0, C.text));
    if (!jobs.length) return wrap(cell(s.onlyFlex ? 'no flex schedules listed' : 'no schedules listed', 0, C.text));
    const colored = parts => parts.map((p, n) =>
      (n ? cell(p.join || ' | ', 0, C.text) : '') + cell(p.t, 0, PART_COLOR[p.k] || C.text, p.k === 'main')).join('');
    return wrap(jobs.map((x, n) => {
      const mark = x.match ? cell(STAR, 0, C.green, true) : cell('✗', 0, C.red, true);
      let h = `<div${n ? ' style="margin-top:5px"' : ''}>${mark} ${cell(x.i.code, 0, C.text, true)}  ${colored(headParts(x.i))}</div>`;
      h += `<div style="padding-left:2ch">${colored(detailParts(x.i, x.spots))}</div>`;
      if (!x.match) h += `<div style="padding-left:2ch">${cell('why: ' + x.reasons.join(', '), 0, C.pink)}</div>`;
      return h;
    }).join(''));
  }

  // 6.7: everything the box knows, as text (the "copy" button). No Pushover keys in it.
  function report() {
    const t = x => x ? new Date(x).toLocaleString() : 'never';
    const stats = loadJSON('siteStat', {});
    return [
      'Transfer Schedule ' + VERSION,
      'time ' + new Date().toString(),
      'page ' + location.pathname + ' | tab ' + document.visibilityState,
      'employee id ' + (employeeId ? 'known' : 'NOT known yet'),
      'last check ' + t(GM_getValue('lastCheckAt', 0)) + ' | next ' + t(GM_getValue('nextDue', 0)) + ' | running ' + (GM_getValue('running', 0) ? t(GM_getValue('running', 0)) : 'no'),
      'every ' + INTERVAL_MIN + ' min | VTO pause ' + (inQuietWindow() ? 'ON now' : 'off now') + ' (8 AM-2 PM drops only)',
      'failed checks in a row ' + JSON.stringify(loadJSON('err', { fails: 0 })),
      'status ' + JSON.stringify(loadJSON('status2', {})),
      '--- sites',
      SITES.map(x => '#' + x.rank + ' ' + x.name + (x.onlyFlex ? ' (flex only)' : '') + ': ' + JSON.stringify(stats[x.name] || null)).join('\n'),
      '--- log',
      loadJSON('twLog', []).join('\n') || 'empty',
    ].join('\n');
  }

  function render() {
    if (!box) return;
    // 6.9: Light / Dark was switched (here or in another tab): rebuild in the other colors
    if (wantTheme() !== themeNow) { applyTheme(); box.remove(); box = null; lastHtml = ''; lastHead = ''; buildBox(); return; }
    const st = loadJSON('status2', { kind: '', text: '' });
    const err = loadJSON('err', { fails: 0 });
    const running = GM_getValue('running', 0) > Date.now() - 3 * 60 * 1000;
    // 6.9: like the VTO box: white header, status in orange; a full orange bar only when something needs you
    let label = '', bar = false;
    if (!employeeId) { label = 'OPEN TRANSFER PAGE ONCE'; bar = true; }
    else if (running) label = 'Checking…';
    else if (err.fails >= 2) { label = 'PROBLEM - CHECK SIGN-IN'; bar = true; }
    else if (err.fails === 1) { label = 'LAST CHECK FAILED'; bar = true; }
    else if (inQuietWindow()) label = 'Paused for VTO :59:30-:01:00';
    const headTxt = 'Transfer ' + VERSION + '|' + label + '|' + bar;
    if (headTxt !== lastHead) {
      lastHead = headTxt;
      const h = box.__head;
      h.style.background = bar ? C.azOrange : C.bg;
      h.style.borderBottomColor = bar ? C.azOrange : C.border;
      h.style.color = bar ? C.onWarn : C.text;
      headLabel.innerHTML = 'Transfer ' + esc(VERSION) + (label ? ` <span style="font-weight:400;${bar ? '' : 'color:' + C.gray}">|</span> <span style="${bar ? '' : 'color:' + C.azOrange}">${esc(label)}</span>` : '');
    }

    bodyEl.style.display = collapsed ? 'none' : 'block';
    if (collapsed) return;

    // One line per site in fixed columns: ▸ name | status (★ / ✗ / flex count) | open copy.
    // Spot status is shown per schedule in the ▸ list, only at sites that use spots.
    const stats = loadJSON('siteStat', {});
    const openSite = GM_getValue('openSite', '');
    let rows = '';
    SITES.forEach(s => {
      const d = stats[s.name];
      const isOpen = openSite === s.name;
      // ▸ / ▾ and the site name are clickable: they open or close this site's schedule list
      let line = `<span data-site="${esc(s.name)}" style="cursor:pointer">` +
        cell(isOpen ? '▾' : '▸', 2, C.cyan) + cell('#' + s.rank + ' ' + s.name, 9, C.text, true) + '</span>';
      let status;
      if (!d) status = cell('…', 0, C.text);
      else if (d.error) status = `<span title="${esc(d.error)}">${cell('error', 0, C.orange, true)}</span>`;
      else if (s.onlyFlex) status = flexText(d.flexOpen || 0, d.flexListed || 0);
      else {
        status = cell(STAR + ' ' + d.match, 6, d.match ? C.green : C.text, d.match > 0) +
          cell('✗ ' + d.noMatch, 6, d.noMatch ? C.red : C.text, d.noMatch > 0);
        if (d.flexListed) status += flexText(d.flexOpen, d.flexListed);
      }
      // last batch change (+added -removed), shown for 24 h after it happened
      if (d && !d.error && d.changedAt && Date.now() - d.changedAt < 24 * 3600 * 1000 && (d.added || d.removed)) {
        status += '&nbsp;&nbsp;' + cell([d.added ? '+' + d.added : '', d.removed ? '-' + d.removed : ''].filter(Boolean).join(' '), 0, C.yellow, true);
      }
      // fixed-width status column so the open / copy buttons line up on every row
      line += `<span style="display:inline-block;min-width:20ch;white-space:nowrap;vertical-align:bottom">${status}</span>`;
      line += siteBtn('open', s.name) + siteBtn('copy', s.name);
      rows += `<div>${line}</div>`;
      if (isOpen) rows += siteList(s);
    });

    const legend = `<div style="margin-top:4px">${cell(STAR, 0, C.green)} match   ${cell('✗', 0, C.red)} no match</div>`;

    const lastOk = GM_getValue('lastCheckAt', 0);
    const next = GM_getValue('nextDue', 0);
    let foot = `<div style="border-top:1px solid ${C.border};margin-top:8px;padding-top:8px;color:${C.text};font-weight:700;font-size:15px;">Checks</div>`;
    foot += `<div>${cell('last ', 0, C.gray)}${cell(lastOk ? clock(lastOk) : '—', 0, C.azOrange)} ${cell('|', 0, C.gray)} ${cell('next ', 0, C.gray)}${cell(next > Date.now() ? clock(next) : 'soon', 0, C.azOrange)}</div>`;
    if (st.text && st.kind === 'err') foot += `<div>${cell('! ' + st.text, 0, C.orange)}</div>`;
    else if (st.text && st.kind === 'ok' && Date.now() - st.t < 60000) foot += `<div>${cell(st.text, 0, C.text)}</div>`;

    const html = rows + legend + foot;
    if (html !== lastHtml) { lastHtml = html; bodyEl.innerHTML = html; }   // redraw only when something changed
  }

  // ---------- one site ----------
  async function checkSite(site, seen) {
    const jobs = await fetchJobs(site.id);
    await sleep(800 + Math.random() * 800);
    const av = await fetchAvailability(site.id);

    const prev = seen[site.id];          // { jobId: true/false (open) } or undefined (first time)
    const cur = {};
    const events = [];
    const list = [];                     // every relevant schedule, for the box's site list
    let openCount = 0, openMatches = 0, flexListed = 0, flexOpen = 0;

    for (const j of jobs) {
      const open = av.statusMode ? av.open.has(j.id) : true;
      cur[j.id] = open;
      const relevant = !site.onlyFlex || isFlex(j);
      if (!relevant) continue;
      const ev = evaluate(j);
      list.push({
        id: j.id, i: info(j), match: ev.match, reasons: ev.reasons, rk: rankKey(j, ev), open,
        spots: av.statusMode ? (open ? 'spots: ' + cap(av.open.get(j.id)) : 'no spots') : '',
      });
      if (open) { openCount++; if (ev.match) openMatches++; }
      if (isFlex(j)) { flexListed++; if (open) flexOpen++; }
      if (prev && open && prev[j.id] !== true) {
        events.push({ j, ev, spots: av.statusMode ? av.open.get(j.id) : '', kind: prev[j.id] === false ? 'SPOTS OPENED' : 'NEW' });
      } else if (prev && !open && prev[j.id] === undefined && isFlex(j)) {
        events.push({ j, ev, spots: '', kind: 'NEW · no spots yet' });
      }
    }
    seen[site.id] = cur;
    // schedules taken down since the last check (compared with the last saved list; entries saved by
    // versions before 5.8 have no id and are skipped, so updating never causes a false "removed")
    const allJobs = loadJSON('siteJobs', {});
    const curIds = new Set(list.map(x => x.id));
    const removed = prev ? (allJobs[site.name] || []).filter(x => x.id && !curIds.has(x.id)) : [];
    const added = events.filter(e => /^NEW/.test(e.kind)).length;
    const opened = events.length - added;
    list.sort((a, b) => (b.match - a.match) || (b.open - a.open) || (a.rk - b.rk));
    allJobs[site.name] = list; saveJSON('siteJobs', allJobs);
    const old = loadJSON('siteStat', {})[site.name] || {};
    const change = (added || removed.length)
      ? { added, removed: removed.length, changedAt: Date.now() }
      : { added: old.added || 0, removed: old.removed || 0, changedAt: old.changedAt || 0 };
    setSite(site.name, Object.assign({ match: openMatches, noMatch: openCount - openMatches, flexListed, flexOpen, statusMode: av.statusMode }, change));

    // batch summary line at the top of the alert, e.g. "Now 10 listed · +10 new · -12 removed"
    const summary = `Now ${list.length} listed` + (added ? ` · +${added} new` : '') +
      (opened ? ` · ${opened} spots opened` : '') + (removed.length ? ` · -${removed.length} removed` : '');
    const removedText = removed.length
      ? `\n\nRemoved (${removed.length}): ` + removed.slice(0, 15).map(x => x.i.code).join(', ') + (removed.length > 15 ? `, +${removed.length - 15} more` : '')
      : '';

    if (!events.length && removed.length) {
      notify(`#${site.rank} ${site.name} · ${removed.length} schedule${removed.length > 1 ? 's' : ''} removed`,
        summary + removedText, 3, 'wastebasket', site);
    }
    if (events.length) {
      events.sort((a, b) => (b.ev.match - a.ev.match) || (rankKey(a.j, a.ev) - rankKey(b.j, b.ev)));
      const matches = events.filter(e => e.ev.match);
      const blocks = events.slice(0, 8).map(e => {
        const d = describe(e.j, e.spots);
        return (e.ev.match ? '⭐ ' : '❌ ') + d.head + '\n   ' + d.detail + ' · ' + e.kind +
          (e.ev.match ? '' : '\n   why: ' + e.ev.reasons.join(', '));
      });
      const more = events.length > 8 ? `\n\n+${events.length - 8} more - open A to Z to see all` : '';
      const what = [added ? added + ' new' : '', opened ? opened + ' opened' : '', removed.length ? removed.length + ' removed' : ''].filter(Boolean).join(', ');
      const title = matches.length
        ? `MATCH · #${site.rank} ${site.name} · ${matches.length} match${matches.length > 1 ? 'es' : ''} (${what})`
        : `#${site.rank} ${site.name} · ${what} (no match)`;
      notify(title, summary + '\n\n' + blocks.join('\n\n') + more + removedText, 5, matches.length ? 'star' : 'x', site);
    }
    return { firstTime: prev === undefined, openCount, openMatches, flexListed, flexOpen };
  }

  // ---------- full check ----------
  async function runCheck() {
    const seen = loadJSON('seen2', {});
    const errors = [];
    const baseline = [];

    log('check started');
    for (const site of SITES) {
      if (inQuietWindow(SITE_LEAD_SEC)) { log('paused for the VTO drop, will finish after :01'); render(); return 'quiet'; }
      try {
        const t0 = Date.now();
        let r;
        // 6.7: a site that fails is tried once more after 5 s before it counts as an error
        try { r = await checkSite(site, seen); }
        catch (e1) {
          log(site.name + ' failed, trying again in 5 s: ' + e1.message);
          await sleep(5000);
          if (inQuietWindow(SITE_LEAD_SEC)) throw e1;
          r = await checkSite(site, seen);
          log(site.name + ' ok on the second try');
        }
        log(site.name + ' ok (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s): ' + (site.onlyFlex
          ? r.flexOpen + '/' + r.flexListed + ' flex open'
          : r.openMatches + ' match, ' + (r.openCount - r.openMatches) + ' no match' + (r.flexListed ? ', ' + r.flexOpen + '/' + r.flexListed + ' flex open' : '')));
        saveJSON('seen2', seen);
        if (r.firstTime) baseline.push(site.onlyFlex
          ? `#${site.rank} ${site.name}: ${r.flexOpen}/${r.flexListed} flex open`
          : `#${site.rank} ${site.name}: ⭐ ${r.openMatches}  ✗ ${r.openCount - r.openMatches}`);
      } catch (e) {
        errors.push(site.name + ': ' + e.message);
        log('!! ' + site.name + ' error: ' + e.message);
        setSite(site.name, { error: e.message, at: Date.now() });
      }
      await sleep(1500 + Math.random() * 1500);
    }

    if (baseline.length) {
      notify('Transfer Schedule · started', 'Now watching (open schedules):\n' + baseline.join('\n') +
        '\n\nYou will be alerted when schedules are added or spots open.', 3, 'eyes');
    }

    const es = loadJSON('err', { fails: 0, lastAlert: 0, inError: false });
    const now = Date.now();
    if (errors.length) {
      es.fails++;
      if (es.fails >= 2 && (!es.inError || now - es.lastAlert > 2 * 3600 * 1000)) {
        notify('Transfer Schedule · problem',
          errors.join('\n') + '\n\nOpen A to Z and sign in if needed. Checks are NOT running correctly.', 4, 'warning');
        es.lastAlert = now;
        es.inError = true;
      }
      setStatus('err', errors.length + ' site' + (errors.length > 1 ? 's' : '') + ' failed (' + es.fails + ' in a row)');
    } else {
      if (es.inError) notify('Transfer Schedule · recovered', 'Checks are working again.', 3, 'green_circle');
      es.fails = 0;
      es.inError = false;
      const today = chicagoNow().date;
      if (DAILY_SUMMARY && !baseline.length && GM_getValue('summaryDay', '') !== today) {
        const s = loadJSON('siteStat', {});
        const lines = SITES.map(x => {
          const d = s[x.name] || {};
          if (x.onlyFlex) return `#${x.rank} ${x.name}: ${d.flexOpen || 0}/${d.flexListed || 0} flex open`;
          return `#${x.rank} ${x.name}: ⭐ ${d.match || 0}  ✗ ${d.noMatch || 0}` + (d.flexListed ? `  · ${d.flexOpen}/${d.flexListed} flex open` : '');
        });
        notify('Transfer Schedule · daily check', 'Still watching. Open schedules right now:\n' + lines.join('\n'), 2, 'calendar');
        GM_setValue('summaryDay', today);
      }
    }
    saveJSON('err', es);
    GM_setValue('lastCheckAt', Date.now());   // 6.7: "last" = last finished check, even if a site failed (was: only when all sites worked)
    log('check finished' + (errors.length ? ', ' + errors.length + ' site' + (errors.length > 1 ? 's' : '') + ' failed' : ', all sites ok'));
    return 'done';
  }

  // "check" button: run a check now instead of waiting for the next automatic one.
  // Still never runs from :59:30 to :01:00 around the 8 AM - 2 PM VTO drops - it waits and starts after :01 by itself.
  let checking = false;
  function checkNow() {
    if (!employeeId) { setStatus('err', 'open the Transfer page once first (in a second tab)'); return; }
    if (checking || GM_getValue('running', 0) > Date.now() - 3 * 60 * 1000) { setStatus('ok', 'already checking…'); return; }
    GM_setValue('nextDue', 0);
    if (inQuietWindow(CHECK_LEAD_SEC)) { setStatus('ok', 'paused for VTO - will check after :01'); return; }
    tick();
  }

  async function tick() {
    if (!employeeId) { render(); return; }
    if (inQuietWindow(CHECK_LEAD_SEC)) { render(); return; }
    if (checking || Date.now() < GM_getValue('nextDue', 0)) return;
    GM_setValue('nextDue', Date.now() + 3 * 60 * 1000);
    GM_setValue('running', Date.now());
    checking = true;
    render();
    let result = 'done';
    try { result = await runCheck(); } catch (e) { setStatus('err', e.message); log('!! check stopped: ' + e.message); }
    checking = false;
    GM_setValue('running', 0);
    GM_setValue('nextDue', result === 'quiet'
      ? Date.now() + 60 * 1000
      : Date.now() + (INTERVAL_MIN + (Math.random() * 10 - 5)) * 60 * 1000);
    if (result === 'done' && loadJSON('err', { fails: 0 }).fails === 0) setStatus('ok', '');   // "last" already shows the time
    render();
  }

  // ================= HIGHLIGHT MATCHES ON AMAZON'S TRANSFER PAGE =================
  // Only on /transfers pages (never the VTO page). Reads each schedule card's text (time, work days, hours,
  // full/part/flex, OT day), runs the same rules as the alerts, and marks the card. Sends nothing to Amazon.
  const ON_TRANSFERS = /^\/(m\/)?transfers/.test(location.pathname);
  const DAY3 = { Sun: 'SUNDAY', Mon: 'MONDAY', Tue: 'TUESDAY', Wed: 'WEDNESDAY', Thu: 'THURSDAY', Fri: 'FRIDAY', Sat: 'SATURDAY' };
  const TIME_RE = /(\d{1,2}):(\d{2})\s*([AP])M\s*[-\u2013]\s*(\d{1,2}):(\d{2})\s*([AP])M/i;
  const to24 = (h, m, ap) => String((+h % 12) + (/p/i.test(ap) ? 12 : 0)).padStart(2, '0') + ':' + m;
  const shown = el => !!(el && (el.offsetParent || (el.getClientRects && el.getClientRects().length)));

  function findCards() {
    const cards = new Set();
    document.querySelectorAll('button, [role="button"], a').forEach(b => {
      if (!/^\s*Apply\s*$/i.test(b.innerText || b.textContent || '') || !shown(b) || (box && box.contains(b))) return;
      let n = b.parentElement;
      for (let i = 0; i < 10 && n && n !== document.body; i++, n = n.parentElement) {
        const t = n.innerText || '';
        // a card shows a time range ("10:00 AM - 8:30 PM") or only a start time ("5:15 AM"), or is flex
        if (/\d{1,2}:\d{2}\s*[AP]M/i.test(t) || /Flexible Schedule|Flex-time/i.test(t)) {
          // stop at the card: it holds exactly one Apply button
          const applies = Array.from(n.querySelectorAll('button, [role="button"], a')).filter(x => /^\s*Apply\s*$/i.test(x.innerText || ''));
          if (applies.length === 1) cards.add(n);
          break;
        }
      }
    });
    return Array.from(cards);
  }

  // card text -> the same shape as Amazon's data, so evaluate() can judge it
  function cardToJob(text) {
    const flex = /Flexible Schedule|Flex-time/i.test(text);
    const type = flex ? 'FLEX_PART_TIME' : /Part-time/i.test(text) ? 'PART_TIME' : /Full-time/i.test(text) ? 'FULL_TIME' : '';
    let days = [], start = '', end = '';
    const tm = text.match(TIME_RE);
    const lm = text.match(/(\d+)\s*hrs?(?:\s*(\d+)\s*mins?)?\s*shift/i);
    const len = lm ? +lm[1] + (lm[2] ? +lm[2] / 60 : 0) : 0;
    if (tm) { start = to24(tm[1], tm[2], tm[3]); end = to24(tm[4], tm[5], tm[6]); }
    else {
      // some cards show only the start time (e.g. "5:15 AM"): end = start + shift length
      const one = text.match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
      if (one && len) {
        start = to24(one[1], one[2], one[3]);
        const e = (toMin(start) + Math.round(len * 60)) % 1440;
        end = String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0');
      }
    }
    const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
    const wi = lines.findIndex(x => /^Work days$/i.test(x));
    if (wi > -1 && lines[wi + 1]) days = (lines[wi + 1].match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g) || []).map(d => DAY3[d]);
    const otm = text.match(/OT Days?:\s*([A-Za-z, ]+)/i);
    const ot = otm ? (otm[1].match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g) || []).map(d => ({ day: DAY3[d] })) : [];
    return {
      job: {
        scheduleClass: flex ? 'FLEXIBLE' : 'STANDARD_RECURRING',
        scheduleMetadata: [{ type, shiftType: 'DAY', averageShiftLength: len,
          normalWorkingDays: days.map(d => ({ day: d, startTime: start, endTime: end })), overtimeDays: ot }],
      },
      ok: flex || (!!start && days.length > 0),        // enough text to judge
      noSpots: /No spots/i.test(text),
    };
  }

  let hlPill = null, hlTargets = [], hlIndex = 0;
  function markCards() {
    const cards = findCards();
    hlTargets = [];
    cards.forEach(card => {
      const text = card.innerText || '';
      const sig = text.length + ':' + text.slice(0, 80);
      const r = cardToJob(text);
      if (!r.ok) return;
      const ev = evaluate(r.job);
      if (ev.match) hlTargets.push(card);
      if (card.getAttribute('data-tw') === sig) return;     // already marked, unchanged
      card.setAttribute('data-tw', sig);
      const old = card.querySelector(':scope > .tw-badge'); if (old) old.remove();
      const badge = document.createElement('div');
      badge.className = 'tw-badge';
      badge.style.cssText = 'font:700 13px ' + FONT + ';margin:0 0 6px 0;';
      if (ev.match) {
        card.style.outline = '2px solid ' + C.green; card.style.outlineOffset = '-2px'; card.style.opacity = '';
        badge.style.color = C.green;
        badge.textContent = STAR + ' MATCH' + (r.noSpots ? '  (no spots right now)' : '');
      } else {
        card.style.outline = ''; card.style.opacity = '';   // not dimmed: you can still apply to any card
        badge.style.color = C.pink;
        badge.textContent = '✗ ' + ev.reasons.join(', ');
      }
      card.insertBefore(badge, card.firstChild);
    });
    // counter pill: "★ 2 matches  next ↓" (top right); click jumps to the next match
    if (!hlPill) {
      hlPill = document.createElement('div');
      hlPill.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483646;background:' + C.bg + ';color:' + C.text + ';font:700 14px ' + FONT + ';border:1px solid ' + C.green + ';border-radius:8px;padding:6px 12px;cursor:pointer;box-shadow:0 2px 12px ' + C.shadow + ';';
      hlPill.addEventListener('click', () => {
        if (!hlTargets.length) return;
        hlIndex = hlIndex % hlTargets.length;
        hlTargets[hlIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        hlIndex++;
      });
      document.body.appendChild(hlPill);
    }
    const total = cards.length;
    hlPill.style.display = total ? 'block' : 'none';
    hlPill.style.borderColor = hlTargets.length ? C.green : C.gray;
    hlPill.textContent = hlTargets.length
      ? STAR + ' ' + hlTargets.length + ' match' + (hlTargets.length > 1 ? 'es' : '') + ' of ' + total + '   next ↓'
      : 'no matches (' + total + ' schedules)';
  }

  function startHighlighter() {
    if (!ON_TRANSFERS || !IS_TOP) return;
    let pending = false;
    const run = () => { pending = false; try { markCards(); } catch (e) {} };
    new MutationObserver(recs => {
      if (pending) return;
      if (recs.every(r => (box && box.contains(r.target)) || (hlPill && hlPill.contains(r.target)) ||
        (r.target.classList && r.target.classList.contains('tw-badge')))) return;
      pending = true; setTimeout(run, 400);
    }).observe(document.body, { childList: true, subtree: true });
    run();
  }

  function start() {
    if (!GM_getValue('v2init', false)) { GM_setValue('nextDue', 0); GM_setValue('v2init', true); }
    // After installing a new version, check right away so the box fills in.
    if (GM_getValue('lastVer', '') !== VERSION) { GM_setValue('nextDue', 0); GM_setValue('lastVer', VERSION); }
    buildBox();
    startHighlighter();
    setTimeout(tick, 5000);
    setInterval(tick, 30000);
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
