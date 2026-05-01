const STORAGE_KEYS = {
  images: "imageAssets"
};

const state = {
  imageAssets: []
};

const selectedImageIds = new Set();
let editorImage = null;

const els = {
  statusText: document.querySelector("#status-text"),
  editorImageSelect: document.querySelector("#editor-image-select"),
  imageGrid: document.querySelector("#image-grid"),
  canvas: document.querySelector("#editor-canvas"),
  cropX: document.querySelector("#crop-x"),
  cropY: document.querySelector("#crop-y"),
  cropW: document.querySelector("#crop-w"),
  cropH: document.querySelector("#crop-h"),
  resizeW: document.querySelector("#resize-w"),
  resizeH: document.querySelector("#resize-h")
};

const ctx = els.canvas.getContext("2d");

bindActions();
init().catch((error) => setStatus(error.message, true));

async function init() {
  await refreshState();
  renderAll();
  await loadAssetFromQuery();
}

function bindActions() {
  document.querySelector("#refresh-images").addEventListener("click", async () => {
    await refreshState();
    renderAll();
    setStatus("Images refreshed.");
  });

  document.querySelector("#load-image").addEventListener("click", () => {
    const id = els.editorImageSelect.value;
    const asset = state.imageAssets.find((item) => item.id === id);
    if (!asset) {
      return setStatus("Select an image first.", true);
    }

    loadImageToCanvas(asset.dataUrl || asset.sourceUrl);
  });

  document.querySelector("#crop-image").addEventListener("click", () => {
    if (!editorImage) {
      return setStatus("Load an image first.", true);
    }

    const x = toNumber(els.cropX.value, 0);
    const y = toNumber(els.cropY.value, 0);
    const w = toNumber(els.cropW.value, editorImage.width);
    const h = toNumber(els.cropH.value, editorImage.height);
    applyCrop(x, y, w, h);
  });

  document.querySelector("#resize-image").addEventListener("click", () => {
    if (!editorImage) {
      return setStatus("Load an image first.", true);
    }

    const w = toNumber(els.resizeW.value, 640);
    const h = toNumber(els.resizeH.value, 360);
    applyResize(w, h);
  });

  document.querySelector("#create-collage").addEventListener("click", async () => {
    const selected = state.imageAssets.filter((asset) => selectedImageIds.has(asset.id));
    if (selected.length < 2) {
      return setStatus("Select at least 2 images in the grid.", true);
    }

    await createCollage(selected);
  });

  document.querySelector("#save-edited-image").addEventListener("click", async () => {
    const dataUrl = els.canvas.toDataURL("image/png");
    setStatus("Saving edited image...");
    try {
      const saved = await sendMessage({
        type: "sidepanel:add-image",
        payload: { sourceUrl: dataUrl, title: "Edited image" }
      });
      state.imageAssets.unshift(saved);
      renderImageGrid();
      renderEditorSelect();
      setStatus("Edited image saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

async function refreshState() {
  const store = await chrome.storage.local.get([STORAGE_KEYS.images]);
  state.imageAssets = Array.isArray(store[STORAGE_KEYS.images]) ? store[STORAGE_KEYS.images] : [];
}

function renderAll() {
  renderEditorSelect();
  renderImageGrid();
}

function renderEditorSelect() {
  if (!state.imageAssets.length) {
    els.editorImageSelect.innerHTML = "<option value=\"\">No images</option>";
    return;
  }

  els.editorImageSelect.innerHTML = state.imageAssets
    .map((asset) => `<option value="${asset.id}">${escapeHtml(asset.title || asset.id)}</option>`)
    .join("");
}

async function loadAssetFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const assetId = params.get("assetId") || "";
  if (!assetId) {
    return;
  }

  const asset = state.imageAssets.find((item) => item.id === assetId);
  if (!asset) {
    return setStatus("Saved image asset not found.", true);
  }

  els.editorImageSelect.value = asset.id;
  await loadImageToCanvas(asset.dataUrl || asset.sourceUrl);
  setStatus("Loaded saved image asset.");
}

function renderImageGrid() {
  if (!state.imageAssets.length) {
    els.imageGrid.innerHTML = "<div class=\"list-item\">No images saved yet.</div>";
    return;
  }

  els.imageGrid.innerHTML = state.imageAssets
    .slice(0, 120)
    .map((asset) => {
      const src = asset.dataUrl || asset.sourceUrl;
      const selectedClass = selectedImageIds.has(asset.id) ? "selected" : "";
      return `
        <article class="image-card ${selectedClass}" data-id="${asset.id}">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(asset.title || "image")}" />
        </article>
      `;
    })
    .join("");

  els.imageGrid.querySelectorAll(".image-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-id");
      if (!id) return;
      if (selectedImageIds.has(id)) selectedImageIds.delete(id);
      else selectedImageIds.add(id);
      renderImageGrid();
    });
  });
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown error");
  }
  return response.payload;
}

function loadImageToCanvas(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      editorImage = image;
      els.canvas.width = image.width;
      els.canvas.height = image.height;
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      ctx.drawImage(image, 0, 0);
      resolve();
    };
    image.onerror = () => reject(new Error("Cannot load image for editing."));
    image.src = src;
  }).catch((error) => setStatus(error.message, true));
}

function applyCrop(x, y, w, h) {
  const clampedW = Math.max(1, Math.min(w, els.canvas.width - x));
  const clampedH = Math.max(1, Math.min(h, els.canvas.height - y));
  const imageData = ctx.getImageData(x, y, clampedW, clampedH);
  els.canvas.width = clampedW;
  els.canvas.height = clampedH;
  ctx.putImageData(imageData, 0, 0);
  editorImage = imageFromCanvas();
}

function applyResize(width, height) {
  const targetW = Math.max(1, width);
  const targetH = Math.max(1, height);
  const snapshot = imageFromCanvas();
  els.canvas.width = targetW;
  els.canvas.height = targetH;
  ctx.drawImage(snapshot, 0, 0, targetW, targetH);
  editorImage = imageFromCanvas();
}

async function createCollage(assets) {
  const images = await Promise.all(
    assets.map((asset) => loadImageElement(asset.dataUrl || asset.sourceUrl).catch(() => null))
  );

  const validImages = images.filter(Boolean);
  if (!validImages.length) {
    return setStatus("Could not load selected images.", true);
  }

  const height = Math.max(...validImages.map((img) => img.height));
  const width = validImages.reduce((sum, img) => sum + img.width, 0);

  els.canvas.width = width;
  els.canvas.height = height;

  let x = 0;
  for (const img of validImages) {
    ctx.drawImage(img, x, 0);
    x += img.width;
  }

  editorImage = imageFromCanvas();
  setStatus("Collage created.");
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = src;
  });
}

function imageFromCanvas() {
  const image = new Image();
  image.src = els.canvas.toDataURL("image/png");
  return image;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setStatus(text, isError = false) {
  els.statusText.textContent = text;
  els.statusText.style.color = isError ? "#9e2a2b" : "#6b7567";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
