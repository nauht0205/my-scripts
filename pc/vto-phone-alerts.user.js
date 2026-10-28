// ==UserScript==
// @name         VTO Phone Alerts
// @namespace    martin.vto.notify
// @version      2.10
// @updateURL    https://raw.githubusercontent.com/nauht0205/my-scripts/main/pc/vto-phone-alerts.user.js
// @downloadURL  https://raw.githubusercontent.com/nauht0205/my-scripts/main/pc/vto-phone-alerts.user.js
// @description  (PC) Phone alerts via Pushover for the VTO script on the PC: one loud repeating Critical Alert when you are still not signed in after 1 minute (the virtual passkey did not finish), and normal pushes for accepted / missed / checks stalled. Critical Alert On/Off mute in the VTO box.
// @match        https://atoz.amazon.work/voluntary_time_off*
// @match        https://atoz-login.amazon.work/*
// @match        https://atozworkforce.idprism-auth.amazon.com/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @connect      api.pushover.net
// ==/UserScript==

/* Companion to "VTO Auto Accept" (4.48 PC+). It does not touch that script. It only reads what that script
   already saves in this page's localStorage, and sends a short push to your phone through Pushover.
   2.9: the virtual passkey signs you back in by itself, so the passkey-due heads-up and the separate "needs your passkey"
   alarm are gone. One Critical Alert is left: still signed out after 1 minute, on either sign-in page.
   Install the Pushover app on your phone, turn on Critical Alerts for it, and paste your two Pushover keys below. */

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

  const NOTIFY_ACCEPTED = true;         // phone alert when a VTO is accepted
  const NOTIFY_MISSED = true;           // phone alert when a VTO was missed (already full, or the accept failed)
  const NOTIFY_STALLED = true;          // phone alert when checks stop for a while
  const STALL_AFTER_MS = 120000;        // "stalled" = no good check for 2 minutes
  const STALL_COOLDOWN_MS = 900000;     // at most one stalled alert per 15 minutes
  const STUCK_MS = 60000;               // 2.9: still on a sign-in page after 1 minute = the automatic sign-in did not finish
  const LOGOUT_MS = 600000;             // a "log out" from the VTO box counts as in progress for 10 minutes

  /* ---------- PUSHOVER (your only alert channel) ----------
     Paste YOUR OWN two keys below. Get them from the Pushover app / pushover.net:
       - PUSHOVER_USER  = your User Key (pushover.net home page)
       - PUSHOVER_TOKEN = the API Token of an Application you create (pushover.net -> Create an Application)
     Keep both PRIVATE. While either is left as the PASTE_... placeholder, nothing is sent.

     Priority levels used:
       2 = EMERGENCY: loud, sounds through Silent/DND (needs Critical Alerts on in the app), repeats until you tap Acknowledge.
           Used ONLY for a sign-in that is still stuck after 1 minute - the get-up moment.
       1 = HIGH: not used since 2.6 (with Critical Alerts on, iOS plays high like an emergency, through Silent).
       0 = NORMAL: a normal notification. Used for accepted / missed / checks stalled / the test. */
  const PUSHOVER_USER = pushoverKey('pushoverUser', '', 'Pushover User Key');
  const PUSHOVER_TOKEN = pushoverKey('pushoverToken', '', 'Pushover API Token');
  const PUSHOVER_SOUND = 'persistent';  // the long "Persistent" alarm sound for the emergency alerts; swap for another Pushover sound if you want
  const PUSHOVER_RETRY = 30;            // emergency repeats every 30 s (Pushover's minimum) until you tap Acknowledge
  const PUSHOVER_EXPIRE = 1800;         // emergency keeps repeating for up to 30 minutes, then goes quiet on its own

  // One send path for everything. priority 2 adds the repeat (retry/expire) + the alarm sound; 1 and 0 are ordinary pushes.
  function push(title, message, priority, sound) {
    if (!PUSHOVER_USER || PUSHOVER_USER === 'PASTE_YOUR_USER_KEY' ||
        !PUSHOVER_TOKEN || PUSHOVER_TOKEN === 'PASTE_YOUR_APP_TOKEN') return;
    const p = (priority == null ? 0 : priority);
    try {
      let body = 'token=' + encodeURIComponent(PUSHOVER_TOKEN) +
        '&user=' + encodeURIComponent(PUSHOVER_USER) +
        '&title=' + encodeURIComponent(title) +
        '&message=' + encodeURIComponent(message) +
        '&priority=' + p;
      if (p === 2) body += '&retry=' + PUSHOVER_RETRY + '&expire=' + PUSHOVER_EXPIRE;
      if (sound) body += '&sound=' + encodeURIComponent(sound);
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.pushover.net/1/messages.json',
        data: body,
        timeout: 15000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        onerror: function () {},
        ontimeout: function () {}
      });
    } catch (e) {}
  }
  // the loud repeating wake alarm (sign-in stuck)
  // 2.7: when "Critical Alert" is turned Off in the VTO box (vtoAlarmMuted), the alarm is muted - it goes out as a
  //      quiet notification (priority -1: shows on your phone, no sound, no vibration, no repeat) instead of the alarm.
  function alarmMuted() { try { return !!GM_getValue('vtoAlarmMuted', false); } catch (e) { return false; } }
  function alarm(title, message) {
    if (alarmMuted()) { push(title, message, -1); return; }
    push(title, message, 2, PUSHOVER_SOUND);
  }

  // one Critical Alert per stuck sign-out, whichever sign-in page notices it first
  function stuckAlarm(msg) {
    if (Date.now() - GM_getValue('vtoStuckAlarmAt', 0) < 10 * 60000) return;
    GM_setValue('vtoStuckAlarmAt', Date.now());
    alarm('🚨 Authentication Failed', msg + ' VTO watching is OFF. Sign in on the PC.');
  }

  /* ---------- Amazon's sign-in page (amazon.com) ----------
     This site can't share cookies with A to Z (amazon.work), so what it notes goes into this script's own Tampermonkey storage. */
  if (location.hostname === 'atozworkforce.idprism-auth.amazon.com') {
    // "log out" in the VTO box opens Amazon's sign-out page with #vtoReset. After it has signed you out,
    // go on to A to Z's own sign-out, which leads to the sign-in page, where the VTO script types your alias.
    try {
      if (/vtoReset/.test(location.hash)) { GM_setValue('vtoResetAt', Date.now()); GM_setValue('vtoResetStage', 'idp'); }
      if (GM_getValue('vtoResetStage', '') === 'idp' && Date.now() - GM_getValue('vtoResetAt', 0) < LOGOUT_MS) {
        setTimeout(function () {
          if (GM_getValue('vtoResetStage', '') !== 'idp') return;
          GM_setValue('vtoResetStage', 'atoz');
          location.replace('https://atoz-login.amazon.work/logout');
        }, 2500);
        return;
      }
    } catch (err) {}
    // you clicked Sign out yourself: no alarm for that sign-out (the A to Z pages pass it on as the vtoManual cookie)
    document.addEventListener('click', function (e) {
      try {
        if (!e.isTrusted) return;
        const b = e.target && e.target.closest && e.target.closest('button, a, [role="button"], [role="menuitem"]');
        const t = b ? String(b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim() : '';
        if (t.length < 40 && /\b(sign|log) ?(out|off)\b/i.test(t)) GM_setValue('vtoManualAt', Date.now());
      } catch (err) {}
    }, true);
    // 2.9: the virtual passkey normally finishes here in about 5 s. Still on this page after 1 minute = it did not.
    let youHere = false;
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (n) { window.addEventListener(n, function (e) { if (e.isTrusted) youHere = true; }, true); });
    try {
      if (/^\/(?:account|logout)(?:\/|$)/i.test(location.pathname)) return;   // account and sign-out pages are not a sign-in
      setTimeout(function () {
        if (Date.now() - GM_getValue('vtoResetAt', 0) < LOGOUT_MS && GM_getValue('vtoResetStage', '')) return;   // a log out still in progress
        if (youHere || Date.now() - GM_getValue('vtoManualAt', 0) < LOGOUT_MS) return;   // you are on this page / you signed out yourself
        stuckAlarm('Amazon\'s sign-in page has not finished after 1 minute (the virtual passkey did not sign you in).');
      }, STUCK_MS);
    } catch (err) {}
    return;
  }
  const onLogin = location.hostname === 'atoz-login.amazon.work';

  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  // shared with VTO Auto Accept through a cookie on amazon.work (the login site and the VTO site can't read each other's storage)
  //   vtoHb      = last good VTO check (written by VTO Auto Accept)
  //   vtoManual  = you clicked Log Out / Sign out yourself (written by VTO Auto Accept)
  function getShared(name) {
    try { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }
  function setShared(name, val) {
    try { document.cookie = name + '=' + encodeURIComponent(val) + '; domain=amazon.work; path=/; max-age=2592000; secure; samesite=lax'; } catch (e) {}
  }
  const num = (n) => parseInt(getShared(n) || '0', 10);
  function syncManual() {
    try { const g = GM_getValue('vtoManualAt', 0); if (g > num('vtoManual')) setShared('vtoManual', g); } catch (e) {}
  }
  syncManual();
  try { GM_addValueChangeListener('vtoManualAt', function () { syncManual(); }); } catch (e) {}

  /* ---------- sign-in page: the VTO script is off ----------
     2.4: a sign-out that recovers on its own (the script types your alias and Amazon remembers you) is SILENT.
     Only a sign-in still stuck on this page after ~1 min needs you, so that fires the loud alarm - any reason,
     a passkey or a hung sign-in both. Your own sign-out or "log out" from the VTO box never alarms. */
  if (onLogin) {
    // a "log out" that reached A to Z's sign-in page has done its sign-out step: never send it back to the sign-out page
    try { if (GM_getValue('vtoResetStage', '') === 'idp') GM_setValue('vtoResetStage', 'atoz'); } catch (e) {}
    const lwNow = () => String(getShared('vtoLogin') || '').split('|');
    setTimeout(function () {
      const r = lwNow(); const since = Number(r[0]) || 0; const kind = r[3] || ''; const userAt = Number(r[4]) || 0;   // 2.9: same alarm as Amazon's sign-in page
      if (kind === 'manual' || kind === 'reset' || (userAt && userAt >= since)) return;   // you signed out yourself / log out / you are here signing in
      if (num('vtoStuckAlerted') === since) return;                                        // one alarm per stuck sign-out (Pushover handles the repeating)
      setShared('vtoStuckAlerted', since);
      const a = num('vtoAutoSign');
      stuckAlarm((a >= since ? 'The script typed your alias at ' + clock(a) + ', but' : 'After a sign-out,') + ' A to Z is still on the sign-in page after 1 minute.');
    }, STUCK_MS);
    return;
  }

  /* ---------- VTO page ---------- */
  try { if (GM_getValue('vtoResetStage', '')) GM_setValue('vtoResetStage', ''); } catch (e) {}   // back on VTO, a log out is over

  const events = () => lsGet('vtoEvents', []);
  const signed = () => lsGet('vtoSignErrors', []);

  // baseline: ignore everything that was already saved before this alerts script started
  if (lsGet('vtoNotifyBase', null) === null) {
    lsSet('vtoNotifyBase', { ev: events().length ? events()[events().length - 1] : '', se: signed().length ? signed()[signed().length - 1] : '' });
    push('🔔 VTO alerts connected', 'Test message from the VTO script on your PC. If you see this, Pushover alerts work.', 0);
  }

  function newAfter(list, lastSeen) {
    if (!lastSeen) return list.slice();
    const i = list.lastIndexOf(lastSeen);
    return i < 0 ? list.slice(-3) : list.slice(i + 1);
  }

  function check() {
    // 2.7: mirror the VTO box's "Critical Alert" mute flag into GM storage so the sign-in pages
    //      (other sites, which can't read this page's storage) know whether to mute the alarm.
    try { GM_setValue('vtoAlarmMuted', !!lsGet('vtoAlarmMuted', false)); } catch (e) {}
    const base = lsGet('vtoNotifyBase', { ev: '', se: '' });

    const ev = events();
    const freshEv = newAfter(ev, base.ev);
    if (ev.length) base.ev = ev[ev.length - 1];
    if (NOTIFY_ACCEPTED) {
      freshEv.forEach(function (line) {
        const k = line.indexOf('OK ACCEPTED');
        if (k > -1) push('✅ VTO ACCEPTED', line.slice(k).replace(/\s*\[[^\]]*\]\s*$/, ''), 0);   // normal - only the Critical Alert sounds through Silent
        // missed: someone else got the spot first
        const m = line.indexOf('X MISSED: ');
        if (NOTIFY_MISSED && m > -1) push('❌ VTO MISSED', line.slice(m + 10).replace(/\s*\[[^\]]*\]\s*$/, ''), 0);
      });
    }

    // a sign-out sends nothing here (the Critical Alert above covers one that gets stuck); its time only keeps the "stalled" alert from repeating it
    const se = signed();
    const freshSe = newAfter(se, base.se);
    if (se.length) base.se = se[se.length - 1];
    freshSe.forEach(function (line) { if (line.indexOf('SIGNED OUT: ') > -1) lsSet('vtoNotifySignedAt', Date.now()); });
    lsSet('vtoNotifyBase', base);

    // 2.5: the "test" button in the VTO box (pressed in the last minute, not sent yet) -> one normal test alert
    const tReq = lsGet('vtoTestAlertAt', 0);
    if (tReq && tReq > lsGet('vtoTestAlertDone', 0) && Date.now() - tReq < 60000) {
      lsSet('vtoTestAlertDone', tReq);
      push('🔔 VTO test', 'Test from the VTO box on your PC at ' + clock(tReq) + '. If you see this, VTO alerts work.', 0);
    }

    if (NOTIFY_STALLED) {
      const hb = lsGet('vtoHeartbeat', 0);
      const sinceHb = Date.now() - hb;
      const recentlySignedOut = Date.now() - lsGet('vtoNotifySignedAt', 0) < 3600000;
      if (hb && sinceHb > STALL_AFTER_MS && !recentlySignedOut && Date.now() - lsGet('vtoNotifyStallAt', 0) > STALL_COOLDOWN_MS) {
        lsSet('vtoNotifyStallAt', Date.now());
        push('⚠️ VTO checks stalled', 'No good VTO check since ' + clock(hb) + '. Look at the PC.', 0);
      }
    }
  }

  setInterval(function () { try { check(); } catch (e) {} }, 3000);
})();
