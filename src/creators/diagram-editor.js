import { getAssetIdFromQuery, getImageAssetById, saveCanvasAsImage, setStatus } from "./shared.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const els = {
  statusText: document.querySelector("#status-text"),
  svg: document.querySelector("#diagram-svg"),
  shapeLayer: document.querySelector("#shape-layer"),
  selectionLayer: document.querySelector("#selection-layer"),
  fillColor: document.querySelector("#fill-color"),
  strokeColor: document.querySelector("#stroke-color"),
  strokeWidth: document.querySelector("#stroke-width"),
  textValue: document.querySelector("#text-value"),
  textSize: document.querySelector("#text-size"),
  textAlign: document.querySelector("#text-align")
};

const state = {
  tool: "select",
  selectedId: "",
  shapes: [],
  drag: null,
  resize: null
};

bindActions();
void init();

async function init() {
  await restoreSavedDiagramEditor();
  renderShapes();
}

function bindActions() {
  document.querySelectorAll(".tool-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.tool = button.getAttribute("data-tool") || "select";
      document.querySelectorAll(".tool-btn").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      els.svg.classList.toggle("select-mode", state.tool === "select");
      setStatus(els.statusText, `Tool: ${state.tool}`);
    });
  });

  els.svg.addEventListener("click", (event) => {
    const point = pointerToSvg(event);
    if (!point) return;

    const shapeGroup = event.target.closest("g.shape-group");
    if (shapeGroup) {
      const id = shapeGroup.getAttribute("data-id");
      if (id) {
        state.selectedId = id;
        syncStyleInputs();
        renderSelection();
      }
      return;
    }

    if (state.tool === "select") {
      state.selectedId = "";
      renderSelection();
      return;
    }

    createShapeAt(point.x, point.y);
  });

  els.svg.addEventListener("mousedown", (event) => {
    if (state.resize) {
      return;
    }

    if (state.tool !== "select") {
      return;
    }

    const shapeGroup = event.target.closest("g.shape-group");
    if (!shapeGroup) {
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

    state.selectedId = id;
    state.drag = {
      id,
      startX: point.x,
      startY: point.y,
      shapeX: shape.x,
      shapeY: shape.y
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
    state.resize = {
      id: shapeId,
      handle,
      startX: point.x,
      startY: point.y,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height
    };
  });

  window.addEventListener("mousemove", (event) => {
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
      return;
    }

    const point = pointerToSvg(event);
    if (!point) {
      return;
    }

    const shape = getShapeById(state.drag.id);
    if (!shape) {
      return;
    }

    const dx = point.x - state.drag.startX;
    const dy = point.y - state.drag.startY;
    shape.x = Math.max(0, state.drag.shapeX + dx);
    shape.y = Math.max(0, state.drag.shapeY + dy);
    renderShapes();
  });

  window.addEventListener("mouseup", () => {
    if (state.resize) {
      state.resize = null;
      setStatus(els.statusText, "Shape resized.");
    }

    if (state.drag) {
      state.drag = null;
      setStatus(els.statusText, "Shape moved.");
    }
  });

  document.querySelector("#btn-apply-style").addEventListener("click", () => {
    const shape = getShapeById(state.selectedId);
    if (!shape) {
      return setStatus(els.statusText, "Select a shape first.", true);
    }

    shape.fill = els.fillColor.value;
    shape.stroke = els.strokeColor.value;
    shape.strokeWidth = toNumber(els.strokeWidth.value, 2);
    shape.text = els.textValue.value;
    shape.textSize = toNumber(els.textSize.value, 22);
    shape.textAlign = els.textAlign.value;
    renderShapes();
    setStatus(els.statusText, "Style applied.");
  });

  document.querySelector("#btn-delete").addEventListener("click", () => {
    if (!state.selectedId) {
      return setStatus(els.statusText, "Select an object to delete.", true);
    }

    state.shapes = state.shapes.filter((shape) => shape.id !== state.selectedId);
    state.selectedId = "";
    renderShapes();
    setStatus(els.statusText, "Shape deleted.");
  });

  document.querySelector("#btn-duplicate").addEventListener("click", () => {
    const shape = getShapeById(state.selectedId);
    if (!shape) {
      return setStatus(els.statusText, "Select a shape first.", true);
    }

    const copy = {
      ...shape,
      id: crypto.randomUUID(),
      x: shape.x + 30,
      y: shape.y + 24
    };
    state.shapes.push(copy);
    state.selectedId = copy.id;
    renderShapes();
    setStatus(els.statusText, "Duplicated.");
  });

  document.querySelector("#btn-clear").addEventListener("click", () => {
    state.shapes = [];
    state.selectedId = "";
    renderShapes();
    setStatus(els.statusText, "Canvas cleared.");
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
          fillColor: els.fillColor.value,
          strokeColor: els.strokeColor.value,
          strokeWidth: els.strokeWidth.value,
          textValue: els.textValue.value,
          textSize: els.textSize.value,
          textAlign: els.textAlign.value
        }
      });
    } catch (error) {
      setStatus(els.statusText, error.message, true);
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
  els.fillColor.value = saved.fillColor || els.fillColor.value;
  els.strokeColor.value = saved.strokeColor || els.strokeColor.value;
  els.strokeWidth.value = saved.strokeWidth || els.strokeWidth.value;
  els.textValue.value = saved.textValue || els.textValue.value;
  els.textSize.value = saved.textSize || els.textSize.value;
  els.textAlign.value = saved.textAlign || els.textAlign.value;
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
    fill: els.fillColor.value,
    stroke: els.strokeColor.value,
    strokeWidth: toNumber(els.strokeWidth.value, 2),
    text: els.textValue.value || "Text",
    textSize: toNumber(els.textSize.value, 22),
    textAlign: els.textAlign.value
  };

  if (isLineShape(common.type)) {
    common.width = 220;
    common.height = 0;
  }

  if (["square", "circle", "actor", "crescent"].includes(common.type)) {
    common.width = 110;
    common.height = 110;
  }

  if (["triangle", "hexagon", "arrow-right", "chevron", "parallelogram", "trapezoid"].includes(common.type)) {
    common.width = 180;
    common.height = 110;
  }

  if (["cloud", "speech", "document", "note", "cylinder"].includes(common.type)) {
    common.width = 180;
    common.height = 120;
  }

  if (common.type === "wave") {
    common.width = 200;
    common.height = 60;
    common.fill = "transparent";
  }

  if (common.type === "text") {
    common.fill = "transparent";
    common.stroke = "transparent";
    common.width = 200;
    common.height = 60;
  }

  state.shapes.push(common);
  state.selectedId = common.id;
  renderShapes();
  setStatus(els.statusText, `${state.tool} added.`);
}

function renderShapes() {
  els.shapeLayer.innerHTML = "";

  for (const shape of state.shapes) {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "shape-group");
    group.setAttribute("data-id", shape.id);

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
    }

    if (supportsInnerText(shape.type)) {
      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = shape.text || "";
      text.setAttribute("x", String(shape.x + shape.width / 2));
      text.setAttribute("y", String(shape.y + shape.height / 2 + shape.textSize * 0.35));
      text.setAttribute("text-anchor", shape.textAlign || "middle");
      if (shape.textAlign === "start") {
        text.setAttribute("x", String(shape.x + 12));
      }
      if (shape.textAlign === "end") {
        text.setAttribute("x", String(shape.x + shape.width - 12));
      }
      text.setAttribute("font-size", String(shape.textSize));
      text.setAttribute("fill", "#1f2a1f");
      text.setAttribute("font-weight", "600");
      group.appendChild(text);
    } else if (isLineShape(shape.type) && shape.text) {
      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = shape.text;
      text.setAttribute("x", String(shape.x + shape.width / 2));
      text.setAttribute("y", String(shape.y - 10));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", String(shape.textSize));
      text.setAttribute("fill", shape.stroke);
      text.setAttribute("font-weight", "600");
      group.appendChild(text);
    }

    if (shape.type === "text") {
      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = shape.text || "Text";
      text.setAttribute("x", String(shape.x));
      text.setAttribute("y", String(shape.y + shape.textSize));
      text.setAttribute("text-anchor", shape.textAlign || "start");
      if (shape.textAlign === "middle") {
        text.setAttribute("x", String(shape.x + shape.width / 2));
      }
      if (shape.textAlign === "end") {
        text.setAttribute("x", String(shape.x + shape.width));
      }
      text.setAttribute("font-size", String(shape.textSize));
      text.setAttribute("fill", shape.stroke === "transparent" ? "#1f2a1f" : shape.stroke);
      text.setAttribute("font-weight", "600");
      group.appendChild(text);
    }

    els.shapeLayer.appendChild(group);
  }

  renderSelection();
}

function renderSelection() {
  els.selectionLayer.innerHTML = "";
  const shape = getShapeById(state.selectedId);
  if (!shape) {
    return;
  }

  const bounds = getShapeBounds(shape);
  const minX = bounds.x;
  const minY = bounds.y;
  const width = bounds.width;
  const height = bounds.height;

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", "selection-box");
  rect.setAttribute("x", String(minX - 6));
  rect.setAttribute("y", String(minY - 6));
  rect.setAttribute("width", String(Math.max(16, width + 12)));
  rect.setAttribute("height", String(Math.max(16, height + 12)));
  els.selectionLayer.appendChild(rect);

  if (isLineShape(shape.type)) {
    const startHandle = createResizeHandle(shape.x, shape.y, "line-start", shape.id);
    const endHandle = createResizeHandle(shape.x + shape.width, shape.y + shape.height, "line-end", shape.id);
    els.selectionLayer.appendChild(startHandle);
    els.selectionLayer.appendChild(endHandle);
    return;
  }

  const handles = [
    { name: "nw", x: minX, y: minY },
    { name: "n", x: minX + width / 2, y: minY },
    { name: "ne", x: minX + width, y: minY },
    { name: "e", x: minX + width, y: minY + height / 2 },
    { name: "se", x: minX + width, y: minY + height },
    { name: "s", x: minX + width / 2, y: minY + height },
    { name: "sw", x: minX, y: minY + height },
    { name: "w", x: minX, y: minY + height / 2 }
  ];

  for (const handle of handles) {
    els.selectionLayer.appendChild(createResizeHandle(handle.x, handle.y, handle.name, shape.id));
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

  if (right - left < minSize) {
    if (resizeState.handle.includes("w")) {
      left = right - minSize;
    } else if (resizeState.handle.includes("e")) {
      right = left + minSize;
    }
  }

  if (bottom - top < minSize) {
    if (resizeState.handle.includes("n")) {
      top = bottom - minSize;
    } else if (resizeState.handle.includes("s")) {
      bottom = top + minSize;
    }
  }

  shape.x = left;
  shape.y = top;
  shape.width = Math.max(minSize, right - left);
  shape.height = Math.max(minSize, bottom - top);
}

function getShapeBounds(shape) {
  if (isLineShape(shape.type)) {
    const x1 = shape.x;
    const y1 = shape.y;
    const x2 = shape.x + shape.width;
    const y2 = shape.y + shape.height;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.max(1, Math.abs(x2 - x1)),
      height: Math.max(1, Math.abs(y2 - y1))
    };
  }

  return {
    x: shape.x,
    y: shape.y,
    width: Math.max(1, shape.width),
    height: Math.max(1, shape.height)
  };
}

function syncStyleInputs() {
  const shape = getShapeById(state.selectedId);
  if (!shape) {
    return;
  }

  if (shape.fill && shape.fill !== "transparent") {
    els.fillColor.value = normalizeColor(shape.fill, els.fillColor.value);
  }
  if (shape.stroke && shape.stroke !== "transparent") {
    els.strokeColor.value = normalizeColor(shape.stroke, els.strokeColor.value);
  }
  els.strokeWidth.value = String(shape.strokeWidth || 2);
  els.textValue.value = shape.text || "";
  els.textSize.value = String(shape.textSize || 22);
  els.textAlign.value = shape.textAlign || "middle";
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
  return !isLineShape(type) && type !== "text" && type !== "actor" && type !== "wave";
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

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeColor(value, fallback) {
  const input = String(value || "").trim();
  const hex = /^#[0-9a-f]{6}$/i.test(input);
  return hex ? input : fallback;
}

async function exportSvgToCanvas({ download }) {
  const clonedSvg = els.svg.cloneNode(true);
  clonedSvg.querySelector("#selection-layer")?.replaceChildren();

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
  canvas.width = 1400;
  canvas.height = 900;
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
