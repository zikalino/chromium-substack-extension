function inferPageContext() {
  return {
    url: window.location.href,
    title: document.title || "Untitled page",
    hasTextSelection: Boolean(window.getSelection()?.toString().trim())
  };
}

function collectImageUrls() {
  return collectImageDetails().map((item) => item.url);
}

function collectImageDetails() {
  const byUrl = new Map();

  const pushDetail = (rawUrl, source, notes = "") => {
    const normalized = normalizeAbsoluteUrlInfo(rawUrl);
    if (!normalized.url || !isLikelyImageUrl(normalized.url)) {
      return;
    }

    const existing = byUrl.get(normalized.url);
    if (!existing) {
      byUrl.set(normalized.url, {
        url: normalized.url,
        source,
        notes: buildNotes(notes, normalized.trailingSlashFixed)
      });
      return;
    }

    existing.source = mergeSource(existing.source, source);
    existing.notes = mergeNotes(existing.notes, buildNotes(notes, normalized.trailingSlashFixed));
  };

  for (const image of document.images) {
    const src = image.currentSrc || image.src || image.getAttribute("src") || "";
    pushDetail(src, "dom:img");
  }

  const ogImage = document.querySelector("meta[property='og:image']")?.getAttribute("content") || "";
  const twitterImage = document.querySelector("meta[name='twitter:image']")?.getAttribute("content") || "";
  pushDetail(ogImage, "meta:og:image");
  pushDetail(twitterImage, "meta:twitter:image");

  for (const scriptUrl of collectImageUrlsFromScripts()) {
    pushDetail(scriptUrl, "script:url-scan");
  }

  for (const hotelImageUrl of collectTripHotelImagesOnly()) {
    pushDetail(hotelImageUrl, "script:hotelImages", "trip hotelImages");
  }

  return Array.from(byUrl.values());
}

function mergeSource(existing, next) {
  const parts = new Set(
    String(existing || "")
      .split(" + ")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  parts.add(next);
  return Array.from(parts).join(" + ");
}

function buildNotes(note, trailingSlashFixed) {
  const parts = [];
  if (note) {
    parts.push(note);
  }
  if (trailingSlashFixed) {
    parts.push("normalized trailing slash");
  }
  return parts.join("; ");
}

function mergeNotes(existing, next) {
  const parts = new Set(
    [String(existing || ""), String(next || "")]
      .flatMap((item) => item.split(";"))
      .map((item) => item.trim())
      .filter(Boolean)
  );
  return Array.from(parts).join("; ");
}

function normalizeAbsoluteUrlInfo(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return { url: "", trailingSlashFixed: false };
  }

  try {
    const resolved = new URL(raw, window.location.href);
    if (!/^https?:/i.test(resolved.toString())) {
      return { url: "", trailingSlashFixed: false };
    }

    const originalPath = resolved.pathname;
    resolved.pathname = resolved.pathname.replace(/(\.(?:jpg|jpeg|png|webp|gif|avif|bmp|svg))\/+$/i, "$1");
    return {
      url: resolved.toString(),
      trailingSlashFixed: originalPath !== resolved.pathname
    };
  } catch {
    return { url: "", trailingSlashFixed: false };
  }
}

function collectTripHotelImagesOnly() {
  const urls = [];
  const scripts = Array.from(document.querySelectorAll("script"));

  for (const script of scripts) {
    const text = String(script.textContent || "").trim();
    if (!text && script.id !== "__NEXT_DATA__") {
      continue;
    }

    if (script.id === "__NEXT_DATA__") {
      const parsed = safeJsonParse(text);
      if (parsed) {
        collectHotelImagesFromDataNode(parsed, urls);
      }
      continue;
    }

    if (!text) {
      continue;
    }

    const inlineData = extractInlineAssignedObject(text, "window.IBU_HOTEL_DETAIL")
      || extractInlineAssignedObject(text, "IBU_HOTEL_DETAIL")
      || extractInlineAssignedObject(text, "window.__NEXT_DATA__");

    if (inlineData) {
      collectHotelImagesFromDataNode(inlineData, urls);
    }

    collectTripHotelImagesFromScriptText(text, urls);
  }

  const seen = new Set();
  const unique = [];
  for (const item of urls) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    unique.push(item);
  }

  return unique;
}

function collectHotelImagesFromDataNode(root, urls) {
  const stack = [root];
  const visited = new Set();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      continue;
    }
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object") {
          stack.push(item);
        }
      }
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (String(key).toLowerCase() === "hotelimages" && Array.isArray(value)) {
        for (const imageItem of value) {
          if (typeof imageItem === "string") {
            const normalized = normalizeAbsoluteUrl(imageItem);
            if (isLikelyImageUrl(normalized)) {
              urls.push(normalized);
            }
            continue;
          }

          if (imageItem && typeof imageItem === "object") {
            const raw = imageItem.url || imageItem.imageUrl || imageItem.src || "";
            const normalized = normalizeAbsoluteUrl(raw);
            if (isLikelyImageUrl(normalized)) {
              urls.push(normalized);
            }
          }
        }
      }

      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
}

function collectTripHotelImagesFromScriptText(text, urls) {
  const normalizedText = String(text || "").replaceAll("\\/", "/");
  if (!/hotelImages/i.test(normalizedText)) {
    return;
  }

  const blocks = normalizedText.match(/hotelImages\s*[:=]\s*\[[\s\S]*?\]/gi) || [];
  const urlRegex = /https?:\/\/[^\"'\s)\],]+/gi;

  for (const block of blocks) {
    for (const match of block.matchAll(urlRegex)) {
      const normalized = normalizeAbsoluteUrl(match[0]);
      if (isLikelyImageUrl(normalized)) {
        urls.push(normalized);
      }
    }
  }
}

function collectImageUrlsFromScripts() {
  const urls = [];
  const scripts = Array.from(document.querySelectorAll("script"));

  for (const script of scripts) {
    const text = String(script.textContent || "").trim();
    if (!text && script.id !== "__NEXT_DATA__") {
      continue;
    }

    if (script.id === "__NEXT_DATA__") {
      const parsed = safeJsonParse(text);
      if (parsed) {
        collectImageUrlsFromDataNode(parsed, urls);
      }
      continue;
    }

    if (!text) {
      continue;
    }

    const inlineData = extractInlineAssignedObject(text, "window.IBU_HOTEL_DETAIL")
      || extractInlineAssignedObject(text, "IBU_HOTEL_DETAIL")
      || extractInlineAssignedObject(text, "window.__NEXT_DATA__");

    if (inlineData) {
      collectImageUrlsFromDataNode(inlineData, urls);
    }

    collectImageUrlsFromScriptText(text, urls);
  }

  const seen = new Set();
  const unique = [];
  for (const item of urls) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    unique.push(item);
  }

  return unique;
}

function collectImageUrlsFromDataNode(root, urls) {
  const stack = [root];
  const visited = new Set();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      continue;
    }
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === "string") {
          const normalized = normalizeAbsoluteUrl(item);
          if (isLikelyImageUrl(normalized)) {
            urls.push(normalized);
          }
        } else {
          stack.push(item);
        }
      }
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      const lowerKey = key.toLowerCase();

      if (typeof value === "string") {
        const normalized = normalizeAbsoluteUrl(value);
        if (normalized && (lowerKey.includes("url") || lowerKey.includes("src")) && isLikelyImageUrl(normalized)) {
          urls.push(normalized);
        }
      }

      if (Array.isArray(value) && lowerKey.includes("image")) {
        for (const item of value) {
          if (item && typeof item === "object" && typeof item.url === "string") {
            const normalized = normalizeAbsoluteUrl(item.url);
            if (isLikelyImageUrl(normalized)) {
              urls.push(normalized);
            }
          }
        }
      }

      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
}

function extractInlineAssignedObject(text, varName) {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}\\s*=\\s*(\\{[\\s\\S]*?\\});`),
    new RegExp(`${escaped}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*$`)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parsed = safeJsonParse(match[1]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function collectImageUrlsFromScriptText(text, urls) {
  const normalizedText = String(text || "").replaceAll("\\/", "/");
  const regex = /https?:\/\/[^\"'\s)]+/gi;

  for (const match of normalizedText.matchAll(regex)) {
    const candidate = normalizeAbsoluteUrl(match[0]);
    if (isLikelyImageUrl(candidate)) {
      urls.push(candidate);
    }
  }
}

function isLikelyImageUrl(url) {
  if (!url) {
    return false;
  }

  if (!/^https?:/i.test(url)) {
    return false;
  }

  if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(?:$|[?#])/i.test(url)) {
    return true;
  }

  return /image|img|photo|pic/i.test(url);
}

function normalizeAbsoluteUrl(value) {
  return normalizeAbsoluteUrlInfo(value).url;
}

function findButtonLikeByText(targetText) {
  const normalizedTarget = targetText.trim().toLowerCase();
  const nodes = Array.from(document.querySelectorAll("button, a, span, div"));
  return (
    nodes.find((node) => {
      const text = (node.textContent || "").trim().toLowerCase();
      if (text !== normalizedTarget) {
        return false;
      }
      const role = (node.getAttribute("role") || "").toLowerCase();
      return node instanceof HTMLElement && (node.tagName === "BUTTON" || node.tagName === "A" || role === "button");
    }) || null
  );
}

function findUrlNearNode(node) {
  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const scope = node.closest("[role='dialog'], .modal, .popup, .share") || document;
  const valueNodes = scope.querySelectorAll("input[value], textarea, [data-clipboard-text], a[href]");

  for (const item of valueNodes) {
    const fromData = item.getAttribute?.("data-clipboard-text") || "";
    const fromValue = "value" in item ? item.value : "";
    const fromHref = item.getAttribute?.("href") || "";
    const candidate = String(fromData || fromValue || fromHref || "").trim();
    const normalized = normalizeAbsoluteUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTripHotelCanonical(url) {
  if (!url) {
    return "";
  }

  const value = String(url);

  // Pattern A: /hotel-detail-6154564/
  let match = value.match(/hotel-detail-(\d+)/);
  if (match) {
    return `https://www.trip.com/hotels/detail?hotelId=${match[1]}`;
  }

  // Pattern B: ?hotelId=6154564
  match = value.match(/[?&]hotelId=(\d+)/);
  if (match) {
    return `https://www.trip.com/hotels/detail?hotelId=${match[1]}`;
  }

  // Pattern C: /hotels/<city>/<id>.html
  match = value.match(/\/hotels\/[^/]+\/(\d+)\.html/);
  if (match) {
    return `https://www.trip.com/hotels/detail?hotelId=${match[1]}`;
  }

  // Pattern D: any 6-9 digit id in path
  match = value.match(/\/(\d{6,9})(?:\/|$)/);
  if (match) {
    return `https://www.trip.com/hotels/detail?hotelId=${match[1]}`;
  }

  return "";
}

async function resolveTripPropertyUrl() {
  const host = window.location.hostname.toLowerCase();
  if (!host.includes("trip.com")) {
    return "";
  }

  const canonicalFromCurrent = extractTripHotelCanonical(window.location.href);
  if (canonicalFromCurrent) {
    return canonicalFromCurrent;
  }

  const shareVia = findButtonLikeByText("Share Via");
  if (!shareVia) {
    return "";
  }

  shareVia.click();
  await sleep(350);

  const copyButton = findButtonLikeByText("Copy");
  const discoveredBeforeCopy = findUrlNearNode(copyButton || shareVia);
  if (copyButton) {
    copyButton.click();
  }

  await sleep(120);

  let clipboardUrl = "";
  try {
    clipboardUrl = await navigator.clipboard.readText();
  } catch {
    clipboardUrl = "";
  }

  const canonicalFromClipboard = extractTripHotelCanonical(clipboardUrl);
  if (canonicalFromClipboard) {
    return canonicalFromClipboard;
  }

  const canonicalFromDiscovered = extractTripHotelCanonical(discoveredBeforeCopy);
  if (canonicalFromDiscovered) {
    return canonicalFromDiscovered;
  }

  return normalizeAbsoluteUrl(clipboardUrl) || discoveredBeforeCopy;
}

chrome.runtime
  .sendMessage({ type: "page:context", payload: inferPageContext() })
  .catch(() => {
    // Ignore if service worker is asleep or not listening for this message.
  });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "content:capture-page-assets") {
    return;
  }

  (async () => {
    const tripUrl = await resolveTripPropertyUrl();
    const imageDetails = collectImageDetails();
    const imageUrls = imageDetails.map((item) => item.url);
    sendResponse({
      ok: true,
      payload: {
        title: document.title || "Untitled page",
        url: window.location.href,
        resolvedUrl: tripUrl || window.location.href,
        imageUrls,
        imageDetails
      }
    });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || "Failed to capture page assets." });
  });

  return true;
});
