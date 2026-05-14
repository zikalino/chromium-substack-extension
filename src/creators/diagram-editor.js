import { getAssetIdFromQuery, getImageAssetById, saveCanvasAsImage, setStatus } from "./shared.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SIDE_PANEL_IMAGE_MIME = "application/x-substack-image-asset";

const els = {
  statusText: document.querySelector("#status-text"),
  canvasWrap: document.querySelector("#canvas-wrap"),
  svg: document.querySelector("#diagram-svg"),
  svgDefs: document.querySelector("#diagram-svg defs"),
  shapeLayer: document.querySelector("#shape-layer"),
  selectionLayer: document.querySelector("#selection-layer"),
  fillColor: document.querySelector("#fill-color"),
  fillTransparencyRange: document.querySelector("#fill-transparency-range"),
  fillTransparencyNumber: document.querySelector("#fill-transparency-number"),
  strokeColor: document.querySelector("#stroke-color"),
  lineTransparencyRange: document.querySelector("#line-transparency-range"),
  lineTransparencyNumber: document.querySelector("#line-transparency-number"),
  strokeWidth: document.querySelector("#stroke-width"),
  lineSketchStyle: document.querySelector("#line-sketch-style"),
  lineCompoundType: document.querySelector("#line-compound-type"),
  lineDashType: document.querySelector("#line-dash-type"),
  lineCapType: document.querySelector("#line-cap-type"),
  lineJoinType: document.querySelector("#line-join-type"),
  textValue: document.querySelector("#text-value"),
  textSize: document.querySelector("#text-size"),
  textAlign: document.querySelector("#text-align"),
  gridRows: document.querySelector("#grid-rows"),
  gridCols: document.querySelector("#grid-cols"),
  alignButtons: document.querySelectorAll(".align-btn"),
  fillModeInputs: document.querySelectorAll('input[name="fill-mode"]'),
  lineModeInputs: document.querySelectorAll('input[name="line-mode"]')
};

const DEFAULT_SHAPE_STYLE = {
  fillMode: "solid",
  fill: "#e7f2ec",
  fillOpacity: 1,
  lineMode: "solid",
  stroke: "#2f5f4f",
  strokeWidth: 2,
  strokeOpacity: 1,
  lineSketchStyle: "none",
  lineCompoundType: "single",
  lineDashType: "solid",
  lineCapType: "butt",
  lineJoinType: "miter",
  text: "Text",
  textSize: 22,
  textAlign: "middle"
};

const state = {
  tool: "select",
  selectedId: "",
  selectedIds: new Set(),
  shapes: [],
  clipboardShapes: [],
  drag: null,
  resize: null,
  rotate: null,
  marquee: null,
  suppressClick: false,
  textEditor: null
};

bindActions();
void init();

async function init() {
  await restoreSavedDiagramEditor();
  renderShapes();
}

function bindActions() {
  setTextAlignValue(els.textAlign.value || "middle");
  setFillMode(getCheckedValue(els.fillModeInputs, "solid"));
  setLineMode(getCheckedValue(els.lineModeInputs, "solid"));
  setImageGridControlsEnabled(false, false);

  bindTransparencyPair(els.fillTransparencyRange, els.fillTransparencyNumber);
  bindTransparencyPair(els.lineTransparencyRange, els.lineTransparencyNumber);

  document.querySelectorAll(".tool-btn").forEach((button) => {
    const tooltip = button.getAttribute("title") || button.getAttribute("aria-label") || "";
    if (tooltip) {
      button.setAttribute("data-tooltip", tooltip);
    }
    button.removeAttribute("title");

    button.addEventListener("click", () => {
      state.tool = button.getAttribute("data-tool") || "select";
      document.querySelectorAll(".tool-btn").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      els.svg.classList.toggle("select-mode", state.tool === "select");
      setStatus(els.statusText, `Tool: ${state.tool}`);
    });
  });

  els.alignButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const align = button.getAttribute("data-align") || "middle";
      setTextAlignValue(align);
      applyStyleToSelectedShapes();
    });
  });

  els.fillModeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      setFillMode(input.value);
      applyStyleToSelectedShapes();
    });
  });

  els.lineModeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      setLineMode(input.value);
      applyStyleToSelectedShapes();
    });
  });

  els.fillColor.addEventListener("input", () => applyStyleToSelectedShapes());
  els.strokeColor.addEventListener("input", () => applyStyleToSelectedShapes());
  els.strokeWidth.addEventListener("input", () => applyStyleToSelectedShapes());
  els.lineSketchStyle.addEventListener("change", () => applyStyleToSelectedShapes());
  els.lineCompoundType.addEventListener("change", () => applyStyleToSelectedShapes());
  els.lineDashType.addEventListener("change", () => applyStyleToSelectedShapes());
  els.lineCapType.addEventListener("change", () => applyStyleToSelectedShapes());
  els.lineJoinType.addEventListener("change", () => applyStyleToSelectedShapes());
  els.textValue.addEventListener("input", () => applyStyleToSelectedShapes());
  els.textSize.addEventListener("input", () => applyStyleToSelectedShapes());
  els.gridRows.addEventListener("input", () => applyStyleToSelectedShapes());
  els.gridCols.addEventListener("input", () => applyStyleToSelectedShapes());

  els.canvasWrap.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  els.canvasWrap.addEventListener("drop", (event) => {
    if (!event.dataTransfer) {
      return;
    }

    const payload = extractDroppedImagePayload(event.dataTransfer);
    if (!payload?.src) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // If dropped onto an existing containable shape, make it an image frame.
    const shapeGroup = event.target.closest("g.shape-group");
    if (shapeGroup) {
      const id = shapeGroup.getAttribute("data-id");
      const existing = getShapeById(id);
      if (existing && isMultiImageShapeType(existing.type)) {
        addImageToMultiShape(existing, payload);
        state.selectedIds.clear();
        state.selectedIds.add(existing.id);
        state.selectedId = existing.id;
        renderShapes();
        syncStyleInputs();
        setStatus(els.statusText, "Image added to grid slot.");
        return;
      }
      if (existing && !isLineShape(existing.type) && existing.type !== "image") {
        existing.imageSrc = payload.src;
        existing.imageTitle = payload.title || "image";
        existing.imageMode = "frame";
        existing.sourceAssetId = payload.id || "";
        state.selectedIds.clear();
        state.selectedIds.add(existing.id);
        state.selectedId = existing.id;
        renderShapes();
        syncStyleInputs();
        setStatus(els.statusText, "Image applied to shape.");
        return;
      }
    }

    const point = pointerToSvg(event);
    if (!point) {
      return;
    }

    createDroppedImageShape(point.x, point.y, payload);
  });

  els.svg.addEventListener("click", (event) => {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }

    const point = pointerToSvg(event);
    if (!point) return;

    const shapeGroup = event.target.closest("g.shape-group");
    if (shapeGroup) {
      const id = shapeGroup.getAttribute("data-id");
      if (id) {
        if (event.ctrlKey) {
          // Multi-select: toggle shape in selection set
          if (state.selectedIds.has(id)) {
            state.selectedIds.delete(id);
          } else {
            state.selectedIds.add(id);
          }
        } else {
          // Single select: replace selection
          state.selectedIds.clear();
          state.selectedIds.add(id);
        }
        state.selectedId = id; // Keep for backward compat
        syncStyleInputs();
        renderSelection();
      }
      return;
    }

    if (state.tool === "select") {
      state.selectedIds.clear();
      state.selectedId = "";
      renderSelection();
      return;
    }

    createShapeAt(point.x, point.y);
  });

  els.svg.addEventListener("dblclick", (event) => {
    const shapeGroup = event.target.closest("g.shape-group");
    if (!shapeGroup) {
      return;
    }

    const id = shapeGroup.getAttribute("data-id");
    if (!id) {
      return;
    }

    const shape = getShapeById(id);
    if (!shape || !canEditShapeText(shape)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openTextEditor(shape);
  });

  els.svg.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }

    if (state.resize) {
      return;
    }

    if (state.tool !== "select") {
      return;
    }

    const shapeGroup = event.target.closest("g.shape-group");
    if (!shapeGroup) {
      if (state.tool !== "select") {
        return;
      }

      const point = pointerToSvg(event);
      if (!point) {
        return;
      }

      state.marquee = {
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        additive: event.ctrlKey,
        moved: false
      };

      if (!event.ctrlKey) {
        state.selectedIds.clear();
        state.selectedId = "";
      }

      renderSelection();
      return;
    }

    const id = shapeGroup.getAttribute("data-id");
    if (!id) {
      return;
    }

    const point = pointerToSvg(event);
    const shape = getShapeById(id);
    if (!point || !shape) {
      return;
    }

    // Ensure clicked shape participates in drag selection.
    if (!state.selectedIds.has(id)) {
      if (!event.ctrlKey) {
        state.selectedIds.clear();
      }
      state.selectedIds.add(id);
    }

    const draggedShapes = [];
    for (const shapeId of state.selectedIds) {
      const selectedShape = getShapeById(shapeId);
      if (selectedShape) {
        draggedShapes.push({
          id: selectedShape.id,
          x: selectedShape.x,
          y: selectedShape.y
        });
      }
    }

    if (draggedShapes.length === 0) {
      draggedShapes.push({
        id: shape.id,
        x: shape.x,
        y: shape.y
      });
      state.selectedIds.add(shape.id);
    }

    state.selectedId = id;
    state.drag = {
      startX: point.x,
      startY: point.y,
      moved: false,
      shapes: draggedShapes
    };
    syncStyleInputs();
    renderSelection();
  });

  els.selectionLayer.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!(target instanceof SVGElement)) {
      return;
    }

    const handle = target.getAttribute("data-handle");
    const shapeId = target.getAttribute("data-shape-id");
    if (!handle || !shapeId) {
      return;
    }

    const shape = getShapeById(shapeId);
    const point = pointerToSvg(event);
    if (!shape || !point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    state.selectedId = shapeId;
    state.selectedIds.clear();
    state.selectedIds.add(shapeId);

    if (handle === "rotate") {
      const center = getShapeCenter(shape);
      const startAngle = Math.atan2(point.y - center.y, point.x - center.x);
      state.rotate = {
        id: shapeId,
        centerX: center.x,
        centerY: center.y,
        startAngle,
        rotation: toNumber(shape.rotation, 0),
        moved: false
      };
      renderSelection();
      return;
    }

    state.resize = {
      id: shapeId,
      handle,
      startX: point.x,
      startY: point.y,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      flippedX: Boolean(shape.flippedX),
      flippedY: Boolean(shape.flippedY)
    };
  });

  window.addEventListener("mousemove", (event) => {
    if (state.rotate) {
      const point = pointerToSvg(event);
      if (!point) {
        return;
      }

      const shape = getShapeById(state.rotate.id);
      if (!shape) {
        return;
      }

      const currentAngle = Math.atan2(point.y - state.rotate.centerY, point.x - state.rotate.centerX);
      const delta = ((currentAngle - state.rotate.startAngle) * 180) / Math.PI;
      shape.rotation = normalizeRotation(state.rotate.rotation + delta);
      if (Math.abs(delta) > 0.5) {
        state.rotate.moved = true;
      }
      renderShapes();
      return;
    }

    if (state.resize) {
      const point = pointerToSvg(event);
      if (!point) {
        return;
      }

      const shape = getShapeById(state.resize.id);
      if (!shape) {
        return;
      }

      applyResizeDrag(shape, state.resize, point.x, point.y);
      renderShapes();
      return;
    }

    if (!state.drag) {
      if (state.marquee) {
        const point = pointerToSvg(event);
        if (!point) {
          return;
        }

        state.marquee.currentX = point.x;
        state.marquee.currentY = point.y;
        if (Math.abs(point.x - state.marquee.startX) > 2 || Math.abs(point.y - state.marquee.startY) > 2) {
          state.marquee.moved = true;
        }
        renderSelection();
      }
      return;
    }

    const point = pointerToSvg(event);
    if (!point) {
      return;
    }

    const dx = point.x - state.drag.startX;
    const dy = point.y - state.drag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      state.drag.moved = true;
    }

    for (const dragged of state.drag.shapes) {
      const shape = getShapeById(dragged.id);
      if (!shape) {
        continue;
      }
      shape.x = Math.max(0, dragged.x + dx);
      shape.y = Math.max(0, dragged.y + dy);
    }
    renderShapes();
  });

  window.addEventListener("mouseup", () => {
    if (state.rotate) {
      if (state.rotate.moved) {
        state.suppressClick = true;
        setStatus(els.statusText, "Shape rotated.");
      }
      state.rotate = null;
    }

    if (state.resize) {
      state.resize = null;
      setStatus(els.statusText, "Shape resized.");
    }

    if (state.drag) {
      if (state.drag.moved) {
        state.suppressClick = true;
        setStatus(els.statusText, "Shape moved.");
      }
      state.drag = null;
    }

    if (state.marquee) {
      const { startX, startY, currentX, currentY, additive, moved } = state.marquee;
      if (moved) {
        const minX = Math.min(startX, currentX);
        const minY = Math.min(startY, currentY);
        const maxX = Math.max(startX, currentX);
        const maxY = Math.max(startY, currentY);

        const hits = state.shapes.filter((shape) => {
          const b = getShapeBounds(shape);
          const shapeMinX = b.x;
          const shapeMinY = b.y;
          const shapeMaxX = b.x + b.width;
          const shapeMaxY = b.y + b.height;
          return shapeMaxX >= minX && shapeMinX <= maxX && shapeMaxY >= minY && shapeMinY <= maxY;
        });

        if (!additive) {
          state.selectedIds.clear();
        }

        for (const shape of hits) {
          state.selectedIds.add(shape.id);
        }

        state.selectedId = hits.length > 0 ? hits[hits.length - 1].id : "";
        state.suppressClick = true;
        renderShapes();
        setStatus(els.statusText, `${hits.length} shape(s) selected.`);
      }

      state.marquee = null;
      renderSelection();
    }
  });

  document.querySelector("#btn-delete").addEventListener("click", () => {
    if (state.selectedIds.size === 0) {
      return setStatus(els.statusText, "Select shape(s) to delete.", true);
    }

    state.shapes = state.shapes.filter((shape) => !state.selectedIds.has(shape.id));
    state.selectedIds.clear();
    state.selectedId = "";
    renderShapes();
    setStatus(els.statusText, "Shape(s) deleted.");
  });

  document.querySelector("#btn-duplicate").addEventListener("click", () => {
    if (state.selectedIds.size === 0) {
      return setStatus(els.statusText, "Select shape(s) to duplicate.", true);
    }

    const selectedShapes = state.shapes.filter((shape) => state.selectedIds.has(shape.id));
    state.selectedIds.clear();
    
    for (const shape of selectedShapes) {
      const copy = {
        ...JSON.parse(JSON.stringify(shape)),
        id: crypto.randomUUID(),
        x: shape.x + 30,
        y: shape.y + 24
      };
      state.shapes.push(copy);
      state.selectedIds.add(copy.id);
      state.selectedId = copy.id;
    }
    
    renderShapes();
    setStatus(els.statusText, `Duplicated ${selectedShapes.length} shape(s).`);
  });

  document.querySelector("#btn-clear").addEventListener("click", () => {
    state.shapes = [];
    state.selectedIds.clear();
    state.selectedId = "";
    renderShapes();
    setStatus(els.statusText, "Canvas cleared.");
  });

  document.querySelector("#btn-crop").addEventListener("click", () => {
    cropCanvas();
  });

  document.querySelector("#btn-export-png").addEventListener("click", () => {
    exportSvgToCanvas({ download: true })
      .then(() => setStatus(els.statusText, "PNG exported."))
      .catch((error) => setStatus(els.statusText, error.message, true));
  });

  document.querySelector("#btn-save-assets").addEventListener("click", async () => {
    try {
      const canvas = await exportSvgToCanvas({ download: false });
      await saveCanvasAsImage(canvas, "Diagram Editor", els.statusText, {
        assetType: "diagram-editor",
        editor: {
          type: "diagram-editor",
          path: "src/creators/diagram-editor.html"
        },
        editorState: {
          shapes: state.shapes,
          tool: state.tool,
          selectedId: state.selectedId,
          selectedIds: Array.from(state.selectedIds),
          fillColor: els.fillColor.value,
          strokeColor: els.strokeColor.value,
          strokeWidth: els.strokeWidth.value,
          fillTransparency: els.fillTransparencyNumber.value,
          lineTransparency: els.lineTransparencyNumber.value,
          lineSketchStyle: els.lineSketchStyle.value,
          lineCompoundType: els.lineCompoundType.value,
          lineDashType: els.lineDashType.value,
          lineCapType: els.lineCapType.value,
          lineJoinType: els.lineJoinType.value,
          textValue: els.textValue.value,
          textSize: els.textSize.value,
          textAlign: els.textAlign.value,
          fillMode: getCheckedValue(els.fillModeInputs, "solid"),
          lineMode: getCheckedValue(els.lineModeInputs, "solid")
        }
      });
    } catch (error) {
      setStatus(els.statusText, error.message, true);
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (event) => {
    // Delete key: delete all selected shapes
    if (event.key === "Delete") {
      if (state.textEditor?.element || isTextInputTarget(event.target)) {
        return;
      }

      if (state.selectedIds.size === 0) {
        return;
      }
      event.preventDefault();
      state.shapes = state.shapes.filter((shape) => !state.selectedIds.has(shape.id));
      state.selectedIds.clear();
      state.selectedId = "";
      renderShapes();
      setStatus(els.statusText, "Shape(s) deleted.");
      return;
    }

    // Ctrl+C: copy selected shapes
    if ((event.ctrlKey || event.metaKey) && event.key === "c") {
      if (state.selectedIds.size === 0) {
        return;
      }
      event.preventDefault();
      const selectedShapes = state.shapes.filter((shape) => state.selectedIds.has(shape.id));
      state.clipboardShapes = JSON.parse(JSON.stringify(selectedShapes));
      setStatus(els.statusText, `Copied ${state.clipboardShapes.length} shape(s).`);
      return;
    }

    // Ctrl+V: paste shapes from clipboard
    if ((event.ctrlKey || event.metaKey) && event.key === "v") {
      if (state.clipboardShapes.length === 0) {
        return;
      }
      event.preventDefault();
      
      state.selectedIds.clear();
      const offset = 24;
      
      for (const shape of state.clipboardShapes) {
        const newShape = {
          ...JSON.parse(JSON.stringify(shape)),
          id: crypto.randomUUID(),
          x: shape.x + offset,
          y: shape.y + offset
        };
        state.shapes.push(newShape);
        state.selectedIds.add(newShape.id);
        state.selectedId = newShape.id;
      }
      
      renderShapes();
      setStatus(els.statusText, `Pasted ${state.clipboardShapes.length} shape(s).`);
      return;
    }
  });
}

async function restoreSavedDiagramEditor() {
  const asset = await getImageAssetById(getAssetIdFromQuery());
  const saved = asset?.editorState;
  if (!saved) {
    return;
  }

  state.shapes = Array.isArray(saved.shapes) ? saved.shapes : [];
  state.tool = saved.tool || "select";
  state.selectedId = saved.selectedId || "";
  if (Array.isArray(saved.selectedIds)) {
    state.selectedIds = new Set(saved.selectedIds);
  }
  els.fillColor.value = saved.fillColor || els.fillColor.value;
  els.strokeColor.value = saved.strokeColor || els.strokeColor.value;
  els.strokeWidth.value = saved.strokeWidth || els.strokeWidth.value;
  setTransparencyValue(els.fillTransparencyRange, els.fillTransparencyNumber, saved.fillTransparency ?? els.fillTransparencyNumber.value);
  setTransparencyValue(els.lineTransparencyRange, els.lineTransparencyNumber, saved.lineTransparency ?? els.lineTransparencyNumber.value);
  els.lineSketchStyle.value = saved.lineSketchStyle || els.lineSketchStyle.value;
  els.lineCompoundType.value = saved.lineCompoundType || els.lineCompoundType.value;
  els.lineDashType.value = saved.lineDashType || els.lineDashType.value;
  els.lineCapType.value = saved.lineCapType || els.lineCapType.value;
  els.lineJoinType.value = saved.lineJoinType || els.lineJoinType.value;
  els.textValue.value = saved.textValue || els.textValue.value;
  els.textSize.value = saved.textSize || els.textSize.value;
  setTextAlignValue(saved.textAlign || els.textAlign.value);
  setFillMode(saved.fillMode || getCheckedValue(els.fillModeInputs, "solid"));
  setLineMode(saved.lineMode || getCheckedValue(els.lineModeInputs, "solid"));
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tool") === state.tool);
  });
  els.svg.classList.toggle("select-mode", state.tool === "select");
}

function createShapeAt(x, y) {
  const common = {
    id: crypto.randomUUID(),
    type: state.tool,
    x,
    y,
    width: 170,
    height: 100,
    rotation: 0,
    flippedX: false,
    flippedY: false,
    fillMode: DEFAULT_SHAPE_STYLE.fillMode,
    fill: DEFAULT_SHAPE_STYLE.fill,
    fillOpacity: DEFAULT_SHAPE_STYLE.fillOpacity,
    lineMode: DEFAULT_SHAPE_STYLE.lineMode,
    stroke: DEFAULT_SHAPE_STYLE.stroke,
    strokeWidth: DEFAULT_SHAPE_STYLE.strokeWidth,
    strokeOpacity: DEFAULT_SHAPE_STYLE.strokeOpacity,
    lineSketchStyle: DEFAULT_SHAPE_STYLE.lineSketchStyle,
    lineCompoundType: DEFAULT_SHAPE_STYLE.lineCompoundType,
    lineDashType: DEFAULT_SHAPE_STYLE.lineDashType,
    lineCapType: DEFAULT_SHAPE_STYLE.lineCapType,
    lineJoinType: DEFAULT_SHAPE_STYLE.lineJoinType,
    text: DEFAULT_SHAPE_STYLE.text,
    textSize: DEFAULT_SHAPE_STYLE.textSize,
    textAlign: DEFAULT_SHAPE_STYLE.textAlign
  };

  if (isLineShape(common.type)) {
    common.width = 220;
    common.height = 0;
  }

  if (["square", "circle", "actor", "crescent", "star", "pentagon", "database", "hexagon-flat", "plus", "flowchart-decision"].includes(common.type)) {
    common.width = 110;
    common.height = 110;
  }

  if (["triangle", "hexagon", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "chevron", "parallelogram", "trapezoid", "arrow-left-right", "right-arrow-bold", "bracket-left", "bracket-right"].includes(common.type)) {
    common.width = 180;
    common.height = 110;
  }

  if (["cloud", "speech", "document", "note", "cylinder", "callout-rect", "callout-circle", "flowchart-process", "flowchart-terminator", "flowchart-data", "callout-left", "callout-right", "callout-up", "callout-down", "minus"].includes(common.type)) {
    common.width = 180;
    common.height = 120;
  }

  if (["oval"].includes(common.type)) {
    common.width = 180;
    common.height = 100;
  }

  if (common.type === "wave") {
    common.width = 200;
    common.height = 60;
    common.fillMode = "none";
    common.fill = "transparent";
  }

  if (common.type === "dashed-line") {
    common.lineDashType = "dash";
  }

  if (common.type === "text") {
    common.fillMode = "none";
    common.fill = "transparent";
    common.lineMode = "none";
    common.stroke = "transparent";
    common.width = 200;
    common.height = 60;
  }

  if (common.type === "image-grid") {
    common.width = 300;
    common.height = 240;
    common.gridRows = 3;
    common.gridCols = 3;
    common.imageCells = Array(9).fill(null);
    common.nextImageSlot = 0;
    common.text = "";
  }

  if (common.type === "hex-image-grid") {
    common.width = 320;
    common.height = 220;
    common.imageCells = Array(7).fill(null);
    common.nextImageSlot = 0;
    common.text = "";
  }

  state.shapes.push(common);
  state.selectedIds.clear();
  state.selectedIds.add(common.id);
  state.selectedId = common.id;
  renderShapes();
  setStatus(els.statusText, `${state.tool} added.`);
}

function createDroppedImageShape(x, y, payload) {
  const shape = {
    id: crypto.randomUUID(),
    type: "image",
    x,
    y,
    width: 240,
    height: 160,
    rotation: 0,
    flippedX: false,
    flippedY: false,
    fillMode: "none",
    fill: "transparent",
    fillOpacity: 1,
    lineMode: "none",
    stroke: "transparent",
    strokeWidth: DEFAULT_SHAPE_STYLE.strokeWidth,
    strokeOpacity: 1,
    lineSketchStyle: DEFAULT_SHAPE_STYLE.lineSketchStyle,
    lineCompoundType: DEFAULT_SHAPE_STYLE.lineCompoundType,
    lineDashType: DEFAULT_SHAPE_STYLE.lineDashType,
    lineCapType: DEFAULT_SHAPE_STYLE.lineCapType,
    lineJoinType: DEFAULT_SHAPE_STYLE.lineJoinType,
    text: "",
    textSize: DEFAULT_SHAPE_STYLE.textSize,
    textAlign: DEFAULT_SHAPE_STYLE.textAlign,
    imageSrc: payload.src,
    imageTitle: payload.title || "image",
    sourceAssetId: payload.id || ""
  };

  state.shapes.push(shape);
  state.selectedIds.clear();
  state.selectedIds.add(shape.id);
  state.selectedId = shape.id;
  renderShapes();
  setStatus(els.statusText, "Image dropped into diagram.");
}

function renderShapes() {
  closeTextEditor({ commit: true });
  els.shapeLayer.innerHTML = "";
  clearDynamicPaintDefs();

  for (const shape of state.shapes) {
    normalizeShapeTransform(shape);

    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "shape-group");
    group.setAttribute("data-id", shape.id);
    const transform = getShapeTransform(shape);
    if (transform) {
      group.setAttribute("transform", transform);
    }

    if (shape.type === "rect") {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(shape.x));
      rect.setAttribute("y", String(shape.y));
      rect.setAttribute("width", String(shape.width));
      rect.setAttribute("height", String(shape.height));
      rect.setAttribute("fill", shape.fill);
      rect.setAttribute("stroke", shape.stroke);
      rect.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(rect);
    } else if (shape.type === "ellipse") {
      const ellipse = document.createElementNS(SVG_NS, "ellipse");
      ellipse.setAttribute("cx", String(shape.x + shape.width / 2));
      ellipse.setAttribute("cy", String(shape.y + shape.height / 2));
      ellipse.setAttribute("rx", String(shape.width / 2));
      ellipse.setAttribute("ry", String(shape.height / 2));
      ellipse.setAttribute("fill", shape.fill);
      ellipse.setAttribute("stroke", shape.stroke);
      ellipse.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(ellipse);
    } else if (shape.type === "diamond") {
      const path = document.createElementNS(SVG_NS, "path");
      const x = shape.x;
      const y = shape.y;
      const w = shape.width;
      const h = shape.height;
      path.setAttribute("d", `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`);
      path.setAttribute("fill", shape.fill);
      path.setAttribute("stroke", shape.stroke);
      path.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(path);
    } else if (shape.type === "rounded-rect") {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(shape.x));
      rect.setAttribute("y", String(shape.y));
      rect.setAttribute("width", String(shape.width));
      rect.setAttribute("height", String(shape.height));
      rect.setAttribute("rx", "18");
      rect.setAttribute("ry", "18");
      rect.setAttribute("fill", shape.fill);
      rect.setAttribute("stroke", shape.stroke);
      rect.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(rect);
    } else if (shape.type === "square") {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(shape.x));
      rect.setAttribute("y", String(shape.y));
      rect.setAttribute("width", String(shape.width));
      rect.setAttribute("height", String(shape.height));
      rect.setAttribute("fill", shape.fill);
      rect.setAttribute("stroke", shape.stroke);
      rect.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(rect);
    } else if (shape.type === "circle") {
      const ellipse = document.createElementNS(SVG_NS, "ellipse");
      ellipse.setAttribute("cx", String(shape.x + shape.width / 2));
      ellipse.setAttribute("cy", String(shape.y + shape.height / 2));
      ellipse.setAttribute("rx", String(shape.width / 2));
      ellipse.setAttribute("ry", String(shape.height / 2));
      ellipse.setAttribute("fill", shape.fill);
      ellipse.setAttribute("stroke", shape.stroke);
      ellipse.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(ellipse);
    } else if (shape.type === "parallelogram") {
      group.appendChild(createPath(shape, createParallelogramPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "trapezoid") {
      group.appendChild(createPath(shape, createTrapezoidPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "hexagon") {
      group.appendChild(createPath(shape, createHexagonPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "triangle") {
      group.appendChild(createPath(shape, createTrianglePath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "arrow-right") {
      group.appendChild(createPath(shape, createArrowRightPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "chevron") {
      group.appendChild(createPath(shape, createChevronPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "document") {
      group.appendChild(createPath(shape, createDocumentPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "note") {
      group.appendChild(createPath(shape, createNotePath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "speech") {
      group.appendChild(createPath(shape, createSpeechPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "cloud") {
      group.appendChild(createPath(shape, createCloudPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "crescent") {
      group.appendChild(createPath(shape, createCrescentPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "star") {
      group.appendChild(createPath(shape, createStarPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "pentagon") {
      group.appendChild(createPath(shape, createPentagonPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "arrow-left") {
      group.appendChild(createPath(shape, createArrowLeftPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "arrow-up") {
      group.appendChild(createPath(shape, createArrowUpPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "arrow-down") {
      group.appendChild(createPath(shape, createArrowDownPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "oval") {
      const ellipse = document.createElementNS(SVG_NS, "ellipse");
      ellipse.setAttribute("cx", String(shape.x + shape.width / 2));
      ellipse.setAttribute("cy", String(shape.y + shape.height / 2));
      ellipse.setAttribute("rx", String(shape.width / 2));
      ellipse.setAttribute("ry", String(shape.height / 2));
      ellipse.setAttribute("fill", shape.fill);
      ellipse.setAttribute("stroke", shape.stroke);
      ellipse.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(ellipse);
    } else if (shape.type === "image-grid") {
      renderRectImageGrid(group, shape);
    } else if (shape.type === "hex-image-grid") {
      renderHexImageGrid(group, shape);
    } else if (shape.type === "image") {
      const image = document.createElementNS(SVG_NS, "image");
      const src = shape.imageSrc || "";
      image.setAttribute("x", String(shape.x));
      image.setAttribute("y", String(shape.y));
      image.setAttribute("width", String(shape.width));
      image.setAttribute("height", String(shape.height));
      image.setAttribute("preserveAspectRatio", "xMidYMid meet");
      image.setAttribute("href", src);
      if (shape.imageTitle) {
        image.setAttribute("aria-label", shape.imageTitle);
      }
      group.appendChild(image);
    } else if (shape.type === "database") {
      group.appendChild(createDatabaseGroup(shape));
    } else if (shape.type === "callout-rect") {
      group.appendChild(createPath(shape, createCalloutRectPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "callout-circle") {
      group.appendChild(createPath(shape, createCalloutCirclePath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "cylinder") {
      group.appendChild(createCylinderGroup(shape));
    } else if (shape.type === "actor") {
      group.appendChild(createActorGroup(shape));
    } else if (shape.type === "line") {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(shape.x));
      line.setAttribute("y1", String(shape.y));
      line.setAttribute("x2", String(shape.x + shape.width));
      line.setAttribute("y2", String(shape.y + shape.height));
      line.setAttribute("stroke", shape.stroke);
      line.setAttribute("stroke-width", String(shape.strokeWidth));
      line.setAttribute("marker-end", "url(#arrowHead)");
      line.setAttribute("data-default-marker-end", "url(#arrowHead)");
      group.appendChild(line);
    } else if (shape.type === "arrow-line") {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(shape.x));
      line.setAttribute("y1", String(shape.y));
      line.setAttribute("x2", String(shape.x + shape.width));
      line.setAttribute("y2", String(shape.y + shape.height));
      line.setAttribute("stroke", shape.stroke);
      line.setAttribute("stroke-width", String(shape.strokeWidth));
      line.setAttribute("marker-end", "url(#arrowHead)");
      line.setAttribute("data-default-marker-end", "url(#arrowHead)");
      group.appendChild(line);
    } else if (shape.type === "double-arrow") {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(shape.x));
      line.setAttribute("y1", String(shape.y));
      line.setAttribute("x2", String(shape.x + shape.width));
      line.setAttribute("y2", String(shape.y + shape.height));
      line.setAttribute("stroke", shape.stroke);
      line.setAttribute("stroke-width", String(shape.strokeWidth));
      line.setAttribute("marker-start", "url(#arrowHeadStart)");
      line.setAttribute("marker-end", "url(#arrowHead)");
      line.setAttribute("data-default-marker-start", "url(#arrowHeadStart)");
      line.setAttribute("data-default-marker-end", "url(#arrowHead)");
      group.appendChild(line);
    } else if (shape.type === "dashed-line") {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(shape.x));
      line.setAttribute("y1", String(shape.y));
      line.setAttribute("x2", String(shape.x + shape.width));
      line.setAttribute("y2", String(shape.y + shape.height));
      line.setAttribute("stroke", shape.stroke);
      line.setAttribute("stroke-width", String(shape.strokeWidth));
      line.setAttribute("stroke-dasharray", "10 8");
      group.appendChild(line);
    } else if (shape.type === "wave") {
      const wave = document.createElementNS(SVG_NS, "path");
      wave.setAttribute("d", createWavePath(shape.x, shape.y, shape.width, shape.height));
      wave.setAttribute("fill", "none");
      wave.setAttribute("stroke", shape.stroke);
      wave.setAttribute("stroke-width", String(shape.strokeWidth));
      group.appendChild(wave);
    } else if (shape.type === "hexagon-flat") {
      group.appendChild(createPath(shape, createHexagonFlatPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "plus") {
      group.appendChild(createPath(shape, createPlusPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "minus") {
      group.appendChild(createPath(shape, createMinusPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "arrow-left-right") {
      group.appendChild(createPath(shape, createArrowLeftRightPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "right-arrow-bold") {
      group.appendChild(createPath(shape, createRightArrowBoldPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "flowchart-process") {
      group.appendChild(createPath(shape, createFlowchartProcessPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "flowchart-decision") {
      group.appendChild(createPath(shape, createFlowchartDecisionPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "flowchart-terminator") {
      group.appendChild(createPath(shape, createFlowchartTerminatorPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "flowchart-data") {
      group.appendChild(createPath(shape, createFlowchartDataPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "callout-left") {
      group.appendChild(createPath(shape, createCalloutLeftPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "callout-right") {
      group.appendChild(createPath(shape, createCalloutRightPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "callout-up") {
      group.appendChild(createPath(shape, createCalloutUpPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "callout-down") {
      group.appendChild(createPath(shape, createCalloutDownPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "bracket-left") {
      group.appendChild(createPath(shape, createBracketLeftPath(shape.x, shape.y, shape.width, shape.height)));
    } else if (shape.type === "bracket-right") {
      group.appendChild(createPath(shape, createBracketRightPath(shape.x, shape.y, shape.width, shape.height)));
    }

    if (shape.imageMode === "frame" && shape.imageSrc) {
      addImageFrameToGroup(group, shape);
    }

    applyShapeVisualStyle(group, shape);

    if (supportsInnerText(shape.type)) {
      const text = document.createElementNS(SVG_NS, "text");
      const centerX = shape.x + shape.width / 2;
      const centerY = shape.y + shape.height / 2;
      const anchor = shape.textAlign || "middle";
      let x = centerX;
      if (shape.textAlign === "start") {
        x = shape.x + 12;
      }
      if (shape.textAlign === "end") {
        x = shape.x + shape.width - 12;
      }

      appendMultilineText(text, shape.text || "", {
        x,
        y: centerY,
        textSize: shape.textSize,
        textAlign: anchor,
        fill: "#1f2a1f",
        centerBlock: true
      });

      text.setAttribute("text-anchor", anchor);
      if (shape.textAlign === "start") {
        text.setAttribute("x", String(shape.x + 12));
      }
      if (shape.textAlign === "end") {
        text.setAttribute("x", String(shape.x + shape.width - 12));
      }
      text.setAttribute("font-weight", "600");
      group.appendChild(text);
    } else if (isLineShape(shape.type) && shape.text) {
      const text = document.createElementNS(SVG_NS, "text");
      const centerX = shape.x + shape.width / 2;
      const labelY = shape.y - 10;
      appendMultilineText(text, shape.text, {
        x: centerX,
        y: labelY,
        textSize: shape.textSize,
        textAlign: "middle",
        fill: shape.stroke,
        centerBlock: true
      });
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-weight", "600");
      group.appendChild(text);
    }

    if (shape.type === "text") {
      const text = document.createElementNS(SVG_NS, "text");
      const anchor = shape.textAlign || "start";
      let x = shape.x;
      if (shape.textAlign === "middle") {
        x = shape.x + shape.width / 2;
      }
      if (shape.textAlign === "end") {
        x = shape.x + shape.width;
      }
      appendMultilineText(text, shape.text || "Text", {
        x,
        y: shape.y + shape.textSize,
        textSize: shape.textSize,
        textAlign: anchor,
        fill: shape.stroke === "transparent" ? "#1f2a1f" : shape.stroke,
        centerBlock: false
      });
      text.setAttribute("text-anchor", anchor);
      if (shape.textAlign === "middle") {
        text.setAttribute("x", String(shape.x + shape.width / 2));
      }
      if (shape.textAlign === "end") {
        text.setAttribute("x", String(shape.x + shape.width));
      }
      text.setAttribute("font-weight", "600");
      group.appendChild(text);
    }

    els.shapeLayer.appendChild(group);
  }

  renderSelection();
}

function renderSelection() {
  els.selectionLayer.innerHTML = "";
  
  // Render selection boxes and handles for all selected shapes
  for (const id of state.selectedIds) {
    const shape = getShapeById(id);
    if (!shape) continue;

    const bounds = getShapeBounds(shape);
    const minX = bounds.x;
    const minY = bounds.y;
    const width = bounds.width;
    const height = bounds.height;
    const offset = 6; // Offset to position handles on the dashed selection lines

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "selection-box");
    rect.setAttribute("x", String(minX - offset));
    rect.setAttribute("y", String(minY - offset));
    rect.setAttribute("width", String(Math.max(16, width + 2 * offset)));
    rect.setAttribute("height", String(Math.max(16, height + 2 * offset)));
    els.selectionLayer.appendChild(rect);

    // Only show resize handles for the primary selected shape
    if (state.selectedIds.size === 1) {
      const rotateX = minX + width / 2;
      const rotateY = minY - 28;
      const rotateStem = document.createElementNS(SVG_NS, "line");
      rotateStem.setAttribute("class", "rotate-stem");
      rotateStem.setAttribute("x1", String(rotateX));
      rotateStem.setAttribute("y1", String(minY - offset));
      rotateStem.setAttribute("x2", String(rotateX));
      rotateStem.setAttribute("y2", String(rotateY));
      els.selectionLayer.appendChild(rotateStem);
      els.selectionLayer.appendChild(createResizeHandle(rotateX, rotateY, "rotate", shape.id));

      if (isLineShape(shape.type)) {
        const startHandle = createResizeHandle(shape.x, shape.y, "line-start", shape.id);
        const endHandle = createResizeHandle(shape.x + shape.width, shape.y + shape.height, "line-end", shape.id);
        els.selectionLayer.appendChild(startHandle);
        els.selectionLayer.appendChild(endHandle);
      } else {
        const handles = [
          { name: "nw", x: minX - offset, y: minY - offset },
          { name: "n", x: minX + width / 2, y: minY - offset },
          { name: "ne", x: minX + width + offset, y: minY - offset },
          { name: "e", x: minX + width + offset, y: minY + height / 2 },
          { name: "se", x: minX + width + offset, y: minY + height + offset },
          { name: "s", x: minX + width / 2, y: minY + height + offset },
          { name: "sw", x: minX - offset, y: minY + height + offset },
          { name: "w", x: minX - offset, y: minY + height / 2 }
        ];

        for (const handle of handles) {
          els.selectionLayer.appendChild(createResizeHandle(handle.x, handle.y, handle.name, shape.id));
        }
      }
    }
  }

  if (state.marquee) {
    const minX = Math.min(state.marquee.startX, state.marquee.currentX);
    const minY = Math.min(state.marquee.startY, state.marquee.currentY);
    const width = Math.abs(state.marquee.currentX - state.marquee.startX);
    const height = Math.abs(state.marquee.currentY - state.marquee.startY);

    if (width > 1 || height > 1) {
      const marquee = document.createElementNS(SVG_NS, "rect");
      marquee.setAttribute("class", "marquee-box");
      marquee.setAttribute("x", String(minX));
      marquee.setAttribute("y", String(minY));
      marquee.setAttribute("width", String(width));
      marquee.setAttribute("height", String(height));
      els.selectionLayer.appendChild(marquee);
    }
  }
}

function createResizeHandle(x, y, handleName, shapeId) {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("class", `resize-handle ${handleName}`);
  circle.setAttribute("cx", String(x));
  circle.setAttribute("cy", String(y));
  circle.setAttribute("r", "6.5");
  circle.setAttribute("data-handle", handleName);
  circle.setAttribute("data-shape-id", shapeId);
  return circle;
}

function applyResizeDrag(shape, resizeState, currentX, currentY) {
  const dx = currentX - resizeState.startX;
  const dy = currentY - resizeState.startY;

  if (isLineShape(shape.type)) {
    if (resizeState.handle === "line-start") {
      shape.x = resizeState.x + dx;
      shape.y = resizeState.y + dy;
      shape.width = resizeState.width - dx;
      shape.height = resizeState.height - dy;
      return;
    }

    if (resizeState.handle === "line-end") {
      shape.width = resizeState.width + dx;
      shape.height = resizeState.height + dy;
      return;
    }
  }

  const minSize = shape.type === "text" ? 24 : 30;
  let left = resizeState.x;
  let top = resizeState.y;
  let right = resizeState.x + resizeState.width;
  let bottom = resizeState.y + resizeState.height;

  if (resizeState.handle.includes("w")) {
    left = resizeState.x + dx;
  }
  if (resizeState.handle.includes("e")) {
    right = resizeState.x + resizeState.width + dx;
  }
  if (resizeState.handle.includes("n")) {
    top = resizeState.y + dy;
  }
  if (resizeState.handle.includes("s")) {
    bottom = resizeState.y + resizeState.height + dy;
  }

  const crossedX = left > right;
  if (crossedX) {
    const tmp = left;
    left = right;
    right = tmp;
  }

  const crossedY = top > bottom;
  if (crossedY) {
    const tmp = top;
    top = bottom;
    bottom = tmp;
  }

  const hasHorizontalHandle = resizeState.handle.includes("w") || resizeState.handle.includes("e");
  const hasVerticalHandle = resizeState.handle.includes("n") || resizeState.handle.includes("s");
  if (hasHorizontalHandle) {
    shape.flippedX = resizeState.flippedX !== crossedX;
  }
  if (hasVerticalHandle) {
    shape.flippedY = resizeState.flippedY !== crossedY;
  }

  if (right - left < minSize && hasHorizontalHandle) {
    if (resizeState.handle.includes("w")) {
      left = right - minSize;
    } else {
      right = left + minSize;
    }
  }

  if (bottom - top < minSize && hasVerticalHandle) {
    if (resizeState.handle.includes("n")) {
      top = bottom - minSize;
    } else {
      bottom = top + minSize;
    }
  }

  shape.x = left;
  shape.y = top;
  shape.width = Math.max(minSize, right - left);
  shape.height = Math.max(minSize, bottom - top);
}

function getShapeBounds(shape) {
  normalizeShapeTransform(shape);

  const rotation = toNumber(shape.rotation, 0) || 0;

  if (isLineShape(shape.type)) {
    const x1 = shape.x;
    const y1 = shape.y;
    const x2 = shape.x + shape.width;
    const y2 = shape.y + shape.height;
    const bounds = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.max(1, Math.abs(x2 - x1)),
      height: Math.max(1, Math.abs(y2 - y1))
    };

    if (rotation === 0) {
      return bounds;
    }

    return getRotatedBounds(bounds, getShapeCenter(shape), rotation);
  }

  const bounds = {
    x: shape.x,
    y: shape.y,
    width: Math.max(1, shape.width),
    height: Math.max(1, shape.height)
  };

  if (rotation === 0) {
    return bounds;
  }

  return getRotatedBounds(bounds, getShapeCenter(shape), rotation);
}

function normalizeShapeTransform(shape) {
  if (!shape || typeof shape !== "object") {
    return;
  }

  shape.rotation = normalizeRotation(toNumber(shape.rotation, 0));
  shape.flippedX = Boolean(shape.flippedX);
  shape.flippedY = Boolean(shape.flippedY);
}

function getShapeCenter(shape) {
  return {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2
  };
}

function normalizeRotation(value) {
  const safe = toNumber(value, 0);
  return ((safe % 360) + 360) % 360;
}

function getShapeTransform(shape) {
  const rotation = toNumber(shape.rotation, 0) || 0;
  const scaleX = shape.flippedX ? -1 : 1;
  const scaleY = shape.flippedY ? -1 : 1;
  if (rotation === 0 && scaleX === 1 && scaleY === 1) {
    return "";
  }

  const center = getShapeCenter(shape);
  return `translate(${center.x} ${center.y}) rotate(${rotation}) scale(${scaleX} ${scaleY}) translate(${-center.x} ${-center.y})`;
}

function getRotatedBounds(bounds, center, rotationDeg) {
  const radians = (rotationDeg * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);

  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height }
  ];

  const rotated = corners.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos
    };
  });

  const xs = rotated.map((point) => point.x);
  const ys = rotated.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function syncStyleInputs() {
  const shape = getShapeById(state.selectedId);
  if (!shape) {
    setImageGridControlsEnabled(false, false);
    return;
  }

  if (shape.fill && shape.fill !== "transparent") {
    els.fillColor.value = normalizeColor(shape.fill, els.fillColor.value);
  }
  if (shape.stroke && shape.stroke !== "transparent") {
    els.strokeColor.value = normalizeColor(shape.stroke, els.strokeColor.value);
  }
  els.strokeWidth.value = String(shape.strokeWidth || DEFAULT_SHAPE_STYLE.strokeWidth);
  setTransparencyValue(els.fillTransparencyRange, els.fillTransparencyNumber, Math.round((1 - toNumber(shape.fillOpacity, 1)) * 100));
  setTransparencyValue(els.lineTransparencyRange, els.lineTransparencyNumber, Math.round((1 - toNumber(shape.strokeOpacity, 1)) * 100));
  els.lineSketchStyle.value = shape.lineSketchStyle || DEFAULT_SHAPE_STYLE.lineSketchStyle;
  els.lineCompoundType.value = shape.lineCompoundType || DEFAULT_SHAPE_STYLE.lineCompoundType;
  els.lineDashType.value = shape.lineDashType || DEFAULT_SHAPE_STYLE.lineDashType;
  els.lineCapType.value = shape.lineCapType || DEFAULT_SHAPE_STYLE.lineCapType;
  els.lineJoinType.value = shape.lineJoinType || DEFAULT_SHAPE_STYLE.lineJoinType;
  els.textValue.value = shape.text || "";
  els.textSize.value = String(shape.textSize || 22);
  setTextAlignValue(shape.textAlign || "middle");
  setFillMode(shape.fillMode || (shape.fill === "transparent" ? "none" : "solid"));
  setLineMode(shape.lineMode || (shape.stroke === "transparent" ? "none" : "solid"));
  syncImageGridControls(shape);
}

function applyStyleToSelectedShapes() {
  if (state.selectedIds.size === 0) {
    return;
  }

  const fillMode = getCheckedValue(els.fillModeInputs, DEFAULT_SHAPE_STYLE.fillMode);
  const lineMode = getCheckedValue(els.lineModeInputs, DEFAULT_SHAPE_STYLE.lineMode);
  const fill = fillMode === "none" ? "transparent" : els.fillColor.value;
  const stroke = lineMode === "none" ? "transparent" : els.strokeColor.value;
  const strokeWidth = toNumber(els.strokeWidth.value, DEFAULT_SHAPE_STYLE.strokeWidth);
  const fillOpacity = (100 - getTransparencyPercent(els.fillTransparencyNumber.value)) / 100;
  const strokeOpacity = (100 - getTransparencyPercent(els.lineTransparencyNumber.value)) / 100;
  const text = els.textValue.value;
  const textSize = toNumber(els.textSize.value, DEFAULT_SHAPE_STYLE.textSize);
  const textAlign = els.textAlign.value;
  const gridRows = getGridDimensionValue(els.gridRows.value, 3);
  const gridCols = getGridDimensionValue(els.gridCols.value, 3);

  for (const id of state.selectedIds) {
    const shape = getShapeById(id);
    if (!shape) {
      continue;
    }
    shape.fillMode = fillMode;
    shape.fill = fill;
    shape.fillOpacity = fillOpacity;
    shape.lineMode = lineMode;
    shape.stroke = stroke;
    shape.strokeWidth = strokeWidth;
    shape.strokeOpacity = strokeOpacity;
    shape.lineSketchStyle = els.lineSketchStyle.value;
    shape.lineCompoundType = els.lineCompoundType.value;
    shape.lineDashType = els.lineDashType.value;
    shape.lineCapType = els.lineCapType.value;
    shape.lineJoinType = els.lineJoinType.value;
    shape.text = text;
    shape.textSize = textSize;
    shape.textAlign = textAlign;
    if (shape.type === "image-grid") {
      shape.gridRows = gridRows;
      shape.gridCols = gridCols;
      normalizeMultiImageShape(shape);
    }
  }

  renderShapes();
}

function getGridDimensionValue(rawValue, fallback) {
  const value = Math.round(toNumber(rawValue, fallback));
  return Math.max(1, Math.min(12, value));
}

function setImageGridControlsEnabled(enabledRows, enabledCols) {
  els.gridRows.disabled = !enabledRows;
  els.gridCols.disabled = !enabledCols;
}

function syncImageGridControls(shape) {
  if (shape.type === "image-grid") {
    normalizeMultiImageShape(shape);
    els.gridRows.value = String(shape.gridRows || 3);
    els.gridCols.value = String(shape.gridCols || 3);
    setImageGridControlsEnabled(true, true);
    return;
  }

  if (shape.type === "hex-image-grid") {
    els.gridRows.value = "3";
    els.gridCols.value = "3";
    setImageGridControlsEnabled(false, false);
    return;
  }

  setImageGridControlsEnabled(false, false);
}

function bindTransparencyPair(rangeInput, numberInput) {
  const sync = (value) => {
    setTransparencyValue(rangeInput, numberInput, value);
    applyStyleToSelectedShapes();
  };
  rangeInput.addEventListener("input", () => sync(rangeInput.value));
  numberInput.addEventListener("input", () => sync(numberInput.value));
}

function setTransparencyValue(rangeInput, numberInput, rawValue) {
  const value = String(getTransparencyPercent(rawValue));
  rangeInput.value = value;
  numberInput.value = value;
}

function getTransparencyPercent(value) {
  const n = Math.round(toNumber(value, 0));
  return Math.max(0, Math.min(100, n));
}

function setTextAlignValue(value) {
  const align = ["start", "middle", "end"].includes(value) ? value : "middle";
  els.textAlign.value = align;
  els.alignButtons.forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-align") === align);
  });
}

function getCheckedValue(inputs, fallback) {
  const selected = Array.from(inputs).find((input) => input.checked);
  return selected?.value || fallback;
}

function setFillMode(value) {
  const allowed = ["none", "solid", "gradient", "texture", "pattern"];
  const mode = allowed.includes(value) ? value : DEFAULT_SHAPE_STYLE.fillMode;
  els.fillModeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
  const disabled = mode === "none";
  els.fillColor.disabled = disabled;
  els.fillTransparencyRange.disabled = disabled;
  els.fillTransparencyNumber.disabled = disabled;
}

function setLineMode(value) {
  const mode = ["none", "solid", "gradient"].includes(value) ? value : DEFAULT_SHAPE_STYLE.lineMode;
  els.lineModeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
  const disabled = mode === "none";
  els.strokeColor.disabled = disabled;
  els.strokeWidth.disabled = disabled;
  els.lineTransparencyRange.disabled = disabled;
  els.lineTransparencyNumber.disabled = disabled;
  els.lineSketchStyle.disabled = disabled;
  els.lineCompoundType.disabled = disabled;
  els.lineDashType.disabled = disabled;
  els.lineCapType.disabled = disabled;
  els.lineJoinType.disabled = disabled;
}

function clearDynamicPaintDefs() {
  if (!els.svgDefs) {
    return;
  }
  els.svgDefs.querySelectorAll("[data-dynamic-style='true']").forEach((node) => node.remove());
}

/**
 * Returns the SVG path `d` string for a given shape, used when building clipPath elements.
 * Returns null for non-path shapes (rect, ellipse, etc.) that have dedicated SVG elements.
 */
function getShapePathD(shape) {
  const { x, y, width: w, height: h } = shape;
  const generators = {
    diamond: () => `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`,
    parallelogram: () => createParallelogramPath(x, y, w, h),
    trapezoid: () => createTrapezoidPath(x, y, w, h),
    hexagon: () => createHexagonPath(x, y, w, h),
    triangle: () => createTrianglePath(x, y, w, h),
    "arrow-right": () => createArrowRightPath(x, y, w, h),
    chevron: () => createChevronPath(x, y, w, h),
    document: () => createDocumentPath(x, y, w, h),
    note: () => createNotePath(x, y, w, h),
    speech: () => createSpeechPath(x, y, w, h),
    cloud: () => createCloudPath(x, y, w, h),
    crescent: () => createCrescentPath(x, y, w, h),
    star: () => createStarPath(x, y, w, h),
    pentagon: () => createPentagonPath(x, y, w, h),
    "arrow-left": () => createArrowLeftPath(x, y, w, h),
    "arrow-up": () => createArrowUpPath(x, y, w, h),
    "arrow-down": () => createArrowDownPath(x, y, w, h),
    "hexagon-flat": () => createHexagonFlatPath(x, y, w, h),
    plus: () => createPlusPath(x, y, w, h),
    minus: () => createMinusPath(x, y, w, h),
    "arrow-left-right": () => createArrowLeftRightPath(x, y, w, h),
    "right-arrow-bold": () => createRightArrowBoldPath(x, y, w, h),
    "flowchart-process": () => createFlowchartProcessPath(x, y, w, h),
    "flowchart-decision": () => createFlowchartDecisionPath(x, y, w, h),
    "flowchart-terminator": () => createFlowchartTerminatorPath(x, y, w, h),
    "flowchart-data": () => createFlowchartDataPath(x, y, w, h),
    "callout-left": () => createCalloutLeftPath(x, y, w, h),
    "callout-right": () => createCalloutRightPath(x, y, w, h),
    "callout-up": () => createCalloutUpPath(x, y, w, h),
    "callout-down": () => createCalloutDownPath(x, y, w, h),
    "callout-rect": () => createCalloutRectPath(x, y, w, h),
    "callout-circle": () => createCalloutCirclePath(x, y, w, h),
    "bracket-left": () => createBracketLeftPath(x, y, w, h),
    "bracket-right": () => createBracketRightPath(x, y, w, h),
  };
  const gen = generators[shape.type];
  return gen ? gen() : null;
}

/**
 * Returns an SVG element suitable for use inside a <clipPath> matching the shape geometry.
 */
function getClipShapeElement(shape) {
  const { x, y, width, height } = shape;

  if (shape.type === "rounded-rect") {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("x", String(x));
    el.setAttribute("y", String(y));
    el.setAttribute("width", String(width));
    el.setAttribute("height", String(height));
    el.setAttribute("rx", "18");
    el.setAttribute("ry", "18");
    return el;
  }

  if (["ellipse", "circle", "oval"].includes(shape.type)) {
    const el = document.createElementNS(SVG_NS, "ellipse");
    el.setAttribute("cx", String(x + width / 2));
    el.setAttribute("cy", String(y + height / 2));
    el.setAttribute("rx", String(width / 2));
    el.setAttribute("ry", String(height / 2));
    return el;
  }

  const d = getShapePathD(shape);
  if (d) {
    const el = document.createElementNS(SVG_NS, "path");
    el.setAttribute("d", d);
    return el;
  }

  // Fallback / bounding rect (rect, square, group shapes like cylinder/actor/database)
  const el = document.createElementNS(SVG_NS, "rect");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("width", String(width));
  el.setAttribute("height", String(height));
  return el;
}

/**
 * Inserts an image clipped to the shape's geometry as the bottom layer of the group.
 * The shape's stroke outline remains on top.
 */
function addImageFrameToGroup(group, shape) {
  if (!shape.imageSrc || !els.svgDefs) {
    return;
  }

  const clipId = `imgclip-${shape.id}`;
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", clipId);
  clipPath.setAttribute("data-dynamic-style", "true");

  const clipEl = getClipShapeElement(shape);
  clipPath.appendChild(clipEl);
  els.svgDefs.appendChild(clipPath);

  const img = document.createElementNS(SVG_NS, "image");
  img.setAttribute("x", String(shape.x));
  img.setAttribute("y", String(shape.y));
  img.setAttribute("width", String(shape.width));
  img.setAttribute("height", String(shape.height));
  img.setAttribute("href", shape.imageSrc);
  img.setAttribute("preserveAspectRatio", "xMidYMid slice");
  img.setAttribute("clip-path", `url(#${clipId})`);
  if (shape.imageTitle) {
    img.setAttribute("aria-label", shape.imageTitle);
  }

  // Prepend so the image sits behind all other children (stroke outline renders on top).
  group.insertBefore(img, group.firstChild);
}

function applyShapeVisualStyle(group, shape) {
  ensureShapePaintDefs(shape);
  // When the shape acts as an image frame, the fill is transparent so the clipped image shows through.
  const fillPaint = shape.imageMode === "frame" ? "none" : resolveFillPaint(shape);
  const fillOpacity = shape.imageMode === "frame" ? "0" : String(toNumber(shape.fillOpacity, 1));
  const strokePaint = resolveStrokePaint(shape);
  const dasharray = getDashArray(shape.lineDashType, shape.strokeWidth);
  const strokeOpacity = String(toNumber(shape.strokeOpacity, 1));
  const lineCap = shape.lineCapType || DEFAULT_SHAPE_STYLE.lineCapType;
  const lineJoin = shape.lineJoinType || DEFAULT_SHAPE_STYLE.lineJoinType;
  const isRough = shape.lineSketchStyle === "rough";

  for (const child of group.children) {
    if (!(child instanceof SVGElement)) {
      continue;
    }

    const tagName = child.tagName.toLowerCase();
    if (tagName === "text" || tagName === "image") {
      continue;
    }

    const keepNoFill = child.getAttribute("fill") === "none";
    if (!keepNoFill) {
      child.setAttribute("fill", fillPaint);
      child.setAttribute("fill-opacity", fillOpacity);
    }

    child.setAttribute("stroke", strokePaint);
    child.setAttribute("stroke-width", String(toNumber(shape.strokeWidth, DEFAULT_SHAPE_STYLE.strokeWidth)));
    child.setAttribute("stroke-opacity", strokeOpacity);
    child.setAttribute("stroke-linecap", lineCap);
    child.setAttribute("stroke-linejoin", lineJoin);

    if (dasharray) {
      child.setAttribute("stroke-dasharray", dasharray);
    } else {
      child.removeAttribute("stroke-dasharray");
    }

    if (isRough) {
      child.setAttribute("stroke-linecap", "round");
      child.setAttribute("stroke-dasharray", "1 4");
    }

    if (shape.lineCompoundType === "double") {
      child.setAttribute("stroke-width", String(toNumber(shape.strokeWidth, DEFAULT_SHAPE_STYLE.strokeWidth) * 1.8));
      child.setAttribute("paint-order", "stroke fill markers");
    } else {
      child.removeAttribute("paint-order");
    }

    const defaultStart = child.getAttribute("data-default-marker-start");
    const defaultEnd = child.getAttribute("data-default-marker-end");
    if (defaultStart || defaultEnd) {
      if (strokePaint === "transparent") {
        child.removeAttribute("marker-start");
        child.removeAttribute("marker-end");
      } else {
        if (defaultStart) {
          child.setAttribute("marker-start", defaultStart);
        }
        if (defaultEnd) {
          child.setAttribute("marker-end", defaultEnd);
        }
      }
    }
  }
}

function ensureShapePaintDefs(shape) {
  if (!els.svgDefs) {
    return;
  }

  if (shape.fillMode === "gradient") {
    const id = `fill-grad-${shape.id}`;
    createLinearGradientDef(id, getSafeColor(shape.fill, DEFAULT_SHAPE_STYLE.fill));
  }
  if (shape.fillMode === "texture") {
    const id = `fill-texture-${shape.id}`;
    createPatternDef(id, getSafeColor(shape.fill, DEFAULT_SHAPE_STYLE.fill), "texture");
  }
  if (shape.fillMode === "pattern") {
    const id = `fill-pattern-${shape.id}`;
    createPatternDef(id, getSafeColor(shape.fill, DEFAULT_SHAPE_STYLE.fill), "pattern");
  }
  if (shape.lineMode === "gradient") {
    const id = `line-grad-${shape.id}`;
    createLinearGradientDef(id, getSafeColor(shape.stroke, DEFAULT_SHAPE_STYLE.stroke));
  }
}

function resolveFillPaint(shape) {
  const fillMode = shape.fillMode || DEFAULT_SHAPE_STYLE.fillMode;
  if (fillMode === "none") {
    return "transparent";
  }
  if (fillMode === "gradient") {
    return `url(#fill-grad-${shape.id})`;
  }
  if (fillMode === "texture") {
    return `url(#fill-texture-${shape.id})`;
  }
  if (fillMode === "pattern") {
    return `url(#fill-pattern-${shape.id})`;
  }
  return getSafeColor(shape.fill, DEFAULT_SHAPE_STYLE.fill);
}

function resolveStrokePaint(shape) {
  const lineMode = shape.lineMode || DEFAULT_SHAPE_STYLE.lineMode;
  if (lineMode === "none") {
    return "transparent";
  }
  if (lineMode === "gradient") {
    return `url(#line-grad-${shape.id})`;
  }
  return getSafeColor(shape.stroke, DEFAULT_SHAPE_STYLE.stroke);
}

function createLinearGradientDef(id, baseColor) {
  if (!els.svgDefs || els.svgDefs.querySelector(`#${id}`)) {
    return;
  }
  const gradient = document.createElementNS(SVG_NS, "linearGradient");
  gradient.setAttribute("id", id);
  gradient.setAttribute("x1", "0%");
  gradient.setAttribute("y1", "0%");
  gradient.setAttribute("x2", "100%");
  gradient.setAttribute("y2", "100%");
  gradient.setAttribute("data-dynamic-style", "true");

  const stop1 = document.createElementNS(SVG_NS, "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("stop-color", adjustHexColor(baseColor, 32));
  gradient.appendChild(stop1);

  const stop2 = document.createElementNS(SVG_NS, "stop");
  stop2.setAttribute("offset", "100%");
  stop2.setAttribute("stop-color", adjustHexColor(baseColor, -20));
  gradient.appendChild(stop2);

  els.svgDefs.appendChild(gradient);
}

function createPatternDef(id, baseColor, kind) {
  if (!els.svgDefs || els.svgDefs.querySelector(`#${id}`)) {
    return;
  }
  const pattern = document.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", id);
  pattern.setAttribute("width", "10");
  pattern.setAttribute("height", "10");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("data-dynamic-style", "true");

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", "10");
  bg.setAttribute("height", "10");
  bg.setAttribute("fill", adjustHexColor(baseColor, 44));
  pattern.appendChild(bg);

  if (kind === "texture") {
    const lineA = document.createElementNS(SVG_NS, "path");
    lineA.setAttribute("d", "M -2 2 L 2 -2 M 0 10 L 10 0 M 8 12 L 12 8");
    lineA.setAttribute("stroke", adjustHexColor(baseColor, -24));
    lineA.setAttribute("stroke-width", "1");
    pattern.appendChild(lineA);
  } else {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", "2.5");
    dot.setAttribute("cy", "2.5");
    dot.setAttribute("r", "1.3");
    dot.setAttribute("fill", adjustHexColor(baseColor, -24));
    pattern.appendChild(dot);
  }

  els.svgDefs.appendChild(pattern);
}

function getDashArray(type, strokeWidth) {
  const width = Math.max(1, toNumber(strokeWidth, 2));
  if (type === "dash") {
    return `${width * 5} ${width * 3}`;
  }
  if (type === "dot") {
    return `${width} ${width * 2.8}`;
  }
  if (type === "dash-dot") {
    return `${width * 5} ${width * 2.4} ${width} ${width * 2.4}`;
  }
  return "";
}

function getSafeColor(value, fallback) {
  return normalizeColor(value, fallback);
}

function adjustHexColor(hex, amount) {
  const safe = normalizeColor(hex, "#777777").slice(1);
  const value = Number.parseInt(safe, 16);
  let r = (value >> 16) & 0xff;
  let g = (value >> 8) & 0xff;
  let b = value & 0xff;
  r = Math.max(0, Math.min(255, r + amount));
  g = Math.max(0, Math.min(255, g + amount));
  b = Math.max(0, Math.min(255, b + amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function getShapeById(id) {
  return state.shapes.find((shape) => shape.id === id);
}

function pointerToSvg(event) {
  const point = els.svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const ctm = els.svg.getScreenCTM();
  if (!ctm) {
    return null;
  }

  return point.matrixTransform(ctm.inverse());
}

function supportsInnerText(type) {
  return !isLineShape(type)
    && type !== "text"
    && type !== "actor"
    && type !== "wave"
    && type !== "image"
    && type !== "image-grid"
    && type !== "hex-image-grid";
}

function isMultiImageShapeType(type) {
  return type === "image-grid" || type === "hex-image-grid";
}

function getMultiImageSlotCount(shape) {
  if (shape.type === "image-grid") {
    const rows = Math.max(1, Math.round(toNumber(shape.gridRows, 3)));
    const cols = Math.max(1, Math.round(toNumber(shape.gridCols, 3)));
    return rows * cols;
  }
  if (shape.type === "hex-image-grid") {
    return 7;
  }
  return 0;
}

function normalizeMultiImageShape(shape) {
  if (!shape || !isMultiImageShapeType(shape.type)) {
    return;
  }

  if (shape.type === "image-grid") {
    shape.gridRows = Math.max(1, Math.round(toNumber(shape.gridRows, 3)));
    shape.gridCols = Math.max(1, Math.round(toNumber(shape.gridCols, 3)));
  }

  const slotCount = getMultiImageSlotCount(shape);
  if (!Array.isArray(shape.imageCells)) {
    shape.imageCells = [];
  }

  shape.imageCells = shape.imageCells
    .slice(0, slotCount)
    .map((cell) => (cell && cell.src ? {
      src: String(cell.src),
      title: String(cell.title || "image"),
      id: String(cell.id || "")
    } : null));

  while (shape.imageCells.length < slotCount) {
    shape.imageCells.push(null);
  }

  shape.nextImageSlot = Math.max(0, Math.floor(toNumber(shape.nextImageSlot, 0)));
  if (slotCount > 0) {
    shape.nextImageSlot %= slotCount;
  }
}

function addImageToMultiShape(shape, payload) {
  normalizeMultiImageShape(shape);
  const slotCount = getMultiImageSlotCount(shape);
  if (slotCount === 0) {
    return;
  }

  let slotIndex = shape.imageCells.findIndex((cell) => !cell?.src);
  if (slotIndex < 0) {
    slotIndex = Math.max(0, Math.floor(toNumber(shape.nextImageSlot, 0))) % slotCount;
  }

  shape.imageCells[slotIndex] = {
    src: payload.src,
    title: payload.title || "image",
    id: payload.id || ""
  };
  shape.nextImageSlot = (slotIndex + 1) % slotCount;
}

function renderRectImageGrid(group, shape) {
  normalizeMultiImageShape(shape);

  const rows = Math.max(1, shape.gridRows || 3);
  const cols = Math.max(1, shape.gridCols || 3);
  const gap = 4;
  const pad = 6;
  const cellWidth = Math.max(6, (shape.width - pad * 2 - gap * (cols - 1)) / cols);
  const cellHeight = Math.max(6, (shape.height - pad * 2 - gap * (rows - 1)) / rows);

  const base = document.createElementNS(SVG_NS, "rect");
  base.setAttribute("x", String(shape.x));
  base.setAttribute("y", String(shape.y));
  base.setAttribute("width", String(shape.width));
  base.setAttribute("height", String(shape.height));
  group.appendChild(base);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const cellX = shape.x + pad + col * (cellWidth + gap);
      const cellY = shape.y + pad + row * (cellHeight + gap);

      if (shape.imageCells[index]?.src && els.svgDefs) {
        const clipId = `imgclip-${shape.id}-${index}`;
        const clipPath = document.createElementNS(SVG_NS, "clipPath");
        clipPath.setAttribute("id", clipId);
        clipPath.setAttribute("data-dynamic-style", "true");
        const clipRect = document.createElementNS(SVG_NS, "rect");
        clipRect.setAttribute("x", String(cellX));
        clipRect.setAttribute("y", String(cellY));
        clipRect.setAttribute("width", String(cellWidth));
        clipRect.setAttribute("height", String(cellHeight));
        clipPath.appendChild(clipRect);
        els.svgDefs.appendChild(clipPath);

        const image = document.createElementNS(SVG_NS, "image");
        image.setAttribute("x", String(cellX));
        image.setAttribute("y", String(cellY));
        image.setAttribute("width", String(cellWidth));
        image.setAttribute("height", String(cellHeight));
        image.setAttribute("href", shape.imageCells[index].src);
        image.setAttribute("preserveAspectRatio", "xMidYMid slice");
        image.setAttribute("clip-path", `url(#${clipId})`);
        group.appendChild(image);
      }

      const border = document.createElementNS(SVG_NS, "rect");
      border.setAttribute("x", String(cellX));
      border.setAttribute("y", String(cellY));
      border.setAttribute("width", String(cellWidth));
      border.setAttribute("height", String(cellHeight));
      border.setAttribute("fill", "none");
      group.appendChild(border);
    }
  }
}

/**
 * Returns a flat-top hexagon path using inset = w/4, which produces proper
 * edge-sharing tiling when combined with column step = 0.75*w, row offset = 0.5*h.
 */
function createTilingHexPath(x, y, w, h) {
  const inset = w / 4;
  return `M ${x + inset} ${y} L ${x + w - inset} ${y} L ${x + w} ${y + h / 2} L ${x + w - inset} ${y + h} L ${x + inset} ${y + h} L ${x} ${y + h / 2} Z`;
}

function getHexGridCells(shape) {
  // Proper flat-top hex tiling:
  //   layout: 3 columns → [col0: 2 rows, col1: 3 rows, col2: 2 rows] = 7 cells
  //   total width  = hexW * (0.75*2 + 1) = hexW * 2.5
  //   total height = hexH * 3            (col1 spans full height)
  //   col0 and col2 are vertically centred, offset by hexH/2
  //   column horizontal step = 0.75 * hexW
  // With inset = hexW/4, adjacent hexes share edges exactly (no gaps).
  const hexW = Math.max(8, shape.width / 2.5);
  const hexH = Math.max(8, shape.height / 3);

  const cell = (cx, cy) => ({
    x: cx,
    y: cy,
    width: hexW,
    height: hexH,
    d: createTilingHexPath(cx, cy, hexW, hexH)
  });

  const x0 = shape.x;
  const x1 = shape.x + hexW * 0.75;
  const x2 = shape.x + hexW * 1.5;

  return [
    // Column 0 (even): 2 rows, offset down by hexH/2
    cell(x0, shape.y + hexH * 0.5),
    cell(x0, shape.y + hexH * 1.5),
    // Column 1 (odd):  3 rows, no vertical offset
    cell(x1, shape.y),
    cell(x1, shape.y + hexH),
    cell(x1, shape.y + hexH * 2),
    // Column 2 (even): 2 rows, offset down by hexH/2
    cell(x2, shape.y + hexH * 0.5),
    cell(x2, shape.y + hexH * 1.5)
  ];
}

function renderHexImageGrid(group, shape) {
  normalizeMultiImageShape(shape);

  const base = document.createElementNS(SVG_NS, "rect");
  base.setAttribute("x", String(shape.x));
  base.setAttribute("y", String(shape.y));
  base.setAttribute("width", String(shape.width));
  base.setAttribute("height", String(shape.height));
  group.appendChild(base);

  const cells = getHexGridCells(shape);
  cells.forEach((cell, index) => {
    if (shape.imageCells[index]?.src && els.svgDefs) {
      const clipId = `imgclip-${shape.id}-${index}`;
      const clipPath = document.createElementNS(SVG_NS, "clipPath");
      clipPath.setAttribute("id", clipId);
      clipPath.setAttribute("data-dynamic-style", "true");
      const clipPathShape = document.createElementNS(SVG_NS, "path");
      clipPathShape.setAttribute("d", cell.d);
      clipPath.appendChild(clipPathShape);
      els.svgDefs.appendChild(clipPath);

      const image = document.createElementNS(SVG_NS, "image");
      image.setAttribute("x", String(cell.x));
      image.setAttribute("y", String(cell.y));
      image.setAttribute("width", String(cell.width));
      image.setAttribute("height", String(cell.height));
      image.setAttribute("href", shape.imageCells[index].src);
      image.setAttribute("preserveAspectRatio", "xMidYMid slice");
      image.setAttribute("clip-path", `url(#${clipId})`);
      group.appendChild(image);
    }

    const border = document.createElementNS(SVG_NS, "path");
    border.setAttribute("d", cell.d);
    border.setAttribute("fill", "none");
    group.appendChild(border);
  });
}

function extractDroppedImagePayload(dataTransfer) {
  const rawPayload = dataTransfer.getData(SIDE_PANEL_IMAGE_MIME);
  if (rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload);
      if (parsed?.src) {
        return {
          src: String(parsed.src),
          title: String(parsed.title || "image"),
          id: String(parsed.id || "")
        };
      }
    } catch {
      // Ignore invalid payload and continue with fallbacks.
    }
  }

  const uriList = dataTransfer.getData("text/uri-list").trim();
  if (uriList) {
    return { src: uriList, title: "image", id: "" };
  }

  const plainText = dataTransfer.getData("text/plain").trim();
  if (!plainText) {
    return null;
  }

  if (plainText.startsWith("substack-image::")) {
    const json = plainText.slice("substack-image::".length);
    try {
      const parsed = JSON.parse(json);
      if (parsed?.src) {
        return {
          src: String(parsed.src),
          title: String(parsed.title || "image"),
          id: String(parsed.id || "")
        };
      }
    } catch {
      return null;
    }
  }

  const markdownImage = plainText.match(/^!\[[^\]]*\]\((.+)\)$/);
  if (markdownImage?.[1]) {
    return { src: markdownImage[1], title: "image", id: "" };
  }

  return null;
}

function isLineShape(type) {
  return ["line", "arrow-line", "double-arrow", "dashed-line"].includes(type);
}

function createPath(shape, d) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", shape.fill);
  path.setAttribute("stroke", shape.stroke);
  path.setAttribute("stroke-width", String(shape.strokeWidth));
  return path;
}

function createParallelogramPath(x, y, w, h) {
  const skew = w * 0.18;
  return `M ${x + skew} ${y} L ${x + w} ${y} L ${x + w - skew} ${y + h} L ${x} ${y + h} Z`;
}

function createTrapezoidPath(x, y, w, h) {
  const inset = w * 0.18;
  return `M ${x + inset} ${y} L ${x + w - inset} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function createHexagonPath(x, y, w, h) {
  const inset = w * 0.2;
  return `M ${x + inset} ${y} L ${x + w - inset} ${y} L ${x + w} ${y + h / 2} L ${x + w - inset} ${y + h} L ${x + inset} ${y + h} L ${x} ${y + h / 2} Z`;
}

function createTrianglePath(x, y, w, h) {
  return `M ${x} ${y + h} L ${x + w / 2} ${y} L ${x + w} ${y + h} Z`;
}

function createArrowRightPath(x, y, w, h) {
  const notch = w * 0.28;
  return `M ${x} ${y + h * 0.2} L ${x + w - notch} ${y + h * 0.2} L ${x + w - notch} ${y} L ${x + w} ${y + h / 2} L ${x + w - notch} ${y + h} L ${x + w - notch} ${y + h * 0.8} L ${x} ${y + h * 0.8} Z`;
}

function createChevronPath(x, y, w, h) {
  const inset = w * 0.22;
  return `M ${x} ${y} L ${x + w - inset} ${y} L ${x + w} ${y + h / 2} L ${x + w - inset} ${y + h} L ${x} ${y + h} L ${x + inset} ${y + h / 2} Z`;
}

function createDocumentPath(x, y, w, h) {
  const fold = Math.min(w, h) * 0.22;
  const wave = h * 0.08;
  return `M ${x} ${y} L ${x + w - fold} ${y} L ${x + w} ${y + fold} L ${x + w} ${y + h - wave} Q ${x + w * 0.75} ${y + h + wave} ${x + w * 0.5} ${y + h - wave} Q ${x + w * 0.25} ${y + h - wave * 3} ${x} ${y + h} Z`;
}

function createNotePath(x, y, w, h) {
  const cut = Math.min(w, h) * 0.24;
  return `M ${x} ${y} L ${x + w - cut} ${y} L ${x + w} ${y + cut} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function createSpeechPath(x, y, w, h) {
  const tailX = x + w * 0.28;
  const tailY = y + h;
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h * 0.78} L ${tailX + 22} ${y + h * 0.78} L ${tailX} ${tailY} L ${tailX + 4} ${y + h * 0.78} L ${x} ${y + h * 0.78} Z`;
}

function createCloudPath(x, y, w, h) {
  return [
    `M ${x + w * 0.18} ${y + h * 0.7}`,
    `C ${x - w * 0.02} ${y + h * 0.68}, ${x} ${y + h * 0.36}, ${x + w * 0.18} ${y + h * 0.38}`,
    `C ${x + w * 0.2} ${y + h * 0.12}, ${x + w * 0.45} ${y + h * 0.08}, ${x + w * 0.56} ${y + h * 0.28}`,
    `C ${x + w * 0.78} ${y + h * 0.14}, ${x + w * 0.96} ${y + h * 0.34}, ${x + w * 0.84} ${y + h * 0.55}`,
    `C ${x + w * 0.98} ${y + h * 0.78}, ${x + w * 0.72} ${y + h * 0.92}, ${x + w * 0.54} ${y + h * 0.82}`,
    `C ${x + w * 0.36} ${y + h}, ${x + w * 0.1} ${y + h * 0.9}, ${x + w * 0.18} ${y + h * 0.7}`,
    "Z"
  ].join(" ");
}

function createCrescentPath(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const innerR = r * 0.72;
  const innerCx = cx + r * 0.32;
  return [
    `M ${cx} ${cy - r}`,
    `A ${r} ${r} 0 1 1 ${cx} ${cy + r}`,
    `A ${r} ${r} 0 1 1 ${cx} ${cy - r}`,
    `M ${innerCx} ${cy - innerR}`,
    `A ${innerR} ${innerR} 0 1 0 ${innerCx} ${cy + innerR}`,
    `A ${innerR} ${innerR} 0 1 0 ${innerCx} ${cy - innerR}`,
    "Z"
  ].join(" ");
}

function createWavePath(x, y, w, h) {
  return `M ${x} ${y + h / 2} C ${x + w * 0.12} ${y}, ${x + w * 0.22} ${y}, ${x + w * 0.34} ${y + h / 2} S ${x + w * 0.56} ${y + h}, ${x + w * 0.68} ${y + h / 2} S ${x + w * 0.9} ${y}, ${x + w} ${y + h / 2}`;
}

function createCylinderGroup(shape) {
  const group = document.createElementNS(SVG_NS, "g");
  const rimH = Math.max(18, shape.height * 0.18);
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(shape.x));
  rect.setAttribute("y", String(shape.y + rimH / 2));
  rect.setAttribute("width", String(shape.width));
  rect.setAttribute("height", String(shape.height - rimH));
  rect.setAttribute("fill", shape.fill);
  rect.setAttribute("stroke", shape.stroke);
  rect.setAttribute("stroke-width", String(shape.strokeWidth));

  const top = document.createElementNS(SVG_NS, "ellipse");
  top.setAttribute("cx", String(shape.x + shape.width / 2));
  top.setAttribute("cy", String(shape.y + rimH / 2));
  top.setAttribute("rx", String(shape.width / 2));
  top.setAttribute("ry", String(rimH / 2));
  top.setAttribute("fill", shape.fill);
  top.setAttribute("stroke", shape.stroke);
  top.setAttribute("stroke-width", String(shape.strokeWidth));

  const bottom = document.createElementNS(SVG_NS, "path");
  bottom.setAttribute("d", `M ${shape.x} ${shape.y + shape.height - rimH / 2} A ${shape.width / 2} ${rimH / 2} 0 0 0 ${shape.x + shape.width} ${shape.y + shape.height - rimH / 2}`);
  bottom.setAttribute("fill", "none");
  bottom.setAttribute("stroke", shape.stroke);
  bottom.setAttribute("stroke-width", String(shape.strokeWidth));

  group.appendChild(rect);
  group.appendChild(top);
  group.appendChild(bottom);
  return group;
}

function createActorGroup(shape) {
  const group = document.createElementNS(SVG_NS, "g");
  const cx = shape.x + shape.width / 2;
  const headR = Math.min(shape.width, shape.height) * 0.15;
  const head = document.createElementNS(SVG_NS, "circle");
  head.setAttribute("cx", String(cx));
  head.setAttribute("cy", String(shape.y + headR + 6));
  head.setAttribute("r", String(headR));
  head.setAttribute("fill", "none");
  head.setAttribute("stroke", shape.stroke);
  head.setAttribute("stroke-width", String(shape.strokeWidth));

  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute(
    "d",
    `M ${cx} ${shape.y + headR * 2 + 6} L ${cx} ${shape.y + shape.height * 0.62} M ${shape.x + shape.width * 0.18} ${shape.y + shape.height * 0.34} L ${shape.x + shape.width * 0.82} ${shape.y + shape.height * 0.34} M ${cx} ${shape.y + shape.height * 0.62} L ${shape.x + shape.width * 0.22} ${shape.y + shape.height} M ${cx} ${shape.y + shape.height * 0.62} L ${shape.x + shape.width * 0.78} ${shape.y + shape.height}`
  );
  body.setAttribute("fill", "none");
  body.setAttribute("stroke", shape.stroke);
  body.setAttribute("stroke-width", String(shape.strokeWidth));
  body.setAttribute("stroke-linecap", "round");

  group.appendChild(head);
  group.appendChild(body);
  return group;
}

function createStarPath(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const points = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.4;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return `M ${points.join(" L ")} Z`;
}

function createPentagonPath(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const points = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return `M ${points.join(" L ")} Z`;
}

function createArrowLeftPath(x, y, w, h) {
  const notch = w * 0.28;
  return `M ${x + notch} ${y + h * 0.2} L ${x + w} ${y + h * 0.2} L ${x + w} ${y + h * 0.8} L ${x + notch} ${y + h * 0.8} L ${x + notch} ${y + h} L ${x} ${y + h / 2} L ${x + notch} ${y} Z`;
}

function createArrowUpPath(x, y, w, h) {
  const notch = h * 0.28;
  return `M ${x + w * 0.2} ${y + notch} L ${x + w * 0.2} ${y + h} L ${x + w * 0.8} ${y + h} L ${x + w * 0.8} ${y + notch} L ${x + w} ${y + notch} L ${x + w / 2} ${y} L ${x} ${y + notch} Z`;
}

function createArrowDownPath(x, y, w, h) {
  const notch = h * 0.28;
  return `M ${x + w * 0.2} ${y} L ${x + w * 0.2} ${y + h - notch} L ${x} ${y + h - notch} L ${x + w / 2} ${y + h} L ${x + w} ${y + h - notch} L ${x + w * 0.8} ${y + h - notch} L ${x + w * 0.8} ${y} Z`;
}

function createDatabaseGroup(shape) {
  const group = document.createElementNS(SVG_NS, "g");
  const rimH = Math.max(18, shape.height * 0.2);

  const body = document.createElementNS(SVG_NS, "rect");
  body.setAttribute("x", String(shape.x));
  body.setAttribute("y", String(shape.y + rimH / 2));
  body.setAttribute("width", String(shape.width));
  body.setAttribute("height", String(shape.height - rimH));
  body.setAttribute("fill", shape.fill);
  body.setAttribute("stroke", shape.stroke);
  body.setAttribute("stroke-width", String(shape.strokeWidth));

  const top = document.createElementNS(SVG_NS, "ellipse");
  top.setAttribute("cx", String(shape.x + shape.width / 2));
  top.setAttribute("cy", String(shape.y + rimH / 2));
  top.setAttribute("rx", String(shape.width / 2));
  top.setAttribute("ry", String(rimH / 2));
  top.setAttribute("fill", shape.fill);
  top.setAttribute("stroke", shape.stroke);
  top.setAttribute("stroke-width", String(shape.strokeWidth));

  const bottom = document.createElementNS(SVG_NS, "ellipse");
  bottom.setAttribute("cx", String(shape.x + shape.width / 2));
  bottom.setAttribute("cy", String(shape.y + shape.height - rimH / 2));
  bottom.setAttribute("rx", String(shape.width / 2));
  bottom.setAttribute("ry", String(rimH / 2));
  bottom.setAttribute("fill", shape.fill);
  bottom.setAttribute("stroke", shape.stroke);
  bottom.setAttribute("stroke-width", String(shape.strokeWidth));

  group.appendChild(body);
  group.appendChild(top);
  group.appendChild(bottom);
  return group;
}

function createCalloutRectPath(x, y, w, h) {
  const pointX = x + w * 0.15;
  const pointY = y + h;
  const tailX = pointX - 12;
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h * 0.8} L ${pointX + 12} ${y + h * 0.8} L ${pointX} ${pointY} L ${tailX} ${y + h * 0.8} L ${x} ${y + h * 0.8} Z`;
}

function createCalloutCirclePath(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const pointX = x + w * 0.15;
  const pointY = y + h;
  const tailX = pointX - 12;
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} M ${pointX} ${y + h * 0.8} L ${pointX} ${pointY} L ${tailX} ${y + h * 0.8}`;
}

function createFlowchartProcessPath(x, y, w, h) {
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function createFlowchartDecisionPath(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`;
}

function createFlowchartTerminatorPath(x, y, w, h) {
  const cornerR = Math.min(w, h) * 0.25;
  return `M ${x + cornerR} ${y} L ${x + w - cornerR} ${y} A ${cornerR} ${cornerR} 0 0 1 ${x + w} ${y + cornerR} L ${x + w} ${y + h - cornerR} A ${cornerR} ${cornerR} 0 0 1 ${x + w - cornerR} ${y + h} L ${x + cornerR} ${y + h} A ${cornerR} ${cornerR} 0 0 1 ${x} ${y + h - cornerR} L ${x} ${y + cornerR} A ${cornerR} ${cornerR} 0 0 1 ${x + cornerR} ${y} Z`;
}

function createFlowchartDataPath(x, y, w, h) {
  return createParallelogramPath(x, y, w, h);
}

function createCalloutLeftPath(x, y, w, h) {
  const tailW = 16;
  const tailX = x - tailW;
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} L ${x} ${y + h * 0.65} L ${tailX} ${y + h / 2} L ${x} ${y + h * 0.35} Z`;
}

function createCalloutRightPath(x, y, w, h) {
  const tailW = 16;
  const tailX = x + w + tailW;
  return `M ${x} ${y} L ${x + w} ${y} L ${tailX} ${y + h * 0.35} L ${x + w} ${y + h * 0.35} L ${x + w} ${y + h * 0.65} L ${tailX} ${y + h / 2} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function createCalloutUpPath(x, y, w, h) {
  const tailH = 16;
  const tailY = y - tailH;
  return `M ${x} ${y} L ${x + w * 0.35} ${y} L ${x + w / 2} ${tailY} L ${x + w * 0.65} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function createCalloutDownPath(x, y, w, h) {
  const tailH = 16;
  const tailY = y + h + tailH;
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x + w * 0.65} ${y + h} L ${x + w / 2} ${tailY} L ${x + w * 0.35} ${y + h} L ${x} ${y + h} Z`;
}

function createBracketLeftPath(x, y, w, h) {
  const notch = w * 0.4;
  return `M ${x + w} ${y} L ${x + notch} ${y} L ${x + notch} ${y + h * 0.3} L ${x} ${y + h * 0.3} L ${x} ${y + h * 0.7} L ${x + notch} ${y + h * 0.7} L ${x + notch} ${y + h} L ${x + w} ${y + h}`;
}

function createBracketRightPath(x, y, w, h) {
  const notch = w * 0.4;
  return `M ${x} ${y} L ${x + w - notch} ${y} L ${x + w - notch} ${y + h * 0.3} L ${x + w} ${y + h * 0.3} L ${x + w} ${y + h * 0.7} L ${x + w - notch} ${y + h * 0.7} L ${x + w - notch} ${y + h} L ${x} ${y + h}`;
}

function createArrowLeftRightPath(x, y, w, h) {
  const notch = w * 0.2;
  return `M ${x} ${y + h / 2} L ${x + notch} ${y + h * 0.3} L ${x + notch} ${y + h * 0.45} L ${x + w - notch} ${y + h * 0.45} L ${x + w - notch} ${y + h * 0.3} L ${x + w} ${y + h / 2} L ${x + w - notch} ${y + h * 0.7} L ${x + w - notch} ${y + h * 0.55} L ${x + notch} ${y + h * 0.55} L ${x + notch} ${y + h * 0.7} Z`;
}

function createRightArrowBoldPath(x, y, w, h) {
  const notch = w * 0.35;
  return `M ${x} ${y + h * 0.2} L ${x + w - notch} ${y + h * 0.2} L ${x + w - notch} ${y + h * 0.35} L ${x + w} ${y + h / 2} L ${x + w - notch} ${y + h * 0.65} L ${x + w - notch} ${y + h * 0.8} L ${x} ${y + h * 0.8} Z`;
}

function createHexagonFlatPath(x, y, w, h) {
  const sideWidth = w * 0.25;
  return `M ${x + sideWidth} ${y} L ${x + w - sideWidth} ${y} L ${x + w} ${y + h / 2} L ${x + w - sideWidth} ${y + h} L ${x + sideWidth} ${y + h} L ${x} ${y + h / 2} Z`;
}

function createPlusPath(x, y, w, h) {
  const sw = w * 0.3;
  const sh = h * 0.3;
  return `M ${x + w / 2 - sw / 2} ${y} L ${x + w / 2 + sw / 2} ${y} L ${x + w / 2 + sw / 2} ${y + h / 2 - sh / 2} L ${x + w} ${y + h / 2 - sh / 2} L ${x + w} ${y + h / 2 + sh / 2} L ${x + w / 2 + sw / 2} ${y + h / 2 + sh / 2} L ${x + w / 2 + sw / 2} ${y + h} L ${x + w / 2 - sw / 2} ${y + h} L ${x + w / 2 - sw / 2} ${y + h / 2 + sh / 2} L ${x} ${y + h / 2 + sh / 2} L ${x} ${y + h / 2 - sh / 2} L ${x + w / 2 - sw / 2} ${y + h / 2 - sh / 2} Z`;
}

function createMinusPath(x, y, w, h) {
  const sw = w * 0.3;
  return `M ${x} ${y + h / 2 - sw / 2} L ${x + w} ${y + h / 2 - sw / 2} L ${x + w} ${y + h / 2 + sw / 2} L ${x} ${y + h / 2 + sw / 2} Z`;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeColor(value, fallback) {
  const input = String(value || "").trim();
  const hex = /^#[0-9a-f]{6}$/i.test(input);
  return hex ? input : fallback;
}

function isTextInputTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function canEditShapeText(shape) {
  return Boolean(shape) && (shape.type === "text" || supportsInnerText(shape.type) || isLineShape(shape.type));
}

function openTextEditor(shape) {
  closeTextEditor({ commit: true });

  const bounds = getShapeBounds(shape);
  const editor = document.createElement("textarea");
  editor.className = "shape-text-editor";
  editor.value = shape.text || "";
  editor.setAttribute("data-shape-id", shape.id);

  editor.style.left = `${Math.max(0, bounds.x)}px`;
  editor.style.top = `${Math.max(0, bounds.y)}px`;
  editor.style.width = `${Math.max(120, bounds.width)}px`;
  editor.style.height = `${Math.max(46, bounds.height)}px`;
  editor.style.fontSize = `${Math.max(10, toNumber(shape.textSize, 22))}px`;

  if (shape.textAlign === "end") {
    editor.style.textAlign = "right";
  } else if (shape.textAlign === "middle") {
    editor.style.textAlign = "center";
  } else {
    editor.style.textAlign = "left";
  }

  const commit = () => {
    const target = getShapeById(shape.id);
    if (!target) {
      return;
    }
    target.text = editor.value;
    els.textValue.value = editor.value;
    renderShapes();
    setStatus(els.statusText, "Text updated.");
  };

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTextEditor({ commit: false });
      renderShapes();
      return;
    }

    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;
      editor.value = `${value.slice(0, start)}\n${value.slice(end)}`;
      editor.selectionStart = start + 1;
      editor.selectionEnd = start + 1;
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      closeTextEditor({ commit: true });
      return;
    }
  });

  editor.addEventListener("blur", () => {
    if (state.textEditor?.element !== editor) {
      return;
    }
    closeTextEditor({ commit: true });
  });

  els.canvasWrap?.appendChild(editor);
  state.textEditor = {
    shapeId: shape.id,
    element: editor,
    commit
  };

  editor.focus();
  editor.select();
}

function closeTextEditor({ commit }) {
  if (!state.textEditor || !state.textEditor.element) {
    return;
  }

  const active = state.textEditor;
  state.textEditor = null;

  if (commit) {
    active.commit();
  }

  active.element.remove();
}

function appendMultilineText(textNode, rawText, options) {
  const text = String(rawText || "");
  const lines = text.split(/\r?\n/);
  const lineHeight = Math.max(12, options.textSize * 1.2);
  const baselineOffset = options.textSize * 0.35;
  const startY = options.centerBlock
    ? options.y - ((lines.length - 1) * lineHeight) / 2 + baselineOffset
    : options.y;

  textNode.setAttribute("x", String(options.x));
  textNode.setAttribute("y", String(startY));
  textNode.setAttribute("font-size", String(options.textSize));
  textNode.setAttribute("fill", options.fill);
  textNode.setAttribute("xml:space", "preserve");

  lines.forEach((line, index) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", String(options.x));
    if (index > 0) {
      tspan.setAttribute("dy", String(lineHeight));
    }
    tspan.textContent = line.length > 0 ? line : " ";
    textNode.appendChild(tspan);
  });
}

function cropCanvas() {
  if (state.shapes.length === 0) {
    setStatus(els.statusText, "Nothing to crop.", true);
    return;
  }

  const MARGIN = 10;

  // Compute the union bounding box of all shapes (accounting for rotation).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const shape of state.shapes) {
    const bounds = getShapeBounds(shape);
    const sw = toNumber(shape.strokeWidth, 2) / 2;
    minX = Math.min(minX, bounds.x - sw);
    minY = Math.min(minY, bounds.y - sw);
    maxX = Math.max(maxX, bounds.x + bounds.width + sw);
    maxY = Math.max(maxY, bounds.y + bounds.height + sw);
  }

  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  const newWidth = Math.ceil(maxX - minX + MARGIN * 2);
  const newHeight = Math.ceil(maxY - minY + MARGIN * 2);

  // Shift all shapes so the top-left bounding edge lands at (MARGIN, MARGIN).
  for (const shape of state.shapes) {
    shape.x += dx;
    shape.y += dy;
  }

  // Resize the SVG to the cropped dimensions without scaling the artwork.
  // Keeping width/height in sync with the cropped viewBox prevents zooming when
  // the new canvas is smaller than the surrounding viewport.
  els.svg.setAttribute("viewBox", `0 0 ${newWidth} ${newHeight}`);
  els.svg.setAttribute("width", String(newWidth));
  els.svg.setAttribute("height", String(newHeight));
  els.svg.style.width = `${newWidth}px`;
  els.svg.style.height = `${newHeight}px`;

  // Also resize the grid background rects inside the SVG defs (not critical, cosmetic).
  const gridBg = els.svg.querySelector("rect[fill='url(#majorGridPattern)']");
  if (gridBg) {
    gridBg.setAttribute("width", String(newWidth));
    gridBg.setAttribute("height", String(newHeight));
  }

  state.selectedIds.clear();
  state.selectedId = "";
  renderShapes();
  setStatus(els.statusText, `Canvas cropped to ${newWidth}×${newHeight}.`);
}

async function exportSvgToCanvas({ download }) {
  const clonedSvg = els.svg.cloneNode(true);
  clonedSvg.querySelector("#selection-layer")?.replaceChildren();

  // Remove grid patterns and background rect from the export clone.
  clonedSvg.querySelector("#gridPattern")?.remove();
  clonedSvg.querySelector("#majorGridPattern")?.remove();
  for (const child of Array.from(clonedSvg.children)) {
    const fill = child.getAttribute("fill") || "";
    if (child.tagName === "rect" && fill.startsWith("url(#")) {
      child.remove();
      break;
    }
  }

  // Add white background so the canvas isn't transparent.
  const viewBox = els.svg.getAttribute("viewBox") || "0 0 1400 900";
  const [, , vbWidth, vbHeight] = viewBox.split(" ").map(Number);
  const exportWidth = vbWidth || 1400;
  const exportHeight = vbHeight || 900;

  const bgRect = document.createElementNS(SVG_NS, "rect");
  bgRect.setAttribute("x", "0");
  bgRect.setAttribute("y", "0");
  bgRect.setAttribute("width", String(exportWidth));
  bgRect.setAttribute("height", String(exportHeight));
  bgRect.setAttribute("fill", "#ffffff");
  const shapeLayerClone = clonedSvg.querySelector("#shape-layer");
  clonedSvg.insertBefore(bgRect, shapeLayerClone);

  // Embed a <style> element so text elements use the correct font family when
  // the SVG is serialized and loaded as a blob URL (document CSS is not inherited).
  const styleEl = document.createElementNS(SVG_NS, "style");
  styleEl.textContent = "text { font-family: 'IBM Plex Sans', 'Segoe UI', Arial, sans-serif; font-weight: 600; }";
  clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);

  const serialized = new XMLSerializer().serializeToString(clonedSvg);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not render diagram."));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = exportWidth;
  canvas.height = exportHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  URL.revokeObjectURL(url);

  if (download) {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `diagram-${Date.now()}.png`;
    link.click();
  }

  return canvas;
}
