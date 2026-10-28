// ==UserScript==
// @name         VTO Auto Accept
// @namespace    martin.vto
// @version      4.65
// @updateURL    https://raw.githubusercontent.com/nauht0205/my-scripts/main/mac/vto-auto-accept.user.js
// @downloadURL  https://raw.githubusercontent.com/nauht0205/my-scripts/main/mac/vto-auto-accept.user.js
// @description  (Mac) Watches A to Z VTO in the background, accepts open VTO directly one at a time, night shift (8:30 PM-12:30 AM) first, then soonest date (fast checks, extra-fast :59:59-:00:05 and a :59:50 refresh for the 8 AM-2 PM :00 drops, reads the page's own list), never clicks to accept, alias auto sign-in, passkey reset button, clear status box
// @match        https://atoz.amazon.work/*
// @match        https://atoz-login.amazon.work/*
// @match        https://atozworkforce.idprism-auth.amazon.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__vtoScriptLoaded) return;
  window.__vtoScriptLoaded = true;

  /* The sign-in page (atoz-login.amazon.work) and the VTO page (atoz.amazon.work) cannot read each other's
     localStorage, so the two small facts they share go in a cookie on amazon.work that both can read:
     vtoHb = last good VTO check, vtoLogin = "first seen|last seen" of the sign-in page. */
  function setShared(name, val) {
    try { document.cookie = name + '=' + encodeURIComponent(val) + '; domain=amazon.work; path=/; max-age=2592000; secure; samesite=lax'; } catch (e) {}
  }
  function getShared(name) {
    try { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }

  /* ================= YOUR SETTINGS ================= */
  const AUTO_SIGN_IN = true;   // on the sign-in page: type your alias and continue by itself (never a password)
  const MY_ALIAS = '';         // your alias; leave '' and the script learns it the next time you type it yourself


  // 4.38: page buttons only; the local launcher supplies the virtual passkey.
  // Each button is clicked at most once per document, with at most 3 actions.
  const loginClicked = new WeakSet();
  let loginActionCount = 0, loginActionAt = 0;
  function loginButtonStep(expectedAlias) {
    if (!AUTO_SIGN_IN || loginActionCount >= 3 || Date.now() - loginActionAt < 5000) return false;
    const visible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if ([...document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"]')].some(visible)) return false;
    if ([...document.querySelectorAll('[role="alert"]')].some(el => visible(el) && /failed|error|too many|try again|invalid/i.test(el.textContent))) return false;
    for (const b of document.querySelectorAll('button, input[type="submit"], [role="button"]')) {
      if (!visible(b) || b.disabled || b.getAttribute('aria-disabled') === 'true' || loginClicked.has(b)) continue;
      const text = String(b.innerText || b.value || b.textContent || '').replace(/\s+/g, ' ').trim();
      const next = /^continue as\s+(.+)$/i.exec(text);
      const passkey = /^sign\s*in with (?:your |a )?passkey$/i.test(text);
      if (!passkey && !next) continue;
      if (next && expectedAlias && next[1].trim().toLowerCase() !== expectedAlias.toLowerCase()) continue;
      loginClicked.add(b); loginActionCount++; loginActionAt = Date.now();
      b.click();
      return true;
    }
    return false;
  }
  if (location.hostname === 'atozworkforce.idprism-auth.amazon.com') {
    // Account management and logout pages are deliberately outside this helper.
    if (/^\/(?:account|logout)(?:\/|$)/i.test(location.pathname)) return;
    setInterval(() => { try { loginButtonStep(MY_ALIAS); } catch (_) {} }, 500);
    return;
  }

  if (location.hostname === 'atoz-login.amazon.work') { loginPageMode(); return; }
  // A to Z pages other than VTO: right after a sign-in A to Z lands on its home page, so go straight to the VTO page.
  // Only within 12 hours of the sign-in page (4.25: was 5 minutes - a passkey finished hours later landed on home), and only once;
  // reaching the VTO page clears it, so any other time you can use A to Z normally.
  if (!/^\/voluntary_time_off/.test(location.pathname)) {
    const go = parseInt(getShared('vtoGoVto') || '0', 10);
    if (go && Date.now() - go < 12 * 3600000) { setShared('vtoGoVto', '0'); location.replace('https://atoz.amazon.work/voluntary_time_off'); }
    return;
  }

  /* ================= LOGIN PAGE MODE ================= */
  // Runs only on the sign-in page. It keeps a small record of when this page first appeared (4.57: no red banner or beep here any more),
  // and (AUTO_SIGN_IN) types your alias and continues - never a password; a passkey is always left to you.
  function loginPageMode() {
    const KEY = 'vtoLoginWatch';
    const MERGE_MS = 6 * 3600 * 1000;   // same sign-out if this page was seen again within 6 hours
    const t0 = Date.now();
    let st = null;
    try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    // a new sign-out if the VTO page had a good check after this page was last seen (you were logged in since)
    const vtoHb = parseInt(getShared('vtoHb') || '0', 10);
    if (!st || !st.since || !st.lastSeen || t0 - st.lastSeen > MERGE_MS || vtoHb > st.lastSeen) {
      st = { since: t0, lastSeen: t0, loads: 0 };
      // how this sign-out happened (worked out once, when this sign-in page first appears)
      const loginAt = parseInt(getShared('vtoSince') || '0', 10);
      const manualAt0 = parseInt(getShared('vtoManual') || '0', 10);
      const manual = manualAt0 > 0 && manualAt0 > vtoHb - 60000;
      // Amazon sent the open VTO page here: that page noted "leaving" a few seconds ago, right after a good check.
      // After a PC restart or crash the VTO page never got to note that, so it is not counted as Amazon.
      const left = parseInt(getShared('vtoLeft') || '0', 10);
      // ...and (Chrome 102+) that page really navigated away: closing Chrome or the tab is not a navigation
      const nav = parseInt(getShared('vtoNav') || '0', 10);
      const navKnown = getShared('vtoNavApi') === '1';
      const sentHere = left && t0 - left < 15000 && left >= vtoHb - 10000 && (!navKnown || (nav && nav <= left + 1000 && left - nav < 15000));
      // 4.25: you pressed "reset passkey" in the VTO box a moment ago: sign in again with your alias (not a sign-out to stay out of)
      const resetAt0 = parseInt(getShared('vtoReset') || '0', 10);
      if (resetAt0 && t0 - resetAt0 < 600000 && t0 >= resetAt0) st.kind = 'reset';
      else if (manual) st.kind = 'manual';
      else if (vtoHb && t0 - vtoHb < 180000 && sentHere) { st.kind = 'amazon'; if (loginAt && loginAt < t0) st.loginAt = loginAt; }
      else st.kind = 'closed';
    }
    st.loads = (st.loads || 0) + 1;
    function save() {
      st.lastSeen = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
      setShared('vtoLogin', st.since + '|' + st.lastSeen + '|' + (st.retried || 0) + '|' + (st.kind || '') + '|' + (st.userAt || 0) + '|' + (st.pkAt || 0) + '|' + (st.pwAt || 0) + '|' + (st.pkOffer || 0) + '|' + (st.autoAt || 0) + '|' + (st.wokeAt || 0));
      if (st.kind !== 'manual') setShared('vtoGoVto', st.lastSeen);   // after signing in, A to Z's home page sends you to VTO
    }
    // sign-in method (copy only): note when this page asks Chrome for your passkey, or shows a password box.
    // The script never sees or touches the passkey itself (Windows Hello / Touch ID handles that).
    try {
      const cred = navigator.credentials;
      if (cred && cred.get) {
        const og = cred.get.bind(cred);
        cred.get = function (o) {
          try {
            if (o && o.publicKey) {
              if (o.mediation === 'conditional') { if (!st.pkOffer) { st.pkOffer = Date.now(); save(); } }   // passive passkey suggestion
              else { st.pkAt = Date.now(); save(); }                                                       // real passkey prompt
            }
          } catch (e) {}
          return og(o);
        };
      }
    } catch (e) {}
    setInterval(function () {
      try { if (!st.pwAt) { const pw = document.querySelector('input[type="password"]'); if (pw && (pw.offsetParent || (pw.getClientRects && pw.getClientRects().length))) { st.pwAt = Date.now(); save(); } } } catch (e) {}
    }, 500);
    // any real click / key press / touch on the sign-in page = YOU signed in (the script never types or clicks here),
    // so it can never be called an automatic sign-in
    ['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach(function (n) {
      window.addEventListener(n, function (e) { if (e.isTrusted) { st.userAt = Date.now(); save(); } }, true);
    });
    /* ---- automatic sign-in: your alias only ---- */
    const ALIAS_KEY = 'vtoAlias';
    function shown(el) { return !!(el && (el.offsetParent || (el.getClientRects && el.getClientRects().length))); }
    function pwShown() { const ps = document.querySelectorAll('input[type="password"]'); for (let i = 0; i < ps.length; i++) if (shown(ps[i])) return true; return false; }
    function aliasBox() {
      const list = document.querySelectorAll('input');
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        const t = String(el.getAttribute('type') || 'text').toLowerCase();
        if (['text', 'email', 'tel'].indexOf(t) < 0) continue;
        if (/pass|otp|code|search|pin/i.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || ''))) continue;
        if (el.disabled || el.readOnly || !shown(el)) continue;
        return el;
      }
      return null;
    }
    const okAlias = (v) => /^[A-Za-z0-9._@-]{2,64}$/.test(v);
    function savedAlias() { if (okAlias(MY_ALIAS)) return MY_ALIAS; try { const v = localStorage.getItem(ALIAS_KEY) || ''; return okAlias(v) ? v : ''; } catch (e) { return ''; } }
    // learn the alias when YOU continue with it (Enter / click / submit) - only from the alias box, never while a password box shows
    function learnAlias(e) {
      try {
        if (!e.isTrusted || pwShown()) return;
        if (e.type === 'keydown' && e.key !== 'Enter') return;
        const b = aliasBox(); const v = b ? String(b.value || '').trim() : '';
        if (okAlias(v)) localStorage.setItem(ALIAS_KEY, v);
      } catch (err) {}
    }
    ['keydown', 'pointerdown', 'submit'].forEach(function (n) { window.addEventListener(n, learnAlias, true); });
    function setVal(el, v) {
      try { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); } catch (e) { el.value = v; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function continueBtn(box) {
      const scope = (box && box.form) || document;
      const bs = scope.querySelectorAll('button, input[type="submit"], [role="button"]');
      let sub = null, named = null;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i]; if (!shown(b) || b.disabled) continue;
        const t = String(b.innerText || b.value || b.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(continue|next|sign ?in|log ?in|submit)\b/i.test(t)) { named = named || b; }
        else if (!sub && String(b.getAttribute('type') || '').toLowerCase() === 'submit' && !/passkey|security key|help|forgot|back|cancel/i.test(t)) sub = b;
      }
      return named || sub;
    }
    function autoSignIn() {
      if (!AUTO_SIGN_IN || st.kind === 'manual') return;                 // you signed out yourself: stay out
      if (st.userAt && st.userAt >= st.since) return;                    // you are signing in yourself
      if ((st.autoTries || 0) >= 2 || (st.autoAt && Date.now() - st.autoAt < 15000)) return;
      const alias = savedAlias(); if (pwShown()) return;
      const box = aliasBox();
      if (!box) {
        if (loginButtonStep(alias)) { st.autoAt = Date.now(); save(); setShared('vtoAutoSign', st.autoAt); }
        return;
      }
      if (!alias) return;
      if (String(box.value || '').trim() !== alias) setVal(box, alias);
      st.autoAt = Date.now(); st.autoTries = (st.autoTries || 0) + 1; save();
      setShared('vtoAutoSign', st.autoAt);
      setTimeout(function () {
        try {
          const b = continueBtn(box);
          if (b) b.click();
          else if (box.form && box.form.requestSubmit) box.form.requestSubmit();
          else ['keydown', 'keypress', 'keyup'].forEach(function (n) { box.dispatchEvent(new KeyboardEvent(n, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); });
        } catch (e) {}
      }, 120);
    }
    setInterval(function () { try { autoSignIn(); } catch (e) {} }, 250);
    // 4.27: the Mac woke from sleep while this page was open (timers stop while it sleeps; a 2+ min jump = asleep, as on the VTO page). With the lid closed it wakes
    // for a few seconds, the alias gets typed, then it sleeps again - so a slow VTO page after that is sleep, not a passkey.
    let loginTick = Date.now();
    setInterval(function () { try { const n = Date.now(); if (n - loginTick > 120000) { st.wokeAt = n; save(); } loginTick = n; } catch (e) {} }, 1000);
    function recheckManual() {
      // the alert script may pass on a Sign out you clicked on the passkey page a moment after this page opens
      if (st.kind === 'amazon' && parseInt(getShared('vtoManual') || '0', 10) > Math.max(0, vtoHb - 60000)) { st.kind = 'manual'; delete st.loginAt; }
    }
    // 4.57: the red sign-in banner, the tab title and the 15 s beep are gone (the virtual passkey signs you back in);
    // the sign-out record above is still kept up to date for the VTO box.
    setInterval(function () { try { recheckManual(); save(); } catch (e) {} }, 1000);
    save();
  }

  /* ================= SETTINGS ================= */
  // 4.51 (Martin, 10/27): every SMS-9999 = Amazon busy (retry after 0.3 s, never a failed try); no backup clicking and none
  // of its page refreshes; failed / full VTOs still shown open are retried every 1 s; no page refresh after a win;
  // night shift VTOs (exactly 8:30 PM-12:30 AM) are accepted first;
  // "session reset at ~" (sign-in + 10 h) on the signed in line.
  // 4.52 (Martin, 10/27): the script never clicks to accept: the review pop-up "Accept VTO" and the card "Accept"
  // clicks are gone (Martin no longer accepts by hand). Sign-in, "Stay Logged In" and "OK" clicks stay.
  // 4.54: the before-:00 idea (#3) is removed: Martin's list leaves out VTOs that are not open yet, and the fast
  // :00 checks already cover the drop. No "listed, not open yet" line, no "listed earlier" on OPEN VTO FOUND.
  // 4.55: "check speed" in copy: how long Amazon takes to answer the list checks (to compare the Mac and PC connections).
  // 4.56: the seconds on a VTO events "ACCEPTED (direct, Ns)" line = from sending that accept to Amazon's answer
  // (was from first seeing the VTO open, which added the wait for earlier accepts in a multi-VTO drop).
  // 4.57 (Martin, 10/28): the red banner on the sign-in page and its beep are removed.
  // 4.58 (Martin, 10/28): the orange SIGNED OUT bar, its box line, the SIGNED OUT tab title and its beep on the VTO page are removed.
  // 4.59 (Martin, 10/28): "log out" button word is orange. New "Priority:" button under Critical Alert:
  // Night Shift (dark blue) = night shift VTOs first, then soonest; Normal (orange) = soonest date/time first only.
  // 4.60 (Martin, 10/28): new box colors: darker navy background, medium blue header bar and section names, off-white header text,
  // white header buttons with blue words, missed / full in red (#f82d2d), errors stay orange, white time on last errors and VTO events lines.
  // 4.61 (Martin, 10/28): the time on log lines stays white too; only the text after it takes the line's color.
  // 4.62 (Martin, 10/28): new sounds at 90% volume (was 15%): accepted = fanfare (W3), accepting = double blips that
  //   keep going until Amazon answers and stop the moment it does (A3 long), missed = two falling notes (M4).
  // 4.63 (Martin, 10/28): all box text off-white (#ece8df, like Transfer Schedule); section names sky blue (#60a5fa).
  // 4.64 (Martin, 10/28): Authentication Session: "session ended (10h 7m)" in pink (was "Amazon signed you out", orange); "Auto (3s)" in teal like launcher opened (was "signed in automatically", cyan).
  // 4.65 (Martin, 10/28): "you clicked log out" and "you signed out inside A to Z" are purple (were orange).
  const VERSION = '4.65';
  const EMPLOYEE_ID = '203782037';
  const API_URL = 'https://atoz-apps.amazon.work/apis/ScheduleManagementAssociateGateway/graphql?employeeId=' + EMPLOYEE_ID;
  const DIRECT_ACCEPT = true;      // send AcceptVto directly (skips the click chain)
  const API_POLL_MS = 300;         // background check ~3 per second, always
  const API_POLL_FAST_MS = 200;    // ~5 per second around :00 (multi-VTO drops)
  const API_POLL_BURST_MS = 100;   // 4.24: ~10 per second from :59:59 to :00:05, the seconds a :00 drop opens (10/16: opened ~1:00:01.0, seen 1:00:01.47)
  const BURST_MAX_IN_FLIGHT = 4;   // 4.24: up to 4 checks waiting for Amazon at once in that window (2 the rest of the time)
  const BURST_SLOW_MS = 2000;      // 4.24: a check that fails or takes over 2 s in that window = Amazon slowing down -> back to normal speed for this hour
  const SAFETY_RELOAD_MS = 900000; // safety refresh every 15 minutes (fewer 1-2 s blind gaps; the 8 s stall refresh still reloads right away if checks stop)
  const POLL_TIMEOUT_MS = 3000;    // give up on one list check after 3s so the next check can go out (was 6s)
  const FALLBACK_MS = 8000;        // reload if no good check for this long
  const MAX_DIRECT_HOUR = 240;     // max direct accept RETRIES per hour (first tries on new VTOs never count and are never blocked). 4.51: was 120 (clicking used to take over)
  const PASSKEY_MIN_MS = 4500;   // 4.27: was 8 s - a Touch ID under 8 s was missed (remembered sign-ins take 0-3 s). 4.21: sign-in took more than 8 s after the alias = passkey (remembered takes 2-3 s; was 15 s, a 14 s passkey was missed)
  const RESET_URL = 'https://atozworkforce.idprism-auth.amazon.com/logout#vtoReset';   // 4.25: Amazon's full sign-out page (seen in your history 10/16)
  const ONE_AT_A_TIME_WAIT = 6000;  // accepts go one at a time (Amazon handles one at a time); the next goes the instant the previous gets an answer.
                                   // 4.24: was 2 s. The 2 s "test" accept always got SMS-9999 (busy) and could never win, because Amazon takes
                                   // 1.5-5.6 s to answer an accept. Now the next one waits for the answer, up to 6 s (an accept is given up after 10 s).
                                   // Amazon "busy" = it is still working on the first, so wait for that answer (then go at once).
  const DIRECT_COOLDOWN = 1000;    // after "full" (list not caught up yet) or 3 failed tries: try again every 1 s while the list shows it open (4.51: was 2 s)
  const RETRY_GAP = 800;           // wait before retrying a rejected accept / network error
  const BUSY_GAP = 300;            // 4.51: after Amazon says "busy" (SMS-9999), nothing is sent for 0.3 s (busy blocks every VTO, not just that one)
  const BUSY_MAX = 12;             // such rejections are not counted as tries, but stop after this many
  const RETRY_MAX = 3;             // network-error retries before using clicks
  const MAX_TRIES = 2;             // mismatch reloads (list says open, no Accept button)
  const ACCEPT_QUERY = 'mutation AcceptVto($input: DropShiftInput!) { dropShift(input: $input) }';
  // 4.24: Amazon's reason codes, matched against the list's own reasons (pre-drop test, 10/16):
  //   SMS-2000 = AssociateAccepted (already yours), SMS-2001 = ShiftOpportunityCapacityMet (full),
  //   SMS-2002 = ShiftOpportunityExpired, SMS-9999 = refused while another of your accepts is waiting (busy)
  function smsCode(t) { const m = String(t || '').match(/SMS-\d{4}/g); return m ? m[m.length - 1] : ''; }

  const origFetch = window.fetch.bind(window);

  /* ================= STORAGE HELPERS ================= */
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };

  /* ================= STATE ================= */
  let template = ls.get('vtoTemplate', null);   // the page's own VtoPage request body
  let templateSrc = template ? 'saved' : 'none';
  let capturedLogged = false;
  let lastPollOK = Date.now();
  let timerMode = 'normal';   // 'worker' once the background worker is confirmed ticking
  let lastError = '';
  let pollsInFlight = 0;          // up to 2 list checks at the same time (each waits ~0.5 s for Amazon)
  let pollSeq = 0, pollDoneSeq = 0;
  let checks = 0;
  let listCount = 0;
  let openCount = 0;
  let signedOutFlag = false;
  let reloading = false;
  let pendingReload = null;
  let noReloadUntil = 0;
  let lastDirectSent = 0;
  let clickedAcceptVtoAt = 0;
  // 4.51: no backup clicking. A click sends Amazon the same accept request, so it could not win where direct accept
  // failed, and it needed page refreshes (1-3 s blind). Direct accept keeps retrying instead.
  let reviewText = '', cardText = '';   // which VTO the review pop-up / card is about, e.g. "Wed, Oct 14, 2:30pm - 6:30pm"
  let missingSince = 0;
  let limitLoggedAt = 0;
  let origTitle = '';
  const inFlight = new Set();
  const inFlightAt = {};   // id -> when its accept was sent
  let lastBusyAt = 0;      // last time Amazon answered "busy" (= it is still working on an earlier accept)
  const lastClick = {};

  /* ================= LOGGING ================= */
  const ts = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });   // 01:05:09 AM
  const today = () => new Date().toLocaleDateString();

  // VTO events (found / sending / accepted / lost / accept network errors) go to their own list so
  // the 2-minute "Running" lines can never push them out. They are not repeated in the normal log.
  const EVENT_RE = /^(\* OPEN VTO FOUND|-> sending accept|OK ACCEPTED|X MISSED|!! network error|!! accept rejected|!! accept failed|clicked Accept)/;
  function logAction(msg) {
    if (EVENT_RE.test(msg)) {
      const e = ls.get('vtoEvents', []);
      e.push(new Date().toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' ' + msg);
      while (e.length > 150) e.shift();
      ls.set('vtoEvents', e);
      return;
    }
    const a = ls.get('vtoLog', []);
    a.push(ts() + ' ' + msg);
    while (a.length > 50) a.shift();
    ls.set('vtoLog', a);
  }
  // 4.41: a log line stamped with a given time (Mac asleep: when it fell asleep)
  // The line goes in its place by time, so the box log (which reads the days from the order) stays in order.
  function logAt(t, msg) {
    const a = ls.get('vtoLog', []);
    let k = a.length, prev = Date.now() + 60000;
    for (let i = a.length - 1; i >= 0; i--) {   // each line's real time, newest first (a time later than the line after it = the day before)
      const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\s*([AP]M))?/i.exec(String(a[i])); if (!m) break;
      let h = +m[1]; if (m[4]) { h = h % 12; if (/p/i.test(m[4])) h += 12; }
      const d = new Date(prev); d.setHours(h, +m[2], +m[3], 999);
      if (d.getTime() > prev) d.setDate(d.getDate() - 1);
      prev = d.getTime();
      if (prev <= t) break;
      k = i;
    }
    a.splice(k, 0, new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + msg);
    while (a.length > 50) a.shift();
    ls.set('vtoLog', a);
  }
  function logReload(reason) {
    const a = ls.get('vtoReloads', []);
    a.push(ts() + ' ' + reason);
    while (a.length > 10) a.shift();
    ls.set('vtoReloads', a);
  }
  function stats() {
    let s = ls.get('vtoStats', null);
    if (!s || s.day !== today()) s = { day: today(), accepted: 0, lost: 0, errors: 0 };
    return s;
  }
  function bump(k) { const s = stats(); s[k]++; ls.set('vtoStats', s); }
  function setLast(kind, text) { ls.set('vtoLast', { t: Date.now(), kind: kind, text: text }); }
  function addAccepted(text, how) {
    const a = ls.get('vtoAccepted', []);
    a.push({ day: today(), text: ts() + ' ' + how + ': ' + text });
    while (a.length > 10) a.shift();
    ls.set('vtoAccepted', a);
  }
  // one MISSED line for you; how it was found out + Amazon's text go to "missed details" (in copy)
  function missed(desc, how, detail) {
    desc = String(desc || 'VTO (details not found)').replace(/\s*\[[^\]]*\]\s*$/, '');
    bump('lost');
    setLast('lost', 'MISSED: ' + desc);
    logAction('X MISSED: ' + desc);
    const m = ls.get('vtoMisses', []);
    m.push(new Date().toLocaleString() + ' ' + desc + '\n  how: ' + how + (detail ? '\n  Amazon: ' + String(detail).replace(/\s+/g, ' ').slice(0, 1500) : ''));
    while (m.length > 30) m.shift();
    ls.set('vtoMisses', m);
    addResult('missed', desc, '', null);
    soundMiss();
  }
  /* ================= RESULTS + ERRORS (short lines in the box, details in "copy") ================= */
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function fixTimes(x) { return String(x).replace(/(\d{1,2}:\d{2})\s*([ap])m/gi, function (_, a, b) { return a + ' ' + b.toUpperCase() + 'M'; }).replace(/\s*[-–]\s*/g, ' - '); }
  // every VTO written the same way: "Thu 10/15, 2:30 PM - 6:30 PM"
  function normVto(t) {
    t = String(t || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    let m = /^(\w{3}),\s*(\d{1,2}\/\d{1,2}),\s*(.*)$/.exec(t);
    if (m) return m[1] + ' ' + m[2] + ', ' + fixTimes(m[3]);
    m = /^(\w{3})[a-z]*,?\s+([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),?\s*(.*)$/.exec(t);
    if (m && MONTHS[m[2].toLowerCase()]) return m[1] + ' ' + MONTHS[m[2].toLowerCase()] + '/' + (+m[3]) + ', ' + fixTimes(m[4]);
    return fixTimes(t) || 'VTO (details not found)';
  }
  function addResult(kind, desc, how, since) {
    const r = ls.get('vtoResults', []);
    r.push({ t: Date.now(), day: today(), kind: kind, vto: normVto(desc), how: how || '', secs: since ? Math.round((Date.now() - since) / 100) / 10 : null });
    while (r.length > 200) r.shift();
    ls.set('vtoResults', r);
  }
  // an error = something that went wrong and could have cost a VTO (counted once per problem, not per retry)
  function addError(what, vto, detail) {
    bump('errors');
    const e = ls.get('vtoErrors', []);
    e.push({ t: Date.now(), day: today(), what: what, vto: vto ? normVto(vto) : '', detail: detail ? String(detail).replace(/\s+/g, ' ').slice(0, 1500) : '' });
    while (e.length > 100) e.shift();
    ls.set('vtoErrors', e);
  }
  function errorOutcome(er) {
    if (er.vto) {
      const r = ls.get('vtoResults', []).filter(function (x) { return x.vto === er.vto && x.t >= er.t; })[0];
      if (r) return r.kind === 'ok' ? 'ACCEPTED' : 'MISSED';
      return Date.now() - er.t < 120000 ? 'retrying' : 'no result';
    }
    return (window.__lastPollT || 0) > er.t + 500 ? 'checks back' : 'still down';
  }
  const tShort = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(/^(\d):/, '0$1:');   // 04:35:00 PM
  // box only: "Tue 10/13, 2:30 PM - 6:30 PM" -> "Tue 10/13 2:30PM-6:30PM" (shift times themselves unchanged)
  const vtoShort = (v) => String(v || '').replace(/^(\w{3} \d+\/\d+),\s*/, '$1 ').replace(/\s+([AP]M)/g, '$1').replace(/\s*-\s*/g, '-');
  function resultLine(r) {
    const extra = r.kind === 'ok' ? ' (' + (r.how || '?') + (r.secs !== null && r.secs !== undefined ? ', ' + r.secs + 's' : '') + ')' : '';
    return tShort(r.t) + ' ' + (r.kind === 'ok' ? 'ACCEPTED' : 'MISSED') + ' ' + vtoShort(r.vto) + extra;   // 4.9: single spaces
  }
  function errorLine(er) {
    // 4.41: no internet = one line: start, end and how long ("-> still down" until it is back)
    if (er.what === 'no internet' && (er.until || er.from)) {
      const from = er.from || er.t;
      return tShort(from) + ' no internet ' + (er.until ? 'until ' + tShort(er.until) + ' (' + gapSpan(er.until - from) + ')' : '-> still down');
    }
    let out = errorOutcome(er);
    if (out === 'ACCEPTED') {
      const r = ls.get('vtoResults', []).filter(function (x) { return x.vto === er.vto && x.t >= er.t; })[0];
      const sec = r ? Math.max(0, Math.round((r.t - er.t) / 1000)) : null;
      if (sec !== null) out += ' (' + (sec < 60 ? sec + ' sec' : Math.round(sec / 60) + ' min') + ' later)';
    }
    return tShort(er.t) + ' ' + er.what + (er.vto ? ' ' + vtoShort(er.vto) : '') + ' -> ' + out;   // 4.9: single spaces
  }
  function gapSpan(ms) { const x = Math.max(0, Math.round(ms / 1000)); return x < 60 ? x + 's' : x < 3600 ? Math.floor(x / 60) + 'm ' + (x % 60) + 's' : Math.floor(x / 3600) + 'h ' + Math.floor((x % 3600) / 60) + 'm'; }
  // sign-out lines: "Sat 10/10  2:34 PM -> 2:47 PM (12m)  Amazon, session 10h 8m"
  function gapText(min) { min = Math.max(0, Math.round(min)); return min < 60 ? min + 'm' : Math.floor(min / 60) + 'h ' + (min % 60) + 'm'; }
  // reason tags: [401] red; everything else yellow. (Amazon gives no code here - it just sends you to the sign-in page.)
  // 4.12 In-N-Out line, columns lined up:
  //   Tue 10/13 [Closed]    4:40 AM (0h 25m) -> [Auto]     4:40 AM (10s)
  // sign-out codes: [Closed] you closed VTO Chrome and kept using the PC,
  //   [CutOff] VTO Chrome was cut off while open (crash, power loss, Windows Update, sleep) - orange,
  //   [401] Amazon signed you out (pink), [Network] internet dropped (orange) - others white
  // sign-in codes: [Auto] the script signed in with your alias (cyan), [Passkey] Amazon asked for your passkey (red),
  //   [Remembered] no sign-in page at all (white)
  // 4.15 colors: cyan [Auto], yellow [Closed], red [401] [Passkey], orange [CutOff] [Network], mint [Remembered]
  const TAG_COLOR = function (t) { return (t === '401' || t === 'Passkey') ? C_RED : (t === 'Auto' || t === 'Reset') ? C_CYAN : t === 'Closed' ? C_YEL : (t === 'Network' || t === 'CutOff') ? C_WARN : t === 'Remembered' ? C_MINT : C_TAG; };
  // older names -> the current codes
  const TAG_NAME = { SignedOut: 'Closed', SelfClosed: 'Closed', Asleep: 'CutOff', ShutDown: 'CutOff', NoInternet: 'Network', Manual: 'Auto', Extended: 'Auto' };
  const normTag = function (t) { return TAG_NAME[t] || t; };
  // 4.39: the scheduled restarts are gone (the virtual passkey signs you back in), so there is no [Renew] tag any more.
  function outTagFromText(r, h12, min, ampm) {
    r = String(r || '');
    if (/you signed out yourself/i.test(r)) return 'Closed';
    if (/Amazon signed you out|session likely expired|redirected|HTTP 40|unauthor|expired/i.test(r)) return '401';
    if (/login extended|page was closed/i.test(r)) return 'Closed';
    if (/no internet/i.test(r)) return 'Network';
    return 'CutOff';
  }
  const t0 = (t) => (t.length === 4 ? '0' + t : t);          // 2:34 -> 02:34
  // one stored line -> its columns (null if it is not a sign-out line)
  function signFields(raw) {
    raw = String(raw || '');
    const tags = / \| tags: (\w+)>(\w+)/.exec(raw);
    const sess = /session (\d+h \d+m)/.exec(raw);
    let m = /^(\w{3}), (\d+\/\d+), (\d+):(\d+):\d+ ([AP]M) SIGNED OUT - SIGNED IN (AUTOMATICALLY )?(?:(\w{3}), (\d+\/\d+), )?(\d+:\d+):\d+ ([AP]M) \((?:(\d+) min|(\d+)s) gap\) - (.*)$/.exec(raw);
    const f = { raw: raw };
    if (m) {
      f.inT = normTag(tags ? tags[2] : /PASSKEY/.test(raw) ? 'Passkey' : 'Auto');
      f.outT = normTag(tags ? tags[1] : outTagFromText(m[13], m[3], m[4], m[5]));   // older names -> CutOff
      f.inTime = (m[7] ? m[7] + ' ' : '') + t0(m[9]) + ' ' + m[10];   // 02:39 PM
      f.gap = '(' + (m[11] !== undefined ? gapText(+m[11]) : m[12] + 's') + ')';
    } else if ((m = /^(\w{3}), (\d+\/\d+), (\d+):(\d+):\d+ ([AP]M) SIGNED OUT: (.*)$/.exec(raw))) {
      f.outT = normTag(outTagFromText(m[6], m[3], m[4], m[5]));
    } else return null;
    f.date = m[1] + ' ' + m[2];
    f.outTime = t0(m[3] + ':' + m[4]) + ' ' + m[5];
    f.sess = sess ? '(' + sess[1] + ')' : '';
    return f;
  }
  // several lines with every column padded to the same width (monospace box)
  function signLines(raws) {
    const fs = raws.map(signFields);
    const w = { date: 0, outT: 0, outTime: 0, sess: 0, inT: 0, inTime: 0 };
    fs.forEach(function (f) {
      if (!f) return;
      w.date = Math.max(w.date, f.date.length); w.outT = Math.max(w.outT, f.outT.length + 2);
      w.outTime = Math.max(w.outTime, f.outTime.length); w.sess = Math.max(w.sess, f.sess.length);
      if (f.inT) { w.inT = Math.max(w.inT, f.inT.length + 2); w.inTime = Math.max(w.inTime, f.inTime.length); }
    });
    const R = function (x, n) { x = String(x); return ' '.repeat(Math.max(0, n - x.length)) + x; };   // right-align (times)
    const L = function (x, n) { x = String(x); return x + ' '.repeat(Math.max(0, n - x.length)); };   // left-align
    return fs.map(function (f, i) {
      if (!f) return { parts: [{ t: '  ' + String(raws[i]).slice(0, 90), c: C_BASE }] };
      const parts = [
        { t: '  ' + L(f.date, w.date) + ' ', c: C_BASE },
        { t: '[' + f.outT + ']', c: TAG_COLOR(f.outT) },
        { t: ' '.repeat(w.outT - f.outT.length - 2) + ' ' + R(f.outTime, w.outTime) + (w.sess ? ' ' + L(f.sess, w.sess) : '') + ' -> ', c: C_BASE }
      ];
      if (f.inT) {
        parts.push({ t: '[' + f.inT + ']', c: TAG_COLOR(f.inT) });
        parts.push({ t: ' '.repeat(w.inT - f.inT.length - 2) + ' ' + R(f.inTime, w.inTime) + ' ' + f.gap, c: C_BASE });
      } else parts.push({ t: 'still signed out', c: C_BASE });
      return { parts: parts };
    });
  }

  /* ================= SOUND ================= */
  // 4.62: Martin's picks from the VTO Sound Picker page (same sound engine), at 90% volume.
  // notes: [start ms, Hz, length ms, wave]
  const SOUND_VOL = 0.9;
  const SND_WIN = [[0, 523, 120, 'triangle'], [120, 659, 120, 'triangle'], [240, 784, 120, 'triangle'], [360, 1047, 520, 'triangle']];   // W3 fanfare
  const SND_MISS = [[0, 440, 180, 'square'], [220, 294, 380, 'square']];   // M4 down-down
  const SND_ACCEPTING = [0, 1, 2, 3, 4, 5, 6, 7].reduce(function (a, i) { return a.concat([[i * 380, 880, 60, 'square'], [i * 380 + 100, 880, 60, 'square']]); }, []);   // A3 long, up to 3 s
  function playNotes(notes) {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      const a = new C();
      const tame = { sine: 1, triangle: 0.9, square: 0.35, sawtooth: 0.35 };   // square waves sound louder at the same gain
      const base = a.currentTime + 0.02;
      let end = 0;
      notes.forEach(function (n) {
        const o = a.createOscillator(), g = a.createGain();
        const st = base + n[0] / 1000, en = st + n[2] / 1000, peak = SOUND_VOL * (tame[n[3]] || 1);
        o.type = n[3]; o.frequency.setValueAtTime(n[1], st);
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(peak, st + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, en);
        o.connect(g); g.connect(a.destination); o.start(st); o.stop(en + 0.05);
        end = Math.max(end, n[0] + n[2]);
      });
      setTimeout(function () { try { a.close(); } catch (e) {} }, end + 300);
      return a;
    } catch (e) { return null; }
  }
  let acceptingSound = null, resultSoundUntil = 0;
  function stopAcceptingSound() { if (acceptingSound) { try { acceptingSound.close(); } catch (e) {} acceptingSound = null; } }
  function soundAccepting() {
    // not over a result sound still playing (back-to-back accepts in a multi-VTO drop), and only one at a time
    if (acceptingSound || Date.now() < resultSoundUntil) return;
    acceptingSound = playNotes(SND_ACCEPTING);
    const mine = acceptingSound;
    setTimeout(function () { if (acceptingSound === mine) acceptingSound = null; }, 3200);
  }
  function soundResult(notes) { stopAcceptingSound(); resultSoundUntil = Date.now() + 1000; playNotes(notes); }
  function soundWin() { soundResult(SND_WIN); }
  function soundMiss() { soundResult(SND_MISS); }

  /* ================= CAPTURE THE PAGE'S OWN VtoPage REQUEST ================= */
  function saveTemplate(body, src) {
    if (body === template) return;
    template = body;
    templateSrc = src;
    ls.set('vtoTemplate', body);
    if (!capturedLogged) { capturedLogged = true; logAction('list request captured (' + src + ')'); }
  }
  const isGql = (u) => String(u || '').indexOf('ScheduleManagementAssociateGateway/graphql') > -1;
  // 4.10: accepts sent by the PAGE (backup clicking, or you clicking Accept). Direct accepts wait while one is
  // waiting for Amazon's answer, so the two never overlap (overlapping accepts got SMS-9999).
  let pageAccepts = 0, pageAcceptAt = 0;
  const isAcceptBody = (b) => typeof b === 'string' && (b.indexOf('"AcceptVto"') > -1 || b.indexOf('dropShift') > -1);
  function pageAcceptStart() { pageAccepts++; pageAcceptAt = Date.now(); }
  function pageAcceptEnd() {
    pageAccepts = Math.max(0, pageAccepts - 1);
    // the page's accept got its answer: a waiting direct retry can go at once
    if (!pageAccepts && DIRECT_ACCEPT && lastOpen.length && !signedOutFlag) setTimeout(function () { try { fireDirect(lastOpen); } catch (e) {} }, 0);
  }
  function pageAcceptBusy() {
    if (pageAccepts > 0 && Date.now() - pageAcceptAt < 10000) return true;   // stuck > 10 s: stop waiting for it
    return Date.now() - clickedAcceptVtoAt < 1500;   // "Accept VTO" was just clicked - its request may not have left yet
  }


  // The page asks Amazon for the VTO list itself (on load, and whenever it refreshes). Its answer is read the
  // moment it arrives, so an open VTO is accepted at once - not only when this script's own next check comes round.
  function onPageList(j) {
    try { if (j && j.data && !signedOutFlag) handleList(j, 'page data'); } catch (e) {}
  }
  window.fetch = function (input, init) {
    let isList = false;
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const body = init && typeof init.body === 'string' ? init.body : null;
      if (isGql(url) && body && body.indexOf('"VtoPage"') > -1) {
        saveTemplate(body, 'fetch'); isList = true;
      }
    } catch (e) {}
    let isAcc = false;
    try { const u0 = typeof input === 'string' ? input : (input && input.url) || ''; if (isGql(u0) && init && isAcceptBody(init.body)) { isAcc = true; pageAcceptStart(); } } catch (e) {}
    const pr = origFetch(input, init);
    if (isAcc) pr.then(function () { pageAcceptEnd(); }, function () { pageAcceptEnd(); });
    if (isList) pr.then(function (res) {
      try { res.clone().json().then(onPageList, function () {}); } catch (e) {}
    }, function () {});
    return pr;
  };
  const xOpen = XMLHttpRequest.prototype.open;
  const xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__vtoUrl = u; return xOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    try {
      if (isGql(this.__vtoUrl) && isAcceptBody(b)) {
        pageAcceptStart();
        let done = false; const end = function () { if (!done) { done = true; pageAcceptEnd(); } };
        this.addEventListener('loadend', end);
      }
    } catch (e) {}
    try {
      if (isGql(this.__vtoUrl) && typeof b === 'string' && b.indexOf('"VtoPage"') > -1) {
        saveTemplate(b, 'xhr');
        this.addEventListener('load', function () {
          try {
            onPageList(this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
          } catch (e) {}
        });
      }
    } catch (e) {}
    return xSend.apply(this, arguments);
  };

  /* ================= API HELPERS ================= */
  function uid() {
    try { return crypto.randomUUID(); } catch (e) { return Date.now() + '-' + Math.random().toString(16).slice(2); }
  }
  function hdrs() {
    return {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-atoz-client-id': 'SCHEDULE_MANAGEMENT_SERVICE',
      'x-atoz-client-request-id': uid()
    };
  }
  function collect(node, out, seen, depth) {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(function (n) { collect(n, out, seen, depth + 1); }); return; }
    if (node.type === 'VOLUNTARY_TIME_OFF' && 'eligibility' in node) out.push(node);
    Object.keys(node).forEach(function (k) { collect(node[k], out, seen, depth + 1); });
  }
  function getId(o) {
    const keys = ['shiftOpportunityId', 'opportunityId', 'id'];
    for (let i = 0; i < keys.length; i++) {
      if (typeof o[keys[i]] === 'string' && o[keys[i]]) return o[keys[i]];
    }
    const all = Object.keys(o);
    for (let i = 0; i < all.length; i++) {
      if (typeof o[all[i]] === 'string' && /^amzn\.ls\.opportunityid/i.test(o[all[i]])) return o[all[i]];
    }
    return null;
  }
  // Confirmed open rule: eligible AND unavailability is null
  // 4.24: when the VTO starts (ms), for "soonest date first"; unknown = last
  function vtoStart(o) {
    try { const t = Date.parse(o.shift.timeRange.start); if (!isNaN(t)) return t; } catch (e) {}
    return Number.MAX_SAFE_INTEGER;
  }
  // 4.51: Martin's night shift VTO, exactly 8:30 PM to 12:30 AM (local time)
  // (start and end are read the same way as the VTO times shown in the log)
  function isoTimes(o) {
    const iso = [];
    (function f(n, d) {
      if (!n || typeof n !== 'object' || d > 3) return;
      Object.keys(n).forEach(function (k) {
        if (iso.length >= 2) return;
        const v = n[k];
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) iso.push(v);
        else if (v && typeof v === 'object') f(v, d + 1);
      });
    })(o, 0);
    return iso;
  }
  function isNight(o) {
    try {
      const t = isoTimes(o);
      const a = new Date((o.shift && o.shift.timeRange && o.shift.timeRange.start) || t[0]);
      const b = new Date((o.shift && o.shift.timeRange && o.shift.timeRange.end) || t[1]);
      return !isNaN(a) && !isNaN(b) && a.getHours() === 20 && a.getMinutes() === 30 && b - a === 4 * 3600000;
    } catch (e) { return false; }
  }
  // 4.59: the Priority button (saved; starts on Night Shift)
  function nightFirst() { return ls.get('vtoPriority', 'night') !== 'normal'; }
  function isOpen(o) {
    return !!(o.eligibility && o.eligibility.isEligible === true && o.unavailability === null);
  }
  function describe(o) {
    const iso = isoTimes(o);
    const id = getId(o) || '';
    const tail = id ? ' [' + id.slice(-6) + ']' : '';
    const a = iso[0] ? new Date(iso[0]) : null;
    if (!a || isNaN(a)) return 'VTO' + tail;
    let s = a.toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const b = iso[1] ? new Date(iso[1]) : null;
    if (b && !isNaN(b)) s += ' - ' + b.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return s + tail;
  }

  /* ================= SIGN ERRORS (kept separately so they are not pushed out of the log) ================= */
  const hhmmss = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const dayTime = (t) => new Date(t).toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  function addSignEvent(text) {
    const a = ls.get('vtoSignErrors', []);
    a.push(text);
    while (a.length > 12) a.shift();
    ls.set('vtoSignErrors', a);
  }
  /* ================= STAY LOGGED IN COUNTER (one count per login) ================= */
  // vtoStay = { since: about when you logged in, clicks: [times "Stay logged in" was clicked], done: summary written }
  const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
  function stayGet() { const v = ls.get('vtoStay', null); return v && v.since ? v : null; }
  function stayStart(t) { ls.set('vtoStay', { since: t, clicks: [], done: false }); setShared('vtoSince', t); }
  const hms = (ms) => { const x = Math.max(0, Math.round(ms / 1000)); return Math.floor(x / 3600) + 'h ' + Math.floor((x % 3600) / 60) + 'm ' + (x % 60) + 's'; };
  function stayAdd() {
    const v = stayGet() || { since: Date.now(), clicks: [], done: false };
    if (v.clicks.length && Date.now() - v.clicks[v.clicks.length - 1] < 60000) return;  // same prompt clicked again
    v.clicks.push(Date.now());
    while (v.clicks.length > 300) v.clicks.shift();
    ls.set('vtoStay', v);
  }
  // e.g. "session 8h 54m 46s (5:58:00 PM - 2:52:46 AM) - 39 stay clicks, every ~14 min"
  function staySummary(end) {
    const v = stayGet();
    if (!v || v.done) return '';
    const c = v.clicks.filter(function (t) { return t >= v.since && t <= end + 5000; });
    let txt = 'session ' + hms(end - v.since) + ' (' + hhmmss(v.since) + ' - ' + hhmmss(end) + ')';
    txt += ' - ' + c.length + ' stay click' + (c.length === 1 ? '' : 's');
    if (c.length > 1) txt += ', every ~' + Math.round((c[c.length - 1] - c[0]) / (c.length - 1) / 60000) + ' min';
    return txt;
  }
  // start a new count when the sign-in page was used after the current count began (= you logged in again)
  function loginWatch() {
    const r = String(getShared('vtoLogin') || '').split('|');
    const p = r.map(Number);
    return p[0] && p[1] ? { since: p[0], lastSeen: p[1], retried: p[2] || 0, kind: r[3] || '', userAt: Number(r[4]) || 0, pk: Number(r[5]) || 0, pw: Number(r[6]) || 0, offer: Number(r[7]) || 0, autoAt: Number(r[8]) || 0, wokeAt: Number(r[9]) || 0 } : null;
  }
  // 4.11: after the alias, Amazon may send you to a second sign-in page (atozworkforce.idprism-auth.amazon.com).
  // This script does not run there, so it cannot see the passkey prompt itself. But when Amazon remembers you,
  // the VTO page opens 2-3 s after the alias; when it asks for your passkey, it takes much longer. So:
  // more than PASSKEY_MIN_MS (4.5 s) from leaving the A to Z sign-in page to the VTO page = Amazon asked for your passkey there.
  function secondPageMs(lw) { return lw && lw.lastSeen ? Math.max(0, startedAt - lw.lastSeen) : 0; }
  // 4.27: the alias was typed within 1 min of the Mac waking up, and the VTO page came more than 1 min later = the Mac slept again
  function sleptOnSecondPage(lw) { return !!(lw && lw.wokeAt && lw.autoAt && Math.abs(lw.autoAt - lw.wokeAt) < 60000 && secondPageMs(lw) > 60000); }
  function passkeyOnSecondPage(lw) { return !!(lw && !lw.pk && !lw.pw && lw.lastSeen <= startedAt && secondPageMs(lw) > PASSKEY_MIN_MS && !sleptOnSecondPage(lw)); }
  function stayCheckNewLogin() {
    const lw = loginWatch();
    let v = stayGet();
    if (!v) { stayStart(lw && Date.now() - lw.lastSeen < 12 * 3600000 ? lw.lastSeen : Date.now()); v = stayGet(); v.ver = 2; ls.set('vtoStay', v); return; }
    // new count after a real sign-in page visit (more than 5 s), or (4.8) when the script signed you in with your alias -
    // that takes ~2 s, so it was wrongly seen as "a page that just flashed by" and the count kept running
    const autoSigned = !!(lw && lw.autoAt && lw.autoAt >= lw.since);
    if (lw && lw.lastSeen > v.since && (lw.lastSeen - lw.since > 5000 || autoSigned)) { stayStart(lw.lastSeen); v = stayGet(); v.ver = 2; ls.set('vtoStay', v); }
    setShared('vtoSince', stayGet().since);
  }

  // heartbeat: last time this page had a good check. After a sign-out the next start reads it to show WHEN it stopped.
  function checkGapAtStart(hb) {
    // you clicked Sign out yourself (here, or on the passkey page via VTO Phone Alerts) after the last good check
    const manualAt = parseInt(getShared('vtoManual') || '0', 10);
    const manualNow = !!(hb && manualAt > hb - 60000 && manualAt <= startedAt);
    // 4.25: you pressed "reset passkey" since the last good check
    const resetAt = parseInt(getShared('vtoReset') || '0', 10);
    const resetNow = !!(hb && resetAt > hb - 60000 && resetAt <= startedAt);
    const lw = loginWatch();
    // this gap went through the sign-in page (= a new login), however short
    const signedInHere = !!(hb && lw && lw.since >= hb - 120000 && lw.since <= startedAt && lw.lastSeen >= hb - 5000);
    // ...and the script typed your alias there without you touching the page (4.5 automatic sign-in)
    const autoHere = signedInHere && lw.autoAt >= lw.since && !(lw.userAt && lw.userAt >= lw.since);
    // a gap is recorded after 60 s; your own sign-out, and any gap with a sign-in, are always recorded, however short
    if (hb && (startedAt - hb > 60000 || (manualNow && startedAt - hb > 3000) || signedInHere)) {
      const gapMs = Math.max(0, startedAt - hb);
      const mins = Math.round(gapMs / 60000);
      const gapTxt = gapMs < 60000 ? Math.round(gapMs / 1000) + 's gap' : mins + ' min gap';
      const sameDay = new Date(hb).toDateString() === new Date(startedAt).toDateString();
      // Amazon signed you out = the sign-in page showed up within 2 minutes of the last good check.
      // (If the PC was off, the sign-in page only shows much later, when you come back.)
      const manual = manualNow;
      // ...and stayed up for more than 5 s (a sign-in page that only flashes by let you straight back in = Amazon still knew you),
      // or the script signed you in there
      const viaLogin = !manual && !!(lw && lw.since >= hb - 120000 && lw.since <= hb + 120000 && (lw.lastSeen - lw.since > 5000 || autoHere) &&
        (lw.kind ? lw.kind === 'amazon' : true));   // the sign-in page decided whether Amazon sent you there
      // Chrome was closed or cut off + the script signed you in again
      const extended = !manual && !viaLogin && autoHere;
      const closedAt0 = ls.get('vtoClosedAt', 0);
      const outAt = manual ? Math.max(hb, manualAt) : viaLogin ? Math.max(hb, lw.since)
        : extended && closedAt0 >= hb - 6000 && closedAt0 <= startedAt ? closedAt0 : hb;
      const sum = !manual ? staySummary(outAt) : '';   // 4.12: session length on every line
      // the sign-in page's one automatic try got you back in = this page started right after that try (not when you logged in later)
      // ...and you did not click/type anything on the sign-in page (if you did, YOU signed in)
      // ...or the script typed your alias on the sign-in page (4.5) and you did not touch that page
      const pk2 = signedInHere && passkeyOnSecondPage(lw);   // 4.11: Amazon asked for your passkey on its second page - you finished the sign-in
      const auto = !manual && !pk2 && !!lw && lw.lastSeen >= hb - 5000 && !(lw.userAt && lw.userAt >= lw.since) &&
        ((viaLogin && lw.retried && lw.retried >= lw.since && startedAt - lw.retried < 60000) ||
         (lw.autoAt && lw.autoAt >= lw.since && startedAt - lw.autoAt < 120000));
      // the VTO page saved the moment it was closed (tab, Chrome, PC shutdown, or you left the page) - not for the script's own reloads
      const closedAt = ls.get('vtoClosedAt', 0);
      const closed = closedAt >= hb - 6000 && closedAt <= startedAt;
      const slept = ls.get('vtoSleptAt', null);
      const asleep = !!(slept && slept.from >= hb - 10000 && slept.from <= startedAt);
      const netDown = netDownAtStart;   // read when the page started (the first good check clears it)
      const noNet = !!(netDown && netDown >= hb - 10000 && netDown <= startedAt);
      const pkAny = signedInHere && !!((lw.pk && lw.pk >= lw.since) || (lw.pw && lw.pw >= lw.since) || pk2);
      if (resetNow) {
        ls.set('vtoResetResult', { t: resetAt, at: startedAt, ok: pkAny, signIn: signedInHere });
        if (!signedInHere) logAction('!! log out did not sign you out - press it again');   // 4.43: a log out that worked shows in Authentication Session only
      }
      const reason0 = resetNow ? 'you pressed reset passkey' + (pkAny ? ', the script typed your alias, then Amazon asked for your PASSKEY (you finished it' + (pk2 ? ', ' + Math.round(secondPageMs(lw) / 1000) + 's' : '') + ')'
          : signedInHere ? ', but Amazon remembered you - no passkey, the reset did not take' : ', but there was no sign-in - the reset did not take')
        : manual ? 'you signed out yourself'
        : viaLogin ? 'Amazon signed you out'
        : extended ? 'Chrome closed' + (pk2 ? ', the script typed your alias, then Amazon asked for your PASSKEY (you finished it, ' + Math.round(secondPageMs(lw) / 1000) + 's)' : ' and the script signed in with your alias')
        : closed ? 'page was closed'
        : asleep ? 'Mac was asleep'
        : noNet ? 'no internet'
        : 'PC restarted, Chrome closed suddenly, or power loss';
      const reason = reason0 + (sum ? ' - ' + sum : '');
      // 4.12 reason codes for the In-N-Out line
      const viaPage = !!(lw && lw.lastSeen >= hb - 5000);
      const inTag = !viaPage ? 'Remembered'
        : ((lw.pk && lw.pk >= lw.since) || (lw.pw && lw.pw >= lw.since) || passkeyOnSecondPage(lw)) ? 'Passkey'
        : 'Auto';
      if (inTag === 'Passkey' && startedAt > ls.get('vtoPasskeyAt', 0)) ls.set('vtoPasskeyAt', startedAt);   // 4.18
      // 4.14: no guessing from the passkey (a PC restart does not always bring one) - [ShutDown] only when
      // VTO Chrome was still open and was cut off; closing it yourself is always [Closed]
      const outTag = resetNow ? 'Reset' : manual ? 'Closed' : viaLogin ? '401'
        : closed ? 'Closed'
        : noNet ? 'Network' : 'CutOff';
      const msg = dayTime(outAt) + ' SIGNED OUT - SIGNED IN ' + (auto ? 'AUTOMATICALLY ' : '') + (sameDay ? hhmmss(startedAt) : dayTime(startedAt)) + ' (' + gapTxt + ') - ' + reason + ' | tags: ' + outTag + '>' + inTag;
      // 4.29: In-N-Out = real sign-outs and sign-ins only. A gap where you stayed signed in (no sign-in page: internet drop, reload,
      // Chrome reopened) or where the Mac slept (lid closed) and the script signed you back in gets one log line instead.
      // A passkey, Amazon signing you out (401), your own sign-out and reset passkey always get an In-N-Out line.
      const keepLine = resetNow || manual || outTag === '401' || inTag === 'Passkey' || (viaPage && !asleep);
      if (keepLine) addSignEvent(msg);
      else {
        if (asleep) { const se = ls.get('vtoSignErrors', []); if (se.length && / SIGNED OUT: /.test(se[se.length - 1])) { se.pop(); ls.set('vtoSignErrors', se); } }   // its "signed out" note too
        const g = ls.get('vtoGaps', []); g.push(msg); while (g.length > 30) g.shift(); ls.set('vtoGaps', g);   // full line in copy
        // 4.40: no log line - the Sessions section shows it
      }
      // copy only: back on the VTO page after a gap WITHOUT going through the sign-in page = Amazon still remembered you
      if (!(lw && lw.lastSeen >= hb - 5000)) {
        try {
          const a = ls.get('vtoSignIns', []);
          a.push(dayTime(startedAt) + ' back on VTO page - no sign-in page (Amazon remembered you), gap ' + (gapMs < 60000 ? Math.round(gapMs / 1000) + 's' : (mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm')) + ' (' + reason.split(' - ')[0] + ')');
          while (a.length > 100) a.shift();
          ls.set('vtoSignIns', a);
        } catch (e) {}
      }
    }
    stayCheckNewLogin();
  }

  /* ================= SESSIONS (4.40, replaces In-N-Out in the box) ================= */
  // One line per moment: launcher opened / launcher closed (and how long it ran) / Amazon signed you out
  // (and how long you were signed in) / signed in again (and how many seconds it took). Worked out once,
  // when the VTO page starts after a gap. A refresh by the script itself is not a gap.
  function sessAdd(e) {
    const a = ls.get('vtoSessions', []);
    a.push(e);
    while (a.length > 60) a.shift();
    ls.set('vtoSessions', a);
  }
  function lastOpenAt() {
    const a = ls.get('vtoSessions', []);
    for (let i = a.length - 1; i >= 0; i--) { if (a[i].k === 'close') return 0; if (a[i].k === 'open') return a[i].t; }
    return 0;
  }
  function pageReloaded() { try { const n = performance.getEntriesByType('navigation')[0]; return !!(n && n.type === 'reload'); } catch (e) { return false; } }
  // 4.48: one time: take out the launcher closed/opened pairs that were really you refreshing the page
  // (closed and opened again within 10 s), and fix how long the launcher ran on the close after them
  function fixRefreshPairs() {
    if (ls.get('vtoSessFix48', false)) return;
    ls.set('vtoSessFix48', true);
    const a = ls.get('vtoSessions', []); const out = []; let op = 0, cut = false;
    for (let i = 0; i < a.length; i++) {
      const e = a[i];
      if (e.k === 'close' && a[i + 1] && a[i + 1].k === 'open' && a[i + 1].t - e.t >= 0 && a[i + 1].t - e.t < 10000) { i++; cut = true; continue; }
      if (e.k === 'open') op = e.t;
      if (e.k === 'close') { if (cut) e.ran = op && op < e.t ? e.t - op : 0; op = 0; cut = false; }
      out.push(e);
    }
    ls.set('vtoSessions', out);
  }
  function sessionAtStart(hb) {
    try {
      const lw = loginWatch();
      const closedAt = ls.get('vtoClosedAt', 0);
      const closed = !!(hb && closedAt >= hb - 6000 && closedAt <= startedAt);
      const slept = ls.get('vtoSleptAt', null);
      const asleep = !!(slept && slept.from >= hb - 10000 && slept.from <= startedAt);
      // the sign-in page showed up after the last good check
      const viaLogin = !!(hb && lw && lw.since >= hb - 120000 && lw.since <= startedAt && lw.lastSeen >= hb - 5000);
      const sv = stayGet();   // the sign-in that just ended (stayCheckNewLogin starts the new one after this)
      const inLine = function () {
        const auto = lw.autoAt >= lw.since && !(lw.userAt && lw.userAt >= lw.since);
        sessAdd({ k: 'in', t: startedAt, secs: Math.round((startedAt - lw.since) / 1000), how: auto ? 'auto' : 'you' });
      };
      if (!hb) { sessAdd({ k: 'open', t: startedAt }); return; }   // first run
      // 4.48: you refreshed the page yourself (for example after updating the script): same launcher, nothing to record
      if (!viaLogin && pageReloaded() && startedAt - Math.max(hb, closedAt) < 300000) return;
      if (viaLogin && (lw.kind === 'amazon' || lw.kind === 'manual' || lw.kind === 'reset')) {
        sessAdd({ k: 'out', t: lw.since, why: lw.kind, after: sv && sv.since < lw.since ? lw.since - sv.since : 0 });
        inLine();
        return;
      }
      // the launcher was closed and opened again; not a gap from the Mac sleeping with the launcher open.
      // The launcher stops Chrome by its process number, so the page often can't note the close: then the last good check is the close time (within ~5 s).
      if (closed || (startedAt - hb > 60000 && !asleep)) {
        const at = closed ? closedAt : hb;
        const op = lastOpenAt();
        sessAdd({ k: 'close', t: at, ran: op && op < at ? at - op : 0, sure: closed });
        sessAdd({ k: 'open', t: viaLogin ? Math.min(lw.since, startedAt) : startedAt });
        if (viaLogin) inLine();
      }
    } catch (e) {}
  }
  // 4.44: one time, when this version first runs: rebuild the session list from the sign-in history the script already
  // saved (In-N-Out lines and the gaps kept for copy), so a launcher that was already running shows when it really
  // started, not when the script was installed. Lines written before 4.40 have this shape:
  //   "Mon, 10/26, 5:30:01 AM SIGNED OUT - SIGNED IN AUTOMATICALLY 5:30:20 AM (19s gap) - <reason> - session 10h 2m ... | tags: CutOff>Auto"
  function seedSessions() {
    if (ls.get('vtoSessSeed45', false)) return false;   // 4.45: runs once more, with the sign-in time as the launcher start
    ls.set('vtoSessSeed45', true);
    try {
      const RE = /^\w{3}, (\d+)\/(\d+), (\d+):(\d+):(\d+) ([AP]M) SIGNED OUT - SIGNED IN (?:AUTOMATICALLY )?(?:\w{3}, (\d+)\/(\d+), )?(\d+):(\d+):(\d+) ([AP]M) \((?:\d+ min|\d+s) gap\) - (.*?) \| tags: (\w+)>(\w+)/;
      const now = Date.now();
      const at = function (mo, d, h, mi, se, ap) {
        let hh = +h % 12; if (ap === 'PM') hh += 12;
        const t = new Date(new Date(now).getFullYear(), +mo - 1, +d, hh, +mi, +se);
        if (t.getTime() > now + 60000) t.setFullYear(t.getFullYear() - 1);
        return t.getTime();
      };
      const rows = [];
      ls.get('vtoSignErrors', []).concat(ls.get('vtoGaps', [])).forEach(function (x) {
        const m = RE.exec(String(x)); if (!m) return;
        const out = at(m[1], m[2], m[3], m[4], m[5], m[6]);
        let inn = at(m[7] || m[1], m[8] || m[2], m[9], m[10], m[11], m[12]);
        if (inn < out) inn += 86400000;   // signed in after midnight
        const sess = /session (\d+)h (\d+)m/.exec(m[13]);
        rows.push({ out: out, inn: inn, why: m[13], outT: m[14], inT: m[15], after: sess ? (+sess[1] * 60 + +sess[2]) * 60000 : 0 });
      });
      rows.sort(function (a, b) { return a.out - b.out; });
      // 4.45: the launcher start = your "signed in" time (the sign-in right after the launcher opened).
      // Only when that sign-in was the one after Amazon's 10 h sign-out does it go back to the sign-in after
      // the last time Chrome was closed or cut off (a restart counts; sleep, your own sign-out and internet drops do not).
      const sv = stayGet();
      let startAt = sv && sv.since ? sv.since : 0;
      const after401 = rows.some(function (r) { return r.outT === '401' && Math.abs(r.inn - startAt) < 120000; });
      if (!startAt || after401) {
        let start = null;
        rows.forEach(function (r) { if (/^(CutOff|Closed|Renew|Restart)$/.test(r.outT) && !/asleep|signed out yourself/i.test(r.why) && (!startAt || r.inn <= startAt)) start = r; });
        if (start) startAt = start.inn;
      }
      const list = [];
      if (startAt) {
        list.push({ k: 'open', t: startAt });
        // Amazon's 10 h sign-outs since then
        rows.forEach(function (r) {
          if (r.out <= startAt || r.outT !== '401') return;
          list.push({ k: 'out', t: r.out, why: 'amazon', after: r.after });
          list.push({ k: 'in', t: r.inn, secs: Math.round((r.inn - r.out) / 1000), how: r.inT === 'Auto' ? 'auto' : 'you' });
        });
      }
      ls.set('vtoSessions', list);
      return true;
    } catch (e) { return false; }
  }
  // "Mon 10/26 07:02 PM"
  const sessWhen = (t) => { const d = new Date(t); return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  function sessLine(e) {
    const txt = e.k === 'open' ? 'launcher opened'
      : e.k === 'close' ? 'launcher closed' + (e.ran ? ' - ran ' + gapText(e.ran / 60000) : '')
      // 4.49: Martin's wording: "Amazon signed you out", "you signed out inside A to Z", "you clicked log out", "you signed in"
      : e.k === 'out' ? (e.why === 'manual' ? 'you signed out inside A to Z' : e.why === 'reset' ? 'you clicked log out' : 'session ended') + (e.after ? ' (' + gapText(e.after / 60000) + ')' : '')
      : (e.how === 'auto' ? 'Auto' : 'you signed in') + ' (' + e.secs + 's)';
    // 4.64: session ended = pink like launcher closed; Auto = teal like launcher opened
    const c = e.k === 'open' ? C_MINT : e.k === 'close' ? C_BAD : e.k === 'out' ? (e.why === 'manual' || e.why === 'reset' ? C_PURPLE : C_BAD) : e.how === 'auto' ? C_MINT : C_CYAN;
    return { fix: true, parts: [{ t: '  ' + sessWhen(e.t) + '  ', c: C_BASE }, { t: txt, c: c }] };
  }

  /* ================= NO INTERNET vs THE MAC SLEEPING (4.29) ================= */
  // The network goes down for a few seconds as the Mac falls asleep (lid closed) and wakes up. That is not a real internet drop,
  // so it is not counted as an error: within 1 min after waking it is never written, and one written in the last minute before
  // the sleep is taken back when the sleep is noticed (on waking). A real drop is written and counted as before.
  // 4.41: a drop in the minute before sleep or the first 2 minutes after waking belongs to the sleep, not to the internet
  function nearSleep(t) { const sl = ls.get('vtoSleptAt', null); return !!(sl && t >= sl.from - 60000 && t <= sl.to + 120000); }
  function netDownNote(msg, detail) {
    if (nearSleep(Date.now()) || Date.now() - (window.__vtoTick || Date.now()) > 120000) return;   // just woke up (or waking, not noticed yet)
    // 4.41: no log line - one "no internet" line in last errors, finished with its end time when the internet is back
    addError('no internet', '', detail);
    const e = ls.get('vtoErrors', []);
    if (e.length) { e[e.length - 1].from = ls.get('vtoNetDownAt', 0) || e[e.length - 1].t; ls.set('vtoErrors', e); }
    ls.set('vtoNetErrAt', e.length ? e[e.length - 1].t : 0);
    ls.set('vtoNetShown', true);   // "internet back" is written only for a drop that was written
  }
  function forgetSleepNet(from) {
    try {
      const at = ls.get('vtoNetErrAt', 0);
      if (!at || at < from - 60000 || at > from) return;
      ls.set('vtoNetErrAt', 0); ls.set('vtoNetShown', false);
      const e = ls.get('vtoErrors', []);
      const k = e.findIndex(function (x) { return x.t === at && x.what === 'no internet'; });
      if (k > -1) { const day = e[k].day; e.splice(k, 1); ls.set('vtoErrors', e); const s = stats(); if (day === s.day && s.errors > 0) { s.errors--; ls.set('vtoStats', s); } }
      const a = ls.get('vtoLog', []);
      for (let i = a.length - 1; i >= Math.max(0, a.length - 20); i--) { if (a[i].indexOf('!! no internet') > -1) { a.splice(i, 1); ls.set('vtoLog', a); break; } }
    } catch (e) {}
  }

  /* ================= SIGNED OUT ================= */
  function signedOut(why) {
    if (signedOutFlag) return;
    signedOutFlag = true;
    logAction('!! SIGNED OUT (' + why + ') - log in again');
    const manual = parseInt(getShared('vtoManual') || '0', 10) > Date.now() - 600000;
    const sum = manual ? '' : staySummary(Date.now());
    addSignEvent(dayTime(Date.now()) + ' SIGNED OUT: ' + (manual ? 'you signed out yourself' : why) + (sum ? ' - ' + sum : ''));
    const v = stayGet(); if (v) { v.done = true; ls.set('vtoStay', v); }   // 4.58: no SIGNED OUT tab title or beep
  }

  /* ================= :00 DROP WINDOW (multi-VTO releases) ================= */
  // Multi-VTO releases (announced by the A to Z notification "N VTO opportunities available ... within the next 60 minutes")
  // open exactly at :00, 1 hour later. So every hour: one page refresh at :59:50, fast checks from :59:55 to :00:30
  // (extra fast :59:59-:00:05). The 15-minute safety refresh stays out of the way from :59:00 to :00:40.
  // 4.47: :00 drops only happen from 8:00 AM to 2:00 PM, so all of this (refresh, fast checks, held-back buttons
  // and refreshes) runs only for those :00s. The rest of the day: normal checks and nothing held back.
  const DROP_FIRST_HOUR = 8, DROP_LAST_HOUR = 14;
  function dropHour(d) { d = d || new Date(); const h = d.getMinutes() >= 30 ? (d.getHours() + 1) % 24 : d.getHours(); return h >= DROP_FIRST_HOUR && h <= DROP_LAST_HOUR; }
  function inBoost(d) { d = d || new Date(); const m = d.getMinutes(), x = d.getSeconds(); return dropHour(d) && ((m === 59 && x >= 55) || (m === 0 && x < 30)); }
  // 4.24: the seconds a :00 drop actually opens: checks every 0.1 s, up to 4 waiting at once
  function inBurstWin(d) { d = d || new Date(); const m = d.getMinutes(), x = d.getSeconds(); return dropHour(d) && ((m === 59 && x >= 59) || (m === 0 && x < 5)); }
  let burstOffHour = '';   // the :00 this hour's burst was switched off for (Amazon slow or refusing)
  function burstKey(d) { d = d || new Date(); const n = d.getMinutes() === 59 ? new Date(d.getTime() + 60000) : d; return n.getFullYear() + '-' + n.getMonth() + '-' + n.getDate() + '-' + n.getHours(); }
  function inBurst(d) { d = d || new Date(); return inBurstWin(d) && burstOffHour !== burstKey(d); }
  function burstOff(why) {
    if (burstOffHour === burstKey()) return;
    burstOffHour = burstKey();
    // 4.29: copy only (not an error, and not needed in the box)
    const b = ls.get('vtoBurstOff', []); b.push(new Date().toLocaleString() + ' ' + why); while (b.length > 20) b.shift(); ls.set('vtoBurstOff', b);
  }
  function inQuiet(d) { d = d || new Date(); const m = d.getMinutes(); return dropHour(d) && (m === 59 || (m === 0 && d.getSeconds() < 40)); }
  function nearDrop(d) { d = d || new Date(); const m = d.getMinutes(); return dropHour(d) && (m === 59 || m === 0); }   // 4.47: test / log out wait only around a real drop
  function hourlyRefresh() {
    const d = new Date();
    if (signedOutFlag || reloading) return;
    // 4.6: refresh at :59:50 (page is fresh and checking again by about :59:53), so nothing is blind at :00:00.
    // 4.23: kept at :59:50 - a :00 refresh slowed the checks right at the 10/16 1:00 PM drop.
    if (d.getMinutes() !== 59 || d.getSeconds() < 50 || !dropHour(d)) return;   // 4.47: only 7:59:50 to 1:59:50
    const n = new Date(d.getTime() + 60000);   // the :00 this refresh is for
    const key = n.getFullYear() + '-' + n.getMonth() + '-' + n.getDate() + '-' + n.getHours();
    if (ss.get('vtoHourDone') === key) return;
    ss.set('vtoHourDone', key);
    if (Date.now() - startedAt < 20000) return;   // this page just started - it is fresh already
    reload('pre-:00 refresh at :59:50');   // waits if an accept is in progress
  }

  /* ================= RELOAD CONTROL ================= */
  // 4.16: true while the internet (or A to Z) is unreachable - a refresh then would only land on Chrome's
  // "No internet" page, where this script cannot run; staying on the page keeps checks going so watching resumes by itself
  function offlineNow() { return navigator.onLine === false || !!ls.get('vtoNetDownAt', 0); }
  function reload(reason) {
    if (reloading) return;
    if (signedOutFlag) return; // signed out: stay put so the red alert keeps showing
    if (offlineNow()) { if (!pendingReload) pendingReload = reason; return; }   // 4.16: refresh later, once the internet is back
    if (inFlight.size || Date.now() < noReloadUntil || retryPending()) {
      if (!pendingReload) pendingReload = reason;
      return;
    }
    reloading = true;
    logReload(reason);
    location.reload();
  }

  try { localStorage.removeItem('vtoListedAt'); localStorage.removeItem('vtoOpenSeenIds'); } catch (e) {}   // 4.54: leftovers of the removed #3 line

  /* ================= CHECK SPEED (4.55, copy only) ================= */
  // How long Amazon takes to answer each list check, per hour of the day, so the Mac and PC connections can be compared.
  // Kept in memory and saved every 30 s (not on every check). Accepting is not affected.
  const spLoad = [];   // last 600 answer times (ms) on this page load
  let spTimeouts = 0;
  let spDay = (function () { const v = ls.get('vtoCheckSpeed', null); return v && v.day === today() ? v : { day: today(), hours: {}, timeouts: 0 }; })();
  let spDirty = false;
  function speedAdd(ms) {
    if (!(ms >= 0) || ms > POLL_TIMEOUT_MS) return;   // a check that spanned a sleep is not a real reading
    spLoad.push(ms); if (spLoad.length > 600) spLoad.shift();
    if (spDay.day !== today()) spDay = { day: today(), hours: {}, timeouts: 0 };
    const h = new Date().getHours(), x = spDay.hours[h] || [0, 0, 0];   // [checks, total ms, slowest ms]
    x[0]++; x[1] += ms; if (ms > x[2]) x[2] = ms;
    spDay.hours[h] = x; spDirty = true;
  }
  function speedTimeout() { spTimeouts++; if (spDay.day === today()) { spDay.timeouts = (spDay.timeouts || 0) + 1; spDirty = true; } }
  setInterval(function () { if (spDirty) { spDirty = false; ls.set('vtoCheckSpeed', spDay); } }, 30000);
  window.addEventListener('pagehide', function () { if (spDirty) ls.set('vtoCheckSpeed', spDay); });
  function speedLines() {
    const sec = (ms) => (ms / 1000).toFixed(2) + 's';
    const out = [];
    if (spLoad.length) {
      const a = spLoad.slice().sort(function (p, q) { return p - q; });
      const avg = a.reduce(function (p, q) { return p + q; }, 0) / a.length;
      out.push('this page load (last ' + a.length + ' checks): average ' + sec(avg) + ' | middle ' + sec(a[Math.floor(a.length / 2)]) + ' | fastest ' + sec(a[0]) + ' | slowest ' + sec(a[a.length - 1]) + ' | timeouts ' + spTimeouts);
    } else out.push('this page load: no checks yet');
    const hs = Object.keys(spDay.hours).map(Number).sort(function (p, q) { return p - q; });
    let n = 0, sum = 0;
    hs.forEach(function (h) { const x = spDay.hours[h]; n += x[0]; sum += x[1]; });
    if (n) out.push('today ' + spDay.day + ': average ' + sec(sum / n) + ' over ' + n + ' checks | timeouts ' + (spDay.timeouts || 0));
    hs.forEach(function (h) {
      const x = spDay.hours[h], lbl = new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
      out.push('  ' + lbl + ': average ' + sec(x[1] / x[0]) + ' | slowest ' + sec(x[2]) + ' | ' + x[0] + ' checks');
    });
    return out.join('\n');
  }

  /* ================= DIRECT ACCEPT ================= */
  function dstate() { return ls.get('vtoDirect', {}); }
  function setD(id, patch) {
    const d = dstate();
    d[id] = Object.assign({}, d[id] || {}, { closedSeen: false }, patch, { t: Date.now() });   // a new answer starts a new "seen filled" watch
    const cutoff = Date.now() - 86400000;
    Object.keys(d).forEach(function (k) { if (d[k].t < cutoff) delete d[k]; });
    ls.set('vtoDirect', d);
  }

  // Accepts go ONE AT A TIME (Amazon answered overlapping accepts with SMS-9999). 4.6: a VTO never tried yet
  // always goes before retries, and the hourly cap only counts retries, so a new VTO is never held back.
  let lastOpen = [];
  function retryPending() {
    const now = Date.now(), d = dstate();
    return lastOpen.some(function (o) {
      const st = d[getId(o)];
      return st && !st.final && (st.res === 'rejected' || st.res === 'error') && now - st.t < 20000 && (st.n || 0) < RETRY_MAX;
    });
  }
  function fireDirect(open) {
    if (signedOutFlag) return;
    const now = Date.now();
    const d = dstate();
    const times = ls.get('vtoDirectTimes', []).filter(function (t) { return now - t < 3600000; });   // retries in the last hour
    const before = times.length;
    let sent = 0;
    // order: never-tried VTOs first, then retries, then ones whose accept got no answer at all.
    // 4.24: inside each group the SOONEST VTO date goes first (your choice, 10/17): Amazon handles one accept at a time
    // (~4 s each at a drop), so the first one sent is the one you are surest to get.
    const timedOut = function (o) { const x = d[getId(o)]; return !!(x && x.res === 'error' && x.timedOut); };
    const fresh = function (o) { return !d[getId(o)]; };
    open = open.slice().sort(function (a, b) { return vtoStart(a) - vtoStart(b); });   // stable: same date keeps page order
    open = open.filter(fresh).concat(open.filter(function (o) { return !fresh(o) && !timedOut(o); }), open.filter(function (o) { return !fresh(o) && timedOut(o); }));
    // 4.51: night shift VTOs (exactly 8:30 PM-12:30 AM, the rarer spots) go before all others; the rest keep the order above
    // 4.59: only while the Priority button is on Night Shift; Normal keeps the soonest-first order
    if (nightFirst()) open = open.filter(isNight).concat(open.filter(function (o) { return !isNight(o); }));
    for (let i = 0; i < open.length; i++) {
      const o = open[i];
      const id = getId(o);
      if (!id || inFlight.has(id)) continue;
      const st = d[id];
      let prevN = 0, prevB = 0, isRetry = false;
      if (st) {
        if (st.res === 'ok') continue;
        // a VTO that was full / given up on: wait 2 s - unless the list has shown it filled since then and it is open again now (someone cancelled): go at once
        if (st.res === 'full' && !st.closedSeen && now - st.t < DIRECT_COOLDOWN) continue;
        if (st.res === 'full') isRetry = !st.closedSeen;   // reopened after filling = a new chance, not a retry
        if (st.res === 'error' || st.res === 'rejected') {
          isRetry = true;
          prevB = st.b || 0;
          if (st.closedSeen) { prevB = 0; isRetry = false; }   // reopened: fresh tries
          else if ((st.n || 0) >= RETRY_MAX || prevB >= BUSY_MAX) { if (now - st.t < DIRECT_COOLDOWN) continue; prevN = st.n || 0; }
          else { if (now - st.t < (st.busy ? BUSY_GAP : RETRY_GAP)) continue; prevN = st.n || 0; }
        }
      }
      // one at a time: nothing new while another accept is waiting for Amazon's answer
      if (sent >= 1) break;
      // 4.51: Amazon just said "busy": it refuses every VTO for now, so wait 0.3 s (the night one then still goes first)
      if (now - lastBusyAt < BUSY_GAP) break;
      // 4.10: an accept sent by the page (backup clicking / you) is waiting for its answer: wait for it, never overlap
      if (pageAcceptBusy()) break;
      // an accept still waiting holds the line for ONE_AT_A_TIME_WAIT (6 s) - or until its answer, once Amazon said "busy" (it is working on that one)
      if (Array.from(inFlight).some(function (x) { return now - (inFlightAt[x] || 0) < ONE_AT_A_TIME_WAIT || lastBusyAt > (inFlightAt[x] || 0); })) break;
      if (isRetry && times.length >= MAX_DIRECT_HOUR) {
        // retry budget used up: retries pause; a new VTO further down can still go directly
        if (now - limitLoggedAt > 60000) { limitLoggedAt = now; logAction('!! retry limit reached (' + MAX_DIRECT_HOUR + '/h) - retries paused, new VTOs still go'); }
        continue;
      }
      if (isRetry) times.push(now);
      sent++;
      directAccept(id, describe(o), prevN, prevB);   // not awaited
    }
    if (times.length !== before) ls.set('vtoDirectTimes', times);
  }

  async function directAccept(id, desc, prevN, prevB) {
    const overlapAtSend = inFlight.size > 0 || pageAccepts > 0;   // another accept (ours or the page's) still waiting for its answer
    inFlight.add(id); inFlightAt[id] = Date.now();
    soundAccepting();   // 4.62
    lastDirectSent = Date.now();
    const t0 = Date.now();
    const ctl = new AbortController();
    const to = setTimeout(function () { ctl.abort(); }, 10000);
    // 4.6: the accept leaves FIRST; logging and saved-state reads happen while Amazon is answering
    const sending = origFetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: hdrs(),
      signal: ctl.signal,
      body: JSON.stringify({ operationName: 'AcceptVto', variables: { input: { shiftOpportunityId: id } }, query: ACCEPT_QUERY })
    });
    const prevSt = dstate()[id] || null;
    logAction('-> sending accept: ' + desc);
    try {
      const res = await sending;
      const ms = Date.now() - t0;
      if (res.status === 401 || res.status === 403) {
        setD(id, { res: 'rejected' });
        signedOut('accept HTTP ' + res.status);
        logAction('!! accept failed - not logged in (HTTP ' + res.status + ')');
        return;
      }
      const text = await res.text();
      let j = null;
      try { j = JSON.parse(text); } catch (e) {}
      if (res.ok && j && j.data && j.data.dropShift) {
        setD(id, { res: 'ok' });
        bump('accepted');
        addAccepted(desc, 'direct');
        addResult('ok', desc, 'direct', t0);   // 4.56: send -> answer
        setLast('ok', 'ACCEPTED (direct) ' + desc);
        logAction('OK ACCEPTED (direct, ' + ms + 'ms): ' + desc);
        document.title = 'VTO ACCEPTED';
        soundWin();
        // 4.51: no page refresh after a win (it made the script blind 1-3 s while more VTOs may open); checks read Amazon directly
      } else if (res.status >= 500) {
        throw new Error('HTTP ' + res.status);
      } else {
        const full0 = String((j && j.errors && j.errors[0] && j.errors[0].message) || text || ('HTTP ' + res.status));
        { const rj = ls.get('vtoRejects', []); rj.push({ at: new Date().toLocaleString(), ms: ms, vto: desc, http: res.status, overlap: overlapAtSend, text: text.slice(0, 2500) }); while (rj.length > 15) rj.shift(); ls.set('vtoRejects', rj); }   // every rejection, full text, in "copy"
        const msg = shortReason(full0);
        const code = smsCode(full0);   // 4.24
        // SMS-9999 while another accept was being processed = Amazon busy with that one (not a real try, not an error)
        // 4.51: EVERY SMS-9999 = busy (an earlier accept that timed out, or one from your phone, can still be in progress)
        const busy = /in progress|another request|concurrent|simultaneous|too many|throttl|rate limit|try again|please wait/i.test(full0) ||
          /SMS-9999/.test(full0);
        // 4.6: SMS-9999 although NO other accept was waiting = one-at-a-time does not explain it -> its own clear line
        if (/SMS-9999/.test(full0) && !overlapAtSend && inFlight.size <= 1 && !pageAccepts) {
          const fa = ls.get('vtoFoundAt', {})[id];   // 4.51: kept in copy only; the log shows the "Amazon busy" line below
          const so = ls.get('vtoSms9999Solo', []); so.push(new Date().toLocaleString() + ' ' + desc + ' | ' + ms + 'ms answer' + (fa ? ' | sent ' + ((t0 - fa) / 1000).toFixed(1) + 's after found' : '') + ' | ' + (busy ? 'treated as busy (text matched)' : 'treated as rejected') + ' | ' + text.slice(0, 600));
          while (so.length > 15) so.shift(); ls.set('vtoSms9999Solo', so);
        }
        // 4.24: SMS-2001 (full) and SMS-2002 (expired) are final answers: no more pointless retries (10/16: 2 tries at a full VTO)
        const full = !busy && code !== 'SMS-2000' && (code === 'SMS-2001' || code === 'SMS-2002' || /full|capacity|no longer|not available|unavailable|already|taken|filled/i.test(msg));
        if (!busy && code === 'SMS-2000' && !(prevSt && prevSt.res === 'ok')) {
          // 4.24: SMS-2000 = already yours (an earlier accept that got no answer did go through)
          setD(id, { res: 'ok', desc: desc, final: true });
          bump('accepted');
          addAccepted(desc, 'direct');
          addResult('ok', desc, 'direct (already yours)', t0);   // 4.56: send -> answer
          setLast('ok', 'ACCEPTED (direct) ' + desc);
          logAction('OK ACCEPTED (Amazon says already yours, SMS-2000, ' + ms + 'ms): ' + desc);
          document.title = 'VTO ACCEPTED';
          soundWin();
          return;
        }
        if (full && prevSt && prevSt.res === 'full' && !prevSt.closedSeen) {
          // still full (Amazon's list has not caught up yet): already counted as lost once - no new lost / MISSED
          setD(id, { res: 'full', desc: desc, final: true });
          logAction('still full (' + ms + 'ms): ' + desc);
        } else if (full) {
          setD(id, { res: 'full', desc: desc, final: true });
          missed(desc, 'Amazon answered the direct accept with ' + (code === 'SMS-2002' ? '"expired" (SMS-2002' : code === 'SMS-2001' ? '"full" (SMS-2001' : '"full" (') + (code === 'SMS-2001' || code === 'SMS-2002' ? ', ' : '') + ms + 'ms)', text);
        } else if (busy && (prevB || 0) < BUSY_MAX) {
          // Amazon is still busy with another accept: not a real try, retry quickly one at a time
          lastBusyAt = Date.now();
          setD(id, { res: 'rejected', n: prevN, b: (prevB || 0) + 1, busy: true, desc: desc });
          logAction('!! accept rejected (Amazon busy, ' + ms + 'ms' + (overlapAtSend ? '' : ', nothing else waiting') + '): ' + desc + ' - ' + msg + ' - retrying');
        } else {
          // not a clear "full": try again (up to 3x). Counted as lost only if the VTO then fills up without us.
          const n = prevN + 1;
          setD(id, { res: 'rejected', n: n, b: prevB || 0, desc: desc });
          if (n === 1) addError('accept rejected', desc, text);
          // after 3 tries: keep trying every 1 s while it is open; log every 5th try only
          if (n <= RETRY_MAX || n % 5 === 0) logAction('!! accept rejected (try ' + n + (n <= RETRY_MAX ? '/' + RETRY_MAX : '') + ', ' + ms + 'ms): ' + desc + ' - ' + msg + (n < RETRY_MAX ? ' - retrying' : ' - still trying every 1 s'));
        }
      }
    } catch (e) {
      const n = prevN + 1;
      const m = e && e.name === 'AbortError' ? 'timeout (result unknown)' : (e && e.message) || 'error';
      setD(id, { res: 'error', n: n, b: prevB || 0, desc: desc, timedOut: !!(e && e.name === 'AbortError') });
      if (n === 1) addError(e && e.name === 'AbortError' ? 'accept got no answer (timeout)' : 'accept network error', desc, m);
      if (n <= RETRY_MAX || n % 5 === 0) logAction('!! network error (try ' + n + (n <= RETRY_MAX ? '/' + RETRY_MAX : '') + '): ' + m + (n < RETRY_MAX ? ' - retrying' : ' - still trying every 1 s'));
    } finally {
      clearTimeout(to);
      inFlight.delete(id); delete inFlightAt[id];
      if (!inFlight.size) stopAcceptingSound();   // 4.62: no answer to wait for any more (error / timeout)
      // retry / next open VTO right away
      if (DIRECT_ACCEPT && lastOpen.length && !signedOutFlag) { try { fireDirect(lastOpen); } catch (e) {} }
    }
  }
  // Amazon's error text starts with a long "Request [DropShiftResolver[...]]" dump; the reason is at the end
  function shortReason(m) {
    m = String(m || '').replace(/\s+/g, ' ').trim();
    const k = m.lastIndexOf(']');
    let r = k > -1 && k < m.length - 3 ? m.slice(k + 1).replace(/^[\s:;,.-]+/, '') : m;
    if (r.length > 160) r = '...' + r.slice(-160);
    return r || m.slice(-160);
  }

  /* ================= BACKGROUND LIST CHECK ================= */
  function findButton(text) {
    const els = document.querySelectorAll('button, [role="button"]');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.disabled) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t === text && (el.offsetParent || (el.getClientRects && el.getClientRects().length))) return el;
    }
    return null;
  }

  function handleList(j, src) {
    src = src || 'own check';
    const found = [];
    collect(j && j.data, found, new WeakSet(), 0);
    const byId = new Map();
    const noId = [];
    found.forEach(function (o) {
      const id = getId(o);
      if (id) { if (!byId.has(id)) byId.set(id, o); } else noId.push(o);
    });
    const all = Array.from(byId.values());
    const open = all.filter(isOpen);
    // 4.6: accept FIRST - all logging / saving below happens after the accept has left
    lastOpen = open;
    if (DIRECT_ACCEPT && open.length) fireDirect(open);
    listCount = all.length + noId.length;
    openCount = open.length + noId.filter(isOpen).length;
    const sig = open.map(getId).sort().join('|');
    const prev = ss.get('vtoSig');

    // quietly keep the raw text of a VTO that is listed but not open yet (shown only in "copy")
    const allSig = all.map(function (o) { return getId(o) + (isOpen(o) ? '+' : '-'); }).sort().join('|');
    if (allSig !== ss.get('vtoAllSig')) {
      ss.set('vtoAllSig', allSig);
      const notYet = all.filter(function (o) { return !isOpen(o); }).filter(function (o) { return !ls.get('vtoSeenIds', []).includes(getId(o)); });
      if (notYet.length) {
        const seen = ls.get('vtoSeenIds', []).concat(notYet.map(getId)).slice(-100); ls.set('vtoSeenIds', seen);
        try { ls.set('vtoLastNotOpenRaw', new Date().toLocaleString() + ' (listed, not open)\n' + JSON.stringify(notYet[0]).slice(0, 3000)); } catch (e) {}
      }
    }
    if (open.length && sig !== prev) {
      logAction('* OPEN VTO FOUND (' + open.length + ', ' + src + '): ' + open.map(describe).join(' ; '));
      ls.set('vtoLastFoundT', Date.now());
      try { ls.set('vtoLastVtoRaw', new Date().toLocaleString() + ' (found)\n' + JSON.stringify(open[0]).slice(0, 3000)); } catch (e) {}
    }
    // when each open VTO was first seen (for the speed shown on its result line)
    { const fa = ls.get('vtoFoundAt', {}); let ch = false; const ids = new Set(open.map(getId));
      ids.forEach(function (id) { if (id && !fa[id]) { fa[id] = Date.now(); ch = true; } });
      Object.keys(fa).forEach(function (k) { if (!ids.has(k)) { delete fa[k]; ch = true; } });
      if (ch) ls.set('vtoFoundAt', fa); }
    // 4.51: an open VTO without an id can't be accepted directly (never seen so far): one log line so we know
    if (noId.some(isOpen) && !ss.get('vtoNoIdLogged')) { ss.set('vtoNoIdLogged', '1'); logAction('!! open VTO without an id - cannot accept it directly'); }
    // remember VTOs we tried that the list now shows filled, so if one opens again it is accepted at once
    { const d = dstate(); let ch = false;
      all.forEach(function (o) { const st = d[getId(o)]; if (st && st.res !== 'ok' && !isOpen(o) && !st.closedSeen) { st.closedSeen = true; ch = true; } });
      if (ch) ls.set('vtoDirect', d); }
    settleTried(open, byId);

    // 4.6: these page refreshes only help backup CLICKING; while direct accept is working they would only
    // make the script blind for 1-3 s (bad during multi-VTO drops), so they happen only when clicking is needed
    const needPage = !DIRECT_ACCEPT || !template;   // 4.51: no backup clicking, so no refreshes for it
    if (prev === null) {
      ss.set('vtoSig', sig);
    } else if (sig !== prev) {
      ss.set('vtoSig', sig);
      logAction('list changed - open VTOs now: ' + open.length + (needPage ? '' : ' (no refresh - direct accept handles it)'));
      if (needPage) reload('open VTO list changed');
    }

    // list says open but page shows no Accept button -> reload (max MAX_TRIES)
    if (needPage && openCount > 0 && !inFlight.size && !reloading && !findButton('Accept')) {
      if (!missingSince) missingSince = Date.now();
      else if (Date.now() - missingSince > 1200) {
        const tries = parseInt(ss.get('vtoTries') || '0', 10);
        if (tries < MAX_TRIES) {
          ss.set('vtoTries', String(tries + 1));
          missingSince = 0;
          reload('list shows open VTO but no Accept button on page');
        }
      }
    } else {
      missingSince = 0;
      if (openCount === 0 || findButton('Accept')) ss.set('vtoTries', '0');
    }
  }

  // A VTO we tried (rejected / network error) that is no longer open: accepted by clicking, or filled by someone else.
  function settleTried(open, byId) {
    const now = Date.now();
    const openIds = new Set(open.map(getId));
    const d = dstate();
    let changed = false;
    Object.keys(d).forEach(function (id) {
      const st = d[id];
      if (st.final || st.res === 'ok' || !(st.res === 'rejected' || st.res === 'error') || now - st.t > 600000) return;
      if (openIds.has(id) || inFlight.has(id)) { if (st.goneAt) { delete st.goneAt; changed = true; } return; }
      if (!st.goneAt) { st.goneAt = now; changed = true; return; }
      if (now - st.goneAt < 5000) return;          // give clicking a moment to finish and record itself
      st.final = true; changed = true;
      const item = byId.get(id);
      const raw = item ? JSON.stringify(item.unavailability || item.eligibility || '') : 'gone from list';
      if (clickAcceptedMatch(st.desc, st.goneAt) || /accept/i.test(raw)) return;
      const k = vtoKey(st.desc);   // the page already said "full" for this one (already counted as lost)
      if (k && ls.get('vtoFullSeen', []).some(function (a) { return a.key === k && now - a.t < 900000; })) return;   // got it by clicking (already counted)
      missed(st.desc || id, 'filled while the direct accept was being retried (list: ' + raw.slice(0, 200) + ')', (ls.get('vtoRejects', []).filter(function (r) { return r.vto === st.desc; }).pop() || {}).text);
    });
    if (changed) ls.set('vtoDirect', d);
  }
  // "Wed, 10/14, 2:30 PM - 6:30 PM [e2b676]"  ->  "10/14 2:30pm"
  function vtoKey(t) {
    t = String(t || '');
    let m = /(\d{1,2})\/(\d{1,2}),?\s+(\d{1,2}:\d{2})\s*([AP]M)/i.exec(t);
    if (m) return (+m[1]) + '/' + (+m[2]) + ' ' + m[3] + m[4].toLowerCase();
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    m = /([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2})\b[\s\S]*?(\d{1,2}:\d{2})\s*([ap]m)/i.exec(t);
    if (m && MON[m[1].toLowerCase()]) return MON[m[1].toLowerCase()] + '/' + (+m[2]) + ' ' + m[3] + m[4].toLowerCase();
    return '';
  }
  function clickAcceptedMatch(desc, goneAt) {
    const k = vtoKey(desc);
    return ls.get('vtoClickAccepts', []).some(function (a) {
      if (k && a.key) return a.key === k && Date.now() - a.t < 900000;
      return Math.abs(a.t - (goneAt || 0)) < 30000;   // details unknown: a click-accept right around then -> don't call it lost
    });
  }
  // the VTO a button belongs to, from the page text: "Wed, Oct 14, 2:30pm - 6:30pm"
  function vtoTextNear(el) {
    try {
      const TIME = /(\d{1,2}:\d{2}\s*[ap]m)\s*[-\u2013]\s*(\d{1,2}:\d{2}\s*[ap]m)/i;
      const DAY = /((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Z][a-z]{2}[a-z]*\.?\s+\d{1,2})/;
      const txt = function (n) { return String(n.innerText || n.textContent || ''); };
      let time = '', day = '';
      const dlg = el.closest('[role="dialog"],[role="alertdialog"],dialog');
      if (dlg) {
        const t = txt(dlg), m = TIME.exec(t), dm = DAY.exec(t);
        if (m) time = m[1] + ' - ' + m[2];
        if (dm) day = dm[1];
      } else {
        let n = el;
        for (let i = 0; i < 12 && n && n !== document.body; i++, n = n.parentElement) {
          if (!time) { const m = TIME.exec(txt(n)); if (m) time = m[1] + ' - ' + m[2]; }
          if (time && !day) {
            let sib = n.previousElementSibling;
            while (sib) { const st = txt(sib); if (!TIME.test(st)) { const dm = DAY.exec(st); if (dm) { day = dm[1]; break; } } sib = sib.previousElementSibling; }
          }
          if (time && day) break;
        }
      }
      time = time.replace(/\s+/g, '').replace(/[-\u2013]/, ' - ').toLowerCase();
      return (day ? day.replace(/\s+/g, ' ') + ', ' : '') + time;
    } catch (e) { return ''; }
  }

  async function pollApi() {
    if (pollsInFlight >= (inBurst() ? BURST_MAX_IN_FLIGHT : 2)) return;   // the next check goes out while the previous one still waits for Amazon (4.24: 4 at once from :59:59 to :00:05)
    if (!template) { lastError = 'waiting to capture list request'; return; }
    pollsInFlight++;
    const seq = ++pollSeq;
    const ctl = new AbortController();
    const to = setTimeout(function () { ctl.abort(); }, POLL_TIMEOUT_MS);
    const tSent = Date.now();
    try {
      const res = await origFetch(API_URL, { method: 'POST', credentials: 'include', headers: hdrs(), body: template, signal: ctl.signal, redirect: 'manual' });
      if (res.type === 'opaqueredirect') { lastError = 'redirected (login page?)'; signedOut('redirected - session likely expired'); return; }
      if (res.status === 401 || res.status === 403) { lastError = 'HTTP ' + res.status; signedOut('list HTTP ' + res.status); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const tGot = Date.now();
      if (!nearSleep(tGot)) speedAdd(tGot - tSent);   // 4.55: check speed (copy only)
      if (tGot - tSent > BURST_SLOW_MS && inBurstWin(new Date(tSent))) burstOff('a check took ' + (tGot - tSent) + 'ms');
      if (j.errors && !j.data) {
        const m = (j.errors[0] && j.errors[0].message) || 'GraphQL error';
        if (/unauthor|not authenticated|expired|forbidden/i.test(m)) signedOut(m);
        throw new Error('GraphQL: ' + m);
      }
      lastPollOK = Date.now();
      netFails = 0;
      const netDown = ls.get('vtoNetDownAt', 0);
      if (netDown) {
        ls.set('vtoNetDownAt', 0);
        // 4.41: the internet is back: the "no internet" line gets its end time (no separate log line)
        if (ls.get('vtoNetShown', false)) {
          const at = ls.get('vtoNetErrAt', 0), e = ls.get('vtoErrors', []);
          const k = e.findIndex(function (x) { return x.t === at && x.what === 'no internet'; });
          if (k > -1 && !e[k].until) { e[k].until = Date.now(); ls.set('vtoErrors', e); }
        }
        ls.set('vtoNetShown', false);
      }
      if (!window.__hbT || lastPollOK - window.__hbT > 5000) { window.__hbT = lastPollOK; ls.set('vtoHeartbeat', lastPollOK); setShared('vtoHb', lastPollOK); }
      if (window.__lastPollT && Date.now() - window.__lastPollT > 5000 && !nearSleep(Date.now())) {   // 4.29: not the gap from the Mac sleeping
        logAction('check gap ' + Math.round((Date.now() - window.__lastPollT) / 1000) + 's');
      }
      window.__lastPollT = Date.now();
      checks++;
      lastError = '';
      if (signedOutFlag) { signedOutFlag = false; if (origTitle) document.title = origTitle; logAction('signed in again'); }
      // answers can arrive out of order: never let an older list overwrite a newer one
      if (seq > pollDoneSeq) { pollDoneSeq = seq; handleList(j, 'own check'); }
    } catch (e) {
      lastError = e && e.name === 'AbortError' ? 'check timeout' : (e && e.message) || 'error';
      if (e && e.name === 'AbortError' && !reloading && !pageLeaving) speedTimeout();   // 4.55
      if (inBurstWin(new Date(tSent)) && !reloading && !pageLeaving) burstOff('a check failed: ' + lastError);
      // a check cancelled by a page refresh/close fails the same way, so ignore those and
      // only call it "no internet" after 3 network failures in a row (about 3 s)
      if (!reloading && !pageLeaving && ((e && e.name === 'TypeError') || navigator.onLine === false)) {
        netFails++;
        if (netFails >= 3 && !ls.get('vtoNetDownAt', 0)) { ls.set('vtoNetDownAt', Date.now() - 2000); netDownNote('!! no internet - checks failing (' + lastError + ')', lastError); }
      }
    } finally {
      clearTimeout(to);
      pollsInFlight--;
    }
  }

  /* ================= CLICKING FALLBACK ================= */
  // each pop-up button: when it appeared and its clicks (used for the re-clicks and the stuck idle prompt)
  const popTrack = {};
  function watchPop(text, el) {
    const now = Date.now(), tr = popTrack[text];
    if (el && !tr) popTrack[text] = { seen: now, clicks: [] };
    else if (!el && tr) delete popTrack[text];
  }
  function clickOnce(text, gap, label) {
    const now = Date.now();
    if (lastClick[text] && now - lastClick[text] < gap) return false;
    const el = findButton(text);
    if (!el) return false;
    lastClick[text] = now;
    let dlg = '';
    if (text === 'Stay logged in') {
      try {
        let n = el.closest('[role="dialog"],[role="alertdialog"],dialog,[class*="modal" i],[class*="dialog" i]');
        if (!n) { n = el; for (let i = 0; i < 4 && n.parentElement && n.parentElement !== document.body; i++) n = n.parentElement; }
        const dt = String(n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
        // the normal idle prompt is known ("Are you still there? ... 60 seconds"), so only its short name is logged;
        // any OTHER wording is logged in full so a different warning is not missed
        dlg = /are you still there/i.test(dt) ? '' : ' | different dialog said: "' + dt.slice(0, 220) + '"';
      } catch (e) {}
    }
    el.click();
    const tr = popTrack[text]; const repeat = !!(tr && tr.clicks.length); if (tr) tr.clicks.push(now);
    if (gap <= 300) setTimeout(function () { try { tick(); } catch (e) {} }, gap + 10);   // next re-click right on time if the pop-up is still there
    if (text === 'Stay logged in') {
      stayAdd();
      // one log line per prompt; later clicks on the same prompt are counted, not logged again
      if (now - stayPromptAt > 60000) { stayPromptAt = now; stayPromptClicks = 1; logAction('clicked ' + (label || text) + dlg); }
      else stayPromptClicks++;
      return true;
    }
    if (!repeat) logAction('clicked ' + (label || text) + dlg);   // quick re-clicks on the same pop-up are not logged again
    return true;
  }
  let stayPromptAt = 0, stayPromptClicks = 0;

  function tick() {
    if (!document.body || reloading) return;   // nothing to click while the page is refreshing
    // idle prompt: click "Stay logged in" every 0.25 s while it shows (a pop-up can ignore a click while it is still sliding in).
    // If it is still there after 8 s, refresh the page - that clears it and keeps you logged in.
    watchPop('Stay logged in', findButton('Stay logged in'));
    watchPop('Accept VTO', findButton('Accept VTO'));
    watchPop('OK', findButton('OK'));
    // 4.28: never from :59:55 to :00:30 (the drop seconds). It keeps clicking meanwhile and refreshes at :00:30 if still stuck -
    // under 60 s after the prompt appeared, so the prompt's 60 s count never runs out.
    if (popTrack['Stay logged in'] && Date.now() - popTrack['Stay logged in'].seen > 8000 && Date.now() - stayPromptAt < 60000 && !reloading && !inBoost()) {
      logAction('idle prompt did not close after ' + stayPromptClicks + ' clicks in 8 s - refreshing page');   // routine with a hidden tab: not counted as an error
      stayPromptClicks = 0; noReloadUntil = 0; pendingReload = null;
      reload('idle prompt stuck - refresh to stay logged in');
      return;
    }
    if (clickOnce('Stay logged in', 250, '"Stay Logged In"')) { noReloadUntil = Date.now() + 10000; return; }
    const txt = document.body.innerText || '';
    if (/VTO already full/i.test(txt)) {
      const last = parseInt(ss.get('vtoFullAt') || '0', 10);
      if (Date.now() - last > 5000) {
        ss.set('vtoFullAt', String(Date.now()));
        const which = reviewText || cardText;
        const fs = ls.get('vtoFullSeen', []); fs.push({ t: Date.now(), key: vtoKey(which) }); while (fs.length > 10) fs.shift(); ls.set('vtoFullSeen', fs);
        missed(which, 'the page said "VTO already full" (backup clicking)', '');
        reload('page says VTO already full');
        return;
      }
    }
    const reviewBtn = findButton('Accept VTO');
    if (reviewBtn) { const rt = vtoTextNear(reviewBtn); reviewText = rt && /^[A-Z][a-z]/.test(rt) ? rt : (cardText || rt || reviewText); }   // prefer text that includes the day
    if (/VTO accepted/i.test(txt) && clickOnce('OK', 250, 'OK (VTO accepted pop-up)')) {
      if (Date.now() - clickedAcceptVtoAt < 30000 && popTrack['OK'] && popTrack['OK'].clicks.length === 1) {   // count the accept once per pop-up
        clickedAcceptVtoAt = 0;
        const what = reviewText || '(VTO details not found on page)';
        const ca = ls.get('vtoClickAccepts', []); ca.push({ t: Date.now(), key: vtoKey(what), text: what }); while (ca.length > 10) ca.shift(); ls.set('vtoClickAccepts', ca);
        reviewText = '';
        bump('accepted');
        addAccepted(what, 'clicks');
        { const lf = ls.get('vtoLastFoundT', 0); addResult('ok', what, 'clicks', lf && Date.now() - lf < 120000 ? lf : null); }
        setLast('ok', 'ACCEPTED (via clicks) ' + what);
        logAction('OK ACCEPTED (via clicks): ' + what);
        document.title = 'VTO ACCEPTED';
        soundWin();
      }
      return;
    }
    // 4.52: no accept clicks at all (card "Accept" and review "Accept VTO" removed); every accept goes direct
  }

  /* ================= STATUS BOX ================= */
  let box = null, headLabel = null, bodyEl = null, flashEl = null;
  // 4.30: some text inside the box is selected
  function selInBox() {
    try { const sel = window.getSelection(); return !!(box && sel && !sel.isCollapsed && sel.rangeCount && (box.contains(sel.anchorNode) || box.contains(sel.focusNode))); } catch (e) { return false; }
  }
  // a click outside the box clears a box selection (the page may block that itself); a selection never holds the box for more than 2 min
  let selSince = 0;
  function holdForSel() {
    if (!selInBox()) { selSince = 0; return false; }
    if (!selSince) selSince = Date.now();
    if (Date.now() - selSince < 120000) return true;
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    selSince = 0; return false;
  }
  document.addEventListener('mousedown', function (e) { try { if (box && !box.contains(e.target) && selInBox()) window.getSelection().removeAllRanges(); } catch (err) {} }, true);
  let boxKey = '', liveEl = null;   // 4.26: redraw the box only when something in it changed
  let collapsed = ls.get('vtoBoxCollapsed', false);

  function diag() {
    return [
      'VTO script ' + VERSION,
      'time ' + new Date().toString(),
      'tab ' + document.visibilityState,
      'list request: ' + templateSrc,
      'priority: ' + (nightFirst() ? 'Night Shift (night shift VTOs first, then soonest)' : 'Normal (soonest first)'),
      'timers ' + timerMode,
      'list ' + listCount + ' open ' + openCount + ' checks ' + checks,
      'last error: ' + lastError,
      '--- check speed: how long Amazon takes to answer a list check (4.55; compare Mac and PC at similar hours)', speedLines(),
      'stats ' + JSON.stringify(stats()),
      '--- vto events', ls.get('vtoEvents', []).join('\n'),
      '--- VTO results', ls.get('vtoResults', []).map(function (r) { return r.day + ' ' + resultLine(r); }).join('\n'),
      '--- errors (with how they ended)', ls.get('vtoErrors', []).map(function (x) { return x.day + ' ' + tShort(x.t) + ' ' + x.what + (x.vto ? ', ' + x.vto : '') + ' -> ' + errorOutcome(x) + (x.detail ? '\n  ' + x.detail : ''); }).join('\n'),
      '--- missed details', ls.get('vtoMisses', []).join('\n'),
      '--- extra-fast :00 checks switched off for the hour (copy only)', ls.get('vtoBurstOff', []).join('\n') || 'none',
      '--- SMS-9999 with nothing else in flight (4.6)', ls.get('vtoSms9999Solo', []).join('\n') || 'none',
      '--- rejected accepts (every one, full Amazon text)', ls.get('vtoRejects', []).map(function (r) { return r.at + ' ' + r.vto + ' (' + r.ms + 'ms, HTTP ' + r.http + (r.overlap === undefined ? '' : r.overlap ? ', another accept was waiting' : ', nothing else waiting') + ')\n' + r.text; }).join('\n'),
      '--- last new VTO as Amazon sent it', ls.get('vtoLastVtoRaw', ''),
      '--- last VTO listed but not open yet', ls.get('vtoLastNotOpenRaw', ''),
      '--- list request variables', (function () { try { return JSON.stringify(JSON.parse(template).variables); } catch (e) { return '?'; } })(),
      '--- authentication session (4.40)', ls.get('vtoSessions', []).map(function (e) { return sessLine(e).parts.map(function (p) { return p.t; }).join('').trim(); }).join('\n') || 'none yet',
      '--- signed out', ls.get('vtoSignErrors', []).join('\n'),
      '--- gaps that were not a sign-out (4.29: log only, not In-N-Out)', ls.get('vtoGaps', []).join('\n') || 'none',
      '--- sign-ins (passkey asked or not)', ls.get('vtoSignIns', []).join('\n'),
      '--- passkey (last one recorded; a new one is needed about every 24 h)', ((passkeyLine() || {}).t || 'no passkey sign-in recorded yet') +
        '\ntab title: ' + document.title + ' | reset: ' + JSON.stringify(ls.get('vtoResetResult', null)),
      '--- stay logged in clicks (this login)', (function () { const v = stayGet(); return v ? 'login since ' + new Date(v.since).toLocaleString() + ': ' + v.clicks.filter(function (t) { return t >= v.since; }).map(hhmmss).join(', ') : ''; })(),
      '--- reloads', ls.get('vtoReloads', []).join('\n'),
      '--- log', ls.get('vtoLog', []).join('\n')
    ].join('\n');
  }
  function flash(msg) {
    if (!flashEl) return;
    flashEl.textContent = msg;
    setTimeout(function () { if (flashEl) flashEl.textContent = ''; }, 1500);
  }
  // 4.26: solid buttons (box purple, white text), lighter on hover, pressed down a little on click
  function mkBtn(label, fn, color, bg) {
    bg = bg || '#ffffff';   // 4.60: header buttons are white with blue words (was purple)
    if (!color && bg === '#ffffff') color = C_HEAD2;
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:' + bg + ';color:' + (color || '#ffffff') + ';border:0;border-radius:5px;font:bold 11px/1.4 \'JetBrains Mono\',Menlo,Consolas,monospace;padding:2px 8px;cursor:pointer;display:inline-flex;align-items:center;vertical-align:middle;box-shadow:0 1px 2px rgba(0,0,0,.4);';
    b.addEventListener('mouseenter', function () { b.style.background = bg === '#ffffff' ? '#dbe6ff' : '#34405c'; });   // 4.60
    b.addEventListener('mouseleave', function () { b.style.background = bg; b.style.transform = ''; });
    b.addEventListener('mousedown', function () { b.style.transform = 'translateY(1px)'; });
    b.addEventListener('mouseup', function () { b.style.transform = ''; });
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    return b;
  }
  // 4.26: fold button: "–" while open, four-corner expand icon (like YouTube's full screen) while folded
  let foldBtn = null;
  function setFoldIcon() {
    if (!foldBtn) return;
    foldBtn.textContent = '';
    foldBtn.title = collapsed ? 'open the box' : 'fold the box';
    if (!collapsed) { foldBtn.textContent = '–'; return; }
    try {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z');
      p.setAttribute('fill', 'currentColor');
      svg.appendChild(p); foldBtn.appendChild(svg);
    } catch (e) { foldBtn.textContent = '+'; }
  }
  function copyText(t) {
    try {
      navigator.clipboard.writeText(t).then(function () { flash('copied'); }, function () { fallbackCopy(t); });
    } catch (e) { fallbackCopy(t); }
  }
  function fallbackCopy(t) {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); flash('copied');
    } catch (e) { flash('copy failed'); }
  }

  function loadFont() {
    // JetBrains Mono from Google Fonts; if the page blocks it (or it is installed on the PC already), the box falls back to Menlo/Consolas
    try {
      if (document.getElementById('vto-font')) return;
      const l = document.createElement('link');
      l.id = 'vto-font'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap';
      (document.head || document.documentElement).appendChild(l);
    } catch (e) {}
  }
  function buildBox() {
    if (box || !document.body) return;
    loadFont();
    box = document.createElement('div');
    // 4.26: as wide as its longest fixed line (header, status lines, In-N-Out); long lines wrap; scrolls up and down
    box.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:2147483647;width:max-content;max-width:96vw;max-height:70vh;overflow-y:auto;overflow-x:hidden;background:#0d111c;color:#ece8df;font:13px/1.6 "JetBrains Mono",Menlo,Consolas,monospace;border:1px solid #272d3b;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.55);user-select:text;-webkit-user-select:text;cursor:auto;';
    // 4.30: you can select and copy any box text (Cmd+C); mouse, selection and copy events stay in the box, not the page
    ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'selectstart', 'copy'].forEach(function (n) { box.addEventListener(n, function (e) { e.stopPropagation(); }); });
    box.id = 'vto-box';
    const selCss = document.createElement('style');   // also when the page turns text selection off for everything
    selCss.textContent = '#vto-box, #vto-box * { -webkit-user-select: text !important; user-select: text !important; }';
    box.appendChild(selCss);
    const head = document.createElement('div');
    head.style.cssText = 'position:sticky;top:0;padding:6px 8px 6px 12px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;gap:12px;white-space:pre;';
    headLabel = document.createElement('span');
    const btns = document.createElement('span');
    btns.style.cssText = 'display:flex;gap:5px;align-items:center;';
    flashEl = document.createElement('span');
    flashEl.style.cssText = 'font-size:11px;';
    btns.appendChild(flashEl);
    // 4.44: "log out" sits in the header (two clicks within 5 s); Critical Alert moved to the line where log out was
    btns.appendChild(mkBtn('log out', resetPasskey));   // 4.60: white with blue words like the other header buttons
    // 4.36: "test" asks VTO Phone Alerts to send a test alert to your phone (it holds the Pushover keys). Not near :00.
    btns.appendChild(mkBtn('test', function () {
      if (nearDrop()) { flash('near :00 - try after :01'); return; }
      ls.set('vtoTestAlertAt', Date.now()); flash('test sent');
    }));
    btns.appendChild(mkBtn('copy', function () { copyText(diag()); }));
    btns.appendChild(mkBtn('clear', function () { ls.set('vtoLog', []); ls.set('vtoReloads', []); ls.set('vtoBoxClearedAt', Date.now()); flash('cleared'); }));   // everything stays in copy
    foldBtn = mkBtn('', function () { collapsed = !collapsed; ls.set('vtoBoxCollapsed', collapsed); setFoldIcon(); render(); });
    setFoldIcon();
    btns.appendChild(foldBtn);
    head.appendChild(headLabel);
    head.appendChild(btns);
    bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'padding:8px 12px 10px;';
    box.appendChild(head);
    box.appendChild(bodyEl);
    box.__head = head;
    document.body.appendChild(box);
  }

  /* ================= LOG COLORS ================= */
  // text colors: Dracula's bright set (from Martin's picture); background: the darker purple Martin preferred
  const C_ACCEPT = '#50fa7b';   // green: accepted
  const C_BASE = '#ece8df';     // 4.63: off-white normal box text, same as Transfer Schedule (was pure white)
  const C_YEL = '#f6ff9c';      // yellow: missed / [Closed]
  const C_SECT = '#60a5fa';     // 4.63: sky blue section names (lighter than the header bar)
  const C_HEAD2 = '#2563eb';    // 4.60: medium blue: top bar while watching + section names (was purple)
  const C_MISS = '#f82d2d';     // 4.60: red: missed / full
  const C_HEADTXT = '#ece8df';  // 4.60: off-white header text on the blue bar (same as Transfer Schedule)
  const C_PURPLE = '#bd93f9';   // 4.65: purple: you clicked log out / you signed out inside A to Z
  const C_MINT = '#a6f0c6';     // mint: [Remembered]
  const C_BAD = '#ff92df';      // pink: passkey close/due (signed out + check problems are orange since 4.20, missed is yellow since 4.13)
  const C_WARN = '#ffa94d';     // orange: warnings
  const C_CYAN = '#8be9fd';     // cyan: [Auto] [Reset]
  const C_RED = '#ff5555';      // red: [Passkey] (Amazon asked for your passkey)
  const C_TAG = '#ece8df';      // white: In-N-Out reasons that are not a problem ([SelfClosed], [ShutDown]...)
  // log line colors: accepted = green; signed out, delays, errors = orange; missed = pink; everything else white
  function lineColor(t) {
    if (t.indexOf('SIGNED OUT') > -1 || t.indexOf('not logged in') > -1) return C_WARN;   // 4.20: orange
    if (t.indexOf('check gap') > -1 || t.indexOf('fallback:') > -1 || t.indexOf('HIDDEN') > -1 || t.indexOf('DELAYED') > -1 ||
        t.indexOf('was asleep') > -1 || t.indexOf('no internet') > -1 || t.indexOf('internet back') > -1) return C_WARN;
    if (t.indexOf('OK ACCEPTED') > -1) return C_ACCEPT;
    if (t.indexOf('MISSED') > -1 || t.indexOf('NOT ACCEPTED') > -1 || /\bfull\b/i.test(t) || /\sX\s/.test(t)) return C_MISS;   // 4.60: red (missed / full)
    if (t.indexOf('!!') > -1 || /error|failed|rejected/i.test(t)) return C_WARN;   // 4.26: anything error related is orange (was pink)
    return null;
  }
  // anything about an actual sign-out is fully red
  // 4.60: "  04:35:07 PM rest" -> white time, the rest in its color
  function timeParts(t, c) {
    const m = /^(\s*\d{1,2}:\d{2}:\d{2}\s?[AP]M )([\s\S]*)$/.exec(t);
    return m ? [{ t: m[1], c: C_BASE }, { t: m[2], c: c }] : [{ t: t, c: c }];
  }
  function signParts(t) { return [{ t: t, c: C_WARN }]; }   // 4.20: orange
  function mkLine(item) {
    const d = document.createElement('div');
    if (item && item.heading) {   // 4.13: section name - purple capitals with a line above
      d.textContent = item.heading;
      d.style.cssText = 'border-top:1px solid #272d3b;margin-top:7px;padding-top:7px;color:' + C_SECT + ';font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;';
      return d;
    }
    // 4.26: fixed lines (status, In-N-Out) never wrap and set the box width; all other lines wrap inside that
    // width (width 0 + min-width 100% keeps a long line from widening the box). Indented lines wrap under their text.
    const fix = !!(item && item.fix);
    let parts = typeof item === 'string' ? [{ t: item, c: lineColor(item) }] : (item.parts || [item]);
    let indent = false;
    if (!fix && parts.length && /^  \S/.test(parts[0].t || '')) { parts = [{ t: parts[0].t.slice(2), c: parts[0].c, w: parts[0].w }].concat(parts.slice(1)); indent = true; }   // 4.60: also lines with a white time
    d.style.cssText = fix ? 'white-space:pre;tab-size:4;'
      : 'white-space:pre-wrap;word-break:break-word;tab-size:4;width:0;min-width:100%;' + (indent ? 'padding-left:2ch;box-sizing:border-box;' : '');
    parts.forEach(function (p) {
      if (p.btn) { const b = mkBtn(p.btn, p.fn, p.c, p.bg || '#1b2130'); b.style.marginLeft = p.first ? '0' : '8px'; d.appendChild(b); return; }   // 4.26: a button inside a line
      const sp = document.createElement('span');
      sp.textContent = p.t;
      if (p.c) sp.style.color = p.c;
      if (p.w) sp.style.fontWeight = p.w;
      // red and pink look thinner than yellow/white on a dark background (same font weight, darker color);
      // a hairline outline in the same color evens that out so every line looks equally thick
      d.appendChild(sp);
    });
    return d;
  }

  // 4.17: last passkey time. First run: taken from the newest "PASSKEY ASKED" sign-in line already saved.
  function seedPasskeyAt() {
    try {
      const now = new Date();
      const mk = function (mo, d, hh, mm, ss, ap) {
        let h = +hh % 12; if (ap === 'PM') h += 12;
        const t = new Date(now.getFullYear(), +mo - 1, +d, h, +mm, +ss);
        if (t > now) t.setFullYear(t.getFullYear() - 1);
        return t.getTime();
      };
      let best = 0;
      // sign-ins list: "Wed, 10/14, 2:50:23 PM signed in ... PASSKEY ASKED ..."
      ls.get('vtoSignIns', []).forEach(function (x) {
        if (!/PASSKEY ASKED|passkey asked \(|password box shown/.test(x)) return;
        const m = String(x).match(/(\d{1,2})\/(\d{1,2}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)/);
        if (m) best = Math.max(best, mk(m[1], m[2], m[3], m[4], m[5], m[6]));
      });
      // In-N-Out lines tagged ">Passkey" (4.18): "Thu, 10/15, 8:40:03 PM SIGNED OUT - SIGNED IN 10:33:25 PM (..."
      ls.get('vtoSignErrors', []).forEach(function (x) {
        x = String(x); if (!/>Passkey\s*$/.test(x)) return;
        const d0 = x.match(/^\w{3}, (\d{1,2})\/(\d{1,2}),/);
        const m = x.match(/SIGNED IN (?:AUTOMATICALLY )?(?:\w{3}, (\d{1,2})\/(\d{1,2}), )?(\d{1,2}):(\d{2}):(\d{2}) (AM|PM)/);
        if (!m || !(m[1] || d0)) return;
        best = Math.max(best, mk(m[1] || d0[1], m[2] || d0[2], m[3], m[4], m[5], m[6]));
      });
      if (best > ls.get('vtoPasskeyAt', 0)) ls.set('vtoPasskeyAt', best);
    } catch (e) {}
  }
  function dayClock(t) { return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
  // 4.32: just the time of the last passkey. The last-chance / "covered until" guessing is removed.
  function passkeyLine() {
    try {
      const pk = ls.get('vtoPasskeyAt', 0); if (!pk) return null;
      return { t: 'passkey: ' + dayClock(pk) };
    } catch (e) { return null; }
  }
  // 4.32: no more pkdue in the title (the last-chance restart that read it is gone). This only strips any old pkdue left over.
  function applyPkTitle() {
    try {
      const base = String(document.title || '').replace(/\s*·?\s*pkdue=\d+/g, '').trim();
      if (document.title !== base) document.title = base;
    } catch (e) {}
  }
  // 4.25: "reset passkey" button: full sign-out, then the script signs in with your alias and you touch the fingerprint.
  // Click twice (the second click within 5 s). Never from :55 to :03, and not while an accept is waiting.
  function resetPasskey() {
    if (nearDrop()) { flash('near :00 - try after :01'); return; }   // 4.47: only around the 8 AM-2 PM drops
    if (inFlight.size) { flash('accepting - try again in a moment'); return; }
    // 4.47: one click (was two)
    setShared('vtoReset', Date.now());
    ls.set('vtoResetAt', Date.now());
    logAction('log out: pressed');
    reloading = true;   // not a closed page
    location.assign(RESET_URL);
  }
  // 4.25: after a reset that never reached the sign-in page (A to Z kept you signed in), say so
  function checkResetNoSignIn() {
    try {
      const at = ls.get('vtoResetAt', 0); if (!at || Date.now() - at > 15 * 60000) return;
      const r = ls.get('vtoResetResult', null); if (r && r.t >= at - 1000) return;
      const lw = loginWatch(); if (lw && lw.since >= at - 5000) return;   // a sign-in after the reset: checkGapAtStart reports it
      ls.set('vtoResetResult', { t: at, at: Date.now(), ok: false, signIn: false });
      logAction('!! log out did not sign you out - press it again');
    } catch (e) {}
  }
  function resetLine() {
    const r = ls.get('vtoResetResult', null);
    if (!r || Date.now() - r.at > 2 * 3600000) return null;
    return r.ok ? { t: 'reset passkey: done ' + dayClock(r.at), c: C_MINT }
      : { t: '!! reset passkey did not take - press it again', c: C_WARN };
  }
  function render() {
    applyPkTitle();
    if (!box) buildBox();
    if (!box) return;
    const age = (Date.now() - lastPollOK) / 1000;
    const last = ls.get('vtoLast', null);
    let status, bg;
    // 4.58: no orange SIGNED OUT bar (the virtual passkey signs you back in within seconds)
    if (inFlight.size) { status = 'ACCEPTING...'; bg = '#ffa94d'; }
    else if (last && last.kind === 'ok' && Date.now() - last.t < 30000) { status = 'VTO ACCEPTED'; bg = '#50fa7b'; }
    else if (!template) { status = 'WAITING FOR LIST REQUEST'; bg = '#ffa94d'; }
    else if (age > 8 && !signedOutFlag) { status = 'CHECKS DELAYED'; bg = '#ffa94d'; }
    else if (document.visibilityState === 'hidden') { status = timerMode === 'worker' ? 'WATCHING (TAB HIDDEN - WORKER ON)' : 'WATCHING (TAB HIDDEN - MAY SLOW)'; bg = timerMode === 'worker' ? C_HEAD2 : '#ffa94d'; }
    else { status = 'WATCHING'; bg = C_HEAD2; }

    // 4.26: API ON while good checks are coming in; API OFF (header turns orange) when signed out, no list request yet, or checks delayed
    box.__head.style.background = bg;
    box.__head.style.color = bg === C_HEAD2 ? C_HEADTXT : '#0d111c';   // 4.60: off-white on blue, dark on orange/green
    headLabel.textContent = 'VTO ' + VERSION + ' | ' + status;   // 4.44: API ON / OFF removed (the header color already shows it)
    bodyEl.style.display = collapsed ? 'none' : 'block';
    if (collapsed) { boxKey = ''; return; }
    if (holdForSel()) return;   // 4.30: you are selecting box text: no body redraw until the selection is cleared

    const s = stats();
    const L = [];
    // 4.26: this line changes every check, so only its text is updated (the rest of the box is redrawn only when it changes)
    L.push({ live: true, fix: true, t: 'checks: ' + (template ? age.toFixed(1) + 's ago | ' + checks + ' this load' : 'none yet') + ' | list ' + listCount + ' | open ' + openCount });
    if (inBoost()) L.push({ t: inBurst() ? 'EXTRA FAST (:00 drop)' : 'FAST (:00 drop window)', c: C_ACCEPT });   // 4.47: own line, green
    if (!DIRECT_ACCEPT) L.push({ t: '!! mode: clicking only (direct accept off)', c: C_WARN });   // 4.26: shown only when not normal
    if (timerMode !== 'worker') L.push({ t: '!! timers: normal (slow if tab hidden)', c: C_WARN });
    const sv = stayGet();
    if (sv) L.push({ fix: true, t: 'signed in: ' + dur(Date.now() - sv.since) + ' ago | session reset at ~' + new Date(sv.since + 36000000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });   // 4.51: Amazon's 10 h limit   // 4.46: just this, on its own line (stay-click counts are kept in copy only)
    pkBoxLines().forEach(function (x) { L.push(x); });
    L.push({ fix: true, parts: [{ t: 'today: ' }, { t: 'accepted ' + s.accepted, c: C_ACCEPT }, { t: ' | ' }, { t: 'missed ' + s.lost, c: C_MISS }, { t: ' | ' }, { t: 'errors ' + s.errors, c: C_WARN }] });
    if (!signedOutFlag && template && age > 8) L.push({ t: '!! CHECKS DELAYED - last good check ' + Math.round(age) + 's ago', c: C_WARN });
    if (document.visibilityState === 'hidden' && timerMode !== 'worker') L.push({ t: '!! TAB HIDDEN - checks may slow down', c: C_WARN });
    if (lastError && age > 3) L.push({ t: 'check problem: ' + lastError, c: C_WARN });   // 4.20: orange
    const clearedAt = ls.get('vtoBoxClearedAt', 0);
    const errResetAt = ls.get('vtoErrReset', 0);
    const ers = ls.get('vtoErrors', []).filter(function (x) { return x.day === today() && x.t > clearedAt && x.t > errResetAt; }).slice(-3);
    if (ers.length) { L.push({ heading: 'last errors' }); ers.forEach(function (er) { L.push({ parts: timeParts('  ' + errorLine(er), C_WARN) }); }); }
    const res = ls.get('vtoResults', []).filter(function (x) { return x.day === today() && x.t > clearedAt; }).slice(-6);
    if (res.length) { L.push({ heading: 'VTO events' }); res.forEach(function (r) { L.push({ parts: timeParts('  ' + resultLine(r), r.kind === 'ok' ? C_ACCEPT : C_MISS) }); }); }
    const pad0 = (r) => String(r).replace(/^(\d):/, '0$1:');   // older lines: 1:05:09 AM -> 01:05:09 AM
    // 4.26: one log: reloads and log lines together by time, last 5
    const logs = boxLog(ls.get('vtoReloads', []), ls.get('vtoLog', []), 5);
    if (logs.length) { L.push({ heading: 'log' }); logs.forEach(function (r) { const t = '  ' + pad0(r).replace(' (no refresh - direct accept handles it)', ''); L.push({ parts: timeParts(t, lineColor(t)) }); }); }   // 4.61: white time   // 4.13: that note stays in copy only   // (older-style stay lines stay in copy only)
    // 4.40: Sessions replaces In-N-Out (the In-N-Out lines are still kept in copy)
    const sess = ls.get('vtoSessions', []).slice(-4);   // 4.50: latest 4 lines only (Martin keeps the box narrow); copy still has them all
    if (sess.length) {
      L.push({ heading: 'Authentication Session' });
      // 4.41: dates padded to one width so the columns line up (like In-N-Out)
      const lines = sess.map(sessLine), w = Math.max.apply(null, lines.map(function (x) { return x.parts[0].t.length; }));
      lines.forEach(function (x) { x.parts[0].t = x.parts[0].t.replace(/\s+$/, '') + ' '.repeat(w - x.parts[0].t.replace(/\s+$/, '').length); L.push(x); });
    }

    const key = JSON.stringify(L.map(function (x) { return x.live ? 'live' : x; }));
    if (key === boxKey && liveEl) { const lt = L[0].t; if (liveEl.textContent !== lt) liveEl.textContent = lt; return; }
    boxKey = key;
    const top = box.scrollTop;   // keep your scroll place
    const frag = document.createDocumentFragment();
    liveEl = null;
    L.forEach(function (item) { const d = mkLine(item); if (item.live) liveEl = d; frag.appendChild(d); });
    bodyEl.textContent = '';
    bodyEl.appendChild(frag);
    box.scrollTop = top;
  }
  // 4.42: box only: the "log out" button on its own line (the passkey time is no longer shown; it is still in copy).
  // It is the old reset passkey: a full sign-out, then the script signs you back in with your alias and the virtual passkey.
  // 4.44: the line under the checks: "Critical Alert: On/Off". One press mutes the loud passkey / stuck sign-in alarm;
  // it then sends a silent notification instead (still shows on your phone). Stays until you press it again. Phone Alerts reads vtoAlarmMuted.
  function toggleAlarm() {
    const muted = !ls.get('vtoAlarmMuted', false);
    ls.set('vtoAlarmMuted', muted);
    flash(muted ? 'alarm muted - silent only' : 'alarm back on');
    render();
  }
  function pkBoxLines() {
    const muted = ls.get('vtoAlarmMuted', false);
    const night = nightFirst();
    return [{ fix: true, parts: [{ t: 'Critical Alert: ' }, { btn: muted ? 'Off' : 'On', fn: toggleAlarm, c: '#ffffff', bg: muted ? '#6b2d3a' : '#1f5f38', first: true }] },
      // 4.59: Priority: Night Shift (dark blue) <-> Normal (orange)
      { fix: true, parts: [{ t: 'Priority: ' }, { btn: night ? 'Night Shift' : 'Normal', fn: togglePriority, c: night ? '#ffffff' : '#1d1a2b', bg: night ? '#1e3a8a' : C_WARN, first: true }] }];
  }
  function togglePriority() {
    const night = !nightFirst();
    ls.set('vtoPriority', night ? 'night' : 'normal');
    flash(night ? 'priority: night shift first' : 'priority: soonest first');
    render();
  }

  // 4.26: box only: merge reload and log lines ("01:05:09 PM ...") by time, newest last. Each list is already in order;
  // a time later than the line after it means the line is from the day before.
  function boxLog(a, b, n) {
    const now = new Date(), nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const secOf = function (x) {
      const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\s*([AP]M))?/i.exec(String(x)); if (!m) return null;
      let h = +m[1]; if (m[4]) { h = h % 12; if (/p/i.test(m[4])) h += 12; }
      return h * 3600 + (+m[2]) * 60 + (+m[3]);
    };
    const out = [];
    [a, b].forEach(function (arr, k) {
      let off = 0, prev = nowSec + 60;
      for (let i = arr.length - 1; i >= 0; i--) {
        let sec = secOf(arr[i]); if (sec === null) sec = prev;
        if (sec > prev) off -= 86400;
        prev = sec;
        out.push({ at: sec + off, k: k, i: i, r: arr[i] });
      }
    });
    out.sort(function (x, y) { return x.at - y.at || x.k - y.k || x.i - y.i; });
    return out.slice(-n).map(function (x) { return x.r; });
  }

  /* ================= TIMERS ================= */
  /* Every job runs from one scheduler. A Web Worker ticks it, because worker timers are not
     throttled when the tab is hidden. A normal interval also ticks it as a backup, so if the
     worker is blocked the script behaves like 4.2. Jobs are rate-limited, so double ticks are harmless. */
  const probe = { busy: false, at: 0 };   // 4.16: "can A to Z be reached?" check before a fallback refresh
  function startTimers() {
    function pendingCheck() {
      if (pendingReload && !reloading && !inFlight.size && !retryPending() && Date.now() >= noReloadUntil && !inBoost()) {   // a refresh that had to wait never lands in :59:55-:00:30
        const r = pendingReload; pendingReload = null; reload(r);
      }
    }
    function fallbackCheck() {
      const age = Date.now() - lastPollOK;
      if (age > FALLBACK_MS && !reloading) {
        // 4.16: before refreshing, check that A to Z can be reached at all. If not, the internet is down:
        // do NOT refresh (that lands on Chrome's "No internet" page, where the script stops). Checks keep
        // trying, and the first good one resumes watching by itself.
        if (offlineNow()) { noteOffline(age); return; }
        if (probe.busy || Date.now() - probe.at < 5000) return;
        probe.busy = true; probe.at = Date.now();
        const ctl = new AbortController();
        const pto = setTimeout(function () { ctl.abort(); }, 4000);
        origFetch(location.origin + '/favicon.ico?vto=' + Date.now(), { cache: 'no-store', credentials: 'include', signal: ctl.signal })
          .then(function () { probe.busy = false; clearTimeout(pto); doFallbackReload(Date.now() - lastPollOK); },   // reachable: refresh as before
                function () { probe.busy = false; clearTimeout(pto); noteOffline(Date.now() - lastPollOK); });    // unreachable: wait
      }
    }
    function doFallbackReload(age) {
      if (reloading || Date.now() - lastPollOK <= FALLBACK_MS) return;
      {
        // count it once per page, and not when the PC was just asleep (that is not a script problem)
        const sl = ls.get('vtoSleptAt', null);
        if (!stallCounted && !signedOutFlag && !(sl && Date.now() - sl.to < 20000)) { stallCounted = true; const secs = Math.round(age / 1000);   // 4.31: say plainly when it was Amazon (no answer / an error code)
          addError((lastError === 'check timeout' ? 'Amazon not responding ' + secs + 's'
            : /^HTTP \d+/.test(lastError) ? 'Amazon error ' + lastError.replace(/^HTTP /, '') + ' for ' + secs + 's'
            : 'checks stopped ' + secs + 's') + ' - page refreshed', '', lastError); }
        reload('fallback: last good check ' + Math.round(age / 1000) + 's ago | ' + lastError);
      }
    }
    function noteOffline(age) {
      if (!ls.get('vtoNetDownAt', 0)) {
        ls.set('vtoNetDownAt', lastPollOK || Date.now());
        netDownNote('!! no internet / A to Z unreachable (' + (lastError || 'no answer') + ')', lastError || 'A to Z unreachable');
      }
    }
    const jobs = [
      { every: function () { return inBurst() ? API_POLL_BURST_MS : inBoost() ? API_POLL_FAST_MS : API_POLL_MS; }, last: 0, fn: pollApi },
      { every: 50, last: 0, fn: hourlyRefresh },
      { every: 300, last: 0, fn: tick },
      { every: 500, last: 0, fn: render },
      { every: 250, last: 0, fn: pendingCheck },
      { every: 1000, last: 0, fn: fallbackCheck }
    ];
    const safetyAt = Date.now() + SAFETY_RELOAD_MS;
    let safetyDone = false;
    let lastTick = Date.now();
    function run() {
      const now = Date.now();
      // ticks come every 0.05-0.1 s; a jump of 2+ minutes means the PC (and this page) was asleep
      if (now - lastTick > 120000) {
        // 4.41: with the lid closed the Mac wakes for a few seconds at a time: a sleep that starts under 5 min after the last one ended is the same sleep
        const prevSl = ls.get('vtoSleptAt', null);
        const merge = !!(prevSl && lastTick - prevSl.to < 300000 && lastTick >= prevSl.to);
        const from = merge ? prevSl.from : lastTick;
        ls.set('vtoSleptAt', { from: from, to: now });
        forgetSleepNet(lastTick);   // 4.29
        if (merge) { const a = ls.get('vtoLog', []); for (let i = a.length - 1; i >= 0; i--) { if (/ Mac asleep until /.test(a[i])) { a.splice(i, 1); ls.set('vtoLog', a); break; } } }
        logAt(from, 'Mac asleep until ' + tShort(now) + ' (' + gapSpan(now - from) + ')');
        if (typeof window.__vtoWorkerWake === 'function') window.__vtoWorkerWake(now);
      }
      lastTick = now; window.__vtoTick = now;
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        const ev = typeof j.every === 'function' ? j.every() : j.every;
        if (now - j.last >= ev) { j.last = now; try { j.fn(); } catch (e) {} }
      }
      if (!safetyDone && now >= safetyAt && !inQuiet(new Date(now))) { safetyDone = true; reload('safety refresh'); }
    }

    // 4.47: the background worker restarts itself. If it fails to start, errors, or stops ticking while the page
    // is running, a new one is started (at most every 10 s) and one line is logged (at most every 10 min).
    let worker = null, workerSeen = Date.now(), workerTry = 0, workerStale = 0, workerLogAt = 0;
    function workerDown() {
      timerMode = 'normal';
      if (Date.now() - workerLogAt > 600000) { workerLogAt = Date.now(); logAction('!! background worker stopped - restarting it'); }
    }
    function startWorker() {
      workerTry = Date.now(); workerStale = 0;
      try { if (worker) worker.terminate(); } catch (e) {}
      worker = null;
      try {
        const src = 'setInterval(function(){postMessage(1)},50)';
        const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        const w = new Worker(url);
        w.onmessage = function () {
          if (w !== worker) return;
          workerSeen = Date.now();
          if (timerMode !== 'worker') timerMode = 'worker';
          run();
        };
        w.onerror = function () { if (w === worker) { worker = null; workerDown(); } };
        worker = w; workerSeen = Date.now();
      } catch (e) { workerDown(); }
    }
    function workerCheck() {
      // two stale looks in a row, so the first tick after a short Mac sleep (before the worker's own tick) is not counted
      if (worker && Date.now() - workerSeen < 5000) { workerStale = 0; return; }
      if (worker && ++workerStale < 2) return;
      if (Date.now() - workerTry < 10000) return;
      if (worker) workerDown();
      startWorker();
    }
    window.__vtoWorkerWake = function (t) { workerSeen = t; workerStale = 0; };
    setInterval(function () { run(); workerCheck(); }, 100); // backup ticker (throttled by Chrome when the tab is hidden); also watches the worker
    startWorker();
  }

  // you clicked Log Out / Sign out yourself -> the phone alert script skips this sign-out
  document.addEventListener('click', function (e) {
    try {
      if (!e.isTrusted) return;
      const b = e.target && e.target.closest && e.target.closest('button, a, [role="button"], [role="menuitem"]');
      const t = b ? String(b.innerText || b.textContent || '').trim() : '';
      if (/^(log ?out|sign ?out|log off)$/i.test(t)) { setShared('vtoManual', Date.now()); logAction('you clicked ' + t); }
    } catch (err) {}
  }, true);

  let startedAt = Date.now();
  let hbStartVal = 0;   // 4.18: last good check before this page start (read by recordSignIn)
  let netDownAtStart = 0;
  let netFails = 0;
  let pageLeaving = false;
  let stallCounted = false;
  // a navigation away from this page (Amazon sending you to the sign-in page, or a refresh) - closing Chrome is not one
  try {
    if (window.navigation && window.navigation.addEventListener) {
      setShared('vtoNavApi', '1');
      window.navigation.addEventListener('navigate', function (e) { try { if (e && e.destination && e.destination.sameDocument) return; } catch (x) {} setShared('vtoNav', Date.now()); });   // only page-to-page, not in-page route changes
    }
  } catch (e) {}
  // remember when this page is closed / left (not when the script reloads it itself)
  window.addEventListener('pagehide', function () {
    pageLeaving = true;
    setShared('vtoLeft', Date.now());   // the sign-in page uses this to tell "Amazon sent you here" from a restart
    if (!reloading) ls.set('vtoClosedAt', Date.now());
  });
  window.addEventListener('beforeunload', function () { pageLeaving = true; });
  // sign-ins (copy only): did Amazon ask for the passkey this time, or did it remember you?
  function recordSignIn() {
    try {
      const lw = loginWatch(); if (!lw) return;
      if (lw.since <= ls.get('vtoSignInsSeen', 0)) return;                                   // already recorded
      // 4.18: the first VTO page after the sign-in page, however long the passkey took (was: within 1 h)
      if (hbStartVal > lw.lastSeen + 5000 || lw.lastSeen > startedAt + 10000) return;
      ls.set('vtoSignInsSeen', lw.since);
      if (lw.pk || lw.pw || passkeyOnSecondPage(lw)) ls.set('vtoPasskeyAt', startedAt);   // 4.17: start of the next 24 h
      const how = lw.pk ? 'passkey asked (' + hhmmss(lw.pk) + ')'
        : lw.pw ? 'password box shown (' + hhmmss(lw.pw) + ')'
        : passkeyOnSecondPage(lw) ? 'signed in, looks like a passkey (sign-in took ' + Math.round(secondPageMs(lw) / 1000) + 's)'
        : 'no passkey (Amazon remembered you, ' + Math.round(secondPageMs(lw) / 1000) + 's' + (sleptOnSecondPage(lw) ? ' - the Mac was asleep in between' : '') + ')';
      const why = { amazon: '401', manual: 'you signed out', closed: 'page closed', reset: 'you pressed log out' }[lw.kind] || lw.kind || '?';
      const a = ls.get('vtoSignIns', []);
      const byScript = lw.autoAt && lw.autoAt >= lw.since && !(lw.userAt && lw.userAt >= lw.since) && !passkeyOnSecondPage(lw);
      a.push(dayTime(startedAt) + ' signed in' + (byScript ? ' AUTOMATICALLY (alias typed ' + hhmmss(lw.autoAt) + ')' : lw.autoAt && lw.autoAt >= lw.since ? ' by you (alias typed by the script ' + hhmmss(lw.autoAt) + ')' : '') + ' - ' + how + ' | sign-in page ' + hhmmss(lw.since) + ' - ' + hhmmss(lw.lastSeen) + ' (' + why + ')' + (lw.offer && !lw.pk ? ' | passkey only suggested' : ''));
      while (a.length > 100) a.shift();
      ls.set('vtoSignIns', a);
    } catch (e) {}
  }
  function init() {
    setShared('vtoGoVto', '0');   // back on VTO: A to Z's home page works normally again
    seedPasskeyAt();
    setTimeout(recordSignIn, 3000);
    origTitle = document.title;
    startedAt = Date.now();
    const hbAtStart = ls.get('vtoHeartbeat', 0);
    hbStartVal = hbAtStart;
    netDownAtStart = ls.get('vtoNetDownAt', 0);
    ls.set('vtoHeartbeat', startedAt);   // the shared vtoHb cookie is only written after a real good check
    setTimeout(function () { if (!seedSessions()) sessionAtStart(hbAtStart); fixRefreshPairs(); checkGapAtStart(hbAtStart); }, 2500);   // 4.44: the first run is covered by the history
    setTimeout(checkResetNoSignIn, 20000);   // 4.25
    buildBox();
    // backup clicking reacts the moment a button appears (like 3.3), not only on the 0.3 s timer.
    // Our own box redraws are ignored. (Direct accept is not affected - it does not use the page.)
    try {
      let moPending = false;
      new MutationObserver(function (recs) {
        if (moPending || reloading) return;
        if (box && recs.every(function (r) { return box.contains(r.target); })) return;
        moPending = true;
        setTimeout(function () { moPending = false; try { tick(); } catch (e) {} }, 0);
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open', 'disabled'] });   // also when a pop-up turns visible / a button turns clickable
    } catch (e) {}
    logAction('Running (' + document.visibilityState + ', list request: ' + templateSrc + ')');
    startTimers();
    pollApi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
