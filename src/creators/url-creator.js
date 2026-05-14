const qs = new URLSearchParams(window.location.search);
const draftId = qs.get("draftId") || "";

const els = {
  status: document.querySelector("#status"),
  title: document.querySelector("#url-title"),
  url: document.querySelector("#url-value"),
  includeScreenshot: document.querySelector("#include-screenshot"),
  screenshotBlock: document.querySelector("#screenshot-block"),
  canvas: document.querySelector("#screenshot-canvas"),
  imageList: document.querySelector("#image-list"),
  imageCount: document.querySelector("#image-count"),
  toggleImages: document.querySelector("#toggle-images")
};

const cropState = {
  active: false,
  dragging: false,
  startX: 0,
  startY: 0,
  currentRect: null,
  sourceImage: null,
  originalDataUrl: ""
};

const hoverPreviewState = {
  root: null,
  image: null,
  caption: null,
  visible: false
};

let selectedImageUrls = new Set();
let imageDetailsByUrl = new Map();
let allExtractedImageCount = 0;
const imageDimensionCache = new Map();
const MIN_IMAGE_SIZE = 200;

init().catch((error) => setStatus(error.message || "Failed to load capture form.", true));

async function init() {
  if (!draftId) {
    throw new Error("Missing draft id.");
  }

  const draft = await sendMessage({ type: "bookmark-draft:get", payload: { draftId } });
  if (!draft) {
    throw new Error("Draft not found. Please retry from sidepanel.");
  }

  els.title.value = draft.title || "";
  els.url.value = draft.pageUrl || "";
  els.includeScreenshot.checked = Boolean(draft.includeScreenshot);
  selectedImageUrls = new Set(Array.isArray(draft.imageUrls) ? draft.imageUrls : []);
  imageDetailsByUrl = new Map(
    (Array.isArray(draft.imageDetails) ? draft.imageDetails : [])
      .map((item) => [String(item.url || ""), item])
      .filter(([url]) => Boolean(url))
  );

  bindActions();
  await loadScreenshot(draft.screenshotDataUrl || "");
  const listFromUrls = Array.isArray(draft.imageUrls) ? draft.imageUrls : [];
  const listFromDetails = Array.isArray(draft.imageDetails)
    ? draft.imageDetails.map((item) => String(item?.url || "")).filter(Boolean)
    : [];
  const initialUrls = listFromUrls.length ? listFromUrls : listFromDetails;
  allExtractedImageCount = initialUrls.length;
  await renderImageList(initialUrls);
  syncScreenshotVisibility();
  setStatus("Review captured data and save when ready.");
}

function bindActions() {
  document.querySelector("#cancel")?.addEventListener("click", closeWindow);

  els.includeScreenshot?.addEventListener("change", () => {
    syncScreenshotVisibility();
  });

  els.toggleImages?.addEventListener("click", () => {
    const imageUrls = getImageUrlsFromList();
    const allSelected = imageUrls.every((url) => selectedImageUrls.has(url));

    if (allSelected) {
      selectedImageUrls.clear();
    } else {
      selectedImageUrls = new Set(imageUrls);
    }

    void renderImageList(imageUrls);
  });

  document.querySelector("#start-crop")?.addEventListener("click", () => {
    cropState.active = true;
    setStatus("Drag on screenshot to select crop area.");
  });

  document.querySelector("#apply-crop")?.addEventListener("click", applyCrop);
  document.querySelector("#reset-crop")?.addEventListener("click", resetCrop);
  document.querySelector("#save-bookmark")?.addEventListener("click", saveBookmark);

  bindCanvasCropHandlers();
  ensureHoverPreviewElement();
}

function closeWindow() {
  window.close();
}

function setStatus(text, isError = false) {
  if (!els.status) {
    return;
  }
  els.status.textContent = text;
  els.status.style.color = isError ? "#9e2a2b" : "#657064";
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown error");
  }
  return response.payload;
}

function syncScreenshotVisibility() {
  const show = Boolean(els.includeScreenshot?.checked);
  els.screenshotBlock?.classList.toggle("hidden", !show);
}

async function loadScreenshot(dataUrl) {
  cropState.originalDataUrl = dataUrl || "";
  if (!dataUrl) {
    cropState.currentRect = null;
    clearCanvas();
    return;
  }

  const image = await loadImage(dataUrl);
  cropState.sourceImage = image;
  cropState.currentRect = null;
  drawImageToCanvas(image);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load screenshot image."));
    image.src = dataUrl;
  });
}

function clearCanvas() {
  const ctx = els.canvas.getContext("2d");
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
}

function drawImageToCanvas(image) {
  const ctx = els.canvas.getContext("2d");
  const maxWidth = 1400;
  const maxHeight = 900;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.floor(image.width * scale));
  const height = Math.max(1, Math.floor(image.height * scale));

  els.canvas.width = width;
  els.canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
}

function bindCanvasCropHandlers() {
  const canvas = els.canvas;

  canvas.addEventListener("mousedown", (event) => {
    if (!cropState.active) {
      return;
    }

    const point = getCanvasPoint(event);
    cropState.dragging = true;
    cropState.startX = point.x;
    cropState.startY = point.y;
    cropState.currentRect = { x: point.x, y: point.y, width: 1, height: 1 };
    redrawWithOverlay();
  });

  canvas.addEventListener("mousemove", (event) => {
    if (!cropState.active || !cropState.dragging) {
      return;
    }

    const point = getCanvasPoint(event);
    cropState.currentRect = normalizeRect(cropState.startX, cropState.startY, point.x, point.y);
    redrawWithOverlay();
  });

  canvas.addEventListener("mouseup", () => {
    cropState.dragging = false;
  });

  canvas.addEventListener("mouseleave", () => {
    cropState.dragging = false;
  });
}

function getCanvasPoint(event) {
  const rect = els.canvas.getBoundingClientRect();
  const scaleX = els.canvas.width / rect.width;
  const scaleY = els.canvas.height / rect.height;
  return {
    x: clamp(Math.round((event.clientX - rect.left) * scaleX), 0, els.canvas.width),
    y: clamp(Math.round((event.clientY - rect.top) * scaleY), 0, els.canvas.height)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.max(1, Math.abs(x2 - x1));
  const height = Math.max(1, Math.abs(y2 - y1));
  return { x, y, width, height };
}

function redrawWithOverlay() {
  if (!cropState.sourceImage) {
    return;
  }

  const rect = cropState.currentRect;
  drawImageToCanvas(cropState.sourceImage);
  if (!rect) {
    return;
  }

  const ctx = els.canvas.getContext("2d");
  ctx.save();
  ctx.fillStyle = "rgba(217, 101, 43, 0.2)";
  ctx.strokeStyle = "#d9652b";
  ctx.lineWidth = 2;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function applyCrop() {
  if (!cropState.currentRect) {
    return setStatus("Select a crop area first.", true);
  }

  const rect = cropState.currentRect;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = els.canvas.width;
  sourceCanvas.height = els.canvas.height;
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(els.canvas, 0, 0);

  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = rect.width;
  croppedCanvas.height = rect.height;
  const croppedCtx = croppedCanvas.getContext("2d");
  croppedCtx.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

  const newDataUrl = croppedCanvas.toDataURL("image/png");
  loadScreenshot(newDataUrl)
    .then(() => {
      cropState.active = false;
      setStatus("Crop applied.");
    })
    .catch((error) => setStatus(error.message, true));
}

function resetCrop() {
  cropState.active = false;
  cropState.currentRect = null;
  loadScreenshot(cropState.originalDataUrl)
    .then(() => setStatus("Screenshot reset."))
    .catch((error) => setStatus(error.message, true));
}

function getImageUrlsFromList() {
  return Array.from(els.imageList.querySelectorAll("input[type='checkbox'][data-url]"))
    .map((input) => String(input.getAttribute("data-url") || ""))
    .filter(Boolean);
}

async function renderImageList(imageUrls) {
  const enriched = await enrichImageEntries(imageUrls);
  const filteredEntries = enriched.filter(
    (entry) => entry.width >= MIN_IMAGE_SIZE && entry.height >= MIN_IMAGE_SIZE
  );

  const filteredUrls = filteredEntries.map((entry) => entry.url);
  selectedImageUrls = new Set(Array.from(selectedImageUrls).filter((url) => filteredUrls.includes(url)));

  updateImageCount(filteredEntries.length);

  if (!filteredEntries.length) {
    els.imageList.innerHTML = "<li class='image-item'><span>No images detected on page.</span></li>";
    hideHoverPreview();
    updateToggleImagesLabel();
    return;
  }

  els.imageList.innerHTML = filteredEntries
    .map((entry, index) => {
      const url = entry.url;
      const checked = selectedImageUrls.has(url) ? "checked" : "";
      const detail = imageDetailsByUrl.get(url);
      const sourceText = detail?.source ? `Source: ${detail.source}` : "Source: unknown";
      const noteText = detail?.notes ? ` | ${detail.notes}` : "";
      const sizeText = `${entry.width}x${entry.height}`;
      return `
        <li class="image-item" data-preview-url="${escapeHtml(url)}">
          <label>
            <input type="checkbox" data-url="${escapeHtml(url)}" ${checked} />
          </label>
          <img src="${escapeHtml(url)}" alt="image ${index + 1}" />
          <div class="image-info">
            <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>
            <div class="size">Size: ${escapeHtml(sizeText)}</div>
            <div class="meta">${escapeHtml(`${sourceText}${noteText}`)}</div>
          </div>
        </li>
      `;
    })
    .join("");

  els.imageList.querySelectorAll("input[type='checkbox'][data-url]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const url = String(checkbox.getAttribute("data-url") || "");
      if (!url) {
        return;
      }

      if (checkbox.checked) {
        selectedImageUrls.add(url);
      } else {
        selectedImageUrls.delete(url);
      }
      updateToggleImagesLabel();
    });
  });

  els.imageList.querySelectorAll(".image-item[data-preview-url]").forEach((item) => {
    item.addEventListener("mouseenter", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const url = String(target.getAttribute("data-preview-url") || "");
      if (!url) {
        return;
      }
      showHoverPreview(url, event);
    });

    item.addEventListener("mousemove", (event) => {
      if (!hoverPreviewState.visible) {
        return;
      }
      moveHoverPreview(event);
    });

    item.addEventListener("mouseleave", () => {
      hideHoverPreview();
    });
  });

  updateToggleImagesLabel();
}

function updateImageCount(visibleCount) {
  if (!els.imageCount) {
    return;
  }

  if (allExtractedImageCount > 0 && visibleCount !== allExtractedImageCount) {
    els.imageCount.textContent = `${visibleCount}/${allExtractedImageCount}`;
  } else {
    els.imageCount.textContent = String(visibleCount);
  }
}

async function enrichImageEntries(imageUrls) {
  const uniqueUrls = Array.from(new Set(imageUrls.map((url) => String(url || "").trim()).filter(Boolean)));
  const entries = await Promise.all(
    uniqueUrls.map(async (url) => {
      const size = await getImageDimensions(url);
      return {
        url,
        width: size.width,
        height: size.height
      };
    })
  );

  return entries;
}

async function getImageDimensions(url) {
  if (imageDimensionCache.has(url)) {
    return imageDimensionCache.get(url);
  }

  const size = await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0
      });
    };
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = url;
  });

  imageDimensionCache.set(url, size);
  return size;
}

function ensureHoverPreviewElement() {
  if (hoverPreviewState.root) {
    return;
  }

  const root = document.createElement("div");
  root.className = "hover-preview hidden";

  const image = document.createElement("img");
  image.alt = "Preview";

  const caption = document.createElement("div");
  caption.className = "caption";

  root.appendChild(image);
  root.appendChild(caption);
  document.body.appendChild(root);

  hoverPreviewState.root = root;
  hoverPreviewState.image = image;
  hoverPreviewState.caption = caption;
}

function showHoverPreview(url, event) {
  ensureHoverPreviewElement();

  if (!hoverPreviewState.root || !hoverPreviewState.image || !hoverPreviewState.caption) {
    return;
  }

  hoverPreviewState.image.src = url;
  hoverPreviewState.caption.textContent = url;
  hoverPreviewState.root.classList.remove("hidden");
  hoverPreviewState.visible = true;
  moveHoverPreview(event);
}

function moveHoverPreview(event) {
  if (!hoverPreviewState.root) {
    return;
  }

  const gap = 18;
  const previewRect = hoverPreviewState.root.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = event.clientX + gap;
  let top = event.clientY + gap;

  if (left + previewRect.width > viewportWidth - 12) {
    left = event.clientX - previewRect.width - gap;
  }

  if (top + previewRect.height > viewportHeight - 12) {
    top = viewportHeight - previewRect.height - 12;
  }

  if (left < 8) {
    left = 8;
  }

  if (top < 8) {
    top = 8;
  }

  hoverPreviewState.root.style.left = `${left}px`;
  hoverPreviewState.root.style.top = `${top}px`;
}

function hideHoverPreview() {
  if (!hoverPreviewState.root) {
    return;
  }

  hoverPreviewState.root.classList.add("hidden");
  hoverPreviewState.visible = false;
}

function updateToggleImagesLabel() {
  const imageUrls = getImageUrlsFromList();
  if (!imageUrls.length) {
    els.toggleImages.textContent = "Select all";
    return;
  }

  const allSelected = imageUrls.every((url) => selectedImageUrls.has(url));
  els.toggleImages.textContent = allSelected ? "Clear all" : "Select all";
}

async function saveBookmark() {
  const title = els.title.value.trim();
  const pageUrl = els.url.value.trim();
  if (!pageUrl) {
    return setStatus("URL is required.", true);
  }

  const payload = {
    title: title || "Untitled page",
    pageUrl,
    imageUrls: Array.from(selectedImageUrls),
    imageDetails: Array.from(selectedImageUrls)
      .map((url) => imageDetailsByUrl.get(url))
      .filter(Boolean)
  };

  if (els.includeScreenshot.checked && cropState.sourceImage) {
    payload.screenshotDataUrl = els.canvas.toDataURL("image/png");
  }

  try {
    const saved = await sendMessage({ type: "sidepanel:add-bookmark", payload });
    await sendMessage({ type: "bookmark-draft:delete", payload: { draftId } });
    setStatus(`Saved URL: ${saved.title}`);
    setTimeout(() => closeWindow(), 180);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
