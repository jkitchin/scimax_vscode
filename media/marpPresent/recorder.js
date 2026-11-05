/* marp-present: record the talk. The slides, the mouse and your voice, as a video, for a deck
 * built by scimax with `presenter: true`.
 *
 *   V (shift+v)  open the Microphone window (audio.js), to check the microphone and then press
 *                ● Record there; while recording, stop and save it
 *   right-click  "Highlight the mouse while recording", "Save the recording…" (again, if the
 *                first save was cancelled), "Save captions of the recording (.vtt)"
 *
 * Pressed in the slideshow, Chrome asks to share "this tab"; pressed in Marp's presenter view, it
 * asks which tab to share: pick the slideshow. Sound the deck plays (videos, audio) is recorded
 * along with the microphone. Chrome and Edge write MP4 (H.264 + AAC); Firefox writes WebM.
 * The video is kept to 1080p and a modest bitrate, and a tab only sends frames when something
 * changes, so slides make small files.
 *
 * A tab's recording does not show the mouse pointer, so while recording the slideshow draws a
 * yellow ring that follows the mouse and pulses on clicks (hidden while the laser pointer is on,
 * which shows itself). Recording state is shared through localStorage ("marp-rec:<path>"), so the
 * slideshow draws the ring and the presenter view shows ● REC with the time, whichever window
 * records. The video is held by the browser until you stop (Chrome keeps large recordings on
 * disk), then saved; closing the tab while recording asks first, and live reload waits.
 * In Chrome/Edge, stopping opens a save dialog (named <deck>-YYYY-MM-DD-HHMM) to choose where the
 * video goes; stopped from Chrome's "Stop sharing" bar, a "Save the recording…" button opens it.
 * Firefox downloads the video.
 *
 * The microphone is audio.js's (M opens its panel: which microphone, gain, limiter, filters); its
 * sound goes through that panel's processing, and the presenter view's ● REC shows its level.
 *
 * With live captions on (captions.js, v), what was said during the recording can be saved as
 * WebVTT subtitles next to the video; ffmpeg can add them as a subtitle track:
 *   ffmpeg -i talk.mp4 -i talk.vtt -c copy -c:s mov_text talk-captioned.mp4
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "next" || view === "overview" || window.__marpRecorder) return;   // the presenter view's next-slide preview, Marp's overview
  const presenterView = view === "presenter";
  // Windows that record the slideshow tab rather than themselves: the presenter view and the
  // Microphone window (audio.js, ?view=mic)
  const remote = presenterView || view === "mic";
  const KEY = "marp-rec:" + location.pathname;
  const PREFS = "marp-rec-prefs";
  const ALIVE = 6000;                // a recording window that has not said it is recording for this long has gone
  const VIDEO_BPS = 2500000, AUDIO_BPS = 128000;
  // avc1, not avc3: QuickTime and the rest of macOS cannot play avc3 video (only its sound)
  const TYPES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4",
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const DECK = decodeURIComponent(location.pathname.split("/").pop() || "slides").replace(/\.html?$/, "").replace(/-annotated$/, "");
  const say = msg => (window.__marpSay || console.log)(msg);
  const pad = n => String(n).padStart(2, "0");
  const duration = ms => { const s = Math.round(ms / 1000); return (s >= 3600 ? Math.floor(s / 3600) + ":" + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ":" + pad(s % 60); };

  let prefs = { cursor: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS) || "{}") }; } catch (e) { /* storage blocked */ }
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* storage blocked */ } render(); };

  // ---- shared state: { on, since, alive } from the window that records
  let shared = {};
  const loadShared = () => { try { shared = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { shared = {}; } };
  loadShared();
  const recordingSomewhere = () => !!(shared.on && Date.now() - (shared.alive || 0) < ALIVE) || !!recorder;
  function publish(on) {
    shared = on ? { on: true, since: started, alive: Date.now() } : {};
    try { localStorage.setItem(KEY, JSON.stringify(shared)); } catch (e) { /* storage blocked */ }
    render();
  }

  // ---- recording, in this window
  let recorder = null, chunks = [], streams = [], sized = null, micShared = false, audio = null, started = 0, last = null, title = document.title;
  // The microphone's path into the mix (audio.js: gain, filter, limiter), and its level
  let micSource = null, micChain = null, micMeter = null, micBuf = null, unhook = null, quietSince = 0, quietWarned = false;

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
      say("Recording needs Chrome, Edge or Firefox"); return;
    }
    if (recordingSomewhere()) { say("Already recording in another window: stop it there"); return; }
    hideSaveButton();
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 }, displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: !remote,                 // the slideshow records itself; the other windows ask for its tab
        selfBrowserSurface: remote ? "exclude" : "include",
        surfaceSwitching: "exclude",
        systemAudio: "exclude",
      });
    } catch (e) {
      say(e.name === "NotAllowedError" ? "Not recording: sharing was cancelled" : "Could not record the screen: " + e.message);
      return;
    }
    let mic = null;
    try {
      // The page's one microphone (captions.js), so Chrome asks for it once
      mic = window.__marpMic ? await window.__marpMic.get()
        : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { say("No microphone, so the recording has no voice (" + e.message + ")"); }
    micShared = !!(mic && window.__marpMic);

    const video = display.getVideoTracks()[0];
    if ("contentHint" in video) video.contentHint = "detail";   // sharp text over smooth motion
    sized = fixedSize(video);
    const tracks = [sized];
    const hasMic = !!(mic && mic.getAudioTracks().length), hasTab = display.getAudioTracks().length > 0;
    if (hasMic || hasTab) {
      // the microphone and the tab's own sound, mixed into one track
      audio = new AudioContext();
      const mix = audio.createMediaStreamDestination();
      if (hasTab) audio.createMediaStreamSource(display).connect(mix);
      if (hasMic) {
        const M = window.__marpMic;
        micChain = M && M.chain ? M.chain(audio) : null;
        const into = micChain ? micChain.input : mix;
        if (micChain) micChain.output.connect(mix);
        micMeter = audio.createAnalyser(); micMeter.fftSize = 4096; micBuf = new Float32Array(4096);
        (micChain ? micChain.output : into).connect(micMeter);
        micSource = audio.createMediaStreamSource(mic);
        micSource.connect(into);
        // another microphone chosen while recording (audio.js): carry on with it
        if (M && M.onChange) unhook = M.onChange(s => {
          if (!audio) return;
          if (micSource) micSource.disconnect();
          micSource = audio.createMediaStreamSource(s);
          micSource.connect(into);
          say("Recording with " + (s.getAudioTracks()[0] || {}).label);
        });
      }
      audio.resume().catch(() => {});
      tracks.push(mix.stream.getAudioTracks()[0]);
    }
    streams = [display, micShared ? null : mic].filter(Boolean);
    const type = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    try {
      recorder = new MediaRecorder(new MediaStream(tracks), { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
    } catch (e) { release(); say("Could not record: " + e.message); return; }
    chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = finished;
    video.addEventListener("ended", stop);   // Chrome's own "Stop sharing" button
    recorder.start(1000);
    started = Date.now();
    publish(true);
    document.title = "● REC " + title;
    quietSince = 0; quietWarned = false;
    const micName = mic && (mic.getAudioTracks()[0] || {}).label;
    say(mic ? `Recording with ${micName || "the microphone"}: ■ Stop or V saves the video`
      : "Recording without a microphone: ■ Stop or V saves the video");
  }
  // Every frame the size of the first one, letterboxed: an MP4 that QuickTime can play (avc1)
  // breaks when the size changes mid-stream (resizing the window, going full screen). Frames
  // come as the tab is captured, not on a timer, so this keeps going in a background tab.
  function fixedSize(track) {
    if (!window.MediaStreamTrackProcessor || !window.MediaStreamTrackGenerator || !window.VideoFrame || !window.OffscreenCanvas) return track;
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    const out = new MediaStreamTrackGenerator({ kind: "video" });
    if ("contentHint" in out) out.contentHint = "detail";
    const writer = out.writable.getWriter();
    const even = n => Math.max(2, Math.round(n / 2) * 2);
    let canvas = null, ctx = null;
    (async () => {
      try {
        for (;;) {
          const { value: frame, done } = await reader.read();
          if (done) break;
          const fw = frame.displayWidth, fh = frame.displayHeight;
          if (!canvas) {
            const k = Math.min(1, 1920 / fw, 1080 / fh);
            canvas = new OffscreenCanvas(even(fw * k), even(fh * k));
            ctx = canvas.getContext("2d", { alpha: false });
          }
          const W = canvas.width, H = canvas.height, k = Math.min(W / fw, H / fh), w = fw * k, h = fh * k;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(frame, (W - w) / 2, (H - h) / 2, w, h);
          const timestamp = frame.timestamp;
          frame.close();
          await writer.write(new VideoFrame(canvas, { timestamp }));
        }
      } catch (e) { console.log("[marp-recorder] frames: " + e.message); }
      writer.close().catch(() => {});
    })();
    return out;
  }
  function stop() {
    if (!recorder || recorder.state === "inactive") return;
    askWhere();
    recorder.stop();
  }
  // The file name to suggest: <deck>-YYYY-MM-DD-HHMM, and the extension the browser records in
  const recordingName = t => { const d = new Date(t); return `${DECK}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
  const mimeOf = r => (r.mimeType || chunks[0] && chunks[0].type || "video/webm").split(";")[0];
  const extOf = type => type === "video/mp4" ? ".mp4" : ".webm";
  // Chrome/Edge show a save dialog only during a key press or click, and the video is ready a
  // moment after stopping, so the dialog opens as you stop (V, ■ Stop, the menu) and the video is
  // written to the chosen file when it is ready. `where` resolves to the file, "cancelled", or null
  // (no dialog: Firefox, or stopped from Chrome's "Stop sharing" bar).
  let where = null;
  function askWhere() {
    where = null;
    if (!window.showSaveFilePicker) return;
    const type = mimeOf(recorder), ext = extOf(type);
    try {
      where = showSaveFilePicker({ suggestedName: recordingName(started) + ext, types: [{ description: "Video", accept: { [type]: [ext] } }] })
        .catch(e => e.name === "AbortError" ? "cancelled" : null);
    } catch (e) { where = null; }
  }
  function release() {
    streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    if (sized) { sized.stop(); sized = null; }
    streams = [];
    if (unhook) { unhook(); unhook = null; }
    if (micChain) { micChain.dispose(); micChain = null; }
    micSource = micMeter = micBuf = null;
    if (micShared) { micShared = false; window.__marpMic.release(); }
    if (audio) { audio.close().catch(() => {}); audio = null; }
  }
  function finished() {
    const type = mimeOf(recorder);
    recorder = null;
    release();
    publish(false);
    document.title = title;
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (!blob.size) { say("The recording is empty"); return; }
    last = { blob, name: recordingName(started), ext: extOf(type), started, ended: Date.now(), saved: false };
    const pending = where;
    where = null;
    saveRecording(pending);
  }
  async function saveRecording(pending) {
    if (!last) return;
    hideSaveButton();
    const mb = (last.blob.size / 1e6).toFixed(last.blob.size < 1e7 ? 1 : 0);
    const handle = pending ? await pending : null;
    let ok;
    if (handle === "cancelled") ok = false;
    else if (handle) {
      try {
        const w = await handle.createWritable(); await w.write(last.blob); await w.close();
        say(`Saved ${handle.name}`);
        ok = true;
      } catch (e) { say("Could not save the recording: " + e.message); ok = false; }
    } else if (window.showSaveFilePicker && navigator.userActivation && !navigator.userActivation.isActive) {
      // Stopped without a key press or click (Chrome's "Stop sharing" bar): the dialog needs one
      showSaveButton();
      say("Recording stopped: click Save the recording… to choose where it goes");
      return;
    } else ok = await saveFile(last.blob, last.name + last.ext, "Video", last.ext);
    if (ok) {
      last.saved = true;
      const captions = cues().length ? " · right-click → Save captions of the recording for subtitles" : "";
      setTimeout(() => say(`Recorded ${duration(last.ended - last.started)}, ${mb} MB${captions}`), 1500);
    } else {
      say("The recording was not saved: right-click → Save the recording… (until the next recording)");
    }
  }
  // A button to click when the recording stopped without a key press, so the save dialog can open
  let saveButton = null;
  function showSaveButton() {
    hideSaveButton();
    const b = saveButton = document.createElement("button");
    b.textContent = "💾 Save the recording…";
    b.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;"
      + "font:600 16px system-ui,sans-serif;padding:10px 18px;border-radius:8px;border:0;cursor:pointer;"
      + "background:#c62828;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.4)";
    b.addEventListener("click", e => { e.stopPropagation(); saveRecording(); });
    document.body.appendChild(b);
  }
  function hideSaveButton() { if (saveButton) { saveButton.remove(); saveButton = null; } }
  // As captions.js: a file picker in Chrome/Edge, a download elsewhere.
  async function saveFile(blob, name, what, ext) {
    if (window.__marpCaptions) return window.__marpCaptions.saveFile(blob, name, what, ext);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    say(`Saved ${name} to Downloads`);
    return true;
  }

  // ---- captions said during the last recording, as WebVTT cues of at most two short lines
  function cues() {
    if (!last || !window.__marpCaptions) return [];
    const out = [];
    for (const e of window.__marpCaptions.between(last.started, last.ended)) {
      const t0 = Math.max(0, e.start - last.started), t1 = Math.max(t0 + 1000, e.end - last.started);
      const words = e.text.split(/\s+/), parts = [];
      let line = "";
      for (const w of words) {
        if (line && (line + " " + w).length > 84) { parts.push(line); line = w; } else line = line ? line + " " + w : w;
      }
      if (line) parts.push(line);
      // split the time between the parts by their length
      const total = parts.reduce((n, p) => n + p.length, 0);
      let at = t0;
      for (const p of parts) {
        const end = at + (t1 - t0) * p.length / total;
        out.push({ start: at, end, text: p });
        at = end;
      }
    }
    return out;
  }
  const stamp = ms => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
  function saveCaptions() {
    const list = cues();
    if (!list.length) { say("Nothing was captioned during the last recording"); return; }
    const vtt = "WEBVTT\n\n" + list.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");
    saveFile(new Blob([vtt], { type: "text/vtt" }), last.name + ".vtt", "WebVTT subtitles", ".vtt");
  }

  // ---- the mouse, drawn in the slideshow while recording
  const css = document.createElement("style");
  css.textContent = `
.mp-rec-cursor { position: fixed; left: 0; top: 0; z-index: 100004; pointer-events: none; display: none; }
.mp-rec-cursor > div { width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; box-sizing: border-box;
  border: 3px solid rgba(250, 204, 21, .95); background: rgba(250, 204, 21, .22); box-shadow: 0 0 6px rgba(0, 0, 0, .35);
  transition: transform .12s ease-out, background-color .12s; }
.mp-rec-cursor.down > div { transform: scale(.7); background: rgba(250, 204, 21, .6); }
html.laser-on .mp-rec-cursor { display: none !important; }
.mp-rec-badge { position: fixed; top: 10px; left: 12px; z-index: 100002; padding: 4px 10px; border-radius: 999px; display: none;
  background: rgba(220, 38, 38, .92); color: #fff; font: 600 14px/1 system-ui, -apple-system, sans-serif; font-variant-numeric: tabular-nums; }
body:has(.bespoke-marp-overview[data-open="1"]) .mp-rec-cursor { visibility: hidden; }
.mp-rec-badge .lv { display: inline-block; width: 44px; height: 6px; margin-left: 8px; vertical-align: middle; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, .3); }
.mp-rec-badge .lv > i { display: block; height: 100%; width: 0; background: #fff; transition: width .1s linear; }
.mp-rec-badge .lv.hot > i { background: #fde047; }
@media print { .mp-rec-cursor, .mp-rec-badge { display: none !important; } }`;
  document.head.appendChild(css);
  const ring = document.createElement("div");
  ring.className = "mp-rec-cursor";
  ring.appendChild(document.createElement("div"));
  const badge = document.createElement("div");
  badge.className = "mp-rec-badge";
  badge.innerHTML = '<span class="t"></span><span class="lv" title="Microphone level"><i></i></span>';
  document.body.append(ring, badge);

  let inside = true;
  const move = (x, y) => { ring.style.transform = `translate(${x}px, ${y}px)`; };
  addEventListener("pointermove", e => { inside = true; move(e.clientX, e.clientY); render(); }, true);
  addEventListener("pointerdown", () => ring.classList.add("down"), true);
  addEventListener("pointerup", () => ring.classList.remove("down"), true);
  document.documentElement.addEventListener("mouseleave", () => { inside = false; render(); });
  // Widgets live in same-origin iframes, which swallow the mouse: follow it in (scaled as Marp scales the slide)
  function hookFrame(f) {
    let w;
    try { w = f.contentWindow; } catch (e) { return; }
    if (!w || w.__marpRecHooked) return;
    w.__marpRecHooked = true;
    const at = e => { const r = f.getBoundingClientRect(); return [r.left + e.clientX * r.width / (f.clientWidth || r.width), r.top + e.clientY * r.height / (f.clientHeight || r.height)]; };
    w.addEventListener("pointermove", e => { inside = true; move(...at(e)); render(); }, true);
    w.addEventListener("pointerdown", () => ring.classList.add("down"), true);
    w.addEventListener("pointerup", () => ring.classList.remove("down"), true);
    w.addEventListener("keydown", onKey, true);
  }
  const hookAll = () => document.querySelectorAll("iframe").forEach(f => { hookFrame(f); f.addEventListener("load", () => hookFrame(f)); });

  function render() {
    const on = recordingSomewhere();
    ring.style.display = on && prefs.cursor && inside && !remote ? "block" : "none";
    // The presenter view is not recorded: show that the talk is
    badge.style.display = on && presenterView ? "block" : "none";
    if (on && presenterView) {
      badge.querySelector(".t").textContent = "● REC " + duration(Date.now() - (recorder ? started : shared.since || Date.now()));
      // the microphone's level, from whichever window records (-60 dB to 0)
      const lv = badge.querySelector(".lv"), db = typeof shared.level === "number" ? shared.level : null;
      lv.style.display = db === null ? "none" : "";
      lv.classList.toggle("hot", db !== null && db > -2);
      lv.firstChild.style.width = db === null ? "0" : Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + "%";
    }
  }

  // ---- keys
  function onKey(e) {
    if (e.key !== "V" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && /^(TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
    if (t && t.tagName === "INPUT" && t.type !== "range") return;
    if (t && (t.isContentEditable || (t.closest && t.closest(".pyc")))) return;   // typing in a code cell
    if (window.__marpEdits && window.__marpEdits.editing) return;                // editing the slides (d)
    e.preventDefault();
    keyed();
  }
  const toggle = () => recorder ? stop() : start();
  // V: stop a recording made here; otherwise open the Microphone window, to check the microphone
  // and start from its Record button (in that window itself, V records)
  function keyed() {
    if (recorder) { stop(); return; }
    const M = window.__marpMic;
    if (view !== "mic" && M && M.present) M.present(); else start();
  }
  addEventListener("keydown", onKey, true);

  addEventListener("storage", e => { if (e.key === KEY) { loadShared(); render(); } });
  addEventListener("beforeunload", e => { if (recorder) { e.preventDefault(); e.returnValue = ""; } });
  addEventListener("pagehide", () => { if (recorder) publish(false); });
  // Live reload (marpExport.ts) waits until the recording is saved
  window.__marpHoldReload = () => !!recorder;

  // For presenter.js's right-click menu
  window.__marpRecorder = {
    /** Start recording, or stop and save it (as V). */
    toggle: () => toggle(),
    /** here: recording in this window; on: recording in this or the other window. */
    status: () => ({ here: !!recorder, on: recordingSomewhere(), since: recorder ? started : shared.since || Date.now(), remote }),
    menuItems: () => [
      { label: recorder ? "Stop recording and save" : "Record the talk…", key: "⇧V", check: !!recorder, run: keyed },
      { label: "Highlight the mouse while recording", check: !!prefs.cursor, run: () => { prefs.cursor = !prefs.cursor; savePrefs(); } },
      ...(last ? [{ label: "Save the recording…", run: () => saveRecording() }] : []),
      ...(last && cues().length ? [{ label: "Save captions of the recording (.vtt)…", run: saveCaptions }] : []),
    ],
  };

  // The microphone's level while recording: for the presenter view's badge, and a warning when
  // it has been silent so long that it is probably the wrong one or muted
  setInterval(() => {
    if (!recorder || !micMeter) return;
    micMeter.getFloatTimeDomainData(micBuf);
    let peak = 0;
    for (const v of micBuf) { const a = Math.abs(v); if (a > peak) peak = a; }
    const db = peak > 0 ? Math.max(-60, Math.round(20 * Math.log10(peak))) : -60;
    shared.level = db;
    try { localStorage.setItem(KEY, JSON.stringify(shared)); } catch (e) { /* storage blocked */ }
    if (presenterView) render();
    const now = Date.now();
    if (db > -55) { quietSince = 0; quietWarned = false; }
    else if (!quietSince) quietSince = now;
    else if (!quietWarned && now - quietSince > 15000) {
      quietWarned = true;
      const name = window.__marpMic && window.__marpMic.label ? window.__marpMic.label() : "";
      say(`No sound from the microphone${name ? " (" + name + ")" : ""} for 15 s: M checks it`);
    }
  }, 200);

  hookAll();
  addEventListener("load", hookAll);
  render();
  setInterval(() => {
    if (recorder) { shared.alive = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(shared)); } catch (e) { /* storage blocked */ } }
    render();
  }, 1000);
})();
