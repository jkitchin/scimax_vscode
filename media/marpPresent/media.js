/* marp-present: slide media (movies, sound and YouTube/Vimeo players in Marp HTML decks).
 * Part of scimax-vscode; added to every slideshow and HTML export, with or without the presenter tools.
 *
 * - Leaving a slide pauses its movies, sound and embedded players (Marp only hides the other slides).
 * - A movie or sound with `autoplay` plays only while its slide is shown, not from when the deck opens.
 *   In Marp's presenter view it plays muted (the audience window has the sound), and the next-slide
 *   preview and the overview never play it.
 * - A deck opened from disk shows YouTube embeds as a thumbnail that opens the video on YouTube
 *   (YouTube refuses to play in a file:// page, "Error 153").
 */
(() => {
  if (window.__marpMedia) return;
  window.__marpMedia = true;
  const view = new URLSearchParams(location.search).get("view");
  const presenterView = view === "presenter";
  const preview = view === "next" || view === "overview";
  const slides = () => Array.from(document.querySelectorAll("svg[data-marpit-svg]"));
  const activeSvg = () => document.querySelector("svg[data-marpit-svg].bespoke-marp-active") || (slides().length === 1 ? slides()[0] : null);

  // ---- stop movies, sound and embedded players on the slide being left
  // Marp only hides the other slides, so a <video>, <audio> or YouTube/Vimeo player keeps playing
  // after you move on. YouTube takes a pause command only when the embed has enablejsapi=1, so
  // that is added to YouTube frames on the other slides (changing a frame's src reloads it, so a
  // frame on the slide being shown is left until it is no longer shown). Vimeo needs nothing.
  const YOUTUBE = /^https?:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//i;
  const VIMEO = /^https?:\/\/player\.vimeo\.com\/video\//i;
  // A page opened from disk (file://) sends YouTube no Referer, and YouTube then shows "Error 153"
  // instead of the video. There, each YouTube frame shows the video's thumbnail and a play button
  // that opens it on YouTube in a new window, at the embed's start= time. The thumbnail goes in the
  // frame (srcdoc), so the slide keeps the same elements and the editor still knows the slide.
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function youtubeWatchUrl(src) {
    let u;
    try { u = new URL(src); } catch (e) { return null; }
    const id = (u.pathname.match(/\/embed\/([\w-]{6,})/) || [])[1];
    const list = u.searchParams.get("list");
    const start = parseInt(u.searchParams.get("start") || "", 10);
    if (id && id !== "videoseries") {
      return { id, url: "https://www.youtube.com/watch?v=" + id + (list ? "&list=" + encodeURIComponent(list) : "") + (start > 0 ? "&t=" + start + "s" : "") };
    }
    return list ? { id: null, url: "https://www.youtube.com/playlist?list=" + encodeURIComponent(list) } : null;
  }
  function youtubeFallbacks() {
    if (location.protocol !== "file:") return;
    document.querySelectorAll("svg[data-marpit-svg] iframe").forEach(f => {
      const src = f.getAttribute("src") || "";
      if (!YOUTUBE.test(src) || f.hasAttribute("srcdoc")) return;
      const w = youtubeWatchUrl(src);
      if (!w) return;
      const title = f.getAttribute("title") || "Watch on YouTube";
      const thumb = w.id ? `background-image:url('https://i.ytimg.com/vi/${w.id}/hqdefault.jpg');` : "";
      f.setAttribute("srcdoc", `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;font:600 18px system-ui,sans-serif}
a{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#fff;text-decoration:none;${thumb}background-size:cover;background-position:center}
a::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.25)}
a:hover::before{background:rgba(0,0,0,.1)}
.play{position:relative;width:76px;height:54px;border-radius:14px;background:#f00;display:flex;align-items:center;justify-content:center}
.play::after{content:"";border-style:solid;border-width:12px 0 12px 21px;border-color:transparent transparent transparent #fff;margin-left:4px}
.t{position:relative;max-width:85%;text-align:center;text-shadow:0 1px 4px #000}
.n{position:relative;font-weight:400;font-size:13px;opacity:.85;text-shadow:0 1px 3px #000}
</style><a href="${escapeHtml(w.url)}" target="_blank" rel="noopener"><span class="play"></span><span class="t">${escapeHtml(title)}</span><span class="n">Opens on YouTube: a deck opened from a file cannot play YouTube in the slide</span></a>`);
    });
  }
  function enableYouTubeApi() {
    const active = activeSvg();
    document.querySelectorAll("svg[data-marpit-svg] iframe").forEach(f => {
      const src = f.getAttribute("src") || "";
      if (!YOUTUBE.test(src) || f.hasAttribute("srcdoc") || /[?&]enablejsapi=1\b/.test(src) || (active && active.contains(f))) return;
      const at = src.indexOf("#"), base = at < 0 ? src : src.slice(0, at), hash = at < 0 ? "" : src.slice(at);
      f.setAttribute("src", base + (base.includes("?") ? "&" : "?") + "enablejsapi=1" + hash);
    });
  }
  function stopMedia(slide) {
    if (!slide) return;
    slide.querySelectorAll("video, audio").forEach(m => { try { m.pause(); } catch (e) { /* not playable */ } });
    slide.querySelectorAll("iframe").forEach(f => {
      const src = f.getAttribute("src") || "", w = f.contentWindow;
      if (!w) return;
      if (YOUTUBE.test(src)) w.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "*");
      else if (VIMEO.test(src)) w.postMessage(JSON.stringify({ method: "pause" }), "*");
    });
  }
  // A movie or sound with `autoplay` would start when the deck opens, hidden on its slide. Instead it
  // plays while its slide is shown: the attribute is taken off (and noted in data-mp-autoplay), and
  // the media is started on arriving at its slide and paused on leaving it.
  function takeAutoplay() {
    document.querySelectorAll("svg[data-marpit-svg] video[autoplay], svg[data-marpit-svg] audio[autoplay]").forEach(m => {
      m.dataset.mpAutoplay = "1";
      m.removeAttribute("autoplay");
      m.autoplay = false;
      try { m.pause(); } catch (e) { /* not playable */ }
    });
  }
  function startMedia(slide) {
    if (!slide || preview) return;   // the next-slide preview and the overview never play
    slide.querySelectorAll("[data-mp-autoplay]").forEach(m => {
      if (presenterView) m.muted = true;   // the audience window plays the sound
      try { const p = m.play(); if (p && p.catch) p.catch(() => { /* the browser blocked sound: muted plays */ }); } catch (e) { /* not playable */ }
    });
  }
  let current = activeSvg();
  takeAutoplay();
  startMedia(current);
  youtubeFallbacks();
  enableYouTubeApi();
  new MutationObserver(() => {
    takeAutoplay();   // slides added in the slideshow
    youtubeFallbacks();
    const now = activeSvg();
    if (now === current) return;
    stopMedia(current);
    startMedia(now);
    current = now;
    enableYouTubeApi();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
})();
