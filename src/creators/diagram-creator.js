import { getAssetIdFromQuery, getImageAssetById, parseDataLines, saveCanvasAsImage, setStatus } from "./shared.js";

const PALETTE = ["#2f5f4f", "#d9652b", "#3a7ca5", "#b85c38", "#7a8f2d", "#6c5b7b", "#a44a3f"];

const els = {
  statusText: document.querySelector("#status-text"),
  diagramType: document.querySelector("#diagram-type"),
  diagramTitle: document.querySelector("#diagram-title"),
  diagramData: document.querySelector("#diagram-data"),
  canvas: document.querySelector("#diagram-canvas")
};

const ctx = els.canvas.getContext("2d");

bindActions();
void init();

async function init() {
  const restored = await restoreSavedDiagram();
  if (!restored) {
    loadExample();
  }
  renderDiagram();
}

function bindActions() {
  document.querySelector("#load-diagram-example").addEventListener("click", () => {
    loadExample();
    renderDiagram();
  });

  document.querySelector("#render-diagram").addEventListener("click", () => {
    renderDiagram();
  });

  document.querySelector("#save-diagram").addEventListener("click", async () => {
    try {
      await saveCanvasAsImage(els.canvas, `Diagram: ${els.diagramTitle.value.trim() || "Untitled"}`, els.statusText, {
        assetType: "diagram",
        editor: {
          type: "diagram-creator",
          path: "src/creators/diagram-creator.html"
        },
        editorState: {
          diagramType: els.diagramType.value,
          title: els.diagramTitle.value.trim(),
          dataLines: parseDataLines(els.diagramData.value)
        }
      });
    } catch (error) {
      setStatus(els.statusText, error.message, true);
    }
  });
}

async function restoreSavedDiagram() {
  const asset = await getImageAssetById(getAssetIdFromQuery());
  const state = asset?.editorState;
  if (!state) {
    return false;
  }

  els.diagramType.value = state.diagramType || "bar";
  els.diagramTitle.value = state.title || els.diagramTitle.value;
  els.diagramData.value = Array.isArray(state.dataLines) ? state.dataLines.join("\n") : "";
  return true;
}

function loadExample() {
  els.diagramData.value = ["North,120", "South,80", "East,105", "West,95"].join("\n");
}

function renderDiagram() {
  const dataset = parseDataset(els.diagramData.value);
  if (!dataset.length) {
    setStatus(els.statusText, "Enter at least one data line: Label,Value", true);
    return;
  }

  drawBase();
  drawTitle(els.diagramTitle.value.trim() || "My Diagram");

  const type = els.diagramType.value;
  let didRender = true;
  if (type === "pie") {
    didRender = drawPie(dataset);
  } else if (type === "line") {
    drawLine(dataset);
  } else {
    drawBars(dataset);
  }

  if (didRender) {
    setStatus(els.statusText, `Rendered ${type} diagram with ${dataset.length} values.`);
  }
}

function parseDataset(text) {
  const lines = parseDataLines(text);
  return lines
    .map((line) => {
      const [label, valueRaw] = line.split(",");
      const value = Number((valueRaw || "").trim());
      if (!label?.trim() || !Number.isFinite(value)) {
        return null;
      }
      return { label: label.trim(), value };
    })
    .filter(Boolean);
}

function drawBase() {
  const gradient = ctx.createLinearGradient(0, 0, els.canvas.width, els.canvas.height);
  gradient.addColorStop(0, "#fff7ea");
  gradient.addColorStop(1, "#edf8f2");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
}

function drawTitle(title) {
  ctx.fillStyle = "#1f2a1f";
  ctx.font = "700 38px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  ctx.fillText(title, 42, 58);
  ctx.strokeStyle = "rgba(47, 95, 79, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(42, 74);
  ctx.lineTo(els.canvas.width - 42, 74);
  ctx.stroke();
}

function drawBars(dataset) {
  const left = 120;
  const right = els.canvas.width - 80;
  const bottom = els.canvas.height - 80;
  const top = 120;
  const max = Math.max(...dataset.map((x) => x.value), 1);

  drawAxes(left, top, right, bottom);

  const plotWidth = right - left;
  const step = plotWidth / dataset.length;
  const barWidth = Math.min(90, step * 0.65);

  dataset.forEach((point, i) => {
    const x = left + i * step + (step - barWidth) / 2;
    const h = ((bottom - top) * point.value) / max;
    const y = bottom - h;

    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fillRect(x, y, barWidth, h);

    ctx.fillStyle = "#1f2a1f";
    ctx.font = "600 15px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const labelW = ctx.measureText(point.label).width;
    ctx.fillText(point.label, x + (barWidth - labelW) / 2, bottom + 24);

    const valueText = String(point.value);
    const valueW = ctx.measureText(valueText).width;
    ctx.fillText(valueText, x + (barWidth - valueW) / 2, y - 8);
  });
}

function drawLine(dataset) {
  const left = 110;
  const right = els.canvas.width - 70;
  const bottom = els.canvas.height - 90;
  const top = 130;
  const max = Math.max(...dataset.map((x) => x.value), 1);

  drawAxes(left, top, right, bottom);

  const stepX = dataset.length > 1 ? (right - left) / (dataset.length - 1) : 0;

  ctx.strokeStyle = "#2f5f4f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  dataset.forEach((point, i) => {
    const x = left + i * stepX;
    const y = bottom - ((bottom - top) * point.value) / max;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  dataset.forEach((point, i) => {
    const x = left + i * stepX;
    const y = bottom - ((bottom - top) * point.value) / max;

    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#1f2a1f";
    ctx.font = "600 14px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const labelW = ctx.measureText(point.label).width;
    ctx.fillText(point.label, x - labelW / 2, bottom + 24);
    ctx.fillText(String(point.value), x - 10, y - 12);
  });
}

function drawPie(dataset) {
  const total = dataset.reduce((sum, point) => sum + Math.max(0, point.value), 0);
  if (total <= 0) {
    setStatus(els.statusText, "Pie chart needs positive values.", true);
    return false;
  }

  const cx = els.canvas.width * 0.37;
  const cy = els.canvas.height * 0.52;
  const radius = Math.min(els.canvas.width, els.canvas.height) * 0.28;

  let startAngle = -Math.PI / 2;
  dataset.forEach((point, i) => {
    const fraction = point.value / total;
    const angle = fraction * Math.PI * 2;
    const endAngle = startAngle + angle;

    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();

    const mid = (startAngle + endAngle) / 2;
    const labelX = cx + Math.cos(mid) * (radius * 0.68);
    const labelY = cy + Math.sin(mid) * (radius * 0.68);
    const pctText = `${Math.round(fraction * 100)}%`;

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 18px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const textW = ctx.measureText(pctText).width;
    ctx.fillText(pctText, labelX - textW / 2, labelY + 6);

    startAngle = endAngle;
  });

  const legendX = els.canvas.width * 0.66;
  let legendY = 190;
  dataset.forEach((point, i) => {
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fillRect(legendX, legendY - 14, 22, 22);
    ctx.fillStyle = "#1f2a1f";
    ctx.font = "600 18px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const text = `${point.label} (${point.value})`;
    ctx.fillText(text, legendX + 34, legendY + 4);
    legendY += 38;
  });

  return true;
}

function drawAxes(left, top, right, bottom) {
  ctx.strokeStyle = "#607468";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
}
