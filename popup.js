const SCOPES = [
  { id: "html", label: "Page HTML", desc: "Full DOM source", unit: "chars" },
  { id: "text", label: "Visible text", desc: "Rendered page text", unit: "chars" },
  { id: "links", label: "Links", desc: "Absolute a[href] URLs", unit: "links" },
  { id: "images", label: "Images", desc: "img src and alt text", unit: "imgs" },
  { id: "tables", label: "Tables", desc: "Cells extracted row by row", unit: "tables" },
  { id: "meta", label: "Metadata", desc: "title / description / OG", unit: "items" },
];

const SHOT_KEY = "sc_pending";

const $ = (s) => document.querySelector(s);
let captured = null;
let currentTab = null;
let shot = null; // { payload, canvas }

/* ---------- main view ---------- */

function buildRows() {
  $("#rows").innerHTML = SCOPES.map((s) => `
    <label class="row">
      <input type="checkbox" value="${s.id}" checked>
      <span class="tick">
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#1A1200" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.4 2.4 4.6-5"/></svg>
      </span>
      <span class="lbl"><i>${s.label}</i><small>${s.desc}</small></span>
      <span class="count" data-for="${s.id}"></span>
    </label>`).join("");
}

function selected() {
  return [...document.querySelectorAll("#rows input:checked")].map((i) => i.value);
}

function setStatus(text, isError = false) {
  const el = $("#status");
  el.textContent = text || "";
  el.classList.toggle("show", !!text);
  el.classList.toggle("err", isError);
}

function setBusy(busy) {
  const btn = $("#capture");
  btn.classList.toggle("busy", busy);
  btn.disabled = busy;
  $("#shoot").disabled = busy;
  $("#captureLabel").textContent = busy ? "Capturing…" : captured ? "Capture again" : "Capture current page";
}

function syncToggleAll() {
  const all = document.querySelectorAll("#rows input");
  const on = document.querySelectorAll("#rows input:checked").length;
  $("#toggleAll").textContent = on === all.length ? "Deselect all" : "Select all";
}

function countOf(data, id) {
  if (!data || data[id] == null) return null;
  if (id === "html" || id === "text") return data[id].length;
  if (id === "links" || id === "images" || id === "tables") return data[id].length;
  if (id === "meta") return Object.keys(data.meta.metas || {}).length;
  return null;
}

function renderCounts(data) {
  SCOPES.forEach((s) => {
    const el = document.querySelector(`.count[data-for="${s.id}"]`);
    const n = countOf(data, s.id);
    if (n == null) { el.textContent = ""; el.classList.remove("on"); return; }
    el.textContent = `${n.toLocaleString()} ${s.unit}`;
    el.classList.add("on");
  });
}

function renderStats(data) {
  const rows = SCOPES.map((s) => {
    const n = countOf(data, s.id);
    if (n == null) return "";
    return `<div class="stat"><span>${s.label}</span><b>${n.toLocaleString()}<b class="unit">${s.unit}</b></b></div>`;
  }).join("");
  $("#stats").innerHTML = rows + `<div class="stat"><span>Captured at</span><b>${new Date(data.capturedAt).toLocaleTimeString("en-US")}</b></div>`;
  [...$("#stats").children].forEach((el, i) => { el.style.animationDelay = `${i * 45}ms`; });
  $("#result").classList.add("show");
}

/* ---------- preview rendering ---------- */

const CHEV_GLYPH = '<svg class="chev" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
const DL_GLYPH = '<svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1.8v7.2M4.1 6.2 7 9.1l2.9-2.9M2.4 11.6h9.2"/></svg>';

const PREVIEW_DEFS = [
  { key: "html", label: "Page HTML", open: false },
  { key: "text", label: "Visible text", open: false },
  { key: "links", label: "Links", open: true },
  { key: "images", label: "Images", open: true },
  { key: "tables", label: "Tables", open: true },
  { key: "meta", label: "Metadata", open: true },
];

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return String(u).slice(0, 40); } };

function fmtTime(s) {
  return s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- hover highlight (maps an item onto the screenshot) ---------- */

const NO_HL = { bind() { } };

function makeHighlighter(host) {
  const box = host && host.querySelector(".hl");
  if (!box) return NO_HL;
  const set = (b) => {
    if (!b) { box.style.opacity = "0"; return; }
    box.style.left = b[0] * 100 + "%";
    box.style.top = b[1] * 100 + "%";
    box.style.width = b[2] * 100 + "%";
    box.style.height = b[3] * 100 + "%";
    box.style.opacity = "1";
  };
  return {
    bind(el, b) {
      if (!b) return;
      el.addEventListener("mouseenter", () => set(b));
      el.addEventListener("mouseleave", () => set(null));
      el.addEventListener("focus", () => set(b));
      el.addEventListener("blur", () => set(null));
    },
  };
}

function showToast(text, isError = false) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("err", isError);
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3200);
}

function blockCount(d, key) {
  const v = d[key];
  if (v == null) return 0;
  if (key === "html") return v.length;
  if (key === "text") return typeof v === "string" ? v.length : v.length;
  if (key === "meta") return v.metas ? Object.keys(v.metas).length : 0;
  return v.length;
}

function countLabel(key, d) {
  const n = blockCount(d, key);
  if (key === "html") return `${n.toLocaleString()} chars`;
  if (key === "text") return typeof d.text === "string" ? `${n.toLocaleString()} chars` : `${n} blocks`;
  if (key === "meta") return `${n} items`;
  const unit = { links: "links", images: "imgs", tables: "tables" }[key] || "";
  return `${n}${unit ? " " + unit : ""}`;
}

function fileFromUrl(u, fallback) {
  try {
    const p = new URL(u).pathname.split("/").pop();
    if (p && p.includes(".")) return p;
  } catch { }
  return fallback;
}

/* ---------- generic download: handles http(s) / data: / blob: ---------- */

const BIG_BLOB = 24 * 1024 * 1024; // Above this size, don't move bytes through the popup
const shortName = (path) => String(path).split("/").pop();
const fmtMB = (n) => `${(n / 1048576).toFixed(1)} MB`;

// Characters forbidden in Windows file names (plus trailing dots/spaces) make the browser
// fail with "permission denied" at write time. Only sanitize one path segment; leave "/" alone.
const safeName = (s) =>
  String(s == null ? "" : s)
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 120) || "file";

// Runs in the page: blob: URLs belong to the page origin; the popup can't fetch them, so read them here
function pageGrab(u, name, limit) {
  // Save via the page's own download channel (a navigation that carries Referer and isn't bound by CORS)
  const anchor = (href, dl) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = dl || "download";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (async () => {
    try {
      const resp = await fetch(u);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const b = await resp.blob();
      if (b.size > limit) {
        // Too large to move back to the popup (executeScript results have a size cap); hand the bytes to the page to save
        const o = URL.createObjectURL(b);
        anchor(o, name);
        setTimeout(() => URL.revokeObjectURL(o), 60000);
        return { mode: "page", size: b.size };
      }
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = rej;
        fr.readAsDataURL(b);
      });
      return { mode: "data", size: b.size, dataUrl };
    } catch (e) {
      // Cross-origin resources rarely send CORS headers, so fetch fails, but the download channel still works
      anchor(u, name);
      return { mode: "link", msg: String((e && e.message) || e) };
    }
  })();
}

async function grabFromPage(src, name) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { mode: "fail", msg: "No active tab found" };
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: pageGrab, args: [src, name, BIG_BLOB],
    });
    return (r && r.result) || { mode: "fail", msg: "No response from the page" };
  } catch (e) {
    return { mode: "fail", msg: String((e && e.message) || e) };
  }
}

function blobDownload(src, path, okMsg) {
  fetch(src).then((r) => r.blob()).then((b) => {
    const u = URL.createObjectURL(b);
    chrome.downloads.download({ url: u, filename: path, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id == null) { showToast("Download failed: could not write the file.", true); return; }
      if (okMsg) showToast(okMsg);
    });
    setTimeout(() => URL.revokeObjectURL(u), 20000);
  }).catch(() => showToast("Download failed: could not read the resource.", true));
}

// Start a download and confirm it actually began (missing Referer or blocked plain http fail at write time)
function tryDownload(url, path) {
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename: path, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id == null) { resolve(false); return; }
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        clearTimeout(timer);
        resolve(ok);
      };
      const onChanged = (d) => {
        if (d.id !== id || !d.state) return;
        const ok = d.state.current !== "interrupted";
        // The failed entry shows a red X in the download list; erase it and keep only the successful fallback
        if (!ok) chrome.downloads.erase({ id }, () => void chrome.runtime.lastError);
        finish(ok);
      };
      const timer = setTimeout(() => finish(true), 4000);
      chrome.downloads.onChanged.addListener(onChanged);
    });
  });
}

// Page-triggered downloads are visible to the extension; poll a few times to confirm they didn't fail
function verifyDownload(url) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      chrome.downloads.search({ url, limit: 1 }, (items) => {
        void chrome.runtime.lastError;
        const it = items && items[0];
        if (it && it.state === "interrupted") {
          chrome.downloads.erase({ id: it.id }, () => void chrome.runtime.lastError);
          resolve(false);
          return;
        }
        if (it && (it.state === "complete" || it.state === "in_progress")) { resolve(true); return; }
        if (++n >= 5) { resolve(true); return; } // If it isn't found, assume it started; don't block the popup
        setTimeout(tick, 700);
      });
    };
    tick();
  });
}

// Handle the result of reading bytes from the page
async function usePageResult(res, src, path, failMsg, quiet) {
  if (res.mode === "data") { blobDownload(res.dataUrl, path, quiet ? "" : `Downloaded → ${shortName(path)}`); return true; }
  if (res.mode === "page") { if (!quiet) showToast(`Large file (${fmtMB(res.size)}) — handed to the page to download directly.`); return true; }
  if (res.mode === "link") {
    if (await verifyDownload(src)) { if (!quiet) showToast(`Handed to the page for download → ${shortName(path)}`); return true; }
    if (!quiet) showToast(`${failMsg} (the server rejected the address)`, true);
    return false;
  }
  if (!quiet) showToast(`${failMsg} (${res.msg || "the page could not read the address"})`, true);
  return false;
}

// Single entry point: try every source; stay silent when quiet
async function downloadSrc(src, path, failMsg, quiet) {
  if (!src) { if (!quiet) showToast(failMsg, true); return false; }

  if (/^https?:/i.test(src)) {
    if (await tryDownload(src, path)) { if (!quiet) showToast(`Downloaded → ${shortName(path)}`); return true; }
    // Direct download failed (missing Referer or blocked plain http); read the bytes in page context instead
    return usePageResult(await grabFromPage(src, shortName(path)), src, path, failMsg, quiet);
  }

  if (/^data:/i.test(src)) {
    blobDownload(src, path, quiet ? "" : `Downloaded → ${shortName(path)}`);
    return true;
  }

  if (/^blob:/i.test(src)) {
    return usePageResult(await grabFromPage(src, shortName(path)), src, path, failMsg, quiet);
  }

  if (!quiet) showToast(failMsg, true);
  return false;
}

async function directDownload(src, pageUrl, iso, fallbackName, failMsg, quiet) {
  const raw = /^(data|blob):/i.test(src || "") ? fallbackName : fileFromUrl(src, fallbackName);
  return downloadSrc(src, `${baseName(pageUrl, iso)}/${safeName(raw)}`, failMsg, quiet);
}

/* ---------- icon saving ---------- */

// Download a single icon from the preview; naming matches the batch icons/NN.ext
async function downloadIcon(src, i, pageUrl, iso) {
  const rel = iconPath(i, src);
  if (await downloadSrc(src, `${baseName(pageUrl, iso)}/${rel}`, "This icon could not be downloaded.", true)) showToast(`Downloaded icon → ${rel}`);
  else showToast("This icon could not be downloaded.", true);
}

function iconExt(src) {
  const d = /^data:image\/([a-z0-9.+-]+)/i.exec(src);
  if (d) return d[1].toLowerCase() === "svg+xml" ? "svg" : d[1].toLowerCase().replace(/[^a-z0-9]/g, "");
  const e = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(fileFromUrl(src, ""));
  return e ? e[1].toLowerCase() : "png";
}

function iconPath(i, src) {
  return `icons/${String(i + 1).padStart(2, "0")}.${iconExt(src)}`;
}

/* ---------- icon fallback: crop the icon from the screenshot ---------- */
// For icons with no address (icon fonts, pseudo-elements, external sprites), crop from the screenshot at the link's position
function cropIcon(canvas, b) {
  if (!canvas || !b) return "";
  const x = Math.round(b[0] * canvas.width);
  const y = Math.round(b[1] * canvas.height);
  const w = Math.round(b[2] * canvas.width);
  const h = Math.round(b[3] * canvas.height);
  if (w < 4 || h < 4) return "";
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return c.toDataURL("image/png");
}

function fillIcons(d, canvas) {
  if (!canvas || !d || !Array.isArray(d.links)) return;
  d.links.forEach((l) => {
    if (!l.icon && l.b) l.icon = cropIcon(canvas, l.b);
  });
}

/* ---------- image lightbox ---------- */

function openLightbox(src, label, pageUrl, iso) {
  const lb = $("#lightbox");
  const img = $("#lbImg");
  img.src = src;
  img.onerror = () => { img.removeAttribute("src"); showToast("Image failed to load (possibly blocked by hotlink protection).", true); };
  $("#lbSrc").textContent = label || hostOf(src);
  $("#lbDl").onclick = () => directDownload(src, pageUrl, iso, "image.png", "This image URL cannot be downloaded directly.");
  lb.hidden = false;
}

function closeLightbox() {
  const img = $("#lbImg");
  img.removeAttribute("src");
  img.onerror = null;
  $("#lightbox").hidden = true;
}

/* ---------- per-type preview bodies ---------- */

function buildText(body, value, hl) {
  if (typeof value === "string") {
    body.appendChild(mk("pre", "pv-pre", value));
    return;
  }
  const ul = mk("ul", "pv-list");
  value.forEach((t) => {
    const li = mk("li", "row-flex");
    li.append(mk("span", "chip", t.tag), mk("span", "grow clamp2", t.text));
    hl.bind(li, t.b);
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function buildLinks(body, links, pageUrl, iso, hl) {
  const ul = mk("ul", "pv-list");
  links.forEach((l, i) => {
    const li = mk("li", "row-flex clickable");
    if (l.icon) {
      const ic = mk("button", "pv-ico");
      ic.type = "button";
      ic.title = "Download icon";
      ic.setAttribute("aria-label", "Download icon");
      const im = mk("img");
      im.src = l.icon;
      im.alt = "";
      im.onerror = () => ic.remove();
      ic.appendChild(im);
      ic.addEventListener("click", (e) => { e.stopPropagation(); downloadIcon(l.icon, i, pageUrl, iso); });
      li.appendChild(ic);
    }
    li.append(mk("i", null, l.text || l.href), mk("small", null, l.href));
    li.title = l.href;
    li.addEventListener("click", () => chrome.tabs.create({ url: l.href }));
    hl.bind(li, l.b);
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function buildImages(body, images, pageUrl, iso, hl) {
  const grid = mk("div", "pv-grid");
  images.forEach((v) => {
    const btn = mk("button", "pv-thumb");
    btn.type = "button";
    const img = mk("img");
    img.loading = "lazy";
    img.alt = v.alt || "";
    img.src = v.src;
    img.onerror = () => {
      btn.classList.add("fail");
      img.remove();
      btn.textContent = (v.alt || hostOf(v.src)).slice(0, 20);
    };
    btn.appendChild(img);
    btn.title = v.alt || v.src;
    btn.addEventListener("click", () => openLightbox(v.src, v.alt || hostOf(v.src), pageUrl, iso));
    hl.bind(btn, v.b);
    grid.appendChild(btn);
  });
  body.appendChild(grid);
}

function buildTables(body, tables, hl) {
  tables.forEach((t, i) => {
    const rows = Array.isArray(t) ? t : t.rows || [];
    const wrap = mk("div", "pv-tablewrap");
    const table = mk("table");
    rows.forEach((r, ri) => {
      const tr = mk("tr");
      r.forEach((c) => tr.appendChild(mk(ri === 0 ? "th" : "td", null, c)));
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    hl.bind(wrap, Array.isArray(t) ? null : t.b);
    if (tables.length > 1) body.appendChild(mk("p", "pv-cap", `Table ${i + 1} · ${rows.length} rows`));
    body.appendChild(wrap);
  });
}

function buildMeta(body, meta) {
  const ul = mk("ul", "pv-list");
  const rows = [["title", meta.title], ["lang", meta.lang], ["canonical", meta.canonical]];
  Object.entries(meta.metas || {}).forEach(([k, v]) => rows.push([k, v]));
  rows.filter(([, v]) => v).forEach(([k, v]) => {
    const li = mk("li", "row-flex");
    const key = mk("span", "chip", k);
    key.title = k;
    li.append(key, mk("span", "grow clamp2", v));
    li.title = v;
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

/* ---------- preview container ---------- */

function renderPreviews(container, d, pageUrl, iso, hl = NO_HL) {
  container.innerHTML = "";
  let shown = 0;

  PREVIEW_DEFS.forEach((def) => {
    if (!blockCount(d, def.key)) return;
    shown++;

    const sec = mk("section", "pv");
    sec.dataset.kind = def.key;
    if (!def.open) sec.classList.add("collapsed");

    const head = mk("header", "pv-h");
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.setAttribute("aria-expanded", String(def.open));
    head.append(mk("b", null, def.label), mk("span", "pv-n", countLabel(def.key, d)));

    const dl = mk("button", "pv-dl");
    dl.type = "button";
    dl.title = "Download this group";
    dl.setAttribute("aria-label", `Download ${def.label}`);
    dl.innerHTML = DL_GLYPH;
    dl.addEventListener("click", (e) => {
      e.stopPropagation();
      const f = saveGroup(def.key, d, pageUrl, iso);
      if (f) showToast(`Downloaded ${def.label} → ${f}`);
    });
    head.append(dl);
    head.insertAdjacentHTML("beforeend", CHEV_GLYPH);

    const body = mk("div", "pv-b");
    const value = d[def.key];
    if (def.key === "html") body.appendChild(mk("pre", "pv-pre", value));
    else if (def.key === "text") buildText(body, value, hl);
    else if (def.key === "links") buildLinks(body, value, pageUrl, iso, hl);
    else if (def.key === "images") buildImages(body, value, pageUrl, iso, hl);
    else if (def.key === "tables") buildTables(body, value, hl);
    else if (def.key === "meta") buildMeta(body, value);

    const toggle = () => {
      const collapsed = sec.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    sec.append(head, body);
    container.appendChild(sec);
  });

  container.classList.toggle("show", shown > 0);
}

/* ---------- full-page capture ---------- */

function scraper(scope) {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  // Icon-only links: with no visible text, try to find their icon (img / background image / inline SVG)
  const iconOf = (a) => {
    const im = a.querySelector("img");
    const s = im && (im.getAttribute("src") || im.currentSrc);
    if (s) return abs(s);
    const urlOf = (el, pseudo) => {
      if (!el) return "";
      const s = getComputedStyle(el, pseudo);
      const m = /url\(["']?(.+?)["']?\)/.exec(s.backgroundImage + " " + s.content);
      return m ? abs(m[1]) : "";
    };
    // Background images may be drawn on ::before / ::after, or via content:url(...) (common for icon fonts and sprites)
    for (const el of [a, a.firstElementChild].filter(Boolean)) {
      const u = urlOf(el, null) || urlOf(el, "::before") || urlOf(el, "::after");
      if (u) return u;
    }
    const sv = a.querySelector("svg");
    if (!sv) return "";
    try {
      const c = sv.cloneNode(true);
      if (!c.getAttribute("xmlns")) c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      if (!c.getAttribute("viewBox") && !c.getAttribute("width")) {
        c.setAttribute("width", "24"); c.setAttribute("height", "24");
      }
      const xml = new XMLSerializer().serializeToString(c)
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/currentColor/g, "#ECEEF0");
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    } catch { return ""; }
  };

  // Only count what is truly visible (identical rules on every site):
  // has size, isn't hidden, intersects the viewport, and isn't covered by a "clearly larger overlay".
  // Overlays the same size or smaller (player controls, covers, click layers) are the element's own parts, not occlusion;
  // only a clearly larger overlay (modal / drawer / loading mask) means the element is buried (hidden content).
  // Sample several points; visible if any one isn't covered.
  const PTS = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
  const blocked = (el, r, top) => {
    if (!top || top === el || el.contains(top) || top.contains(el)) return false;
    const t = top.getBoundingClientRect();
    return t.width * t.height > r.width * r.height * 2;
  };
  const vcache = new Map();
  const inView = (el) => {
    const c = vcache.get(el);
    if (c !== undefined) return c;
    let ok = false;
    const r = el.getBoundingClientRect();
    if (r.width >= 8 && r.height >= 8 &&
      r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) {
      const s = getComputedStyle(el);
      ok = s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0;
      // An element with pointer-events:none is never hit by elementFromPoint, so skip the occlusion check
      if (ok && s.pointerEvents !== "none") {
        ok = PTS.some(([fx, fy]) => {
          const x = Math.min(Math.max(r.left + r.width * fx, 0), innerWidth - 1);
          const y = Math.min(Math.max(r.top + r.height * fy, 0), innerHeight - 1);
          return !blocked(el, r, document.elementFromPoint(x, y));
        });
      }
    }
    vcache.set(el, ok);
    return ok;
  };

  // Visible text: only text inside visible elements (innerText would include text under overlays)
  const visibleText = () => {
    if (!document.body) return "";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    let n;
    while ((n = walker.nextNode())) {
      const t = clean(n.nodeValue);
      if (!t) continue;
      const p = n.parentElement;
      if (!p || !inView(p)) continue;
      parts.push(t);
    }
    return parts.join(" ");
  };

  const out = { url: location.href, title: document.title, capturedAt: new Date().toISOString() };

  if (scope.includes("html")) out.html = document.documentElement.outerHTML;
  if (scope.includes("text")) out.text = visibleText();
  if (scope.includes("links")) {
    out.links = [...document.querySelectorAll("a[href]")].filter(inView).map((a) => {
      const label = clean(a.innerText);
      const im = a.querySelector("img");
      const name = label || clean(a.getAttribute("aria-label") || a.getAttribute("title")) || (im ? clean(im.alt) : "");
      return { text: name, href: abs(a.getAttribute("href")), icon: label ? "" : iconOf(a) };
    });
  }
  if (scope.includes("images")) {
    out.images = [...document.querySelectorAll("img")].filter(inView).map((i) => ({
      alt: i.alt || "",
      src: abs(i.getAttribute("src") || i.currentSrc || ""),
    }));
  }

  if (scope.includes("tables")) {
    out.tables = [...document.querySelectorAll("table")].filter(inView).map((t) =>
      [...t.rows].map((r) => [...r.cells].map((c) => (c.innerText || "").trim().replace(/\s+/g, " ")))
    );
  }
  if (scope.includes("meta")) {
    const metas = {};
    document.querySelectorAll("meta").forEach((m) => {
      const k = m.getAttribute("name") || m.getAttribute("property");
      if (k && m.content) metas[k] = m.content;
    });
    const canonical = document.querySelector('link[rel="canonical"]');
    out.meta = {
      title: document.title,
      lang: document.documentElement.lang || "",
      canonical: canonical ? abs(canonical.href) : "",
      metas,
    };
  }
  return out;
}

async function capture() {
  const scope = selected();
  if (!scope.length) { setStatus("Select at least one capture scope.", true); return; }

  setBusy(true);
  setStatus("");
  $("#result").classList.remove("show");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error("No active tab found.");

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scraper,
      args: [scope],
    });

    captured = res.result;
    renderCounts(captured);
    renderStats(captured);
    renderPreviews($("#previews"), captured, captured.url, captured.capturedAt);
    setStatus("");
  } catch (e) {
    captured = null;
    setStatus("Cannot capture this page (browser-internal pages and extension stores block script injection).", true);
  } finally {
    setBusy(false);
  }
}

/* ---------- download ---------- */

function baseName(url, iso) {
  const host = (() => { try { return new URL(url).hostname; } catch { return "page"; } })();
  const d = new Date(iso);
  if (isNaN(d.getTime())) return `${safeName(host)}_${Date.now()}`;
  const p = (n) => String(n).padStart(2, "0");
  return `${safeName(host)}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function saveBlob(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  chrome.downloads.download({ url, filename: name, saveAs: false }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  });
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) { return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"); }

function textOf(d) {
  return typeof d.text === "string" ? d.text : (d.text || []).map((t) => t.text).join("\n");
}

// Save one data type to file; batch and per-group downloads share the same naming
function saveGroup(key, d, pageUrl, iso) {
  const base = baseName(pageUrl, iso);
  if (key === "html" && d.html != null) {
    saveBlob(`${base}/page.html`, d.html, "text/html");
    return "page.html";
  }
  if (key === "text" && d.text != null) {
    saveBlob(`${base}/page.txt`, textOf(d), "text/plain");
    return "page.txt";
  }
  if (key === "links" && d.links) {
    const rows = [["text", "href", "icon", "icon_file"]];
    const icons = [];
    d.links.forEach((l, i) => {
      let f = "";
      if (l.icon) { f = iconPath(i, l.icon); icons.push([l.icon, f]); }
      rows.push([l.text, l.href, l.icon || "", f]);
    });
    saveBlob(`${base}/links.csv`, toCsv(rows), "text/csv");
    icons.forEach(([src, rel]) => downloadSrc(src, `${base}/${rel}`, "", true));
    return "links.csv";
  }
  if (key === "images" && d.images) {
    saveBlob(`${base}/images.csv`, toCsv([["alt", "src"], ...d.images.map((i) => [i.alt, i.src])]), "text/csv");
    return "images.csv";
  }
  if (key === "tables" && d.tables) {
    const rows = [["table", "row", "col", "value"]];
    d.tables.forEach((t, ti) => (Array.isArray(t) ? t : t.rows || [])
      .forEach((r, ri) => r.forEach((c, ci) => rows.push([ti + 1, ri + 1, ci + 1, c]))));
    saveBlob(`${base}/tables.csv`, toCsv(rows), "text/csv");
    return "tables.csv";
  }
  if (key === "meta" && d.meta) {
    saveBlob(`${base}/meta.json`, JSON.stringify(d.meta, null, 2), "application/json");
    return "meta.json";
  }
  return "";
}

function download() {
  if (!captured) return;
  const base = baseName(captured.url, captured.capturedAt);

  if ($("#format").value === "json") {
    saveBlob(`${base}.json`, JSON.stringify(captured, null, 2), "application/json");
    setStatus("Started downloading JSON.");
    return;
  }
  let n = 0;
  PREVIEW_DEFS.forEach(({ key }) => {
    if (blockCount(captured, key)) { saveGroup(key, captured, captured.url, captured.capturedAt); n++; }
  });
  setStatus(`Started downloading ${n} file(s).`);
}

/* ---------- screenshot view ---------- */

async function showShotView(p) {
  $("#viewMain").hidden = true;
  $("#viewShot").hidden = false;

  try { $("#host").textContent = new URL(p.url).hostname || p.url; }
  catch { $("#host").textContent = p.url || "Capture result"; }

  $("#shotDim").textContent = `${Math.round(p.rect.w)} × ${Math.round(p.rect.h)}`;
  $("#shotMeta").textContent =
    `${new Date(p.capturedAt).toLocaleTimeString("en-US")} · ${p.dpr > 1 ? p.dpr + "x" : "1x"} · ${p.title || p.url}`;

  const d = p.data || { text: [], links: [], images: [], tables: [] };
  const stats = [
    ["Text blocks", d.text ? d.text.length : 0, "blocks"],
    ["Links", d.links ? d.links.length : 0, "links"],
    ["Images", d.images ? d.images.length : 0, "imgs"],
    ["Tables", d.tables ? d.tables.length : 0, "tables"],
  ];
  $("#shotStats").innerHTML = stats.map(([label, n, unit], i) =>
    `<div class="stat" style="animation-delay:${i * 45}ms"><span>${label}</span><b>${n.toLocaleString()}<b class="unit">${unit}</b></b></div>`
  ).join("");

  shot = { payload: p, canvas: null };

  await new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const dpr = p.dpr || 1;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(p.rect.w * dpr));
      c.height = Math.max(1, Math.round(p.rect.h * dpr));
      c.getContext("2d").drawImage(
        img,
        Math.round(p.rect.x * dpr), Math.round(p.rect.y * dpr), c.width, c.height,
        0, 0, c.width, c.height
      );
      $("#shotImg").src = c.toDataURL("image/png");
      shot.canvas = c;
      done();
    };
    img.onerror = () => { $("#shotImg").alt = "Capture failed to load"; done(); };
    img.src = p.dataUrl;
  });

  // Fill in icons (cropped from the screenshot) before rendering, to avoid a second refresh
  fillIcons(d, shot.canvas);
  renderPreviews($("#shotPreviews"), d, p.url, p.capturedAt, makeHighlighter($("#shotOverlay")));
}

function downloadShotPng() {
  if (!shot || !shot.canvas) return;
  const base = baseName(shot.payload.url, shot.payload.capturedAt);
  shot.canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `${base}.png`, saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    });
  }, "image/png");
}

function downloadShotJson() {
  if (!shot) return;
  const p = shot.payload;
  const base = baseName(p.url, p.capturedAt);
  const out = { url: p.url, title: p.title, capturedAt: p.capturedAt, region: p.rect, data: p.data };
  saveBlob(`${base}.json`, JSON.stringify(out, null, 2), "application/json");

  const links = (p.data && p.data.links) || [];
  let n = 0;
  links.forEach((l, i) => {
    if (!l.icon) return;
    n++;
    downloadSrc(l.icon, `${base}/${iconPath(i, l.icon)}`, "", true);
  });
  if (n) showToast(`Downloaded data JSON and saved ${n} icon(s) to ${base}/icons/.`);
}

/* ---------- start the region-capture flow ---------- */

async function startShoot() {
  if (!currentTab || currentTab.id == null) return;
  $("#shoot").disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "sc:start", tabId: currentTab.id });
    if (!res || !res.ok) throw new Error("inject failed");
    window.close();
  } catch (e) {
    setStatus("Cannot capture a region on this page (browser-internal pages block script injection).", true);
    $("#shoot").disabled = false;
  }
}

/* ---------- init ---------- */

async function loadTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;

  let host = "Current tab";
  try { host = new URL(tab.url).hostname || tab.url; } catch { host = (tab && tab.url) || "Current tab"; }
  $("#host").textContent = host;

  const restricted = /^(chrome|edge|about|devtools|view-source|chrome-extension|extension):/i.test((tab && tab.url) || "");
  if (restricted) {
    setStatus("This is a browser-internal page; capture and region capture are unavailable. Switch to a normal web page.", true);
    $("#capture").disabled = true;
    $("#shoot").disabled = true;
  }
}

async function init() {
  buildRows();
  syncToggleAll();
  setBusy(false);

  $("#rows").addEventListener("change", syncToggleAll);
  $("#toggleAll").addEventListener("click", () => {
    const inputs = [...document.querySelectorAll("#rows input")];
    const turnOn = document.querySelectorAll("#rows input:checked").length !== inputs.length;
    inputs.forEach((i) => { i.checked = turnOn; });
    syncToggleAll();
  });
  $("#capture").addEventListener("click", capture);
  $("#download").addEventListener("click", download);
  $("#shoot").addEventListener("click", startShoot);
  $("#dlPng").addEventListener("click", downloadShotPng);
  $("#dlJson").addEventListener("click", downloadShotJson);
  $("#reshoot").addEventListener("click", () => location.reload());

  $("#lbClose").addEventListener("click", closeLightbox);
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#lightbox").hidden) closeLightbox();
  });

  const store = await chrome.storage.session.get(SHOT_KEY);
  const pending = store[SHOT_KEY];
  if (pending) {
    await chrome.storage.session.remove(SHOT_KEY);
    chrome.action.setBadgeText({ text: "" });
    showShotView(pending);
    return;
  }
  await loadTab();
}

init();