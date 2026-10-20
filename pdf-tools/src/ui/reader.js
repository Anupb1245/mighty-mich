// PDF Reader: continuous viewer with zoom, page jump, text search, print and download.
import { pageFrames } from "../tools/editor.js";

const I = {
  zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M11 8v6M8 11h6"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M8 11h6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 15l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 9l7 7 7-7"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',
};

export function readerUI({ file, container, api }) {
  const { h, download } = api;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const st = { frames: [], scale: 1, text: null, hits: [], hit: -1, destroyed: false, rendered: new Map() };
  const pages = h("div", { class: "rd-pages" });
  const pageNo = h("input", { type: "number", class: "ed-pageno", min: 1, value: 1, "aria-label": "Page number", onchange: () => scrollTo(Number(pageNo.value) - 1) });
  const total = h("span", { class: "ed-pagetotal" });
  const zoomLabel = h("span", { class: "rd-zoom" }, "100%");
  const search = h("input", { type: "search", class: "rd-search", placeholder: "Search text…", "aria-label": "Search text", onkeydown: (e) => e.key === "Enter" && (e.shiftKey ? step(-1) : step(1)), oninput: () => schedule() });
  const count = h("span", { class: "rd-count muted" });
  const btn = (icon, title, onclick, extra = {}) => h("button", { type: "button", class: "ed-btn", title, "aria-label": title, html: I[icon], onclick, ...extra });
  const toolbar = h(
    "div",
    { class: "rd-toolbar" },
    btn("up", "Previous page", () => scrollTo(currentPage() - 1)),
    h("span", { class: "ed-pages" }, pageNo, " / ", total),
    btn("down", "Next page", () => scrollTo(currentPage() + 1)),
    h("span", { class: "ed-sep" }),
    btn("zoomOut", "Zoom out", () => setScale(st.scale / 1.2)),
    zoomLabel,
    btn("zoomIn", "Zoom in", () => setScale(st.scale * 1.2)),
    h("button", { type: "button", class: "ed-btn ed-zoom", onclick: () => fit() }, "Fit"),
    h("span", { class: "ed-sep" }),
    h("span", { class: "rd-searchwrap" }, search, count, btn("up", "Previous match", () => step(-1)), btn("down", "Next match", () => step(1))),
    h("span", { class: "ed-spacer" }),
    btn("print", "Print", () => print(), { id: "rd-print" }),
    btn("download", "Download", () => download(file.bytes, file.name, "application/pdf"), { id: "rd-download" })
  );
  container.append(toolbar, pages);

  const pageEls = [];
  function build() {
    pages.replaceChildren();
    pageEls.length = 0;
    st.frames.forEach((f, i) => {
      const el = h("div", { class: "rd-page", dataset: { i }, style: `width:${f.W * st.scale}px;height:${f.H * st.scale}px` }, h("img", { alt: `Page ${i + 1}`, draggable: false }), h("div", { class: "rd-hl" }));
      pageEls.push(el);
      pages.append(el);
    });
    total.textContent = String(st.frames.length);
    observe();
    paintHits();
  }
  let io;
  function observe() {
    io?.disconnect();
    io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) if (en.isIntersecting) renderOne(Number(en.target.dataset.i));
      },
      { rootMargin: "600px 0px" }
    );
    pageEls.forEach((el) => io.observe(el));
  }
  async function renderOne(i) {
    const el = pageEls[i];
    const key = `${i}:${st.scale.toFixed(2)}`;
    if (!el || el.dataset.key === key) return;
    el.dataset.key = key;
    const bytes = await api.render.renderPage(file.bytes, i, { scale: Math.min(3, st.scale * dpr), format: "png", password: file.password }).catch(() => null);
    if (!bytes || st.destroyed || el.dataset.key !== key) return;
    const img = el.querySelector("img");
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    img.dataset.url = url;
    img.src = url;
  }
  function currentPage() {
    const top = pages.getBoundingClientRect().top;
    let best = 0;
    for (let i = 0; i < pageEls.length; i++) {
      const r = pageEls[i].getBoundingClientRect();
      if (r.top - top <= 80 + Math.max(0, -top)) best = i;
      if (r.top > window.innerHeight / 2) break;
    }
    return best;
  }
  function scrollTo(i) {
    i = Math.max(0, Math.min(st.frames.length - 1, i | 0));
    pageEls[i]?.scrollIntoView({ block: "start", behavior: "smooth" });
    pageNo.value = i + 1;
  }
  function setScale(s) {
    const cur = currentPage();
    st.scale = Math.max(0.3, Math.min(4, s));
    zoomLabel.textContent = `${Math.round(st.scale * 100)}%`;
    pageEls.forEach((el, i) => {
      el.style.width = `${st.frames[i].W * st.scale}px`;
      el.style.height = `${st.frames[i].H * st.scale}px`;
      el.dataset.key = "";
    });
    paintHits();
    observe();
    pageEls[cur]?.scrollIntoView({ block: "start" });
  }
  function fit() {
    const w = Math.max(240, container.clientWidth - 32);
    setScale(Math.min(2, w / Math.max(...st.frames.map((f) => f.W))));
  }
  let timer;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 250);
  }
  async function runSearch() {
    const q = search.value.trim().toLowerCase();
    st.hits = [];
    st.hit = -1;
    if (q) {
      if (!st.text) st.text = await api.render.extractText(file.bytes, { password: file.password }).catch(() => []);
      st.text.forEach((p, i) => {
        for (const it of p.items) if (it.str.toLowerCase().includes(q)) st.hits.push({ page: i, x: it.x, y: it.y - it.size * 0.85, w: it.w, h: it.size * 1.05 });
      });
      // also whole-line matches across items (query spanning items)
      if (!st.hits.length) {
        const { linesOf } = api.render;
        st.text.forEach((p, i) => {
          for (const line of linesOf(p.items)) if (line.text.toLowerCase().includes(q)) st.hits.push({ page: i, x: line.x, y: line.y - line.size * 0.85, w: line.xEnd - line.x, h: line.size * 1.05 });
        });
      }
    }
    count.textContent = q ? (st.hits.length ? `${st.hits.length}` : "0") : "";
    paintHits();
    if (st.hits.length) step(1);
  }
  function paintHits() {
    pageEls.forEach((el) => el.querySelector(".rd-hl").replaceChildren());
    st.hits.forEach((hit, n) => {
      const el = pageEls[hit.page];
      if (!el) return;
      el.querySelector(".rd-hl").append(h("div", { class: `rd-hit${n === st.hit ? " current" : ""}`, style: `left:${hit.x * st.scale}px;top:${hit.y * st.scale}px;width:${hit.w * st.scale}px;height:${hit.h * st.scale}px` }));
    });
  }
  function step(dir) {
    if (!st.hits.length) return;
    st.hit = (st.hit + dir + st.hits.length) % st.hits.length;
    count.textContent = `${st.hit + 1} / ${st.hits.length}`;
    paintHits();
    const hit = st.hits[st.hit];
    const el = pageEls[hit.page];
    const y = el.offsetTop + hit.y * st.scale - 120;
    window.scrollTo({ top: y + pages.getBoundingClientRect().top + window.scrollY - pages.offsetTop, behavior: "smooth" });
    pageNo.value = hit.page + 1;
  }
  async function print() {
    // make sure every page is rendered before the print dialog opens
    for (let i = 0; i < pageEls.length; i++) await renderOne(i);
    document.body.classList.add("rd-printing");
    window.print();
    setTimeout(() => document.body.classList.remove("rd-printing"), 1000);
  }
  const onKey = (e) => {
    if (e.target.matches("input, textarea, [contenteditable]")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") (e.preventDefault(), scrollTo(currentPage() + 1));
    if (e.key === "ArrowLeft" || e.key === "PageUp") (e.preventDefault(), scrollTo(currentPage() - 1));
    if (e.key === "+" || e.key === "=") setScale(st.scale * 1.2);
    if (e.key === "-") setScale(st.scale / 1.2);
    if ((e.ctrlKey || e.metaKey) && e.key === "f") (e.preventDefault(), search.focus());
  };
  const onScroll = () => (pageNo.value = currentPage() + 1);
  window.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, { passive: true });

  (async () => {
    try {
      st.frames = await pageFrames(file);
    } catch (err) {
      api.setError(err.message || "Could not read this PDF.");
      return;
    }
    if (st.destroyed) return;
    build();
    fit();
  })();

  return {
    collect: () => ({}),
    destroy() {
      st.destroyed = true;
      io?.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
      pageEls.forEach((el) => {
        const u = el.querySelector("img")?.dataset.url;
        if (u) URL.revokeObjectURL(u);
      });
    },
  };
}
