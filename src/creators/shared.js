export function setStatus(statusEl, text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#9e2a2b" : "#5f6a61";
}

export async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown error");
  }
  return response.payload;
}

export async function saveCanvasAsImage(canvas, title, statusEl, options = {}) {
  const dataUrl = canvas.toDataURL("image/png");
  setStatus(statusEl, "Saving generated image...");
  const saved = await sendMessage({
    type: "sidepanel:add-image",
    payload: {
      sourceUrl: dataUrl,
      title,
      assetType: options.assetType || "image",
      editor: options.editor || null,
      editorState: options.editorState || null
    }
  });
  setStatus(statusEl, "Image saved to assets.");
  window.setTimeout(() => {
    window.close();
  }, 150);
  return saved;
}

export function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function parseDataLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getAssetIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("assetId") || "";
}

export async function getImageAssetById(assetId) {
  if (!assetId) {
    return null;
  }

  const store = await chrome.storage.local.get(["imageAssets"]);
  const assets = Array.isArray(store.imageAssets) ? store.imageAssets : [];
  return assets.find((asset) => asset.id === assetId) || null;
}
