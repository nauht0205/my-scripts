// ==UserScript==
// @name         Stretch Fullscreen Video
// @namespace    head-unit-fullscreen
// @version      5.34
// @updateURL    https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/stretch-fullscreen-video.user.js
// @downloadURL  https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/stretch-fullscreen-video.user.js
// @description  Stretches fullscreen video to fill the whole screen (no crop) and keeps it stretched. Tapping a YouTube video opens it straight in fullscreen, and so does opening/reloading a video page (with the MacroDroid tap macro); on a video, steering-wheel seek ▲ opens a strip (Close, YouTube Home, then suggestions) and moves along it, seek ▼ chooses; otherwise seek ▼ is play/pause (playing also goes fullscreen; a live stream resumes at live). Double-tap (or touchpad double-click) the middle of a video to go fullscreen or exit (sides keep the player's own skip). After switching apps (CarPlay, Hamilton home...), the video fills the screen and the MacroDroid tap returns it to fullscreen. After 10+ minutes unused, Firefox opens on YouTube Home. Keyboard H = YouTube Home.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Applied to the video itself.
  const VIDEO_STYLE = {
    position: 'fixed', left: '0px', top: '0px', right: '0px', bottom: '0px',
    width: '100vw', height: '100vh', 'min-width': '0px', 'min-height': '0px',
    'max-width': 'none', 'max-height': 'none', margin: '0px', padding: '0px',
    transform: 'none', translate: 'none', scale: 'none', rotate: 'none',
    'object-fit': 'fill', 'object-position': '50% 50%', 'clip-path': 'none',
    visibility: 'visible', opacity: '1',
  };

  // Applied to ancestors only when they stop a fixed-position video from covering the screen
  // (transform, filter, contain, etc. turn an ancestor into the video's frame).
  const ANCESTOR_STYLE = {
    transform: 'none', translate: 'none', scale: 'none', rotate: 'none',
    filter: 'none', 'backdrop-filter': 'none', perspective: 'none',
    contain: 'none', 'will-change': 'auto', 'container-type': 'normal',
  };

  const ORIG = new WeakMap();     // element -> its original style attribute
  let lastStretched = null;       // the video most recently shown fullscreen
  const touched = new Set();      // every element we changed
  let applying = false;

  function setStyles(el, styles) {
    if (!ORIG.has(el)) {
      ORIG.set(el, el.getAttribute('style'));
      touched.add(el);
      observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    applying = true;
    for (const k in styles) {
      if (el.style.getPropertyValue(k) !== styles[k] || el.style.getPropertyPriority(k) !== 'important') {
        el.style.setProperty(k, styles[k], 'important');
      }
    }
    applying = false;
  }

  function restoreAll() {
    if (!touched.size) return;
    applying = true;
    for (const el of touched) {
      const orig = ORIG.get(el);
      if (orig === null) el.removeAttribute('style'); else el.setAttribute('style', orig);
      ORIG.delete(el);
    }
    touched.clear();
    applying = false;
  }

  // Finds videos everywhere, including inside shadow DOM (some players hide the <video> there).
  // Looking through every element for shadow DOM is slow on a big page, so the list of elements
  // that have one is refreshed at most every 3 seconds, and skipped on YouTube (it has none).
  const NO_SHADOW_VIDEOS = /(^|\.)youtube\.com$/.test(location.hostname);
  let shadowHosts = [], shadowHostsAt = 0;
  function findVideos(root, out) {
    for (const v of root.querySelectorAll('video')) out.push(v);
    if (root !== document) {
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) findVideos(el.shadowRoot, out);
      return out;
    }
    if (NO_SHADOW_VIDEOS) return out;
    const now = Date.now();
    if (now - shadowHostsAt > 3000) {
      shadowHostsAt = now;
      shadowHosts = [];
      for (const el of document.querySelectorAll('*')) if (el.shadowRoot) shadowHosts.push(el);
    }
    for (const el of shadowHosts) if (el.shadowRoot) findVideos(el.shadowRoot, out);
    return out;
  }

  function fullscreenElement() {
    let fs = document.fullscreenElement || document.webkitFullscreenElement || null;
    // Fullscreen element inside a shadow root.
    while (fs && fs.shadowRoot && fs.shadowRoot.fullscreenElement) fs = fs.shadowRoot.fullscreenElement;
    return fs;
  }

  // Real fullscreen, or the page/frame covering the whole screen (players that fake fullscreen,
  // or an iframe made fullscreen by the page around it).
  function isFullscreen() {
    if (fullscreenElement()) return true;
    if (matchMedia('(display-mode: fullscreen)').matches) return true;
    return Math.abs(innerHeight - screen.height) < 4 && Math.abs(innerWidth - screen.width) < 4;
  }

  function isVisible(v) {
    const r = v.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(v);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  // The main video: inside the fullscreen element if there is one, otherwise the biggest visible one.
  function pickVideo() {
    const fs = fullscreenElement();
    let vids = findVideos(document, []);
    if (fs) {
      if (fs.tagName === 'VIDEO') return fs;
      const inside = vids.filter((v) => fs.contains(v) || (fs.shadowRoot && fs.shadowRoot.contains(v)));
      if (inside.length) vids = inside;
    }
    let best = null, bestArea = 0;
    for (const v of vids) {
      if (!isVisible(v) && !touched.has(v)) continue;
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      // Prefer a playing video when sizes are close (e.g. an ad video over the main one).
      const score = area * (v.paused ? 1 : 1.5);
      if (score > bestArea) { best = v; bestArea = score; }
    }
    if (!best) return null;
    // Without a real fullscreen element, only act on a video that is already big.
    if (!fs && best.getBoundingClientRect().height < innerHeight * 0.5 && !touched.has(best)) return null;
    return best;
  }

  function covers(v) {
    const r = v.getBoundingClientRect();
    return r.left <= 1 && r.top <= 1 && r.right >= innerWidth - 1 && r.bottom >= innerHeight - 1;
  }

  function parentOf(el) {
    return el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
  }

  function tick() {
    if (applying) return;
    if (!isFullscreen()) { restoreAll(); return; }
    const v = pickVideo();
    if (!v) { restoreAll(); return; }

    // If the player swapped to a different video, put the old one back.
    for (const el of [...touched]) {
      if (el.tagName === 'VIDEO' && el !== v) {
        applying = true;
        const orig = ORIG.get(el);
        if (orig === null) el.removeAttribute('style'); else el.setAttribute('style', orig);
        ORIG.delete(el); touched.delete(el);
        applying = false;
      }
    }

    setStyles(v, VIDEO_STYLE);
    lastStretched = v;

    // Still not covering the screen? Neutralize the ancestors that trap it, one at a time, up to the fullscreen element.
    if (!covers(v)) {
      const stop = fullscreenElement();
      for (let a = parentOf(v); a && a !== document.documentElement; a = parentOf(a)) {
        const cs = getComputedStyle(a);
        if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' ||
            (cs.contain && cs.contain !== 'none') || /transform|filter|perspective/.test(cs.willChange) ||
            (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.containerType && cs.containerType !== 'normal')) {
          setStyles(a, ANCESTOR_STYLE);
          if (covers(v)) break;
        }
        if (a === stop) break;
      }
    }
  }

  // Re-apply the instant the player rewrites a style we set, before the next frame is drawn.
  const observer = new MutationObserver(() => { if (!applying) tick(); });
  // Catch new or replaced video elements as soon as they appear.
  const domObserver = new MutationObserver((records) => {
    if (applying || !isFullscreen()) return;
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType === 1 && (n.tagName === 'VIDEO' || (n.querySelector && n.querySelector('video')))) { tick(); return; }
    }
  });

  // Observe the document itself so this keeps working even if the page rewrites its whole content.
  domObserver.observe(document, { childList: true, subtree: true });

  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, tick, true);
  for (const ev of ['resize', 'orientationchange']) addEventListener(ev, tick);
  document.addEventListener('loadedmetadata', tick, true);   // new video source (quality change, next video, ad)
  document.addEventListener('play', tick, true);
  // Safety net for anything the events above miss.
  setInterval(tick, 250);

  // ---- Gestures ----

  // ---- MacroDroid tap: play + fullscreen without touching ----
  // Browsers only allow fullscreen (and starting a video with sound) right after a real touch.
  // When the script needs one, it shows "Going fullscreen…" in the middle of the screen; a MacroDroid
  // macro (Screen Content trigger on that text) taps the screen, and the script uses that tap to
  // start the video and go fullscreen. The tap itself never reaches the page.
  const CAR_TAP_TEXT = 'Going fullscreen…';
  let carTap = null;

  function cancelCarTap() {
    if (!carTap) return;
    clearTimeout(carTap.timer);
    carTap.el.remove();
    carTap = null;
  }

  // mode 'restore': the tap brings back fullscreen after an app switch (nothing else changes).
  function requestCarTap(mode) {
    if (window !== window.top) return;
    cancelCarTap();
    const el = document.createElement('div');
    el.textContent = '⛶  ' + CAR_TAP_TEXT;
    el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:2147483647;' +
      'background:rgba(0,0,0,.85);color:#fff;font:700 26px/1.2 sans-serif;padding:18px 30px;border-radius:30px;' +
      'border:2px solid rgba(255,255,255,.6);pointer-events:none;';
    carTap = { el, mode, pressed: false, timer: setTimeout(cancelCarTap, 6000) };
    const show = () => { if (carTap && carTap.el === el) (fullscreenElement() || document.body).appendChild(el); };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  // The YouTube player (or any player), even before its video has loaded.
  function playerElement() {
    const v = biggestVideo();
    if (v && v.getBoundingClientRect().height > 100) return playerBox(v);
    let best = null, area = 0;
    for (const el of document.querySelectorAll('#player-container-id, #movie_player, .html5-video-player, ytm-player, #player, .player-container')) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > area) { best = el; area = r.width * r.height; }
    }
    return area > 20000 ? best : null;
  }

  function startPlayback() {
    const v = biggestVideo();
    if (v && !v.paused) return;
    if (v && v.readyState > 0) { if (liveResume) { liveResume = false; goLive(v); } try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} return; }
    // Only the thumbnail with its ▶ is showing: press the player's own play overlay.
    const box = playerElement();
    if (!box) return;
    const r = box.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (target && (box.contains(target) || target.contains(box))) target.click();
  }

  function useCarTap() {
    const mode = carTap && carTap.mode;
    cancelCarTap();
    if (mode === 'restore') { if (restore) doRestore(); return; }
    if (typeof stopKeepAlive === 'function') stopKeepAlive();
    startPlayback();
    if (fullscreenElement()) return;
    fsGuard = { until: Date.now() + 3000 };
    const v = biggestVideo();
    if (v && v.getBoundingClientRect().height > 100) { goFullscreen(v); return; }
    const box = playerElement();
    if (box && box.requestFullscreen) { try { const p = box.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  }

  addEventListener('touchstart', (e) => {
    if (!carTap) return;
    carTap.pressed = true;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true, passive: false });
  addEventListener('touchend', (e) => {
    if (!carTap || !carTap.pressed) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    useCarTap();
  }, { capture: true, passive: false });


  // Players' own fullscreen buttons (YouTube mobile/desktop, video.js, JW Player, Plyr, and generic labels).
  const FS_BUTTONS = [
    'button.fullscreen-icon', '.fullscreen-icon', '.ytp-fullscreen-button', '.ytm-fullscreen-button',
    '.vjs-fullscreen-control', '.jw-icon-fullscreen', '[data-plyr="fullscreen"]',
    'button[aria-label*="full screen" i]', 'button[aria-label*="fullscreen" i]', 'button[title*="fullscreen" i]',
  ].join(',');

  function biggestVideo() {
    let best = null, bestArea = 0;
    for (const v of findVideos(document, [])) {
      if (!isVisible(v)) continue;
      const r = v.getBoundingClientRect();
      if (r.width * r.height > bestArea) { best = v; bestArea = r.width * r.height; }
    }
    return best;
  }

  // The player box around the video: the highest ancestor that is still about the video's size.
  function playerBox(v) {
    const vr = v.getBoundingClientRect();
    const vArea = Math.max(vr.width * vr.height, 1);
    let box = v.parentElement || v;
    for (let a = v.parentElement, i = 0; a && a !== document.body && a !== document.documentElement && i < 8; a = a.parentElement, i++) {
      const r = a.getBoundingClientRect();
      if (r.width * r.height > vArea * 2.2) break;
      box = a;
    }
    return box;
  }

  // Must be called from inside a tap, because browsers only allow fullscreen after a user action.
  // After the script starts fullscreen, the player sometimes switches it straight off again
  // (YouTube does this when it still thinks it is fullscreen from before, e.g. after Back).
  // For a moment after the MacroDroid tap starts fullscreen, the page isn't allowed to leave it
  // (the script's own exits and your touches still work).
  let fsGuard = null, ownExit = false;
  function pageMayExit() {
    const g = fsGuard;
    if (ownExit || !g || Date.now() > g.until || Date.now() - lastTouch < 400) return true;
    dbg('kept fullscreen: the page tried to leave it');
    return false;
  }
  (function guardExit() {
    const names = ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen'];
    // Page context (Violentmonkey "page" mode) ...
    const pageWin = window.wrappedJSObject;
    if (!pageWin) {
      for (const name of names) {
        const orig = Document.prototype[name];
        if (typeof orig !== 'function') continue;
        Document.prototype[name] = function () { return pageMayExit() ? orig.apply(this, arguments) : Promise.resolve(); };
      }
      return;
    }
    // ... or Firefox content-script mode: patch the page's own Document through the sandbox.
    try {
      const P = pageWin.Document.prototype;
      for (const name of names) {
        const orig = P[name];
        if (typeof orig !== 'function') continue;
        exportFunction(function () {
          if (pageMayExit()) return orig.apply(this, arguments);
          return new pageWin.Promise((res) => res());
        }, P, { defineAs: name });
      }
    } catch (_) {}
  })();

  function goFullscreen(v) {
    if (fullscreenElement() || !v || !v.isConnected) return;
    // Prefer the player's own button so its controls switch to fullscreen layout too,
    // unless the player thinks it is already fullscreen (its button says "exit").
    for (let a = v.parentElement, i = 0; a && i < 8; a = a.parentElement, i++) {
      const btn = a.querySelector(FS_BUTTONS);
      if (btn) {
        const label = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '') + ' ' + (btn.className || '');
        if (!/exit|leave|thoát/i.test(label)) btn.click();
        break;
      }
    }
    // If the button didn't do it, make the player box fullscreen ourselves.
    setTimeout(() => {
      if (fullscreenElement()) return;
      const box = playerBox(v);
      const req = (el) => (el.requestFullscreen ? el.requestFullscreen() : Promise.reject());
      req(box).catch(() => req(v).catch(() => {}));
    }, 150);
  }

  function videoAt(x, y) {
    let best = null, bestArea = 0;
    for (const v of findVideos(document, [])) {
      if (!isVisible(v)) continue;
      const r = v.getBoundingClientRect();
      if (r.height < 80 || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (r.width * r.height > bestArea) { best = v; bestArea = r.width * r.height; }
    }
    return best;
  }

  // Double-tap the middle third of a video to go fullscreen; double-tap the middle third again to exit.
  // The second tap is kept from the page so the player doesn't also seek or pause on it.
  const TAP_MOVE = 15, TAP_TIME = 350, DOUBLE_GAP = 350, DOUBLE_DIST = 60;
  let touch = null, lastTap = null, swallowClicksUntil = 0;

  function exitFullscreen() {
    const d = document;
    const fn = d.exitFullscreen || d.webkitExitFullscreen || d.mozCancelFullScreen;
    ownExit = true;
    if (fn) { try { const r = fn.call(d); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
    ownExit = false;
  }

  // Only the middle third of the video counts, so the left and right thirds keep the
  // player's own double-tap (YouTube: back / forward 10 seconds).
  function inMiddleThird(x, r) {
    return r.width > 0 && x >= r.left + r.width / 3 && x <= r.right - r.width / 3;
  }

  function tapTarget(x, y) {
    const fs = fullscreenElement();
    const v = videoAt(x, y);
    if (fs) {
      const r = (v || fs).getBoundingClientRect();
      return inMiddleThird(x, r) ? 'exit' : null;
    }
    return v && inMiddleThird(x, v.getBoundingClientRect()) ? 'enter' : null;
  }

  addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { touch = null; lastTap = null; return; }
    const t = e.touches[0];
    const second = !!(lastTap && Date.now() - lastTap.time < DOUBLE_GAP &&
      Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < DOUBLE_DIST &&
      tapTarget(t.clientX, t.clientY));
    touch = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false, second };
    if (second) e.stopPropagation();   // hide the second tap from the player (no double-tap seek)
  }, { capture: true, passive: true });

  addEventListener('touchmove', (e) => {
    if (!touch) return;
    const t = e.touches[0];
    if (!t || Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > TAP_MOVE) { touch.moved = true; lastTap = null; }
  }, { capture: true, passive: true });

  addEventListener('touchcancel', () => { touch = null; lastTap = null; }, true);

  addEventListener('touchend', (e) => {
    const s = touch;
    touch = null;
    if (!s || e.touches.length) return;
    const t = e.changedTouches[0];
    const isTap = !s.moved && Date.now() - s.time < TAP_TIME &&
      Math.hypot(t.clientX - s.x, t.clientY - s.y) <= TAP_MOVE;
    if (!isTap) { lastTap = null; return; }
    if (!s.second) { lastTap = { x: t.clientX, y: t.clientY, time: Date.now() }; return; }
    lastTap = null;
    const action = tapTarget(t.clientX, t.clientY);
    if (!action) return;
    if (e.cancelable) e.preventDefault();   // no click from the second tap
    e.stopPropagation();
    swallowClicksUntil = Date.now() + 500;
    if (action === 'exit') { clearRestore(); ourExitAt = Date.now(); exitFullscreen(); }
    else goFullscreen(videoAt(t.clientX, t.clientY));
  }, { capture: true, passive: false });

  // Some browsers still send click/dblclick for the second tap; keep those from the page too.
  const swallow = (e) => { if (e.isTrusted && Date.now() < swallowClicksUntil) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } };
  addEventListener('click', swallow, true);
  addEventListener('dblclick', swallow, true);

  // Touchpad / mouse: double-click the middle third of a video = fullscreen on/off, same as the
  // double-tap (a double-click from a touch is already handled above and ignored here).
  addEventListener('dblclick', (e) => {
    if (!e.isTrusted || Date.now() - lastTouch < 1000) return;
    const fs = fullscreenElement();
    const v = fs ? (lastStretched && lastStretched.isConnected ? lastStretched : biggestVideo()) : videoAt(e.clientX, e.clientY);
    if (!v) return;
    const r = fs ? { left: 0, width: innerWidth } : v.getBoundingClientRect();
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    // Left third = back 10s, right third = forward 10s (done here so it never double-skips).
    const side = e.clientX < r.left + r.width / 3 ? -10 : e.clientX > r.left + r.width * 2 / 3 ? 10 : 0;
    if (side) {
      const end = isFinite(v.duration) ? v.duration - 0.5 : Infinity;
      v.currentTime = Math.max(0, Math.min(end, v.currentTime + side));
      return;
    }
    if (fs) { clearRestore(); ourExitAt = Date.now(); exitFullscreen(); }
    else goFullscreen(v);
  }, true);

  // Returning to fullscreen after the mini player (picture-in-picture).
  // Browsers don't allow going back to fullscreen without a tap, so a pill offers it.
  // Fullscreen can end in three ways:
  //   - our own middle double-tap, or a tap on the player's exit button: nothing to restore;
  //   - the mini player (window shrank or page hidden): "sure" - the next tap anywhere restores;
  //   - anything else with no touch on the page (Firefox's mini player, back button):
  //     the pill shows; tapping the pill restores, a tap anywhere else just dismisses it.
  const IS_TOP = window === window.top;

  // ---- Firefox unused for a while (car off, unit restarted...) → open on YouTube Home ----
  // Time in minutes; only time with Firefox on screen counts as used.
  const IDLE_HOME_MIN = 10;
  let lastUsedMark = 0;
  function lastUsed() { try { return +localStorage.getItem('sv-last-used') || 0; } catch (_) { return 0; } }
  function markUsed(t) { try { localStorage.setItem('sv-last-used', String(t)); } catch (_) {} }
  let leavingForHome = false;
  if (IS_TOP && /(^|\.)youtube\.com$/.test(location.hostname)) {
    const last = lastUsed(), now = Date.now();
    if (last && now - last > IDLE_HOME_MIN * 60000 && location.pathname !== '/') {
      leavingForHome = true;
      markUsed(now);
      location.replace(location.origin + '/');
    }
  }
  let lastSmall = 0, lastAway = 0, lastTouch = 0, ourExitAt = 0;
  let lastExit = null, restore = null, hint = null, lastFsEl = null, fsEnterAt = 0;

  function windowIsSmall() {
    return innerWidth < screen.width * 0.6 || innerHeight < screen.height * 0.6;
  }

  // On-screen log (bottom-left) for troubleshooting. Set to true to show it.
  const DEBUG = false;
  let dbgBox = null, dbgTimer = 0;
  function dbg(msg) {
    if (!DEBUG || !IS_TOP || !document.body) return;
    if (!dbgBox) {
      dbgBox = document.createElement('div');
      dbgBox.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;background:rgba(0,0,0,.8);color:#7f7;' +
        'font:14px/1.3 monospace;padding:6px 10px;border-radius:8px;pointer-events:none;white-space:pre;max-width:60vw;';
    }
    if (!dbgBox.isConnected) document.body.appendChild(dbgBox);
    const t = new Date(), ts = t.toTimeString().slice(3, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0').slice(0, 1);
    dbgBox.textContent = (dbgBox.textContent + '\n' + ts + ' ' + msg).split('\n').filter(Boolean).slice(-14).join('\n');
    clearTimeout(dbgTimer);
    dbgTimer = setTimeout(() => { if (dbgBox) { dbgBox.remove(); dbgBox.textContent = ''; } }, 120000);
  }

  // Animation frames stop while Firefox is in the background, so a long gap between frames
  // means you were in another app, even if Firefox never reports the page as hidden.
  let lastFrame = 0;
  function beat(now) {
    const t = Date.now();
    if (onYouTube() && t - lastUsedMark > 5000) {
      if (t - lastUsed() > IDLE_HOME_MIN * 60000 && lastUsed()) idleHome();
      markUsed(t);
      lastUsedMark = t;
    }
    if (lastFrame && t - lastFrame > 1200) { lastAway = t; if (restore) restore.sure = true; dbg('away detected (' + Math.round((t - lastFrame) / 100) / 10 + 's gap)'); }
    lastFrame = t;
    requestAnimationFrame(beat);
  }
  if (IS_TOP) requestAnimationFrame(beat);

  // Back after Firefox sat unused (the car was off, or a long time in CarPlay): YouTube Home.
  function idleHome() {
    dbg('unused for ' + IDLE_HOME_MIN + '+ min: going to YouTube Home');
    clearRestore();
    cancelCarTap();
    if (location.pathname !== '/') goHome();
  }

  function hideHint() { if (hint) { hint.remove(); hint = null; } }
  function clearRestore() { restore = null; hideHint(); uncover(); }

  // ---- Coming back from another app: never show the page out of fullscreen ----
  // Android drops fullscreen when you switch apps, and the browser only allows it back after a tap.
  // Until that tap (MacroDroid's, or yours), the video already fills the whole page, stretched,
  // so there is no "normal page" moment in between.
  let coverEl = null, coverStyle = null, coverTimer = 0, coverAsks = 0;
  function cover() {
    if (!IS_TOP || !restore || !restore.sure || fullscreenElement() || windowIsSmall() || !document.body) return;
    if (onYouTube() && !onWatchPage()) return;
    const v = restore.v && restore.v.isConnected ? restore.v : biggestVideo();
    const el = (restore.el && restore.el.isConnected && restore.el !== document.documentElement && restore.el !== document.body)
      ? restore.el : (v ? playerBox(v) : null);
    if (!el) return;
    if (!coverStyle) {
      coverStyle = document.createElement('style');
      coverStyle.textContent =
        '[data-sv-cover]{position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;' +
        'width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;' +
        'transform:none!important;z-index:2147483640!important;background:#000!important}' +
        '[data-sv-cover] video{position:absolute!important;left:0!important;top:0!important;width:100%!important;height:100%!important;' +
        'max-width:none!important;max-height:none!important;transform:none!important;object-fit:fill!important}';
    }
    if (!coverStyle.isConnected) (document.head || document.documentElement).appendChild(coverStyle);
    if (coverEl !== el) { uncover(); coverEl = el; el.setAttribute('data-sv-cover', ''); dbg('cover on'); }
    hideHint();
    // Ask MacroDroid for the tap that brings fullscreen back. Same for every way back to Firefox
    // (AUDIO, Hamilton home, recent apps...). A short wait first: Firefox refuses fullscreen
    // while it is still coming to the front. Up to 4 tries if a tap gets refused or missed.
    clearTimeout(coverTimer);
    coverTimer = setTimeout(function ask() {
      if (!restore || !coverEl || fullscreenElement() || document.hidden || windowIsSmall()) return;
      if (coverAsks >= 4) return;
      if (!carTap) { coverAsks++; dbg('cover: asking for the tap'); requestCarTap('restore'); }
      coverTimer = setTimeout(ask, 2500);
    }, 500);
  }
  function uncover() {
    clearTimeout(coverTimer);
    if (coverEl) { coverEl.removeAttribute('data-sv-cover'); coverEl = null; dbg('cover off'); }
  }

  function showHint() {
    // Only when a tap elsewhere would not restore; otherwise any tap (or MacroDroid's) does it.
    if (hint || !IS_TOP || !document.body || !restore || restore.sure || windowIsSmall() || fullscreenElement()) return;
    hint = document.createElement('div');
    hint.textContent = '⛶  Tap to return to fullscreen';
    hint.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(0,0,0,.85);color:#fff;font:700 20px/1.2 sans-serif;padding:14px 24px;border-radius:26px;' +
      'border:2px solid rgba(255,255,255,.6);pointer-events:auto;touch-action:manipulation;user-select:none;cursor:pointer;';
    document.body.appendChild(hint);
  }

  function armRestore(v, el, sure) {
    restore = { v, el, sure, until: Date.now() + 12 * 60 * 60 * 1000 };
    dbg('restore armed, any tap=' + sure);
    showHint();
    if (!document.hidden) cover();
  }

  // Touches inside iframes (embedded players) count as touches on the page.
  addEventListener('touchstart', () => {
    lastTouch = Date.now();
    if (!IS_TOP) { try { window.top.postMessage({ __stretchTouch: 1 }, '*'); } catch (_) {} }
  }, { capture: true, passive: true });
  if (IS_TOP) addEventListener('message', (e) => { if (e.data && e.data.__stretchTouch === 1) lastTouch = Date.now(); });

  let wasSmall = false;
  addEventListener('resize', () => {
    const small = windowIsSmall();
    if (small || wasSmall) lastSmall = Date.now();   // also marks the moment the mini player was expanded
    wasSmall = small;
    if (small) {
      lastAway = Date.now();
      hideHint();
      uncover();
      if (restore) restore.sure = true;
      // Fullscreen ended just before the window shrank into the mini player.
      if (IS_TOP && lastExit && Date.now() - lastExit.time < 4000) { armRestore(lastExit.v, lastExit.el, true); lastExit = null; }
    } else {
      showHint();   // back to full size from the mini player
      cover();
    }
  });

  document.addEventListener('visibilitychange', () => {
    dbg('page ' + (document.hidden ? 'hidden' : 'visible'));
    if (document.hidden) { lastAway = Date.now(); if (restore) restore.sure = true; hideHint(); }
    else { showHint(); cover(); }
  });
  // Coming back from another app: if the page still thinks it is fullscreen but the window
  // no longer covers the screen, drop the stale state so the next tap restores for real.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !IS_TOP) return;
    setTimeout(() => {
      if (!document.hidden && fullscreenElement() && lastAway > fsEnterAt && innerHeight < screen.height * 0.9) {
        exitFullscreen();
      }
    }, 700);
  });
  addEventListener('pageshow', () => showHint());
  addEventListener('blur', () => { if (!IS_TOP) return; lastAway = Date.now(); if (restore) restore.sure = true; dbg('window blur'); });
  addEventListener('focus', () => { if (IS_TOP) dbg('window focus'); showHint(); cover(); });

  document.addEventListener('fullscreenchange', () => {
    const fs = fullscreenElement();
    if (IS_TOP) dbg(fs ? 'fullscreen ON' : 'fullscreen OFF (last touch ' + Math.round((Date.now() - lastTouch) / 100) / 10 + 's ago)');
    if (fs) {
      lastFsEl = fs; fsEnterAt = Date.now(); coverAsks = 0; clearRestore();
      if (carTap && carTap.mode === 'restore') cancelCarTap();   // fullscreen is back: no tap needed
      return;
    }
    if (!IS_TOP) return;   // the top page owns the pill
    const v = lastStretched && lastStretched.isConnected ? lastStretched : null;
    const el = lastFsEl;
    const now = Date.now();
    if (now - ourExitAt < 1500) return;                                      // our double-tap
    if (document.hidden || windowIsSmall() || now - lastSmall < 4000 || now - lastAway < 4000 || lastAway > fsEnterAt) {
      armRestore(v, el, true);                                                // clearly the mini player
    } else if (now - lastTouch < 1500) {
      lastExit = { v, el, time: now };                                        // player's exit button
    } else {
      armRestore(v, el, false);                                               // no touch: offer the pill
    }
  }, true);

  function doRestore() {
    const r = restore;
    clearRestore();
    if (!r) return;
    dbg('restoring...');
    // Firefox can refuse when the tap comes while it is still coming back to the front:
    // then keep the video filling the page and ask for another tap.
    setTimeout(() => {
      if (fullscreenElement()) { dbg('restore OK'); return; }
      dbg('fullscreen restore failed (browser refused)');
      if (!restore && !document.hidden && !windowIsSmall()) armRestore(r.v, r.el, true);
    }, 1200);
    if (r.v && r.v.isConnected) { goFullscreen(r.v); return; }
    if (r.el && r.el.isConnected && r.el.requestFullscreen) {
      try { const p = r.el.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
      return;
    }
    const v = biggestVideo();
    if (v) goFullscreen(v);
  }

  function onRestoreTap(e) {
    if (!restore || fullscreenElement() || windowIsSmall()) return;
    if (Date.now() > restore.until) { clearRestore(); return; }
    const onPill = hint && e.target instanceof Node && hint.contains(e.target);
    if (!restore.sure && lastAway > fsEnterAt) restore.sure = true;
    dbg(e.type + ': pill=' + !!onPill + ' anytap=' + restore.sure);
    if (!onPill && !restore.sure) {
      if (e.type === 'touchend') clearRestore();   // tapped elsewhere: dismiss, let the page have the tap
      return;
    }
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    doRestore();
  }
  // When the next tap will restore, keep the whole touch from the player, so it never sees a
  // finger go down without coming up (YouTube treats that as press-and-hold = 2x speed).
  addEventListener('touchstart', (e) => {
    if (!restore || fullscreenElement() || windowIsSmall()) return;
    if (!restore.sure && lastAway > fsEnterAt) restore.sure = true;
    const onPill = hint && e.target instanceof Node && hint.contains(e.target);
    if (!restore.sure && !onPill) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }, { capture: true, passive: false });
  addEventListener('touchend', onRestoreTap, { capture: true, passive: false });
  addEventListener('click', onRestoreTap, true);

  // ---- Tap a YouTube video: open it straight in fullscreen ----
  // The tap on the thumbnail counts as permission for fullscreen for a few seconds, so as soon as
  // the new video's player appears, the script makes it fullscreen. Set to false to turn this off.
  const AUTO_FULLSCREEN = true;
  let autoFs = null;

  function videoIdOf(href) {
    try { const u = new URL(href, location.href); return u.pathname === '/watch' ? u.searchParams.get('v') : null; } catch (_) { return null; }
  }

  function autoFsStep() {
    const a = autoFs;
    if (!a) return;
    if (fullscreenElement()) { autoFs = null; return; }
    if (Date.now() > a.until) { autoFs = null; dbg('auto fullscreen: player too slow, skipped'); return; }
    const onNewVideo = videoIdOf(location.href) === a.id;
    const v = onNewVideo ? biggestVideo() : null;
    if (v && v.getBoundingClientRect().height > 100) {
      autoFs = null;
      dbg('auto fullscreen: going fullscreen');
      goFullscreen(v);
      setTimeout(() => {
        if (fullscreenElement()) dbg('auto fullscreen OK');
        else if (onWatchPage() && !document.hidden) {
          // The click's permission ran out before the video was ready: MacroDroid's tap finishes it.
          dbg('auto fullscreen refused: asking for the tap');
          requestCarTap();
        }
      }, 1200);
      return;
    }
    setTimeout(autoFsStep, 100);
  }

  addEventListener('click', (e) => {
    if (!AUTO_FULLSCREEN || !IS_TOP || !e.isTrusted || fullscreenElement()) return;
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    const link = path.find((n) => n && n.tagName === 'A' && n.href && videoIdOf(n.href));
    if (!link) return;
    const id = videoIdOf(link.href);
    dbg('video tapped: auto fullscreen armed');
    const first = !autoFs;
    autoFs = { id, until: Date.now() + 4500 };
    if (first) setTimeout(autoFsStep, 100);
  }, true);

  // ---- Steering-wheel seek ▲ / ▼ (media "next" / "previous"): pick a suggested YouTube video without touching ----
  // The car sends seek ▲ to whichever app is playing, as a media "next track" command.
  // Each press shows a strip of suggested videos and moves the highlight box one step;
  // after a few seconds with no press, the boxed video plays. The box starts on the first tile,
  // "✕ Close", so opening the strip by accident never plays anything.
  // Set SEEK_PICKER to false to turn this off.
  const SEEK_PICKER = true;
  function onWatchPage() { return location.pathname === '/watch' || location.pathname.startsWith('/shorts/'); }
  function onYouTube() { return /(^|\.)youtube\.com$/.test(location.hostname); }
  let videoStarted = false, pendingWatch = null;

  // Going to YouTube Home without a full page load when possible, so the wheel keeps working.
  function goHome() {
    if (picker) closePicker();
    if (!onYouTube()) { location.assign('https://m.youtube.com/'); return; }
    if (location.pathname === '/') { scrollTo(0, 0); return; }
    if (fullscreenElement()) { clearRestore(); ourExitAt = Date.now(); exitFullscreen(); }
    const link = [...document.querySelectorAll('a[href]')].find((a) => {
      try { const u = new URL(a.href, location.href); return u.origin === location.origin && u.pathname === '/' && !u.search; } catch (_) { return false; }
    });
    dbg(link ? 'Home: opening' : 'Home: no Home link, full page load');
    if (link) link.click(); else location.assign(location.origin + '/');
  }

  // Away from a playing video the car only sends its buttons while Firefox makes a sound,
  // so the near-silent keep-alive plays while a video chosen with the wheel is loading.
  // Never alongside a video that is playing with sound (it keeps the buttons coming by itself,
  // and two sounds at once confuse which one gets the buttons).
  function audibleVideoPlaying() {
    for (const v of findVideos(document, [])) if (!v.paused && !v.muted && v.volume > 0 && !v.ended) return true;
    return false;
  }
  function keepWheelAlive() {
    if (!IS_TOP || !onYouTube()) return;
    if (audibleVideoPlaying()) { if (keepAlive) { dbg('video has sound: near-silent sound stopped'); stopKeepAlive(); } return; }
    if (keepAlive && !keepAlive.paused) return;
    startKeepAlive();
  }

  // A video chosen with the wheel outside fullscreen: once its page is up, ask for the
  // MacroDroid tap that starts it in fullscreen.
  function watchWhenReady() {
    const w = pendingWatch;
    if (!w) return;
    if (Date.now() > w.until || fullscreenElement()) { pendingWatch = null; return; }
    const box = videoIdOf(location.href) === w.id ? playerElement() : null;
    if (box && box.getBoundingClientRect().height > 100) { pendingWatch = null; requestCarTap(); return; }
    setTimeout(watchWhenReady, 200);
  }
  const PICK_DELAY = 3000, MAX_PICKS = 12;
  let picker = null;

  // Links inside hidden menus/templates don't count (they aren't on the page).
  function isShown(a) {
    // YouTube's thumbnail links can be display:contents (no box of their own): use what's inside.
    for (const el of [a, a.firstElementChild, a.parentElement]) {
      if (!el || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  }

  function suggestions(max, skip) {
    const current = videoIdOf(location.href);
    const byId = new Map();
    for (const a of document.querySelectorAll('a[href*="/watch"]')) {
      const id = videoIdOf(a.href);
      if (!id || id === current || (skip && skip.has(id))) continue;
      if (!isShown(a)) continue;
      let item = byId.get(id);
      if (!item) {
        if (byId.size >= (max || MAX_PICKS)) continue;
        item = { kind: 'video', id, link: a, title: '', img: '' };
        byId.set(id, item);
      }
      const text = (a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > item.title.length) item.title = text;
      const img = a.querySelector('img');
      const src = img && (img.currentSrc || img.src);
      if (!item.img && src && /^https?:/.test(src)) item.img = src;
    }
    for (const item of byId.values()) if (!item.img) item.img = 'https://i.ytimg.com/vi/' + item.id + '/mqdefault.jpg';
    return [...byId.values()];
  }

  // Seek ▼ = play/pause. Pausing just pauses (fullscreen or not). Playing also goes fullscreen:
  // in fullscreen it simply resumes; outside fullscreen it asks MacroDroid for the tap that
  // starts the video in fullscreen.
  // While a video is paused, the car stops sending its buttons to Firefox (nothing is playing).
  // So a pause from the wheel keeps a near-silent sound playing; the car keeps talking to Firefox and
  // the next press can resume. It stops as soon as a video plays (or after 30 minutes).
  // It can't be pure silence: Firefox treats anything below -72 dB as silent and, after a few
  // seconds, stops counting it as playing. So the "sound" is a constant level at about -66 dB:
  // just over Firefox's line, and a constant level (no wave at all) can't be heard.
  let keepAlive = null, keepAliveUrl = null, keepAliveTimer = 0;
  function silentWavUrl() {
    if (keepAliveUrl) return keepAliveUrl;
    // 10 seconds: Firefox ignores very short sounds for media buttons.
    const rate = 8000, n = rate * 10;            // 10 seconds, 8 kHz, 16-bit mono
    const buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
    str(36, 'data'); d.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, 16, true);
    keepAliveUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return keepAliveUrl;
  }
  let keepAliveEl = null;
  function startKeepAlive() {
    stopKeepAlive();
    try {
      if (!keepAliveEl) { keepAliveEl = new Audio(silentWavUrl()); keepAliveEl.loop = true; }
      keepAlive = keepAliveEl;
      keepAlive.currentTime = 0;
      const p = keepAlive.play();
      if (p && p.then) p.then(() => dbg('silent keep-alive playing'), (e) => dbg('keep-alive blocked: ' + (e && e.name), true));
    } catch (e) { dbg('keep-alive failed: ' + (e && e.name), true); }
    keepAliveTimer = setTimeout(stopKeepAlive, 30 * 60 * 1000);
  }
  function stopKeepAlive() {
    clearTimeout(keepAliveTimer);
    if (keepAlive) { try { keepAlive.pause(); } catch (_) {} keepAlive = null; }
  }
  document.addEventListener('play', (e) => {
    const v = e.target;
    if (v === keepAlive || v.tagName !== 'VIDEO' || !onWatchPage()) return;
    if (!v.muted && v.volume) videoStarted = true;
    // Playing again (by any means) ends a wheel pause; a quick undo by YouTube right after the
    // pause doesn't count, the pause retry handles that.
    if (wheelPauseAt && Date.now() - wheelPauseAt > 1500) wheelPauseAt = 0;
    if (keepAlive) dbg('video playing: near-silent sound stopped');
    stopKeepAlive();
  }, true);

  // ---- Live streams: resuming always jumps to live (never behind) ----
  function ytPlayer() {
    const el = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!el) return null;
    return el.wrappedJSObject || el;
  }
  function isLive(v) {
    if (!v) return false;
    if (v.duration === Infinity) return true;
    try { const p = ytPlayer(); const d = p && p.getVideoData && p.getVideoData(); if (d && typeof d.isLive === 'boolean') return d.isLive; } catch (_) {}
    const box = playerBox(v);
    return !!(box && box.querySelector('.ytp-live, .ytp-live-badge[disabled], .ytm-live-badge, [class*="live-badge"]'));
  }
  function goLive(v) {
    if (!isLive(v)) return;
    dbg('live stream: jumping to live');
    try { const p = ytPlayer(); if (p && typeof p.seekToLiveHead === 'function') { p.seekToLiveHead(); return; } } catch (_) {}
    try {
      const r = v.seekable;
      // Only when there is a real stretch to skip (a half-loaded stream can report a tiny range,
      // and jumping to its end meant jumping back to the start).
      if (r && r.length) { const start = r.start(0), end = r.end(r.length - 1); if (end - start > 30 && end - v.currentTime > 10) v.currentTime = end - 3; }
    } catch (_) {}
  }

  // Opening a live stream (tap, click, wheel or reload): YouTube can start it at the beginning of
  // the stream instead of at live. The first time each live video plays, jump to live once, but
  // only when there is a real stretch behind live (a half-loaded stream reports a tiny range, and
  // jumping then sent it back to the start).
  const liveChecked = new Set();
  document.addEventListener('playing', (e) => {
    const v = e.target;
    if (!IS_TOP || !v || v.tagName !== 'VIDEO' || !onWatchPage()) return;
    const id = videoIdOf(location.href);
    if (!id || liveChecked.has(id)) return;
    const check = (left) => {
      if (videoIdOf(location.href) !== id || !v.isConnected || v.paused) { if (left > 0) setTimeout(() => check(left - 1), 1500); return; }
      // YouTube may only say it is live a few seconds in, so keep checking for a while.
      if (!isLive(v)) { if (left > 0) setTimeout(() => check(left - 1), 1500); return; }
      let start = 0, end = 0;
      try { const r = v.seekable; if (r && r.length) { start = r.start(0); end = r.end(r.length - 1); } } catch (_) {}
      if (end - start < 60) { if (left > 0) setTimeout(() => check(left - 1), 1500); return; }   // range not real yet
      liveChecked.add(id);
      if (end - v.currentTime < 45) return;                                                       // already at live
      dbg('live stream opened behind live: jumping to live');
      try { const p = ytPlayer(); if (p && typeof p.seekToLiveHead === 'function') p.seekToLiveHead(); } catch (_) {}
      // Check it moved; otherwise jump there directly.
      setTimeout(() => { try { if (v.isConnected && end - v.currentTime > 45) v.currentTime = end - 3; } catch (_) {} }, 1000);
    };
    setTimeout(() => check(10), 1200);
  }, true);

  // A quick ▶ / ❚❚ in the middle of the screen, so you can see the wheel press arrived.
  let pressIcon = null;
  function showPress(text) {
    if (!IS_TOP || !document.body) return;
    if (!pressIcon) {
      pressIcon = document.createElement('div');
      pressIcon.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;pointer-events:none;' +
        'background:rgba(0,0,0,.6);color:#fff;font:700 54px/1 sans-serif;padding:22px 30px;border-radius:50px;transition:opacity .3s;';
    }
    pressIcon.textContent = text;
    pressIcon.style.opacity = '1';
    (fullscreenElement() || document.body).appendChild(pressIcon);
    clearTimeout(pressIcon.timer);
    pressIcon.timer = setTimeout(() => { pressIcon.style.opacity = '0'; }, 600);
  }

  // Play / pause, then check it really happened; YouTube sometimes undoes or ignores the first try.
  function playVideo(v, tries = 2) {
    try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
    if (tries > 0) setTimeout(() => { if (v.isConnected && v.paused && !wheelPauseAt) { dbg('play did not take, trying again'); playVideo(v, tries - 1); } }, 700);
  }
  let wheelPauseAt = 0, liveResume = false;
  function pauseFromCar(v) {
    wheelPauseAt = Date.now();
    v.pause();
    startKeepAlive();
    setTimeout(() => {
      if (v.isConnected && !v.paused && wheelPauseAt && Date.now() - wheelPauseAt < 1500) { dbg('pause did not take, trying again'); v.pause(); }
    }, 700);
  }

  // One wheel press can arrive twice, even as two different commands (for example "pause" and
  // "previous track"); doing both would pause and play again at once, so the press seems lost.
  // Every play/pause command from the car goes through here and only the first one counts.
  let lastToggle = 0;
  function playFullscreen(want) {
    const now = Date.now();
    if (now - lastToggle < 450) { dbg('▼ repeat ignored'); return; }
    const v = biggestVideo();
    const playing = v && !v.paused;
    if (want === 'play' && playing) return;
    if (want === 'pause' && !playing) return;
    lastToggle = now;
    if (playing) { showPress('❚❚'); pauseFromCar(v); return; }
    wheelPauseAt = 0;
    liveResume = true;   // a wheel play: a live stream resumes at live
    showPress('▶');
    if (fullscreenElement()) { stopKeepAlive(); if (v) { goLive(v); playVideo(v); } return; }
    // Not in fullscreen: start playing right away (so ▼ works even if the MacroDroid tap is late
    // or missing), and ask for the tap that puts it in fullscreen.
    if (v && v.readyState > 0) { liveResume = false; goLive(v); playVideo(v); }
    requestCarTap();
  }

  function closePicker() {
    if (!picker) return;
    clearTimeout(picker.timer);
    picker.box.remove();
    picker = null;
  }

  function choose(i) {
    const p = picker;
    if (!p) return;
    const item = p.items[i];
    const shown = p.shown;
    closePicker();
    if (!item || item.kind === 'close') return;
    if (item.kind === 'nav') { dbg('wheel: ' + item.label); item.run(shown); return; }
    dbg('playing ' + item.id);
    if (!fullscreenElement()) {
      keepWheelAlive();
      pendingWatch = { id: item.id, until: Date.now() + 10000 };
      setTimeout(watchWhenReady, 300);
    }
    item.link.click();
  }

  function drawPicker() {
    const p = picker;
    p.tiles.forEach((t, i) => {
      const on = i === p.sel;
      t.style.outline = on ? '5px solid #fff' : 'none';
      t.style.opacity = on ? '1' : '.6';
      t.style.transform = on ? 'scale(1.06)' : 'none';
    });
    const t = p.tiles[p.sel];
    const left = t.offsetLeft - (p.row.clientWidth - t.offsetWidth) / 2;
    p.row.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    clearTimeout(p.timer);
    p.timer = setTimeout(() => choose(p.sel), PICK_DELAY);
  }

  // The tiles: ✕ Close first (opening by accident never does anything), then 🏠 Home, then the
  // video's suggestions.
  function pickerItems() {
    const close = { kind: 'close', label: '✕  Close' };
    const home = { kind: 'nav', label: '🏠  Home', run: () => goHome() };
    return [close, home, ...suggestions(MAX_PICKS)];
  }

  function openPicker(skip) {
    const items = pickerItems();
    const ids = new Set(skip || []);
    let lastLink = null;
    for (const it of items) if (it.kind === 'video') { ids.add(it.id); lastLink = it.link; }
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:linear-gradient(transparent,rgba(0,0,0,.85) 25%);' +
      'padding:40px 0 6px;font:600 17px/1.25 sans-serif;color:#fff;';
    const hint = document.createElement('div');
    hint.textContent = 'Seek ▲ = move  ·  Seek ▼ or wait 3 s = choose';
    hint.style.cssText = 'padding:0 28px 10px;font-size:15px;opacity:.8;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:22px;overflow-x:auto;padding:14px 28px;scrollbar-width:none;';
    const tiles = [];
    items.forEach((it, i) => {
      const t = document.createElement('div');
      if (it.kind === 'video') {
        t.style.cssText = 'flex:0 0 280px;border-radius:12px;overflow:hidden;background:#222;transition:transform .15s;cursor:pointer;';
        const img = document.createElement('img');
        img.src = it.img;
        img.style.cssText = 'display:block;width:280px;height:158px;object-fit:cover;background:#111;';
        const cap = document.createElement('div');
        cap.textContent = it.title || 'Video';
        cap.style.cssText = 'padding:8px 10px;height:42px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
        t.append(img, cap);
      } else {
        t.textContent = it.label;
        t.style.cssText = 'flex:0 0 180px;min-height:208px;border-radius:12px;background:#333;display:flex;align-items:center;justify-content:center;' +
          'text-align:center;font-size:22px;cursor:pointer;transition:transform .15s;';
      }
      t.addEventListener('click', (e) => { e.stopPropagation(); if (picker) choose(i); });
      row.appendChild(t);
      tiles.push(t);
    });
    box.append(hint, row);
    (fullscreenElement() || document.body).appendChild(box);
    picker = { box, row, tiles, items, sel: 0, timer: 0, shown: { ids, lastLink } };
    drawPicker();
  }

  // Seek ▲ opens the box and moves it forward.
  function onSeekNext() {
    dbg('car media command: nexttrack (seek ▲)');
    if (!onWatchPage()) return;
    if (picker && !picker.box.isConnected) closePicker();
    if (!picker) { openPicker(); return; }
    picker.sel = (picker.sel + 1) % picker.tiles.length;
    drawPicker();
  }
  // Seek ▼ is the OK button: with the strip open it chooses the boxed tile right away.
  // On a video page it is otherwise play/pause (playing also goes fullscreen).
  // Off a video page (Home, results...) the wheel does nothing.
  function onSeekPrev() {
    dbg('car media command: previoustrack (seek ▼)');
    if (picker && !picker.box.isConnected) closePicker();
    if (picker) { choose(picker.sel); return; }
    if (!onWatchPage()) return;
    playFullscreen();
  }

  // ---- Opening or reloading a YouTube video page: play it in fullscreen without touching ----
  // Set to false to turn this off.
  const AUTO_START = true;
  // If the video still sits on its play button (the first tap was missed), ask again every
  // 7 seconds, up to 4 more times. The wheel can't help there: the car sends no buttons
  // while nothing makes a sound.
  if (AUTO_START && IS_TOP && !leavingForHome && onYouTube() && location.pathname === '/watch') {
    let tries = 0, asks = 0;
    const stuck = () => {
      if (videoStarted || fullscreenElement() || !onWatchPage() || document.visibilityState !== 'visible') return false;
      const v = biggestVideo();
      return !v || v.paused;
    };
    const ask = () => {
      if (!stuck() || carTap) return;
      dbg('page loaded: asking for the fullscreen tap');
      requestCarTap();
      if (++asks <= 4) setTimeout(ask, 7000);
    };
    const check = () => {
      if (fullscreenElement() || ++tries > 40) return;
      const box = document.visibilityState === 'visible' ? playerElement() : null;
      if (box && box.getBoundingClientRect().height > 100) { ask(); return; }
      setTimeout(check, 250);
    };
    addEventListener('load', () => setTimeout(check, 1500));
  }

  // Back in Firefox after another app (CarPlay...) with a video paused from the wheel: start the
  // near-silent sound again so Firefox becomes the car's player again and ▼ can resume.
  if (SEEK_PICKER && IS_TOP && onYouTube()) {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < 800) return;
      hiddenAt = 0;
      // Only for a video paused from the wheel (the near-silent sound may have been stopped while away).
      const v = biggestVideo();
      if (!onWatchPage() || !wheelPauseAt || !v || !v.paused || audibleVideoPlaying()) return;
      dbg('back in Firefox: telling the car again');
      startKeepAlive();
    });
  }

  // Leaving a video page (Back, Home, a channel...): close the strip and stop the near-silent sound.
  if (SEEK_PICKER && IS_TOP && onYouTube()) {
    let lastPath = location.pathname + location.search;
    setInterval(() => {
      const path = location.pathname + location.search;
      if (path === lastPath) return;
      lastPath = path;
      // A different page: the strip's videos and any fullscreen to bring back belong to the old one.
      closePicker();
      dbg('page: ' + path);
      if (!onWatchPage()) {
        clearRestore();
        if (carTap && carTap.mode === 'restore') cancelCarTap();
        if (!pendingWatch) stopKeepAlive();
      }
    }, 1000);
    // Keyboard: H = YouTube Home (not while typing in a box).
    addEventListener('keydown', (e) => {
      if (e.key !== 'h' && e.key !== 'H') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      goHome();
    }, true);
  }

  if (SEEK_PICKER && IS_TOP && /(^|\.)youtube\.com$/.test(location.hostname) && 'mediaSession' in navigator) {
    // YouTube re-sets its own handlers whenever the video changes state (for example right after a
    // pause), so the script claims the buttons back right after every such change, and every
    // half second anyway. (5.15–5.18 blocked YouTube from setting them instead; on the unit that
    // stopped the buttons from arriving at all.)
    const claim = () => {
      try { navigator.mediaSession.setActionHandler('nexttrack', onSeekNext); } catch (_) {}
      try { navigator.mediaSession.setActionHandler('previoustrack', onSeekPrev); } catch (_) {}
      // The car may send play / pause / stop instead (for example while the video is paused).
      try { navigator.mediaSession.setActionHandler('play', () => { dbg('car media command: play'); if (onWatchPage()) playFullscreen('play'); }); } catch (_) {}
      try { navigator.mediaSession.setActionHandler('pause', () => { dbg('car media command: pause'); if (onWatchPage()) playFullscreen('pause'); }); } catch (_) {}
      try { navigator.mediaSession.setActionHandler('stop', () => { dbg('car media command: stop'); if (onWatchPage()) playFullscreen('pause'); }); } catch (_) {}
    };
    claim();
    // Same as 5.14 (the last version where the wheel worked on the unit).
    setInterval(claim, 2000);
    // YouTube puts its own handlers back right after a video plays, pauses or loads, which could
    // swallow the next press; take them back straight after each of those, and again a moment later.
    const reclaim = () => { claim(); setTimeout(claim, 0); setTimeout(claim, 250); setTimeout(claim, 1000); };
    for (const ev of ['play', 'pause', 'playing', 'loadeddata', 'emptied']) document.addEventListener(ev, reclaim, true);
    dbg('wheel buttons claimed');
  }
})();
