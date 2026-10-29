/* marp-present: record the talk. The slides, the mouse and your voice, as a video, for a deck
 * built by scimax with `presenter: true`.
 *
 *   V (shift+v)  start recording / stop and save it
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
 *
 * With live captions on (captions.js, v), what was said during the recording can be saved as
 * WebVTT subtitles next to the video; ffmpeg can add them as a subtitle track:
 *   ffmpeg -i talk.mp4 -i talk.vtt -c copy -c:s mov_text talk-captioned.mp4
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "next" || view === "overview" || window.__marpRecorder) return;   // the presenter view's next-slide preview, Marp's overview
  const presenterView = view === "presenter";
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

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
      say("Recording needs Chrome, Edge or Firefox"); return;
    }
    if (recordingSomewhere()) { say("Already recording in the other window: press V there to stop"); return; }
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 }, displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: !presenterView,          // the slideshow records itself; the presenter view asks for its tab
        selfBrowserSurface: presenterView ? "exclude" : "include",
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
    const sound = [display, mic].filter(s => s && s.getAudioTracks().length);
    if (sound.length) {
      // the microphone and the tab's own sound, mixed into one track
      audio = new AudioContext();
      const mix = audio.createMediaStreamDestination();
      sound.forEach(s => audio.createMediaStreamSource(s).connect(mix));
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
    say("Recording" + (mic ? "" : " without a microphone") + ": V again stops it and saves the video");
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
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }
  function release() {
    streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    if (sized) { sized.stop(); sized = null; }
    streams = [];
    if (micShared) { micShared = false; window.__marpMic.release(); }
    if (audio) { audio.close().catch(() => {}); audio = null; }
  }
  function finished() {
    const type = (recorder.mimeType || chunks[0] && chunks[0].type || "video/webm").split(";")[0];
    recorder = null;
    release();
    publish(false);
    document.title = title;
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (!blob.size) { say("The recording is empty"); return; }
    const d = new Date(started);
    const name = `${DECK}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    last = { blob, name, ext: type === "video/mp4" ? ".mp4" : ".webm", started, ended: Date.now(), saved: false };
    saveRecording();
  }
  async function saveRecording() {
    if (!last) return;
    const mb = (last.blob.size / 1e6).toFixed(last.blob.size < 1e7 ? 1 : 0);
    const ok = await saveFile(last.blob, last.name + last.ext, "Video", last.ext);
    if (ok) {
      last.saved = true;
      const captions = cues().length ? " · right-click → Save captions of the recording for subtitles" : "";
      setTimeout(() => say(`Recorded ${duration(last.ended - last.started)}, ${mb} MB${captions}`), 1500);
    } else {
      say("The recording was not saved: right-click → Save the recording… (until the next recording)");
    }
  }
  // As captions.js: a file picker in Chrome/Edge, a download elsewhere. Stopping from Chrome's
  // "Stop sharing" bar is not a key press, so the picker is refused and the video downloads.
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
@media print { .mp-rec-cursor, .mp-rec-badge { display: none !important; } }`;
  document.head.appendChild(css);
  const ring = document.createElement("div");
  ring.className = "mp-rec-cursor";
  ring.appendChild(document.createElement("div"));
  const badge = document.createElement("div");
  badge.className = "mp-rec-badge";
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
    ring.style.display = on && prefs.cursor && inside && !presenterView ? "block" : "none";
    // The presenter view is not recorded: show that the talk is
    badge.style.display = on && presenterView ? "block" : "none";
    if (on && presenterView) badge.textContent = "● REC " + duration(Date.now() - (recorder ? started : shared.since || Date.now()));
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
    toggle();
  }
  const toggle = () => recorder ? stop() : start();
  addEventListener("keydown", onKey, true);

  addEventListener("storage", e => { if (e.key === KEY) { loadShared(); render(); } });
  addEventListener("beforeunload", e => { if (recorder) { e.preventDefault(); e.returnValue = ""; } });
  addEventListener("pagehide", () => { if (recorder) publish(false); });
  // Live reload (marpExport.ts) waits until the recording is saved
  window.__marpHoldReload = () => !!recorder;

  // For presenter.js's right-click menu
  window.__marpRecorder = {
    menuItems: () => [
      { label: recorder ? "Stop recording and save" : "Record the talk", key: "⇧V", check: !!recorder, run: toggle },
      { label: "Highlight the mouse while recording", check: !!prefs.cursor, run: () => { prefs.cursor = !prefs.cursor; savePrefs(); } },
      ...(last ? [{ label: "Save the recording…", run: saveRecording }] : []),
      ...(last && cues().length ? [{ label: "Save captions of the recording (.vtt)…", run: saveCaptions }] : []),
    ],
  };

  hookAll();
  addEventListener("load", hookAll);
  render();
  setInterval(() => {
    if (recorder) { shared.alive = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(shared)); } catch (e) { /* storage blocked */ } }
    render();
  }, 1000);
})();
