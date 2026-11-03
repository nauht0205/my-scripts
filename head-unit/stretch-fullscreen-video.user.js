// ==UserScript==
// @name         Stretch Fullscreen Video
// @namespace    head-unit-fullscreen
// @version      5.15
// @updateURL    https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/stretch-fullscreen-video.user.js
// @downloadURL  https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/stretch-fullscreen-video.user.js
// @description  Stretches fullscreen video to fill the whole screen (no crop) and keeps it stretched. Tapping a YouTube video opens it straight in fullscreen, and so does opening/reloading a video page (with the MacroDroid tap macro); steering-wheel seek ▲ moves a highlight box through the suggested videos, seek ▼ plays the chosen one; otherwise seek ▼ is play/pause (playing also goes fullscreen; a live stream resumes at live). Double-tap (or touchpad double-click) the middle of a video to go fullscreen or exit (sides keep the player's own skip). After switching apps (or the mini player), the next tap returns to fullscreen.
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
  function findVideos(root, out) {
    for (const v of root.querySelectorAll('video')) out.push(v);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) findVideos(el.shadowRoot, out);
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

  function requestCarTap() {
    if (window !== window.top || !document.body) return;
    cancelCarTap();
    const el = document.createElement('div');
    el.textContent = '⛶  ' + CAR_TAP_TEXT;
    el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:2147483647;' +
      'background:rgba(0,0,0,.85);color:#fff;font:700 26px/1.2 sans-serif;padding:18px 30px;border-radius:30px;' +
      'border:2px solid rgba(255,255,255,.6);pointer-events:none;';
    (fullscreenElement() || document.body).appendChild(el);
    carTap = { el, pressed: false, timer: setTimeout(cancelCarTap, 6000) };
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
    if (v && v.readyState > 0) { goLive(v); try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} return; }
    // Only the thumbnail with its ▶ is showing: press the player's own play overlay.
    const box = playerElement();
    if (!box) return;
    const r = box.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (target && (box.contains(target) || target.contains(box))) target.click();
  }

  function useCarTap() {
    cancelCarTap();
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
  let lastSmall = 0, lastAway = 0, lastTouch = 0, ourExitAt = 0;
  let lastExit = null, restore = null, hint = null, lastFsEl = null, fsEnterAt = 0;

  function windowIsSmall() {
    return innerWidth < screen.width * 0.6 || innerHeight < screen.height * 0.6;
  }

  // Temporary on-screen log (bottom-left) to see what happens when switching apps. Set to false to hide.
  const DEBUG = false;
  let dbgBox = null, dbgTimer = 0;
  function dbg(msg, always) {
    if ((!DEBUG && !always) || !IS_TOP || !document.body) return;
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
    if (lastFrame && t - lastFrame > 1200) { lastAway = t; if (restore) restore.sure = true; dbg('away detected (' + Math.round((t - lastFrame) / 100) / 10 + 's gap)'); }
    lastFrame = t;
    requestAnimationFrame(beat);
  }
  if (IS_TOP) requestAnimationFrame(beat);

  function hideHint() { if (hint) { hint.remove(); hint = null; } }
  function clearRestore() { restore = null; hideHint(); }

  function showHint() {
    if (hint || !IS_TOP || !document.body || !restore || windowIsSmall() || fullscreenElement()) return;
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
      if (restore) restore.sure = true;
      // Fullscreen ended just before the window shrank into the mini player.
      if (IS_TOP && lastExit && Date.now() - lastExit.time < 4000) { armRestore(lastExit.v, lastExit.el, true); lastExit = null; }
    } else {
      showHint();   // back to full size from the mini player
    }
  });

  document.addEventListener('visibilitychange', () => {
    dbg('page ' + (document.hidden ? 'hidden' : 'visible'));
    if (document.hidden) { lastAway = Date.now(); if (restore) restore.sure = true; hideHint(); }
    else showHint();
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
  addEventListener('focus', () => { if (IS_TOP) dbg('window focus'); showHint(); });

  document.addEventListener('fullscreenchange', () => {
    const fs = fullscreenElement();
    if (IS_TOP) dbg(fs ? 'fullscreen ON' : 'fullscreen OFF (last touch ' + Math.round((Date.now() - lastTouch) / 100) / 10 + 's ago)');
    if (fs) { lastFsEl = fs; fsEnterAt = Date.now(); clearRestore(); return; }
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
    setTimeout(() => { if (fullscreenElement()) dbg('restore OK'); else dbg('fullscreen restore failed (browser refused)', true); }, 1200);
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
        else dbg('auto fullscreen failed (browser refused)', true);
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
  let claiming = false;
  const PICK_DELAY = 3000, MAX_PICKS = 12;
  let picker = null;

  function suggestions() {
    const current = videoIdOf(location.href);
    const byId = new Map();
    for (const a of document.querySelectorAll('a[href*="/watch"]')) {
      const id = videoIdOf(a.href);
      if (!id || id === current) continue;
      let item = byId.get(id);
      if (!item) {
        if (byId.size >= MAX_PICKS) continue;
        item = { id, link: a, title: '', img: '' };
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
    const rate = 8000, n = rate * 2;             // 2 seconds, 8 kHz, 16-bit mono
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
  document.addEventListener('play', (e) => { if (e.target !== keepAlive && e.target.tagName === 'VIDEO') stopKeepAlive(); }, true);

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
      if (r && r.length) { const end = r.end(r.length - 1); if (end - v.currentTime > 2) v.currentTime = end - 1; }
    } catch (_) {}
  }

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
  let wheelPauseAt = 0;
  function pauseFromCar(v) {
    wheelPauseAt = Date.now();
    v.pause();
    startKeepAlive();
    setTimeout(() => {
      if (v.isConnected && !v.paused && wheelPauseAt && Date.now() - wheelPauseAt < 1500) { dbg('pause did not take, trying again'); v.pause(); }
    }, 700);
  }

  // One wheel press can arrive twice (as two commands); only the first one counts.
  let lastToggle = 0;
  function playFullscreen() {
    const now = Date.now();
    if (now - lastToggle < 200) { dbg('▼ repeat ignored'); return; }
    lastToggle = now;
    const v = biggestVideo();
    if (v && !v.paused) { showPress('❚❚'); pauseFromCar(v); return; }
    wheelPauseAt = 0;
    showPress('▶');
    if (fullscreenElement()) { stopKeepAlive(); if (v) { goLive(v); playVideo(v); } return; }
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
    closePicker();
    if (item) { dbg('playing ' + item.id); item.link.click(); }
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
    p.timer = setTimeout(() => { if (p.sel === 0) closePicker(); else choose(p.sel - 1); }, PICK_DELAY);
  }

  function openPicker() {
    const items = suggestions();
    if (!items.length) { dbg('seek ▲: no suggested videos found', true); return; }
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:linear-gradient(transparent,rgba(0,0,0,.85) 25%);' +
      'padding:40px 0 6px;font:600 17px/1.25 sans-serif;color:#fff;';
    const hint = document.createElement('div');
    hint.textContent = 'Seek ▲ = move  ·  Seek ▼ or wait 3 s = choose';
    hint.style.cssText = 'padding:0 28px 10px;font-size:15px;opacity:.8;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:22px;overflow-x:auto;padding:14px 28px;scrollbar-width:none;';
    const tiles = [];
    const close = document.createElement('div');
    close.textContent = '✕  Close';
    close.style.cssText = 'flex:0 0 180px;border-radius:12px;background:#333;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;';
    close.addEventListener('click', (e) => { e.stopPropagation(); closePicker(); });
    row.appendChild(close);
    tiles.push(close);
    items.forEach((it, i) => {
      const t = document.createElement('div');
      t.style.cssText = 'flex:0 0 280px;border-radius:12px;overflow:hidden;background:#222;transition:transform .15s;cursor:pointer;';
      const img = document.createElement('img');
      img.src = it.img;
      img.style.cssText = 'display:block;width:280px;height:158px;object-fit:cover;background:#111;';
      const cap = document.createElement('div');
      cap.textContent = it.title || 'Video';
      cap.style.cssText = 'padding:8px 10px;height:42px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
      t.append(img, cap);
      t.addEventListener('click', (e) => { e.stopPropagation(); if (picker) choose(i); });
      row.appendChild(t);
      tiles.push(t);
    });
    box.append(hint, row);
    (fullscreenElement() || document.body).appendChild(box);
    picker = { box, row, tiles, items, sel: 0, timer: 0 };
    drawPicker();
  }

  // Seek ▲ opens the strip and moves the box forward.
  function onSeekNext() {
    dbg('car media command: nexttrack (seek ▲)');
    if (picker && !picker.box.isConnected) closePicker();
    if (!picker) { openPicker(); return; }
    picker.sel = (picker.sel + 1) % picker.tiles.length;
    drawPicker();
  }
  // Seek ▼ is the OK button: with the strip open it chooses the boxed tile right away;
  // otherwise it plays the video in fullscreen (or pauses/plays when already fullscreen).
  function onSeekPrev() {
    dbg('car media command: previoustrack (seek ▼)');
    if (picker && !picker.box.isConnected) closePicker();
    if (picker) { const sel = picker.sel; if (sel === 0) closePicker(); else choose(sel - 1); return; }
    playFullscreen();
  }

  // TEMPORARY car-button test: log every media command, key and play/pause the page receives.
  if (DEBUG && IS_TOP) {
    addEventListener('keydown', (e) => dbg('key: ' + e.key + ' / ' + e.code + ' (' + e.keyCode + ')'), true);
    document.addEventListener('pause', (e) => { if (e.target.tagName === 'VIDEO') dbg('video paused'); }, true);
    document.addEventListener('play', (e) => { if (e.target.tagName === 'VIDEO') dbg('video playing'); }, true);
    document.addEventListener('volumechange', (e) => { if (e.target.tagName === 'VIDEO') dbg('volume/mute changed'); }, true);
    if ('mediaSession' in navigator) {
      // YouTube installs its own handlers when a video loads, so keep claiming these.
      const claimTest = () => {
        for (const action of ['seekbackward', 'seekforward', 'skipad']) {
          try { navigator.mediaSession.setActionHandler(action, () => dbg('car media command: ' + action)); } catch (_) {}
        }
      };
      claimTest();
      setInterval(claimTest, 2000);
      document.addEventListener('play', claimTest, true);
      setTimeout(() => dbg('car-button test ready: press the buttons now'), 3000);
    }
  }

  // ---- Opening or reloading a YouTube video page: play it in fullscreen without touching ----
  // Set to false to turn this off.
  const AUTO_START = true;
  if (AUTO_START && IS_TOP && /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname === '/watch') {
    let tries = 0;
    const check = () => {
      if (fullscreenElement() || ++tries > 40) return;
      const box = document.visibilityState === 'visible' ? playerElement() : null;
      if (box && box.getBoundingClientRect().height > 100) { dbg('page loaded: asking for the fullscreen tap'); requestCarTap(); return; }
      setTimeout(check, 250);
    };
    addEventListener('load', () => setTimeout(check, 1500));
  }

  if (SEEK_PICKER && IS_TOP && /(^|\.)youtube\.com$/.test(location.hostname) && 'mediaSession' in navigator) {
    // YouTube re-sets its own handlers whenever the video changes state (for example right after a
    // pause), and a press landing in that moment used to go to YouTube and do nothing. So the page
    // isn't allowed to set these five; only the script's own handlers stay.
    (function lockHandlers() {
      const owned = ['nexttrack', 'previoustrack', 'play', 'pause', 'stop'];
      const pageWin = window.wrappedJSObject;
      try {
        if (!pageWin) {
          const P = MediaSession.prototype, orig = P.setActionHandler;
          P.setActionHandler = function (action, h) {
            if (owned.includes(action) && !claiming) return;
            return orig.call(this, action, h);
          };
        } else {
          const P = pageWin.MediaSession.prototype, orig = P.setActionHandler;
          exportFunction(function (action, h) {
            if (owned.includes(String(action))) return;
            return orig.call(this, action, h);
          }, P, { defineAs: 'setActionHandler' });
        }
      } catch (_) {}
    })();
    const claim = () => {
      claiming = true;
      try { navigator.mediaSession.setActionHandler('nexttrack', onSeekNext); } catch (_) {}
      try { navigator.mediaSession.setActionHandler('previoustrack', onSeekPrev); } catch (_) {}
      // The car may send play / pause / stop instead (for example while the video is paused).
      try { navigator.mediaSession.setActionHandler('play', () => { dbg('car media command: play'); const v = biggestVideo(); if (!v || v.paused) playFullscreen(); }); } catch (_) {}
      try { navigator.mediaSession.setActionHandler('pause', () => { dbg('car media command: pause'); const v = biggestVideo(); if (v && !v.paused) pauseFromCar(v); }); } catch (_) {}
      try { navigator.mediaSession.setActionHandler('stop', () => { dbg('car media command: stop'); const v = biggestVideo(); if (v && !v.paused) pauseFromCar(v); }); } catch (_) {}
      claiming = false;
    };
    claim();
    // YouTube sets its own media handlers when a video loads, so keep claiming the button.
    setInterval(claim, 2000);
    document.addEventListener('play', claim, true);
  }
})();
