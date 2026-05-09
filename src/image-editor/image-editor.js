const STORAGE_KEYS = {
  images: "imageAssets"
};

const LAYER_DEFS = [
  { id: "background", name: "Background" },
  { id: "overlay", name: "Overlay" }
];

const state = {
  imageAssets: [],
  activeTool: "brush",
  activeLayerId: "background",
  layers: [],
  selection: null,
  history: [],
  historyIndex: -1,
  isDrawing: false,
  currentAction: "",
  dragStart: null,
  dragOffset: null,
  preview: null,
  stageCanvas: document.createElement("canvas"),
  stageCtx: null
};

let activePointerId = null;

const els = {
  statusText: document.querySelector("#status-text"),
  canvas: document.querySelector("#editor-canvas"),
  cropX: document.querySelector("#crop-x"),
  cropY: document.querySelector("#crop-y"),
  cropW: document.querySelector("#crop-w"),
  cropH: document.querySelector("#crop-h"),
  resizeW: document.querySelector("#resize-w"),
  resizeH: document.querySelector("#resize-h"),
  textInput: document.querySelector("#text-input"),
  primaryColor: document.querySelector("#primary-color"),
  secondaryColor: document.querySelector("#secondary-color"),
  brushSize: document.querySelector("#brush-size"),
  brushSizeLabel: document.querySelector("#brush-size-label"),
  fillShape: document.querySelector("#fill-shape"),
  activeToolLabel: document.querySelector("#active-tool-label"),
  canvasSizeLabel: document.querySelector("#canvas-size-label"),
  pointerPosition: document.querySelector("#pointer-position"),
  layerList: document.querySelector("#layer-list"),
  selectionX: document.querySelector("#selection-x"),
  selectionY: document.querySelector("#selection-y"),
  selectionW: document.querySelector("#selection-w"),
  selectionH: document.querySelector("#selection-h"),
  transformScale: document.querySelector("#transform-scale")
};

const ctx = els.canvas.getContext("2d");
state.stageCtx = state.stageCanvas.getContext("2d");

bindActions();
void init();

async function init() {
  initLayers(640, 360, true);
  renderAll();
  await refreshState();
  renderAll();
  await loadAssetFromQuery();
}

function bindActions() {
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.getAttribute("data-tool") || "brush";
      setActiveTool(tool);
    });
  });

  els.brushSize.addEventListener("input", () => {
    els.brushSizeLabel.textContent = `${els.brushSize.value} px`;
  });

  document.querySelector("#undo-edit").addEventListener("click", () => {
    void restoreHistoryStep(state.historyIndex - 1);
  });

  document.querySelector("#redo-edit").addEventListener("click", () => {
    void restoreHistoryStep(state.historyIndex + 1);
  });

  document.querySelector("#clear-canvas").addEventListener("click", () => {
    commitHistorySnapshot();
    clearAllLayers();
    clearSelection();
    renderComposite();
    commitHistorySnapshot("Canvas cleared.");
  });

  document.querySelector("#apply-background").addEventListener("click", () => {
    commitHistorySnapshot();
    const layer = getLayer("background");
    layer.ctx.save();
    layer.ctx.fillStyle = els.secondaryColor.value;
    layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.ctx.restore();
    renderComposite();
    commitHistorySnapshot("Background filled.");
  });

  document.querySelector("#crop-image").addEventListener("click", () => {
    const x = toNumber(els.cropX.value, 0);
    const y = toNumber(els.cropY.value, 0);
    const w = toNumber(els.cropW.value, getCanvasWidth());
    const h = toNumber(els.cropH.value, getCanvasHeight());
    commitHistorySnapshot();
    commitSelection();
    applyCrop(x, y, w, h);
    commitHistorySnapshot("Image cropped.");
  });

  document.querySelector("#resize-image").addEventListener("click", () => {
    const w = toNumber(els.resizeW.value, getCanvasWidth());
    const h = toNumber(els.resizeH.value, getCanvasHeight());
    commitHistorySnapshot();
    commitSelection();
    applyResize(w, h);
    commitHistorySnapshot("Image resized.");
  });

  document.querySelector("#save-edited-image").addEventListener("click", async () => {
    renderStage();
    const dataUrl = state.stageCanvas.toDataURL("image/png");
    setStatus("Saving edited image...");
    try {
      const saved = await sendMessage({
        type: "sidepanel:add-image",
        payload: { sourceUrl: dataUrl, title: "Edited image" }
      });
      state.imageAssets.unshift(saved);
      setStatus("Edited image saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.querySelector("#merge-overlay").addEventListener("click", () => {
    commitHistorySnapshot();
    mergeOverlayIntoBackground();
    commitHistorySnapshot("Overlay merged into background.");
  });

  document.querySelector("#clear-active-layer").addEventListener("click", () => {
    commitHistorySnapshot();
    clearActiveLayer();
    commitHistorySnapshot("Active layer cleared.");
  });

  document.querySelector("#commit-selection").addEventListener("click", () => {
    commitHistorySnapshot();
    commitSelection();
    renderComposite();
    commitHistorySnapshot("Selection committed.");
  });

  document.querySelector("#clear-selection").addEventListener("click", () => {
    commitHistorySnapshot();
    commitSelection();
    renderComposite();
    commitHistorySnapshot("Selection cleared.");
  });

  document.querySelector("#apply-scale").addEventListener("click", () => {
    const factor = Math.max(0.1, toNumber(els.transformScale.value, 100) / 100);
    commitHistorySnapshot();
    applyScaleTransform(factor);
    commitHistorySnapshot("Scale applied.");
  });

  document.querySelector("#rotate-left").addEventListener("click", () => {
    commitHistorySnapshot();
    applyRotation("left");
    commitHistorySnapshot("Rotated left.");
  });

  document.querySelector("#rotate-right").addEventListener("click", () => {
    commitHistorySnapshot();
    applyRotation("right");
    commitHistorySnapshot("Rotated right.");
  });

  document.querySelector("#flip-horizontal").addEventListener("click", () => {
    commitHistorySnapshot();
    applyFlip("horizontal");
    commitHistorySnapshot("Flipped horizontally.");
  });

  document.querySelector("#flip-vertical").addEventListener("click", () => {
    commitHistorySnapshot();
    applyFlip("vertical");
    commitHistorySnapshot("Flipped vertically.");
  });

  els.layerList.addEventListener("click", (event) => {
    const activateButton = event.target.closest("button[data-layer-activate]");
    if (!(activateButton instanceof HTMLElement)) {
      return;
    }
    const layerId = activateButton.getAttribute("data-layer-activate") || "background";
    state.activeLayerId = layerId;
    renderAll();
    setStatus(`Active layer: ${getLayer(layerId).name}.`);
  });

  els.layerList.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const layerId = input.getAttribute("data-layer-visible") || "";
    if (!layerId) {
      return;
    }
    const layer = getLayer(layerId);
    layer.visible = input.checked;
    renderComposite();
  });

  els.canvas.addEventListener("pointerdown", handlePointerDown);
  els.canvas.addEventListener("pointermove", handlePointerMove);
  els.canvas.addEventListener("pointerup", handlePointerUp);
  els.canvas.addEventListener("pointerleave", handlePointerLeave);
  els.canvas.addEventListener("pointercancel", handlePointerLeave);
}

async function refreshState() {
  const store = await chrome.storage.local.get([STORAGE_KEYS.images]);
  state.imageAssets = Array.isArray(store[STORAGE_KEYS.images]) ? store[STORAGE_KEYS.images] : [];
}

function renderAll() {
  renderLayerList();
  updateCanvasMeta();
  updateSelectionInfo();
  setActiveTool(state.activeTool, false);
  renderComposite();
}

async function loadAssetFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const assetId = params.get("assetId") || "";
  if (!assetId) {
    resetHistory("Blank canvas ready.");
    return;
  }

  const asset = state.imageAssets.find((item) => item.id === assetId);
  if (!asset) {
    return setStatus("Saved image asset not found.", true);
  }

  await loadImageToCanvas(asset.dataUrl || asset.sourceUrl);
  setStatus("Loaded saved image asset.");
}

function renderLayerList() {
  els.layerList.innerHTML = state.layers
    .map((layer) => {
      const activeClass = layer.id === state.activeLayerId ? "active" : "";
      return `
        <div class="layer-row ${activeClass}">
          <button type="button" class="layer-activate" data-layer-activate="${layer.id}" aria-label="Activate ${escapeHtml(layer.name)}"></button>
          <div class="layer-name">${escapeHtml(layer.name)}</div>
          <label class="visibility-toggle">Show <input type="checkbox" data-layer-visible="${layer.id}" ${layer.visible ? "checked" : ""} /></label>
        </div>
      `;
    })
    .join("");
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown error");
  }
  return response.payload;
}

async function loadImageToCanvas(src) {
  try {
    const image = await loadImageElement(src);
    initLayers(image.width, image.height, false);
    clearAllLayers();
    const backgroundLayer = getLayer("background");
    backgroundLayer.ctx.drawImage(image, 0, 0);
    state.activeLayerId = "background";
    state.selection = null;
    syncDimensionInputs();
    renderAll();
    resetHistory("Image loaded.");
  } catch {
    setStatus("Cannot load image for editing.", true);
  }
}

function initLayers(width, height, fillBackground) {
  state.layers = LAYER_DEFS.map((definition) => createLayer(definition.id, definition.name, width, height));
  resizeStage(width, height);
  state.selection = null;
  if (fillBackground) {
    const backgroundLayer = getLayer("background");
    backgroundLayer.ctx.fillStyle = "#ffffff";
    backgroundLayer.ctx.fillRect(0, 0, width, height);
  }
  syncDimensionInputs();
}

function createLayer(id, name, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    id,
    name,
    visible: true,
    canvas,
    ctx: canvas.getContext("2d")
  };
}

function resizeStage(width, height) {
  state.stageCanvas.width = width;
  state.stageCanvas.height = height;
  els.canvas.width = width;
  els.canvas.height = height;
}

function clearAllLayers() {
  state.layers.forEach((layer) => {
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  });
}

function clearActiveLayer() {
  const layer = getActiveLayer();
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  if (state.selection?.sourceLayerId === layer.id) {
    state.selection = null;
  }
  renderComposite();
}

function mergeOverlayIntoBackground() {
  commitSelection();
  const background = getLayer("background");
  const overlay = getLayer("overlay");
  background.ctx.drawImage(overlay.canvas, 0, 0);
  overlay.ctx.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
  state.activeLayerId = "background";
  renderAll();
}

function getLayer(layerId) {
  return state.layers.find((layer) => layer.id === layerId) || state.layers[0];
}

function getActiveLayer() {
  return getLayer(state.activeLayerId);
}

function getCanvasWidth() {
  return state.stageCanvas.width;
}

function getCanvasHeight() {
  return state.stageCanvas.height;
}

function setActiveTool(tool, announce = true) {
  state.activeTool = tool;
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-tool") === tool);
  });
  els.canvas.style.cursor = tool === "text" ? "text" : tool === "eyedropper" ? "copy" : "crosshair";
  els.activeToolLabel.textContent = `Tool: ${capitalize(tool)}`;
  if (announce) {
    setStatus(`${capitalize(tool)} tool active.`);
  }
  renderComposite();
}

function handlePointerDown(event) {
  if (event.button !== 0) {
    return;
  }

  const point = getCanvasPoint(event);
  updatePointerPosition(point);

  if (state.activeTool === "eyedropper") {
    applyEyedropper(point);
    return;
  }

  if (state.activeTool === "fill") {
    commitHistorySnapshot();
    applyFloodFill(point);
    renderComposite();
    commitHistorySnapshot("Area filled.");
    return;
  }

  if (state.activeTool === "text") {
    commitHistorySnapshot();
    placeText(point);
    renderComposite();
    commitHistorySnapshot("Text added.");
    return;
  }

  if (state.activeTool === "move") {
    if (!state.selection || !pointInSelection(point, state.selection)) {
      return setStatus("Create a selection first.", true);
    }
    beginMoveSelection(event, point);
    return;
  }

  if (state.activeTool === "select") {
    if (state.selection && pointInSelection(point, state.selection)) {
      beginMoveSelection(event, point);
      return;
    }
    if (state.selection) {
      commitSelection();
    }
    beginPreviewAction(event, point, "marquee");
    return;
  }

  if (state.activeTool === "brush" || state.activeTool === "eraser" || state.activeTool === "spray") {
    commitHistorySnapshot();
    startPointerAction(event, point, state.activeTool);
    if (state.activeTool === "spray") {
      sprayPaint(point);
    } else {
      drawStroke(point, point);
    }
    renderComposite();
    return;
  }

  if (isShapeTool(state.activeTool)) {
    commitHistorySnapshot();
    beginPreviewAction(event, point, "shape");
  }
}

function handlePointerMove(event) {
  const point = getCanvasPoint(event);
  updatePointerPosition(point);

  if (!state.isDrawing || event.pointerId !== activePointerId) {
    return;
  }

  if (state.currentAction === "brush" || state.currentAction === "eraser") {
    drawStroke(state.dragStart, point);
    state.dragStart = point;
    renderComposite();
    return;
  }

  if (state.currentAction === "spray") {
    sprayPaint(point);
    state.dragStart = point;
    renderComposite();
    return;
  }

  if (state.currentAction === "move-selection" && state.selection) {
    state.selection.x = clamp(point.x - state.dragOffset.x, 0, Math.max(0, getCanvasWidth() - state.selection.width));
    state.selection.y = clamp(point.y - state.dragOffset.y, 0, Math.max(0, getCanvasHeight() - state.selection.height));
    updateSelectionInfo();
    renderComposite();
    return;
  }

  if (state.preview) {
    state.preview.end = point;
    renderComposite();
  }
}

function handlePointerUp(event) {
  if (!state.isDrawing || event.pointerId !== activePointerId) {
    return;
  }

  const point = getCanvasPoint(event);

  if (state.currentAction === "marquee") {
    const selectionRect = rectFromPoints(state.preview.start, point);
    state.preview = null;
    state.isDrawing = false;
    releasePointer(event);
    if (selectionRect.width < 2 || selectionRect.height < 2) {
      renderComposite();
      return;
    }
    commitHistorySnapshot();
    createSelection(selectionRect);
    renderComposite();
    commitHistorySnapshot("Selection created.");
    return;
  }

  if (state.currentAction === "shape" && state.preview) {
    drawShapeToLayer(state.preview.start, point, state.activeTool);
    state.preview = null;
    state.isDrawing = false;
    releasePointer(event);
    renderComposite();
    commitHistorySnapshot(`${capitalize(state.activeTool)} applied.`);
    return;
  }

  if (state.currentAction === "move-selection") {
    state.isDrawing = false;
    state.dragStart = null;
    state.dragOffset = null;
    releasePointer(event);
    renderComposite();
    commitHistorySnapshot("Selection moved.");
    return;
  }

  state.isDrawing = false;
  state.dragStart = null;
  releasePointer(event);
  renderComposite();
  commitHistorySnapshot(`${capitalize(state.currentAction)} applied.`);
}

function handlePointerLeave(event) {
  if (state.isDrawing && event.pointerId === activePointerId) {
    handlePointerUp(event);
    return;
  }
  els.pointerPosition.textContent = "Pointer: -, -";
}

function startPointerAction(event, point, action) {
  activePointerId = event.pointerId;
  state.isDrawing = true;
  state.currentAction = action;
  state.dragStart = point;
  state.dragOffset = null;
  els.canvas.setPointerCapture(event.pointerId);
}

function beginPreviewAction(event, point, kind) {
  startPointerAction(event, point, kind);
  state.preview = { kind, start: point, end: point };
}

function beginMoveSelection(event, point) {
  startPointerAction(event, point, "move-selection");
  state.dragOffset = {
    x: point.x - state.selection.x,
    y: point.y - state.selection.y
  };
}

function renderComposite() {
  renderStage();
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.drawImage(state.stageCanvas, 0, 0);
  if (state.preview?.kind === "shape") {
    drawShapePreview(ctx, state.preview.start, state.preview.end, state.activeTool);
  }
  if (state.preview?.kind === "marquee") {
    drawMarqueeRect(ctx, rectFromPoints(state.preview.start, state.preview.end));
  }
  if (state.selection) {
    drawSelectionOutline(ctx, state.selection);
  }
  updateCanvasMeta();
  updateSelectionInfo();
}

function renderStage() {
  state.stageCtx.clearRect(0, 0, state.stageCanvas.width, state.stageCanvas.height);
  state.layers.forEach((layer) => {
    if (layer.visible) {
      state.stageCtx.drawImage(layer.canvas, 0, 0);
    }
  });
  if (state.selection) {
    state.stageCtx.drawImage(state.selection.canvas, state.selection.x, state.selection.y);
  }
}

function drawStroke(from, to) {
  const layer = getActiveLayer();
  layer.ctx.save();
  layer.ctx.lineCap = "round";
  layer.ctx.lineJoin = "round";
  layer.ctx.lineWidth = getBrushSize();
  layer.ctx.strokeStyle = state.currentAction === "eraser" ? els.secondaryColor.value : els.primaryColor.value;
  layer.ctx.beginPath();
  layer.ctx.moveTo(from.x, from.y);
  layer.ctx.lineTo(to.x, to.y);
  layer.ctx.stroke();
  layer.ctx.restore();
}

function sprayPaint(point) {
  const layer = getActiveLayer();
  const radius = Math.max(4, getBrushSize() * 1.5);
  const density = Math.max(12, getBrushSize() * 4);
  layer.ctx.save();
  layer.ctx.fillStyle = els.primaryColor.value;
  for (let index = 0; index < density; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius;
    const x = point.x + Math.cos(angle) * distance;
    const y = point.y + Math.sin(angle) * distance;
    layer.ctx.fillRect(x, y, 1.5, 1.5);
  }
  layer.ctx.restore();
}

function drawShapeToLayer(start, end, tool) {
  const layer = getActiveLayer();
  drawShapePreview(layer.ctx, start, end, tool);
}

function drawShapePreview(targetCtx, start, end, tool) {
  targetCtx.save();
  targetCtx.lineWidth = getBrushSize();
  targetCtx.strokeStyle = els.primaryColor.value;
  targetCtx.fillStyle = els.primaryColor.value;

  if (tool === "line") {
    targetCtx.beginPath();
    targetCtx.moveTo(start.x, start.y);
    targetCtx.lineTo(end.x, end.y);
    targetCtx.stroke();
  }

  if (tool === "rectangle") {
    const { x, y, width, height } = rectFromPoints(start, end);
    if (els.fillShape.checked) {
      targetCtx.fillRect(x, y, width, height);
    } else {
      targetCtx.strokeRect(x, y, width, height);
    }
  }

  if (tool === "ellipse") {
    const { centerX, centerY, radiusX, radiusY } = ellipseFromPoints(start, end);
    targetCtx.beginPath();
    targetCtx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    if (els.fillShape.checked) {
      targetCtx.fill();
    } else {
      targetCtx.stroke();
    }
  }

  targetCtx.restore();
}

function placeText(point) {
  const text = (els.textInput.value || "").trim();
  if (!text) {
    setStatus("Enter text before placing it.", true);
    return;
  }

  const layer = getActiveLayer();
  layer.ctx.save();
  layer.ctx.fillStyle = els.primaryColor.value;
  layer.ctx.font = `${Math.max(12, getBrushSize() * 4)}px IBM Plex Sans, Segoe UI, sans-serif`;
  layer.ctx.textBaseline = "top";
  layer.ctx.fillText(text, point.x, point.y);
  layer.ctx.restore();
}

function applyEyedropper(point) {
  renderStage();
  const pixel = state.stageCtx.getImageData(clamp(point.x, 0, getCanvasWidth() - 1), clamp(point.y, 0, getCanvasHeight() - 1), 1, 1).data;
  const color = rgbToHex(pixel[0], pixel[1], pixel[2]);
  els.primaryColor.value = color;
  setStatus(`Picked color ${color}.`);
}

function applyFloodFill(point) {
  const layer = getActiveLayer();
  const width = layer.canvas.width;
  const height = layer.canvas.height;
  const imageData = layer.ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const startX = clamp(point.x, 0, width - 1);
  const startY = clamp(point.y, 0, height - 1);
  const startIndex = (startY * width + startX) * 4;
  const target = data.slice(startIndex, startIndex + 4);
  const replacement = hexToRgba(els.primaryColor.value);

  if (colorsEqual(target, replacement)) {
    return;
  }

  const stack = [[startX, startY]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    const index = (y * width + x) * 4;
    if (!colorsEqual(data.slice(index, index + 4), target)) {
      continue;
    }
    data[index] = replacement[0];
    data[index + 1] = replacement[1];
    data[index + 2] = replacement[2];
    data[index + 3] = replacement[3];
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  layer.ctx.putImageData(imageData, 0, 0);
}

function createSelection(rect) {
  const layer = getActiveLayer();
  const imageData = layer.ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
  const selectionCanvas = document.createElement("canvas");
  selectionCanvas.width = rect.width;
  selectionCanvas.height = rect.height;
  selectionCanvas.getContext("2d").putImageData(imageData, 0, 0);
  layer.ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
  state.selection = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    sourceLayerId: layer.id,
    canvas: selectionCanvas
  };
}

function commitSelection() {
  if (!state.selection) {
    return;
  }
  const layer = getLayer(state.selection.sourceLayerId);
  layer.ctx.drawImage(state.selection.canvas, state.selection.x, state.selection.y);
  state.selection = null;
}

function clearSelection() {
  state.selection = null;
  updateSelectionInfo();
}

function pointInSelection(point, selection) {
  return point.x >= selection.x && point.x <= selection.x + selection.width && point.y >= selection.y && point.y <= selection.y + selection.height;
}

function drawMarqueeRect(targetCtx, rect) {
  targetCtx.save();
  targetCtx.setLineDash([6, 4]);
  targetCtx.strokeStyle = "#1f2a1f";
  targetCtx.lineWidth = 1;
  targetCtx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width, rect.height);
  targetCtx.restore();
}

function drawSelectionOutline(targetCtx, selection) {
  drawMarqueeRect(targetCtx, selection);
  const handles = getSelectionHandles(selection);
  targetCtx.save();
  targetCtx.fillStyle = "#ffffff";
  targetCtx.strokeStyle = "#2f5f4f";
  handles.forEach((handle) => {
    targetCtx.fillRect(handle.x - 4, handle.y - 4, 8, 8);
    targetCtx.strokeRect(handle.x - 4, handle.y - 4, 8, 8);
  });
  targetCtx.restore();
}

function getSelectionHandles(selection) {
  return [
    { x: selection.x, y: selection.y },
    { x: selection.x + selection.width, y: selection.y },
    { x: selection.x, y: selection.y + selection.height },
    { x: selection.x + selection.width, y: selection.y + selection.height }
  ];
}

function applyScaleTransform(factor) {
  if (state.selection) {
    transformSelection((canvas) => scaleCanvas(canvas, factor));
    return;
  }
  transformDocument((canvas) => scaleCanvas(canvas, factor), Math.max(1, Math.round(getCanvasWidth() * factor)), Math.max(1, Math.round(getCanvasHeight() * factor)));
}

function applyRotation(direction) {
  if (state.selection) {
    transformSelection((canvas) => rotateCanvas(canvas, direction));
    return;
  }
  transformDocument((canvas) => rotateCanvas(canvas, direction), getCanvasHeight(), getCanvasWidth());
}

function applyFlip(direction) {
  if (state.selection) {
    transformSelection((canvas) => flipCanvas(canvas, direction));
    return;
  }
  transformDocument((canvas) => flipCanvas(canvas, direction), getCanvasWidth(), getCanvasHeight());
}

function transformSelection(transformer) {
  if (!state.selection) {
    return setStatus("Create a selection first.", true);
  }
  const centerX = state.selection.x + state.selection.width / 2;
  const centerY = state.selection.y + state.selection.height / 2;
  const nextCanvas = transformer(state.selection.canvas);
  state.selection.canvas = nextCanvas;
  state.selection.width = nextCanvas.width;
  state.selection.height = nextCanvas.height;
  state.selection.x = clamp(Math.round(centerX - nextCanvas.width / 2), 0, Math.max(0, getCanvasWidth() - nextCanvas.width));
  state.selection.y = clamp(Math.round(centerY - nextCanvas.height / 2), 0, Math.max(0, getCanvasHeight() - nextCanvas.height));
  renderComposite();
}

function transformDocument(transformer, nextWidth, nextHeight) {
  commitSelection();
  state.layers = state.layers.map((layer) => {
    const nextCanvas = transformer(layer.canvas);
    const nextLayer = createLayer(layer.id, layer.name, nextWidth, nextHeight);
    nextLayer.visible = layer.visible;
    nextLayer.ctx.drawImage(nextCanvas, 0, 0);
    return nextLayer;
  });
  resizeStage(nextWidth, nextHeight);
  syncDimensionInputs();
  renderAll();
}

function scaleCanvas(sourceCanvas, factor) {
  const target = document.createElement("canvas");
  target.width = Math.max(1, Math.round(sourceCanvas.width * factor));
  target.height = Math.max(1, Math.round(sourceCanvas.height * factor));
  target.getContext("2d").drawImage(sourceCanvas, 0, 0, target.width, target.height);
  return target;
}

function rotateCanvas(sourceCanvas, direction) {
  const target = document.createElement("canvas");
  target.width = sourceCanvas.height;
  target.height = sourceCanvas.width;
  const targetCtx = target.getContext("2d");
  targetCtx.translate(target.width / 2, target.height / 2);
  targetCtx.rotate(direction === "left" ? -Math.PI / 2 : Math.PI / 2);
  targetCtx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return target;
}

function flipCanvas(sourceCanvas, direction) {
  const target = document.createElement("canvas");
  target.width = sourceCanvas.width;
  target.height = sourceCanvas.height;
  const targetCtx = target.getContext("2d");
  if (direction === "horizontal") {
    targetCtx.translate(target.width, 0);
    targetCtx.scale(-1, 1);
  } else {
    targetCtx.translate(0, target.height);
    targetCtx.scale(1, -1);
  }
  targetCtx.drawImage(sourceCanvas, 0, 0);
  return target;
}

function applyCrop(x, y, w, h) {
  const clampedX = clamp(x, 0, getCanvasWidth() - 1);
  const clampedY = clamp(y, 0, getCanvasHeight() - 1);
  const clampedW = clamp(w, 1, getCanvasWidth() - clampedX);
  const clampedH = clamp(h, 1, getCanvasHeight() - clampedY);
  state.layers = state.layers.map((layer) => {
    const nextLayer = createLayer(layer.id, layer.name, clampedW, clampedH);
    nextLayer.visible = layer.visible;
    nextLayer.ctx.drawImage(layer.canvas, clampedX, clampedY, clampedW, clampedH, 0, 0, clampedW, clampedH);
    return nextLayer;
  });
  resizeStage(clampedW, clampedH);
  syncDimensionInputs();
  renderAll();
}

function applyResize(width, height) {
  const nextWidth = Math.max(1, width);
  const nextHeight = Math.max(1, height);
  state.layers = state.layers.map((layer) => {
    const nextLayer = createLayer(layer.id, layer.name, nextWidth, nextHeight);
    nextLayer.visible = layer.visible;
    nextLayer.ctx.drawImage(layer.canvas, 0, 0, nextWidth, nextHeight);
    return nextLayer;
  });
  resizeStage(nextWidth, nextHeight);
  syncDimensionInputs();
  renderAll();
}

function updatePointerPosition(point) {
  els.pointerPosition.textContent = `Pointer: ${point.x}, ${point.y}`;
}

function updateCanvasMeta() {
  els.canvasSizeLabel.textContent = `Canvas: ${getCanvasWidth()} x ${getCanvasHeight()}`;
}

function updateSelectionInfo() {
  els.selectionX.value = state.selection ? String(state.selection.x) : "0";
  els.selectionY.value = state.selection ? String(state.selection.y) : "0";
  els.selectionW.value = state.selection ? String(state.selection.width) : "0";
  els.selectionH.value = state.selection ? String(state.selection.height) : "0";
}

function syncDimensionInputs() {
  els.resizeW.value = String(getCanvasWidth());
  els.resizeH.value = String(getCanvasHeight());
  els.cropX.value = "0";
  els.cropY.value = "0";
  els.cropW.value = String(getCanvasWidth());
  els.cropH.value = String(getCanvasHeight());
}

function commitHistorySnapshot(statusText) {
  const snapshot = serializeEditorState();
  const current = state.history[state.historyIndex];
  if (current && current.signature === snapshot.signature) {
    if (statusText) {
      setStatus(statusText);
    }
    return;
  }
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  if (state.history.length > 30) {
    state.history.shift();
  }
  state.historyIndex = state.history.length - 1;
  if (statusText) {
    setStatus(statusText);
  }
}

function resetHistory(statusText) {
  state.history = [];
  state.historyIndex = -1;
  commitHistorySnapshot(statusText);
}

function serializeEditorState() {
  const layers = state.layers.map((layer) => ({
    id: layer.id,
    visible: layer.visible,
    dataUrl: layer.canvas.toDataURL("image/png")
  }));
  const selection = state.selection
    ? {
        x: state.selection.x,
        y: state.selection.y,
        width: state.selection.width,
        height: state.selection.height,
        sourceLayerId: state.selection.sourceLayerId,
        dataUrl: state.selection.canvas.toDataURL("image/png")
      }
    : null;
  return {
    width: getCanvasWidth(),
    height: getCanvasHeight(),
    activeLayerId: state.activeLayerId,
    layers,
    selection,
    signature: JSON.stringify({
      width: getCanvasWidth(),
      height: getCanvasHeight(),
      activeLayerId: state.activeLayerId,
      layers: layers.map((layer) => [layer.id, layer.visible, layer.dataUrl]),
      selection
    })
  };
}

async function restoreHistoryStep(index) {
  if (index < 0 || index >= state.history.length) {
    return;
  }
  const snapshot = state.history[index];
  state.layers = await Promise.all(
    snapshot.layers.map(async (layerSnapshot) => {
      const layerDef = LAYER_DEFS.find((item) => item.id === layerSnapshot.id) || { id: layerSnapshot.id, name: capitalize(layerSnapshot.id) };
      const layer = createLayer(layerSnapshot.id, layerDef.name, snapshot.width, snapshot.height);
      layer.visible = layerSnapshot.visible;
      await drawDataUrlToCanvas(layerSnapshot.dataUrl, layer.canvas);
      return layer;
    })
  );
  resizeStage(snapshot.width, snapshot.height);
  state.activeLayerId = snapshot.activeLayerId;
  if (snapshot.selection) {
    const selectionCanvas = document.createElement("canvas");
    selectionCanvas.width = snapshot.selection.width;
    selectionCanvas.height = snapshot.selection.height;
    await drawDataUrlToCanvas(snapshot.selection.dataUrl, selectionCanvas);
    state.selection = {
      x: snapshot.selection.x,
      y: snapshot.selection.y,
      width: snapshot.selection.width,
      height: snapshot.selection.height,
      sourceLayerId: snapshot.selection.sourceLayerId,
      canvas: selectionCanvas
    };
  } else {
    state.selection = null;
  }
  state.historyIndex = index;
  syncDimensionInputs();
  renderAll();
  setStatus(index < state.history.length - 1 ? "History restored." : "Latest version restored.");
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

function rectFromPoints(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y))
  };
}

function ellipseFromPoints(start, end) {
  const { x, y, width, height } = rectFromPoints(start, end);
  return {
    centerX: x + width / 2,
    centerY: y + height / 2,
    radiusX: Math.max(1, width / 2),
    radiusY: Math.max(1, height / 2)
  };
}

function isShapeTool(tool) {
  return tool === "line" || tool === "rectangle" || tool === "ellipse";
}

function getBrushSize() {
  return Math.max(1, toNumber(els.brushSize.value, 6));
}

function colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function hexToRgba(hex) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255
  ];
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function drawDataUrlToCanvas(dataUrl, targetCanvas) {
  const image = await loadImageElement(dataUrl);
  const targetCtx = targetCanvas.getContext("2d");
  targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetCtx.drawImage(image, 0, 0, targetCanvas.width, targetCanvas.height);
}

function releasePointer(event) {
  if (activePointerId !== null) {
    try {
      els.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release errors when pointer capture was lost.
    }
  }
  activePointerId = null;
  state.currentAction = "";
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
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

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = src;
  });
}
