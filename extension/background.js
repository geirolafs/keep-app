// KEEP Clipper — no server, no pairing. Everything is saved by downloading
// into ~/Downloads/KEEP; the KEEP app watches that folder and ingests.
// Media saves get a `<name>.keep.json` sidecar with metadata; link saves are
// a standalone `<uuid>.keep.json` with {type:"link", url} — the app scrapes og: itself.

const INBOX = "KEEP";

// mirror of the app's accepted extensions (lib.rs MEDIA_EXTS)
const MEDIA_EXTS = [
  "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "tif", "tiff",
  "jxl", "heic", "heif", "mp4", "mov", "webm",
];

chrome.runtime.onInstalled.addListener(() => {
  const items = [
    { id: "save-image", title: "Save image to KEEP", contexts: ["image"] },
    { id: "save-video", title: "Save video to KEEP", contexts: ["video"] },
    { id: "save-link", title: "Save link to KEEP", contexts: ["link"] },
    { id: "save-page", title: "Save page to KEEP", contexts: ["page", "selection"] },
    { id: "shot-visible", title: "Screenshot: visible area", contexts: ["action"] },
    { id: "shot-region", title: "Screenshot: select region", contexts: ["action"] },
  ];
  for (const it of items) chrome.contextMenus.create(it);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case "save-image":
    case "save-video":
      return saveMedia(info.srcUrl, tab);
    case "save-link":
      return saveLink(info.linkUrl);
    case "save-page":
      return saveLink(tab?.url ?? info.pageUrl);
    case "shot-visible":
      return shotVisible(tab);
    case "shot-region":
      return shotRegion(tab);
  }
});

chrome.action.onClicked.addListener((tab) => saveLink(tab?.url));

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "save-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  saveLink(tab?.url);
});

// region-select.js reports the drag rect here
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "keep-region" && sender.tab) handleRegion(msg, sender.tab);
});

// ── save actions ────────────────────────────────────────────────────────────

async function saveMedia(srcUrl, tab) {
  try {
    if (!srcUrl || !/^(https?:|data:image\/)/.test(srcUrl)) {
      throw new Error(`unsupported media URL: ${srcUrl?.slice(0, 40)}`);
    }
    const id = crypto.randomUUID();
    const ext = extFromUrl(srcUrl);
    await sidecar(`${id}.${ext}`, {
      type: "image",
      source_url: tab?.url ?? null,
      title: tab?.title ?? null,
    });
    await download({ url: srcUrl, filename: `${INBOX}/${id}.${ext}` });
    flash();
  } catch (e) {
    fail(e);
  }
}

async function saveLink(url) {
  try {
    if (!url || !/^https?:/.test(url)) throw new Error(`not a saveable page: ${url}`);
    const id = crypto.randomUUID();
    await download({
      url: jsonDataUrl({ type: "link", url }),
      filename: `${INBOX}/${id}.keep.json`,
    });
    flash();
  } catch (e) {
    fail(e);
  }
}

async function shotVisible(tab) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab?.windowId, { format: "png" });
    await saveScreenshot(dataUrl, tab);
  } catch (e) {
    fail(e);
  }
}

async function shotRegion(tab) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["region-select.js"] });
  } catch (e) {
    fail(e); // chrome:// pages, web store, etc.
  }
}

async function handleRegion({ rect, vw }, tab) {
  try {
    await new Promise((r) => setTimeout(r, 80)); // let the overlay teardown paint
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = bmp.width / vw; // capture px per CSS px — covers retina and page zoom
    const sw = Math.max(1, Math.round(rect.w * scale));
    const sh = Math.max(1, Math.round(rect.h * scale));
    const canvas = new OffscreenCanvas(sw, sh);
    canvas
      .getContext("2d")
      .drawImage(bmp, rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale, 0, 0, sw, sh);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    await saveScreenshot(await blobToDataUrl(blob), tab);
  } catch (e) {
    fail(e);
  }
}

async function saveScreenshot(dataUrl, tab) {
  const id = crypto.randomUUID();
  await sidecar(`${id}.png`, {
    type: "screenshot",
    source_url: tab?.url ?? null,
    title: tab?.title ?? null,
  });
  await download({ url: dataUrl, filename: `${INBOX}/${id}.png` });
  flash();
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Resolves when the download *finishes* — chrome.downloads.download() resolves
// when it merely starts, which would flash ✓ for a download that later 404s.
function download(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options).then((id) => {
      const onChanged = (delta) => {
        if (delta.id !== id) return;
        const state = delta.state?.current;
        if (state === "complete") {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve(id);
        } else if (state === "interrupted") {
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error(delta.error?.current ?? "download interrupted"));
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
    }, reject);
  });
}

function sidecar(mediaName, meta) {
  return download({
    url: jsonDataUrl(meta),
    filename: `${INBOX}/${mediaName}.keep.json`,
  });
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function jsonDataUrl(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return `data:application/json;base64,${bytesToB64(bytes)}`;
}

// MIME subtypes whose name isn't the file extension the app expects
const MIME_EXT = { jpeg: "jpg", "svg+xml": "svg", apng: "png" };

function extFromUrl(url) {
  if (url.startsWith("data:image/")) {
    const sub = url.slice("data:image/".length).split(/[;,]/)[0].toLowerCase();
    const ext = MIME_EXT[sub] ?? sub;
    return MEDIA_EXTS.includes(ext) ? ext : "png"; // data: images are bitmaps in practice
  }
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-z0-9]+)$/i);
    const ext = (m?.[1] ?? u.searchParams.get("format") ?? "").toLowerCase();
    if (MEDIA_EXTS.includes(ext)) return ext;
  } catch {}
  return "jpg";
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type};base64,${bytesToB64(buf)}`;
}

function flash(text = "✓", color = "#22c55e") {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

function fail(e) {
  console.error("[keep]", e);
  flash("!", "#ef4444");
}
