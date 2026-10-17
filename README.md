# Site Capture

A minimal Microsoft Edge / Chrome extension (Manifest V3) that captures data from the current web page, previews it, and downloads it locally. Nothing is uploaded — everything is generated in the browser.

## Features

- **Six capture scopes** — pick any combination:
  - Page HTML (full DOM source)
  - Visible text
  - Links (absolute `a[href]` URLs)
  - Images (`img` src + alt)
  - Tables (cells extracted row by row)
  - Metadata (`title` / description / Open Graph)
- **Visibility filtering** — only elements actually visible on screen are captured; off-screen and occluded elements are skipped. A point is sampled at the element's center plus its four edge midpoints; an element counts as visible if any sample is inside the viewport and not covered by a clearly larger overlay. Overlays the same size or smaller (player controls, covers, click layers) are treated as part of the element, not as occlusion. The same rules apply on every site.
- **Region capture** — click *Capture a region*, drag a box over the page, and get a screenshot of that region plus the data inside it. Hovering a captured item highlights its exact position on the screenshot.
- **Previews for every data type** — collapsible sections with a per-type count; the screenshot preview stays pinned while you scroll the list.
- **Downloads**
  - Combined: one JSON file with everything.
  - Split: `page.html`, `page.txt`, `links.csv` (+ an `icons/` folder), `images.csv`, `tables.csv`, `meta.json`.
  - Region capture also exports the screenshot as PNG and the data as JSON.
- **Icon extraction** — icons are pulled from `img`, CSS `background-image`, `::before` / `::after`, and inline SVG; when none can be resolved, they are cropped from the screenshot. Each icon can be downloaded individually.
- **Resilient download chain** — tries the direct URL, then `chrome.downloads`, then reads the bytes in page context (which carries `Referer` and bypasses CORS), and finally falls back to the page's own download channel. Failed attempts are cleaned from the download list automatically.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `popup.html` | Popup UI (dark theme, amber accent) |
| `popup.js` | Popup logic: capture, previews, downloads |
| `background.js` | Region overlay, screenshot, region data extraction |

## Install

1. Open `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. After editing any file, click **Reload** on the extension card. Changes to `background.js` always require a reload.

## Usage

1. Open a normal web page.
2. Click the extension icon.
3. Check the data types you want, then click **Capture current page**.
4. Review the previews, choose a download format, and click **Download**.
5. For a specific area, click **Capture a region**, drag a box, and confirm — the result opens in the screenshot view.

## Permissions

- `activeTab` / `scripting` — inject the capture and region-overlay scripts into the current tab.
- `downloads` — save generated files.
- `storage` — pass the region-capture result from the background script to the popup.
- `host_permissions: <all_urls>` — read page content on any site.

## Limitations

- Browser-internal pages (`edge://`, `chrome://`, `about:`, extension pages) can't be captured, since script injection is blocked there.
- Captures reflect the current viewport only; content that is scrolled out of view or hidden behind a larger overlay is intentionally excluded.
- All processing is local; captured data is never sent anywhere.
