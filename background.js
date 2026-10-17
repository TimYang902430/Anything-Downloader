// Background script: opens the region overlay on the page, screenshots, extracts region data, and sends the result back to the popup.

const SHOT_KEY = "sc_pending";

/* ---------- region overlay (injected into the page) ---------- */
function regionOverlay() {
  if (document.getElementById("__sc_overlay")) return;

  const host = document.createElement("div");
  host.id = "__sc_overlay";
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;";

  const box = document.createElement("div");
  box.style.cssText =
    "position:absolute;display:none;pointer-events:none;border:1.5px solid #F0B429;" +
    "box-shadow:0 0 0 100vmax rgba(5,6,8,.55);";

  const label = document.createElement("div");
  label.style.cssText =
    "position:absolute;top:-25px;left:-1.5px;padding:2px 7px;border-radius:5px;" +
    "background:#F0B429;color:#1A1200;white-space:nowrap;" +
    "font:600 11px/1.6 ui-monospace,Consolas,monospace;";
  box.appendChild(label);
  host.appendChild(box);
  document.documentElement.appendChild(host);

  let sx = 0, sy = 0, dragging = false, rect = null;

  const draw = (x, y) => {
    const l = Math.min(sx, x), t = Math.min(sy, y);
    const w = Math.abs(x - sx), h = Math.abs(y - sy);
    box.style.display = "block";
    box.style.left = l + "px";
    box.style.top = t + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
    label.textContent = Math.round(w) + " × " + Math.round(h);
    rect = { x: l, y: t, w, h };
  };

  const finish = (value) => {
    document.removeEventListener("keydown", onKey, true);
    host.remove();
    // Wait two frames so the overlay itself isn't captured in the screenshot
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chrome.runtime.sendMessage({ type: "sc:region", rect: value, dpr: window.devicePixelRatio || 1 });
    }));
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
  };

  host.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    dragging = true; sx = e.clientX; sy = e.clientY; draw(sx, sy);
  });
  host.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    draw(e.clientX, e.clientY);
  });
  host.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    dragging = false;
    const r = rect;
    if (!r || r.w < 8 || r.h < 8) { finish(null); return; }
    finish(r);
  });
  document.addEventListener("keydown", onKey, true);
}

/* ---------- region data extraction (injected into the page) ---------- */
function extractRegion(rect) {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const ox = window.scrollX, oy = window.scrollY;
  const L = rect.x + ox, T = rect.y + oy, R = L + rect.w, B = T + rect.h;

  // Convert element positions to 0~1 ratios relative to the region, so highlights align at any zoom
  const clip = (n) => Math.max(0, Math.min(1, n));
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = clip((r.left + ox - L) / rect.w);
    const y = clip((r.top + oy - T) / rect.h);
    return [
      +x.toFixed(4), +y.toFixed(4),
      +Math.min(r.width / rect.w, 1 - x).toFixed(4),
      +Math.min(r.height / rect.h, 1 - y).toFixed(4),
    ];
  };

  const hits = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const l = r.left + ox, t = r.top + oy;
    return l + r.width > L && l < R && t + r.height > T && t < B;
  };

  // Generic visibility (identical on every site): has size, isn't hidden, is in the viewport, and isn't covered by a "clearly larger overlay".
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
      if (ok && s.pointerEvents !== "none") {
        ok = PTS.some((p) => {
          const x = Math.min(Math.max(r.left + r.width * p[0], 0), innerWidth - 1);
          const y = Math.min(Math.max(r.top + r.height * p[1], 0), innerHeight - 1);
          return !blocked(el, r, document.elementFromPoint(x, y));
        });
      }
    }
    vcache.set(el, ok);
    return ok;
  };
  const live = (el) => hits(el) && inView(el);

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

  const links = [...document.querySelectorAll("a[href]")].filter(live).map((a) => {
    const label = clean(a.innerText);
    const im = a.querySelector("img");
    const name = label || clean(a.getAttribute("aria-label") || a.getAttribute("title")) || (im ? clean(im.alt) : "");
    return { text: name, href: abs(a.getAttribute("href")), icon: label ? "" : iconOf(a), b: boxOf(a) };
  });

  const images = [...document.querySelectorAll("img")].filter(live)
    .map((i) => ({
      alt: i.alt || "",
      src: abs(i.getAttribute("src") || i.currentSrc || ""),
      w: i.naturalWidth, h: i.naturalHeight,
      b: boxOf(i),
    }));

  const tables = [...document.querySelectorAll("table")].filter(live)
    .map((t) => ({
      rows: [...t.rows].map((r) => [...r.cells].map((c) => clean(c.innerText))),
      b: boxOf(t),
    }));

  const SEL = "h1,h2,h3,h4,h5,h6,p,li,td,th,dd,dt,blockquote,figcaption,pre,code," +
    "a,button,label,span,strong,em,small,time,summary,caption";
  const cand = [...document.querySelectorAll(SEL)].filter(live)
    .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), text: clean(el.innerText), r, el }; })
    .filter((o) => o.text);

  // Drop duplicate text fully contained in a longer entry
  const kept = [];
  for (const c of cand) {
    const covered = (a, b) =>
      a.text.includes(b.text) && a.r.left <= b.r.left && a.r.top <= b.r.top &&
      a.r.right >= b.r.right && a.r.bottom >= b.r.bottom;
    if (kept.some((k) => covered(k, c))) continue;
    const idx = kept.findIndex((k) => covered(c, k));
    if (idx >= 0) kept[idx] = c; else kept.push(c);
  }

  return {
    url: location.href,
    title: document.title,
    rect,
    text: kept.map((k) => ({ tag: k.tag, text: k.text, b: boxOf(k.el) })),
    links, images, tables,
  };
}

/* ---------- orchestration ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "sc:start") {
    chrome.scripting.executeScript({ target: { tabId: msg.tabId }, func: regionOverlay })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.type === "sc:region") {
    sendResponse({ ok: true });
    if (msg.rect && sender.tab) finishSelection(sender.tab, msg.rect, msg.dpr);
    return false;
  }
  return false;
});

async function finishSelection(tab, rect, dpr) {
  try {
    // Let the page repaint once so the overlay has fully disappeared
    await new Promise((r) => setTimeout(r, 160));

    const [dataUrl, res] = await Promise.all([
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractRegion, args: [rect] }),
    ]);

    const payload = {
      dataUrl,
      rect,
      dpr: dpr || 1,
      url: tab.url || (res[0].result && res[0].result.url) || "",
      title: tab.title || "",
      capturedAt: new Date().toISOString(),
      data: res[0].result,
    };

    await chrome.storage.session.set({ [SHOT_KEY]: payload });

    try {
      await chrome.action.openPopup();
    } catch {
      await chrome.action.setBadgeBackgroundColor({ color: "#F0B429" });
      await chrome.action.setBadgeText({ text: "1" });
    }
  } catch (e) {
    await chrome.action.setBadgeBackgroundColor({ color: "#FF8A7A" });
    await chrome.action.setBadgeText({ text: "!" });
  }
}