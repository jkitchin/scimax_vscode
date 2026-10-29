/* marp-present: live captions. What you say, as text at the bottom of the slides, for a deck
 * built by scimax with `presenter: true`.
 *
 *   v        turn live captions on or off
 *   right-click  "Captions at the top", "Save transcript…", "Clear transcript"
 *
 * It uses the browser's speech recognition (Chrome and Edge send the audio to their speech
 * service; Firefox has none). The language is the deck's `lang:` directive, or the browser's.
 * Whichever window you press v in listens (the slideshow or Marp's presenter view); both show
 * the captions, shared through localStorage ("marp-captions:<path>"), so a talk given from the
 * presenter view captions the audience screen. Recognition stops by itself after a pause, so it
 * is started again until captions are turned off. A reload (live reload) keeps them on.
 *
 * Everything recognised is kept, with the time and the slide, in localStorage
 * ("marp-captions:<path>:transcript"): "Save transcript…" writes it as Markdown, one section per
 * slide, and recorder.js turns the part said during a recording into WebVTT subtitles.
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "next" || view === "overview" || window.__marpCaptions) return;   // the presenter view's next-slide preview, Marp's overview
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ROLE = view === "presenter" ? "presenter" : "audience";
  const KEY = "marp-captions:" + location.pathname;
  const LOG = KEY + ":transcript";
  const RECENT = 15 * 60 * 1000;   // captions left on longer ago than this are not turned back on at load
  const FADE = 7000;               // the captions go after this long without speech
  const MAX_LOG = 20000;           // transcript entries kept
  const LANG = window.__MARP_CAPTIONS_LANG__ || document.documentElement.lang || navigator.language || "en-US";
  const DECK = decodeURIComponent(location.pathname.split("/").pop() || "slides").replace(/\.html?$/, "").replace(/-annotated$/, "");
  const say = msg => (window.__marpSay || console.log)(msg);

  // ---- shared state: { on, owner: "audience" | "presenter", top, text, interim, at, status, savedAt }
  // `status` is shown in the bar until the first words are heard: "Listening…", or what went wrong
  function load() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { /* storage blocked */ }
    return s;
  }
  let state = load();
  if (state.on && !(Date.now() - (state.savedAt || 0) < RECENT)) state = { top: state.top };
  function save() {
    state.savedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    render();
  }

  // ---- the transcript: [{ start, end, slide, text }], times in ms since 1970
  function transcript() {
    try { return JSON.parse(localStorage.getItem(LOG) || "[]") || []; } catch (e) { return []; }
  }
  function remember(entry) {
    const list = transcript();
    list.push(entry);
    try { localStorage.setItem(LOG, JSON.stringify(list.slice(-MAX_LOG))); } catch (e) { /* storage full or blocked */ }
  }

  // ---- slides
  const slides = () => [...document.querySelectorAll("svg[data-marpit-svg]")];
  const slideNo = () => {
    const i = slides().indexOf(document.querySelector("svg[data-marpit-svg].bespoke-marp-active"));
    return i >= 0 ? i + 1 : +((location.hash.match(/^#(\d+)/) || [, "1"])[1]);
  };
  const slideTitle = n => {
    const h = slides()[n - 1] && slides()[n - 1].querySelector("h1, h2, h3");
    return h ? h.textContent.trim() : "";
  };

  // ---- recognition, in the window that turned captions on
  let rec = null, listening = false, failures = 0, segStart = 0, warned = false;
  // The last few sentences: the bar shows the end of them
  const tail = text => text.length > 400 ? text.slice(text.indexOf(" ", text.length - 400) + 1) : text;

  function heard(text) {
    text = text.trim();
    if (!text) return;
    const now = Date.now();
    remember({ start: segStart || now, end: now, slide: slideNo(), text });
    segStart = 0;
    state.text = tail(state.text && now - (state.at || 0) < FADE ? state.text + " " + text : text);
  }
  // ---- one microphone for the page, shared with the recorder. Chrome does not remember the
  // microphone permission for file: pages, so asking again (every restart of the recogniser)
  // would mean a prompt each time; one open track is asked for once.
  const mic = { stream: null, users: 0, pending: null };
  const live = s => s && s.getAudioTracks().some(t => t.readyState === "live");
  window.__marpMic = {
    async get() {
      mic.users++;
      try {
        if (!live(mic.stream)) {
          mic.pending = mic.pending || navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          try { mic.stream = await mic.pending; } finally { mic.pending = null; }
        }
        return mic.stream;
      } catch (e) { mic.users--; throw e; }
    },
    release() {
      if (mic.users > 0 && --mic.users === 0 && mic.stream) { mic.stream.getTracks().forEach(t => t.stop()); mic.stream = null; }
    },
  };
  let micHeld = false;   // the captions hold a track of the shared microphone
  async function holdMic() {
    if (micHeld || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return micHeld;
    try { await window.__marpMic.get(); micHeld = true; } catch (e) { console.log("[marp-captions] microphone: " + e.name + " " + e.message); }
    return micHeld;
  }
  function dropMic() { if (micHeld) { micHeld = false; window.__marpMic.release(); } }
  let trackOk = true;    // this browser's recogniser takes a MediaStreamTrack (Chrome 135+)

  let starting = false, restart = 0;
  async function listen() {
    if (!Recognition || rec || starting) return;
    listening = true;
    starting = true;
    await holdMic();   // blocked or no microphone: the recogniser reports it
    starting = false;
    if (!listening || rec) { if (!listening) dropMic(); return; }   // turned off while asking
    rec = new Recognition();
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => console.log("[marp-captions] listening, lang " + LANG);
    rec.onresult = e => {
      state.status = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) heard(r[0].transcript); else interim += r[0].transcript;
      }
      if (interim && !segStart) segStart = Date.now();
      state.interim = interim.trim();
      state.at = Date.now();
      failures = 0;
      save();
    };
    rec.onerror = e => {
      console.log("[marp-captions] error: " + e.error + (e.message ? " (" + e.message + ")" : ""));
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        problem("Captions need the microphone: allow it (the icon in the address bar), then press v twice");
      } else if (e.error === "language-not-supported") {
        problem(`Captions: speech in "${LANG}" is not supported here. Set the deck's lang: directive`);
      } else if (e.error === "network" || e.error === "audio-capture") {
        failures++;
        if (!warned) problem(e.error === "network" ? "Captions: no connection to the speech service (it is online), trying again…" : "Captions: no microphone found, trying again…", true);
        warned = true;
      }
      // "no-speech" and "aborted": just start again (onend)
    };
    // Shown in the caption bar (and as a notice) until speech is heard; a fatal one stops listening
    function problem(msg, retry) {
      say(msg);
      if (!retry) stopListening();
      state.status = msg;
      save();
    }
    rec.onend = () => {
      rec = null;
      if (listening && state.on && state.owner === ROLE) restart = setTimeout(() => { if (listening) listen(); }, Math.min(5000, 200 * 2 ** failures));
      else listening = false;
    };
    const track = micHeld && trackOk && mic.stream && mic.stream.getAudioTracks()[0];
    try {
      if (track) {
        try { rec.start(track); } catch (e) {
          if (e.name !== "TypeError") throw e;
          trackOk = false; rec.start();   // an older recogniser: it opens the microphone itself
        }
      } else rec.start();
    } catch (e) { rec = null; listening = false; state.status = "Could not start captions: " + e.message; say(state.status); save(); }
  }
  function stopListening() {
    listening = false;
    clearTimeout(restart);
    if (rec) { try { rec.abort(); } catch (e) { /* already stopped */ } rec = null; }
    segStart = 0;
    dropMic();
  }

  function turnOn() {
    if (!Recognition) { say("Live captions need Chrome, Edge or Safari: this browser has no speech recognition"); return; }
    state = { on: true, owner: ROLE, top: state.top, text: "", interim: "", at: 0, status: "Listening…" };
    warned = false; failures = 0;
    save();
    listen();
    say("Live captions on: v turns them off");
  }
  function turnOff() {
    stopListening();
    state = { top: state.top };
    save();
  }
  const toggle = () => state.on ? turnOff() : turnOn();

  // ---- the caption bar
  const css = document.createElement("style");
  css.textContent = `
.mp-captions { position: fixed; left: 50%; bottom: 5vh; transform: translateX(-50%); z-index: 100001; max-width: min(88vw, 1400px);
  pointer-events: none; display: none; padding: .35em .75em; border-radius: 8px; background: rgba(0, 0, 0, .78); color: #fff;
  font: 500 clamp(18px, 2.4vw, 38px)/1.3 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; text-align: center; }
.mp-captions.top { top: 5vh; bottom: auto; }
.mp-captions .lines { max-height: 2.6em; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; }
.mp-captions .interim { color: rgba(255, 255, 255, .62); }
.mp-captions.status { font-size: clamp(14px, 1.3vw, 20px); color: rgba(255, 255, 255, .8); }
.mp-captions.in-presenter { font-size: 18px; bottom: 12px; }
body:has(.bespoke-marp-overview[data-open="1"]) .mp-captions { visibility: hidden; }
@media print { .mp-captions { display: none !important; } }`;
  document.head.appendChild(css);
  const bar = document.createElement("div");
  bar.className = "mp-captions" + (ROLE === "presenter" ? " in-presenter" : "");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = '<div class="lines"><div><span class="final"></span> <span class="interim"></span></div></div>';
  document.body.appendChild(bar);
  const finalEl = bar.querySelector(".final"), interimEl = bar.querySelector(".interim");

  function render() {
    const fresh = Date.now() - (state.at || 0) < FADE;
    const text = fresh ? state.text || "" : "", interim = fresh ? state.interim || "" : "";
    // Until the first words: "Listening…" or what went wrong
    const status = !text && !interim && state.status || "";
    finalEl.textContent = text || status;
    interimEl.textContent = interim;
    bar.classList.toggle("top", !!state.top);
    bar.classList.toggle("status", !!status);
    bar.style.display = state.on && (text || interim || status) ? "block" : "none";
  }

  // ---- saving the transcript as Markdown, one section per slide
  const pad = n => String(n).padStart(2, "0");
  const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
  function transcriptMarkdown(list) {
    const t0 = list[0].start, out = [`# Transcript: ${DECK}`, "", new Date(t0).toLocaleString()];
    let slide = null;
    for (const e of list) {
      if (e.slide !== slide) {
        slide = e.slide;
        const title = slideTitle(slide);
        out.push("", `## Slide ${slide}${title ? ": " + title : ""}`, "");
      }
      out.push(`[${clock(e.start - t0)}] ${e.text}`);
    }
    return out.join("\n") + "\n";
  }
  async function saveTranscript() {
    const list = transcript();
    if (!list.length) { say("No transcript yet: turn on captions with v"); return; }
    const now = new Date();
    const name = `${DECK}-transcript-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
    await saveFile(new Blob([transcriptMarkdown(list)], { type: "text/markdown" }), name, "Markdown", ".md");
  }
  // Chrome/Edge let you choose where the file goes; elsewhere (or if that fails) it downloads.
  async function saveFile(blob, name, what, ext) {
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: what, accept: { [blob.type]: [ext] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        say(`Saved ${h.name}`);
        return true;
      } catch (e) { if (e.name === "AbortError") return false; /* otherwise fall back to a download */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    say(`Saved ${name} to Downloads`);
    return true;
  }
  function clearTranscript() {
    try { localStorage.removeItem(LOG); } catch (e) { /* storage blocked */ }
    say("Transcript cleared");
  }

  // ---- keys
  function onKey(e) {
    if (e.key !== "v" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && /^(TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
    if (t && t.tagName === "INPUT" && t.type !== "range") return;
    if (t && (t.isContentEditable || (t.closest && t.closest(".pyc")))) return;   // typing in a code cell
    if (window.__marpEdits && window.__marpEdits.editing) return;                // editing the slides (d)
    toggle();
  }
  addEventListener("keydown", onKey, true);
  // Widgets in iframes swallow keys; listen there too
  const hookFrame = f => { try { const w = f.contentWindow; if (w && !w.__marpCaptionsHooked) { w.__marpCaptionsHooked = true; w.addEventListener("keydown", onKey, true); } } catch (e) { /* cross-origin */ } };
  document.querySelectorAll("iframe").forEach(f => { hookFrame(f); f.addEventListener("load", () => hookFrame(f)); });

  // Another window turned captions on or off, or heard something
  addEventListener("storage", e => {
    if (e.key !== KEY) return;
    state = load();
    if (listening && !(state.on && state.owner === ROLE)) stopListening();
    render();
  });
  addEventListener("pagehide", () => { if (listening) stopListening(); });

  // For presenter.js's right-click menu and recorder.js
  window.__marpCaptions = {
    on: () => !!state.on,
    /** What was said between two times (ms since 1970). */
    between: (t0, t1) => transcript().filter(e => e.end >= t0 && e.start <= t1),
    menuItems: () => [
      { label: Recognition ? "Live captions" : "Live captions (not in this browser)", key: "v", check: !!state.on, off: !Recognition, run: toggle },
      ...(state.on ? [{ label: "Captions at the top", check: !!state.top, run: () => { state.top = !state.top; save(); } }] : []),
      { label: "Save transcript…", off: !transcript().length, run: saveTranscript },
      { label: "Clear transcript", off: !transcript().length, run: clearTranscript },
    ],
    saveFile,
  };

  render();
  // A reload with captions on (live reload) listens again; the browser may ask for the microphone again
  if (state.on && state.owner === ROLE) listen();
  setInterval(() => {
    // after a pause the next words start a fresh caption
    if (listening && state.text && Date.now() - (state.at || 0) > FADE) { state.text = ""; state.interim = ""; save(); }
    render();
  }, 500);
})();
