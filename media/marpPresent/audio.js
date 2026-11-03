/* marp-present: microphone. One microphone for the page, shared by live captions (captions.js)
 * and the recorder (recorder.js), and a panel to choose it and set it up, like the audio mixer of
 * a streaming app, for a deck built by scimax with `presenter: true`.
 *
 *   M (shift+m)  open or close the Microphone panel (also in the right-click menu)
 *
 * The panel opens in a window of its own (this deck with ?view=mic, showing only the panel), so it
 * never covers the slides: put it beside them, or on the laptop screen while the slides are on the
 * projector. It has a Record / Stop button for the talk (recorder.js; V opens the window); recording from it asks
 * which tab to share, as from the presenter view: pick the slideshow. If pop-ups are blocked, the
 * panel opens at the right edge of the slideshow instead. The panel shows which microphone is in use (and lets you pick another), a live level meter,
 * an input gain, a limiter that keeps loud moments from clipping, a voice filter (less rumble
 * and less "boxy" room sound), the browser's echo cancellation, noise suppression and automatic
 * gain, and a 5 second test that plays back what the recording will sound like. The settings are
 * kept in localStorage ("marp-audio"), for every deck in this browser.
 *
 * The choice of microphone matters most: a webcam, monitor or laptop microphone is far from your
 * mouth and records the room's echo; a USB or headset microphone close to you does not.
 *
 * Changing the microphone or its processing reopens it; captions and a recording in progress
 * carry on with the new one. Gain, limiter and filter change the recording at once.
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "next" || view === "overview" || (window.__marpMic && window.__marpMic.panel)) return;
  const micView = view === "mic";   // the Microphone window: only the panel
  const PREFS = "marp-audio";
  const DEFAULTS = { deviceId: "", label: "", gain: 0, limiter: true, voice: false,
    echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const say = msg => (window.__marpSay || console.log)(msg);
  const dbToGain = db => Math.pow(10, db / 20);
  const toDb = x => x > 0 ? 20 * Math.log10(x) : -Infinity;
  // Webcams, monitors and laptops: far from the mouth, so they record the room
  const FAR = /webcam|camera|\bcam\b|brio|kiyo|iphone|ipad|display|monitor|\bP\d{4}\w*WEB\b|built-?in|macbook|imac|facetime/i;

  let prefs = { ...DEFAULTS };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS) || "{}") }; } catch (e) { /* storage blocked */ }
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* storage blocked */ } };

  // ---- the shared microphone. Chrome does not remember the microphone permission for file:
  // pages, so one open track is shared (and asked for once) rather than opened by each user.
  const mic = { stream: null, users: 0, pending: null };
  const listeners = new Set();
  const live = s => s && s.getAudioTracks().some(t => t.readyState === "live");
  const processing = () => ({ echoCancellation: !!prefs.echoCancellation, noiseSuppression: !!prefs.noiseSuppression, autoGainControl: !!prefs.autoGainControl });

  async function open() {
    const md = navigator.mediaDevices;
    if (!prefs.deviceId) return md.getUserMedia({ audio: processing() });
    try {
      return await md.getUserMedia({ audio: { ...processing(), deviceId: { exact: prefs.deviceId } } });
    } catch (e) {
      if (e.name !== "OverconstrainedError" && e.name !== "NotFoundError") throw e;
      // The id is not known (pages from files may get new ids each time): find it by its name
      const s = await md.getUserMedia({ audio: processing() });
      const same = (await md.enumerateDevices()).find(d => d.kind === "audioinput" && d.label === prefs.label && !/^(default|communications)$/.test(d.deviceId));
      if (same) {
        s.getTracks().forEach(t => t.stop());
        prefs.deviceId = same.deviceId; savePrefs();
        return md.getUserMedia({ audio: { ...processing(), deviceId: { exact: same.deviceId } } });
      }
      say(`The microphone "${prefs.label}" is not connected: using the system default`);
      return s;
    }
  }
  async function get() {
    mic.users++;
    try {
      if (!live(mic.stream)) {
        mic.pending = mic.pending || open();
        try { mic.stream = await mic.pending; } finally { mic.pending = null; }
      }
      return mic.stream;
    } catch (e) { mic.users--; throw e; }
  }
  function release() {
    if (mic.users > 0 && --mic.users === 0 && mic.stream) { mic.stream.getTracks().forEach(t => t.stop()); mic.stream = null; }
  }
  // A new device or processing: open it again and hand the new stream to whoever uses it
  let reopening = Promise.resolve();
  const reopen = () => (reopening = reopening.then(async () => {
    if (!mic.users || !live(mic.stream)) return;   // not open: the next get() uses the new settings
    // Closed first: while a device is open, Chrome gives a new track of it the old processing
    mic.stream.getTracks().forEach(t => t.stop());
    let s;
    try { s = await open(); } catch (e) { say("Could not open the microphone: " + e.message); render(); return; }
    if (!mic.users) { s.getTracks().forEach(t => t.stop()); return; }
    mic.stream = s;
    listeners.forEach(f => { try { f(s); } catch (e) { console.log("[marp-audio] " + e.message); } });
    render();
  }));
  // Settings changed in another window of this deck (the Microphone window): use them here too,
  // so captions and a recording in the slideshow follow the panel
  addEventListener("storage", e => {
    if (e.key !== PREFS) return;
    const old = prefs;
    try { prefs = { ...DEFAULTS, ...JSON.parse(e.newValue || "{}") }; } catch (err) { return; }
    retune();
    if (old.deviceId !== prefs.deviceId || Object.keys(processing()).some(k => !!old[k] !== !!prefs[k])) reopen();
    render();
  });
  const track = () => mic.stream && mic.stream.getAudioTracks()[0];
  const label = () => (track() && track().label) || prefs.label || "";

  // ---- the processing the recording (and the test) goes through: gain, voice filter, limiter.
  // Changed live in every chain. The limiter is a hard compressor just under full scale.
  const chains = new Set();
  function tune(c) {
    const t = c.gain.context.currentTime;
    c.gain.gain.setTargetAtTime(dbToGain(prefs.gain), t, 0.02);
    c.low.frequency.setValueAtTime(prefs.voice ? 90 : 10, t);
    c.box.gain.setValueAtTime(prefs.voice ? -4 : 0, t);
    c.lim.threshold.setValueAtTime(prefs.limiter ? -3 : 0, t);
    c.lim.ratio.setValueAtTime(prefs.limiter ? 20 : 1, t);
  }
  /** Nodes for ctx: connect the microphone to .input and take the sound from .output. */
  function chain(ctx) {
    const gain = ctx.createGain();
    const low = ctx.createBiquadFilter(); low.type = "highpass"; low.Q.value = 0.7;          // rumble, desk knocks
    const box = ctx.createBiquadFilter(); box.type = "peaking"; box.frequency.value = 350; box.Q.value = 1.1;   // a room's "boxy" build-up
    const lim = ctx.createDynamicsCompressor(); lim.knee.value = 0; lim.attack.value = 0.002; lim.release.value = 0.15;
    gain.connect(low); low.connect(box); box.connect(lim);
    const c = { input: gain, gain, low, box, lim, output: lim, dispose: () => chains.delete(c) };
    tune(c);
    chains.add(c);
    return c;
  }
  const retune = () => chains.forEach(c => { try { tune(c); } catch (e) { chains.delete(c); } });

  // Peak and RMS (dBFS) of what an analyser holds now
  function level(an, buf) {
    an.getFloatTimeDomainData(buf);
    let peak = 0, sum = 0;
    for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
    return { peak: toDb(peak), rms: toDb(Math.sqrt(sum / buf.length)) };
  }

  // ---- the panel
  const css = document.createElement("style");
  css.textContent = `
.mp-audio { position: fixed; top: 12px; right: 12px; z-index: 100006; width: min(380px, calc(100vw - 24px));
  max-height: calc(100vh - 24px); overflow: auto; box-sizing: border-box; padding: 14px 16px 12px; border-radius: 12px;
  background: rgba(24, 26, 31, .97); color: #e5e7eb; box-shadow: 0 12px 40px rgba(0, 0, 0, .45); display: none;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: left; }
.mp-audio * { box-sizing: border-box; }
.mp-audio h3 { margin: 0 0 10px; font-size: 15px; font-weight: 650; display: flex; align-items: center; gap: 8px; color: #fff; letter-spacing: 0; text-transform: none; }
.mp-audio h3 .x { margin-left: auto; background: none; border: 0; color: #9ca3af; font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px; }
.mp-audio label { display: flex; align-items: center; gap: 8px; margin: 6px 0; color: #e5e7eb; }
.mp-audio .row { margin: 10px 0; }
.mp-audio .cap { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
.mp-audio select { width: 100%; padding: 5px 6px; border-radius: 6px; border: 1px solid #4b5563; background: #111317; color: #f3f4f6; font: inherit; }
.mp-audio .using { font-size: 12px; color: #9ca3af; margin-top: 4px; }
.mp-audio .warn { margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: rgba(245, 158, 11, .15); color: #fcd34d; font-size: 12px; display: none; }
.mp-audio .meter { position: relative; height: 16px; border-radius: 4px; overflow: hidden; background: #0b0c0f; border: 1px solid #374151; }
.mp-audio .meter .bar { position: absolute; inset: 0; background: linear-gradient(90deg, #15803d 0, #22c55e 69%, #eab308 71%, #eab308 89%, #ef4444 91%); }
.mp-audio .meter .mask { position: absolute; top: 0; bottom: 0; right: 0; width: 100%; background: #0b0c0f; }
.mp-audio .meter .hold { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; left: 0; }
.mp-audio .meter .tick { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255, 255, 255, .25); }
.mp-audio .scale { position: relative; height: 14px; font-size: 10px; color: #6b7280; }
.mp-audio .scale span { position: absolute; transform: translateX(-50%); }
.mp-audio .status { font-size: 12px; margin-top: 2px; min-height: 17px; }
.mp-audio input[type=range] { flex: 1; accent-color: #60a5fa; }
.mp-audio input[type=checkbox] { accent-color: #60a5fa; margin: 0; }
.mp-audio .val { width: 56px; text-align: right; font-variant-numeric: tabular-nums; color: #d1d5db; }
.mp-audio .hint { font-size: 12px; color: #9ca3af; margin: 2px 0 0 22px; }
.mp-audio .btns { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.mp-audio button.b { padding: 5px 12px; border-radius: 6px; border: 1px solid #4b5563; background: #2a2e36; color: #f3f4f6; font: inherit; cursor: pointer; }
.mp-audio button.b:hover { background: #374151; }
.mp-audio button.b.rec { border-color: #dc2626; }
.mp-audio .recrow { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid #374151; }
.mp-audio .recrow .b { min-width: 92px; font-weight: 600; }
.mp-audio .recrow .b.on { background: #dc2626; border-color: #dc2626; color: #fff; }
.mp-audio .recrow .b:disabled { opacity: .5; cursor: default; }
.mp-audio .rstat { font-size: 12px; color: #9ca3af; font-variant-numeric: tabular-nums; }
.mp-audio .rstat.on { color: #fca5a5; }
.mp-audio .tip { font-size: 12px; color: #9ca3af; margin-top: 10px; border-top: 1px solid #374151; padding-top: 8px; }
html.mp-mic-view, html.mp-mic-view body { margin: 0; background: #181a1f; overflow: auto; }
html.mp-mic-view body > :not(.mp-audio) { display: none !important; }
html.mp-mic-view .mp-audio { position: static; width: auto; max-height: none; border-radius: 0; box-shadow: none; }
.mp-audio .msg { font-size: 12px; color: #fcd34d; min-height: 0; margin-top: 6px; }
.mp-audio .msg:empty { display: none; }
@media print { .mp-audio { display: none !important; } }`;
  document.head.appendChild(css);
  const panel = document.createElement("div");
  panel.className = "mp-audio";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Microphone");
  panel.innerHTML = `
<h3>🎙 Microphone <button class="x" title="Close (Esc)" aria-label="Close">×</button></h3>
<div class="row recrow"><button class="b recbtn" title="Record the talk (V)">● Record</button><span class="rstat"></span></div>
<div class="msg" role="status"></div>
<div class="row"><div class="cap">Input</div><select class="dev"></select>
  <div class="using"></div><div class="warn"></div></div>
<div class="row"><div class="cap">Level (what is recorded)</div>
  <div class="meter"><div class="bar"></div><div class="mask"></div><div class="hold"></div></div>
  <div class="scale"></div><div class="status"></div></div>
<div class="row"><label>Gain <input type="range" class="gain" min="-12" max="24" step="1"><span class="val gv"></span></label></div>
<div class="row">
  <label><input type="checkbox" data-k="limiter"> Limiter</label><div class="hint">Keeps loud moments from clipping</div>
  <label><input type="checkbox" data-k="voice"> Voice filter</label><div class="hint">Less rumble, and less of a room's boxy sound (350 Hz)</div>
  <label><input type="checkbox" data-k="echoCancellation"> Echo cancellation</label><div class="hint">Removes sound from your speakers, not the room's echo</div>
  <label><input type="checkbox" data-k="noiseSuppression"> Noise suppression</label><div class="hint">Removes steady noise (fans); can make a distant voice sound hollow</div>
  <label><input type="checkbox" data-k="autoGainControl"> Automatic gain</label><div class="hint">Evens out the level; also turns up the room between sentences</div>
</div>
<div class="btns"><button class="b test">Test: record 5 s</button><button class="b reset">Defaults</button><span class="tstat cap"></span></div>
<div class="tip">For the clearest voice, use a USB or headset microphone a hand's width or two from your mouth.
With a good microphone that close, echo cancellation, noise suppression and automatic gain are often better off.</div>`;
  document.body.appendChild(panel);
  const $ = s => panel.querySelector(s);
  const DB_MIN = -60;
  const at = db => Math.max(0, Math.min(1, (db - DB_MIN) / -DB_MIN)) * 100;
  for (const db of [-48, -36, -24, -18, -12, -6, 0]) {
    const t = document.createElement("div"); t.className = "tick"; t.style.left = at(db) + "%"; $(".meter").appendChild(t);
    const s = document.createElement("span"); s.textContent = db; s.style.left = Math.min(at(db), 97) + "%"; $(".scale").appendChild(s);
  }

  // ---- the Record / Stop button: recorder.js does the recording
  const pad2 = n => String(n).padStart(2, "0");
  const clock = ms => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ":" + pad2(t % 60); };
  let recTimer = 0;
  function renderRec() {
    const R = window.__marpRecorder, btn = $(".recbtn"), st = $(".rstat");
    const s = R && R.status ? R.status() : null;
    btn.disabled = !s || (s.on && !s.here);
    btn.classList.toggle("on", !!(s && s.here));
    btn.textContent = s && s.here ? "■ Stop" : "● Record";
    st.classList.toggle("on", !!(s && s.on));
    st.textContent = !s ? "Recording is not available here"
      : s.here ? "● REC " + clock(Date.now() - s.since) + " · Stop saves the video"
      : s.on ? "Recording in the other window: stop it there"
      : s.remote ? "Asks which tab to share: pick the slideshow" : "Records this tab with your voice";
  }

  let shown = false, ctx = null, src = null, meterChain = null, pre = null, post = null, buf = null, raf = 0, hold = -Infinity, holdAt = 0, clipAt = 0, testing = null;

  function render() {
    if (!shown) return;
    $(".gain").value = prefs.gain;
    $(".gv").textContent = (prefs.gain > 0 ? "+" : "") + prefs.gain + " dB";
    panel.querySelectorAll("input[type=checkbox]").forEach(b => { b.checked = !!prefs[b.dataset.k]; });
    const t = track();
    if (t) {
      const s = t.getSettings ? t.getSettings() : {};
      const bits = [s.sampleRate ? (s.sampleRate / 1000) + " kHz" : "", s.channelCount ? (s.channelCount > 1 ? "stereo" : "mono") : ""].filter(Boolean);
      $(".using").textContent = "In use: " + t.label + (bits.length ? " · " + bits.join(", ") : "");
    } else $(".using").textContent = "Not open";
    const far = FAR.test(label());
    $(".warn").style.display = far ? "block" : "none";
    $(".warn").textContent = far ? "This looks like a webcam, monitor or laptop microphone. It is far from your mouth, so it records the room's echo (the \"in a box\" sound). A USB or headset microphone close to you sounds much better." : "";
  }
  async function devices() {
    const sel = $(".dev");
    let list = [];
    try { list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); } catch (e) { /* none */ }
    const def = list.find(d => d.deviceId === "default");
    const real = list.filter(d => !/^(default|communications)$/.test(d.deviceId));
    sel.replaceChildren();
    const add = (value, text) => { const o = document.createElement("option"); o.value = value; o.textContent = text; sel.appendChild(o); };
    add("", "System default" + (def && def.label ? " (" + def.label.replace(/^Default\s*-\s*/i, "") + ")" : ""));
    real.forEach((d, i) => add(d.deviceId, d.label || "Microphone " + (i + 1)));
    // the saved one, by id or by name
    const saved = real.find(d => d.deviceId === prefs.deviceId) || real.find(d => prefs.label && d.label === prefs.label);
    sel.value = saved ? saved.deviceId : "";
  }

  // The meter: the microphone through the same processing as the recording
  function connectMeter(stream) {
    if (!ctx) return;
    if (src) src.disconnect();
    src = ctx.createMediaStreamSource(stream);
    src.connect(meterChain.input);
  }
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!post) return;
    const out = level(post, buf), before = level(pre, buf), now = performance.now();
    $(".mask").style.width = (100 - at(out.peak)) + "%";
    if (out.peak >= hold || now - holdAt > 1500) { hold = out.peak; holdAt = now; }
    $(".hold").style.left = "calc(" + at(hold) + "% - 1px)";
    if (before.peak > -0.5) clipAt = now;
    const st = $(".status");
    if (now - clipAt < 2000) { st.textContent = prefs.limiter ? "Very loud: the limiter is holding it. Turn the gain down a little" : "Clipping: turn the gain down, or turn the limiter on"; st.style.color = "#f87171"; }
    else if (hold < -50) { st.textContent = "Silent: is this the right microphone, and is it muted?"; st.style.color = "#9ca3af"; }
    else if (hold < -24) { st.textContent = "Quiet: speak as in your talk; if it stays here, turn the gain up"; st.style.color = "#fbbf24"; }
    else { st.textContent = "Good: talking should reach the yellow, rarely the red"; st.style.color = "#4ade80"; }
  }
  const onChange = s => connectMeter(s);

  async function show() {
    if (shown) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say("This browser cannot use a microphone"); return; }
    shown = true;
    panel.style.display = "block";
    render();
    renderRec();
    recTimer = setInterval(renderRec, 500);
    let stream;
    try { stream = await get(); } catch (e) {
      $(".using").textContent = "No microphone: " + e.message + " (allow it with the icon in the address bar)";
      await devices();
      return;
    }
    if (!shown) { release(); return; }
    listeners.add(onChange);
    ctx = new AudioContext();
    meterChain = chain(ctx);
    pre = ctx.createAnalyser(); pre.fftSize = 2048;
    post = ctx.createAnalyser(); post.fftSize = 2048;
    buf = new Float32Array(2048);
    meterChain.gain.connect(pre);
    meterChain.output.connect(post);
    connectMeter(stream);
    ctx.resume().catch(() => {});
    await devices();
    render();
    tick();
  }
  function hide() {
    if (!shown) return;
    if (micView) {
      const R = window.__marpRecorder;
      if (R && R.status && R.status().here) { note("Recording from this window: Stop first, then close it"); return; }
      window.close();
      return;
    }
    shown = false;
    panel.style.display = "none";
    clearInterval(recTimer);
    cancelAnimationFrame(raf);
    if (testing) testing.stop();
    const a = $("audio"); if (a) { a.pause(); a.remove(); }
    if (ctx) {
      listeners.delete(onChange);
      if (meterChain) meterChain.dispose();
      ctx.close().catch(() => {});
      ctx = src = meterChain = pre = post = null;
      release();
    }
  }

  // ---- the Microphone window. Opened by name, so M finds the one already open (even after the
  // slideshow reloads) instead of loading it again, which would end a recording made there.
  const WIN = "marp-mic:" + location.pathname;
  let micWin = null;
  const winOpen = () => { try { return !!(micWin && !micWin.closed); } catch (e) { return false; } };
  function openWindow() {
    const w = window.open("", WIN, "popup,width=400,height=820");
    if (!w) return false;
    let fresh = false;
    try { fresh = w.location.href === "about:blank"; } catch (e) { /* the deck, already open */ }
    if (fresh) {
      const u = new URL(location.href);
      u.search = "?view=mic"; u.hash = "";
      w.location.href = u.href;
    }
    micWin = w;
    try { w.focus(); } catch (e) { /* ok */ }
    return true;
  }
  /** Show the panel: the Microphone window (opened, or brought to the front), or here if pop-ups are blocked. */
  function present() {
    if (micView || shown) { show(); return; }
    if (winOpen()) { try { micWin.focus(); } catch (e) { /* ok */ } return; }
    if (openWindow()) return;
    say("Pop-ups are blocked for this page: the Microphone panel opens here instead");
    show();
  }
  function toggle() {
    if (micView) { hide(); return; }
    if (shown) { hide(); return; }
    if (winOpen()) {
      const R = window.__marpRecorder, s = R && R.status && R.status();
      if (s && s.on && !s.here) { try { micWin.focus(); } catch (e) { /* ok */ } return; }   // recording there
      micWin.close(); micWin = null; return;
    }
    if (openWindow()) return;
    say("Pop-ups are blocked for this page: the Microphone panel opens here instead");
    show();
  }
  // Messages in the Microphone window, which has no slideshow to show them
  let noteTimer = 0;
  function note(msg) {
    const m = $(".msg");
    m.textContent = msg;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { m.textContent = ""; }, 8000);
  }
  if (micView) {
    window.__marpSay = window.__marpSay || note;
    document.documentElement.classList.add("mp-mic-view");
    document.title = "🎙 Microphone · " + document.title;
    show();
  }

  // ---- the controls
  $(".x").addEventListener("click", hide);
  $(".recbtn").addEventListener("click", async () => {
    const R = window.__marpRecorder;
    if (!R || !R.toggle) return;
    const s = R.status();
    // The slideshow records itself, and this panel would be in the video: close it
    if (!s.here && !s.remote) hide();
    await R.toggle();
    renderRec();
  });
  $(".dev").addEventListener("change", e => {
    const o = e.target.selectedOptions[0];
    prefs.deviceId = e.target.value;
    prefs.label = e.target.value ? o.textContent : "";
    savePrefs();
    reopen().then(render);
  });
  $(".gain").addEventListener("input", e => { prefs.gain = +e.target.value; savePrefs(); retune(); render(); });
  panel.querySelectorAll("input[type=checkbox]").forEach(b => b.addEventListener("change", () => {
    prefs[b.dataset.k] = b.checked; savePrefs();
    if (b.dataset.k in processing()) reopen(); else retune();
    render();
  }));
  $(".reset").addEventListener("click", () => {
    const changed = ["echoCancellation", "noiseSuppression", "autoGainControl"].some(k => prefs[k] !== DEFAULTS[k]);
    prefs = { ...DEFAULTS, deviceId: prefs.deviceId, label: prefs.label }; savePrefs();
    retune(); if (changed) reopen();
    render();
  });
  // Five seconds through the recording's processing, then played back
  $(".test").addEventListener("click", () => {
    if (!ctx || !meterChain) return;
    if (testing) { testing.stop(); return; }
    const old = $("audio"); if (old) { old.pause(); old.remove(); }
    const dest = ctx.createMediaStreamDestination();
    meterChain.output.connect(dest);
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    let r;
    try { r = new MediaRecorder(dest.stream, type ? { mimeType: type } : {}); } catch (e) { say("Could not test: " + e.message); return; }
    const parts = [];
    let left = 5;
    const btn = $(".test"), stat = $(".tstat");
    btn.classList.add("rec");
    btn.textContent = "Stop";
    stat.textContent = "Recording… say a sentence from your talk (" + left + ")";
    const count = setInterval(() => { left--; if (left > 0) stat.textContent = "Recording… say a sentence from your talk (" + left + ")"; else r.stop(); }, 1000);
    r.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    r.onstop = () => {
      clearInterval(count);
      try { meterChain && meterChain.output.disconnect(dest); } catch (e) { /* closed */ }
      testing = null;
      btn.classList.remove("rec");
      btn.textContent = "Test: record 5 s";
      if (!shown || !parts.length) { stat.textContent = ""; return; }
      const a = document.createElement("audio");
      a.controls = true;
      a.style.cssText = "width: 100%; margin-top: 8px; height: 32px;";
      a.src = URL.createObjectURL(new Blob(parts, { type: r.mimeType || "audio/webm" }));
      a.onended = () => { stat.textContent = "Listen with headphones to judge the echo"; };
      $(".btns").after(a);
      a.play().catch(() => {});
      stat.textContent = "Playing back";
    };
    r.start();
    testing = r;
  });
  // Keys typed in the panel are not the slideshow's (Esc closes it)
  panel.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); hide(); }
    e.stopPropagation();
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => { if (shown) devices(); });
  }

  function onKey(e) {
    if (e.key === "Escape" && shown) { e.preventDefault(); e.stopPropagation(); hide(); return; }
    if (e.key !== "M" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && /^(TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
    if (t && t.tagName === "INPUT" && t.type !== "range") return;
    if (t && (t.isContentEditable || (t.closest && t.closest(".pyc")))) return;   // typing in a code cell
    if (window.__marpEdits && window.__marpEdits.editing) return;                // editing the slides (d)
    e.preventDefault();
    toggle();
  }
  addEventListener("keydown", onKey, true);
  const hookFrame = f => { try { const w = f.contentWindow; if (w && !w.__marpAudioHooked) { w.__marpAudioHooked = true; w.addEventListener("keydown", onKey, true); } } catch (e) { /* cross-origin */ } };
  const hookAll = () => document.querySelectorAll("iframe").forEach(f => { hookFrame(f); f.addEventListener("load", () => hookFrame(f)); });
  hookAll();
  addEventListener("load", hookAll);
  addEventListener("pagehide", hide);

  // For captions.js, recorder.js and presenter.js's right-click menu
  window.__marpMic = {
    get, release,
    /** The open stream, if any. */
    current: () => mic.stream,
    /** f(stream) when the microphone is opened again with other settings. Returns a remover. */
    onChange: f => { listeners.add(f); return () => listeners.delete(f); },
    chain, level,
    /** The name of the microphone in use (or chosen). */
    label,
    panel: toggle,
    /** Open the panel (V: get ready to record there). */
    present,
    menuItems: () => [{ label: "Microphone…", key: "⇧M", check: shown || winOpen(), run: toggle }],
  };
})();
