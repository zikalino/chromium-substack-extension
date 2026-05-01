import { getAssetIdFromQuery, getImageAssetById, saveCanvasAsImage, setStatus } from "./shared.js";

const MAX_ROWS = 10;
const MAX_COLS = 6;

const els = {
  statusText: document.querySelector("#status-text"),
  chartTabs: document.querySelectorAll(".chart-tab"),
  panelTabs: document.querySelectorAll(".panel-tab"),
  panelData: document.querySelector("#panel-data"),
  panelImport: document.querySelector("#panel-import"),
  panelSettings: document.querySelector("#panel-settings"),
  dataTable: document.querySelector("#data-table"),
  addRow: document.querySelector("#add-row"),
  addCol: document.querySelector("#add-col"),
  renderFromGrid: document.querySelector("#render-from-grid"),
  importCsv: document.querySelector("#import-csv"),
  importApply: document.querySelector("#import-apply"),
  chartTitle: document.querySelector("#chart-title"),
  seriesColumn: document.querySelector("#series-column"),
  primaryColor: document.querySelector("#primary-color"),
  secondaryColor: document.querySelector("#secondary-color"),
  showValues: document.querySelector("#show-values"),
  applySettings: document.querySelector("#apply-settings"),
  downloadChart: document.querySelector("#download-chart"),
  saveChart: document.querySelector("#save-chart"),
  canvas: document.querySelector("#chart-canvas")
};

const ctx = els.canvas.getContext("2d");

const state = {
  chartType: "bar",
  rows: 6,
  cols: 3,
  seriesColumn: "1",
  grid: [
    ["Label", "item1", "item2"],
    ["Item1", "10", "20"],
    ["Item2", "20", "35"],
    ["Item3", "30", "42"],
    ["Item4", "40", "49"],
    ["Item5", "50", "55"]
  ]
};

bindActions();
void init();

async function init() {
  await restoreSavedGraph();
  renderTable();
  applyChartTabSelection();
  renderChart();
}

function bindActions() {
  els.chartTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.chartTabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.chartType = tab.getAttribute("data-chart") || "bar";
      renderChart();
    });
  });

  els.panelTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.panelTabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      const panel = tab.getAttribute("data-panel");
      els.panelData.classList.toggle("hidden", panel !== "data");
      els.panelImport.classList.toggle("hidden", panel !== "import");
      els.panelSettings.classList.toggle("hidden", panel !== "settings");
    });
  });

  els.addRow.addEventListener("click", () => {
    if (state.rows >= MAX_ROWS) {
      return setStatus(els.statusText, `Max rows: ${MAX_ROWS}`, true);
    }
    const newRow = Array.from({ length: state.cols }, (_, i) => (i === 0 ? `Item${state.rows}` : "0"));
    state.grid.push(newRow);
    state.rows += 1;
    renderTable();
  });

  els.addCol.addEventListener("click", () => {
    if (state.cols >= MAX_COLS) {
      return setStatus(els.statusText, `Max columns: ${MAX_COLS}`, true);
    }
    state.grid.forEach((row, rowIndex) => {
      row.push(rowIndex === 0 ? `item${state.cols}` : "0");
    });
    state.cols += 1;
    renderTable();
  });

  els.renderFromGrid.addEventListener("click", () => {
    readGridInputs();
    renderChart();
  });

  els.importApply.addEventListener("click", () => {
    const csv = els.importCsv.value.trim();
    if (!csv) {
      return setStatus(els.statusText, "Paste CSV first.", true);
    }
    importCsvToGrid(csv);
    renderTable();
    renderChart();
  });

  els.applySettings.addEventListener("click", () => {
    readGridInputs();
    renderChart();
  });

  els.downloadChart.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = els.canvas.toDataURL("image/png");
    link.download = `graph-${Date.now()}.png`;
    link.click();
    setStatus(els.statusText, "Chart downloaded.");
  });

  els.saveChart.addEventListener("click", async () => {
    try {
      await saveCanvasAsImage(els.canvas, `Graph: ${els.chartTitle.value || "Chart"}`, els.statusText, {
        assetType: "graph",
        editor: {
          type: "graph-tool",
          path: "src/creators/graph-tool.html"
        },
        editorState: collectGraphState()
      });
    } catch (error) {
      setStatus(els.statusText, error.message, true);
    }
  });
}

async function restoreSavedGraph() {
  const asset = await getImageAssetById(getAssetIdFromQuery());
  const saved = asset?.editorState;
  if (!saved) {
    return;
  }

  state.chartType = saved.chartType || state.chartType;
  state.rows = Number(saved.rows) || state.rows;
  state.cols = Number(saved.cols) || state.cols;
  state.grid = Array.isArray(saved.grid) ? saved.grid.map((row) => Array.isArray(row) ? row.map((cell) => String(cell || "")) : []) : state.grid;
  state.seriesColumn = saved.seriesColumn || state.seriesColumn;
  els.chartTitle.value = saved.title || els.chartTitle.value;
  els.primaryColor.value = saved.primaryColor || els.primaryColor.value;
  els.secondaryColor.value = saved.secondaryColor || els.secondaryColor.value;
  els.showValues.value = saved.showValues || els.showValues.value;
}

function collectGraphState() {
  readGridInputs();
  return {
    chartType: state.chartType,
    rows: state.rows,
    cols: state.cols,
    seriesColumn: els.seriesColumn.value || state.seriesColumn || "1",
    grid: state.grid,
    title: els.chartTitle.value,
    primaryColor: els.primaryColor.value,
    secondaryColor: els.secondaryColor.value,
    showValues: els.showValues.value
  };
}

function applyChartTabSelection() {
  els.chartTabs.forEach((tab) => {
    const isActive = tab.getAttribute("data-chart") === state.chartType;
    tab.classList.toggle("active", isActive);
  });
}

function renderTable() {
  const letters = ["A", "B", "C", "D", "E", "F", "G"];
  let html = "<thead><tr><th></th>";
  for (let c = 0; c < state.cols; c += 1) {
    html += `<th>${letters[c] || c + 1}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (let r = 0; r < state.rows; r += 1) {
    html += `<tr><th>${r + 1}</th>`;
    for (let c = 0; c < state.cols; c += 1) {
      const value = escapeHtml(state.grid[r]?.[c] || "");
      html += `<td><input data-r="${r}" data-c="${c}" value="${value}" /></td>`;
    }
    html += "</tr>";
  }

  html += "</tbody>";
  els.dataTable.innerHTML = html;

  updateSeriesOptions();
}

function updateSeriesOptions() {
  const options = [];
  for (let c = 1; c < state.cols; c += 1) {
    const header = state.grid[0]?.[c] || `Series ${c}`;
    options.push(`<option value="${c}">${escapeHtml(header)}</option>`);
  }
  els.seriesColumn.innerHTML = options.join("");
  const assetSeries = state.seriesColumn || "1";
  if (assetSeries && Number(assetSeries) < state.cols) {
    els.seriesColumn.value = assetSeries;
  }
}

function readGridInputs() {
  els.dataTable.querySelectorAll("input[data-r][data-c]").forEach((input) => {
    const r = Number(input.getAttribute("data-r"));
    const c = Number(input.getAttribute("data-c"));
    if (Number.isFinite(r) && Number.isFinite(c) && state.grid[r]) {
      state.grid[r][c] = input.value;
    }
  });
}

function importCsvToGrid(csv) {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return;
  }

  const parsed = lines.map((line) => line.split(",").map((cell) => cell.trim()));
  const cols = Math.min(MAX_COLS, Math.max(...parsed.map((row) => row.length)));
  const rows = Math.min(MAX_ROWS, parsed.length);

  state.cols = cols;
  state.rows = rows;
  state.grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => parsed[r]?.[c] || "")
  );

  setStatus(els.statusText, "CSV imported.");
}

function getSeriesData() {
  const seriesCol = Math.max(1, Number(els.seriesColumn.value || 1));
  const labels = [];
  const values = [];

  for (let r = 1; r < state.rows; r += 1) {
    const label = (state.grid[r]?.[0] || "").trim();
    const raw = state.grid[r]?.[seriesCol] || "0";
    const value = Number(raw);
    if (!label) {
      continue;
    }
    labels.push(label);
    values.push(Number.isFinite(value) ? value : 0);
  }

  return { labels, values, seriesCol };
}

function renderChart() {
  readGridInputs();
  const { labels, values } = getSeriesData();
  if (!labels.length) {
    setStatus(els.statusText, "Add data rows to render a chart.", true);
    clearCanvas();
    return;
  }

  clearCanvas();
  drawBackdrop();
  drawTitle(els.chartTitle.value || "My Chart");

  const type = state.chartType;
  if (type === "line") {
    drawLineChart(labels, values);
  } else if (type === "area") {
    drawAreaChart(labels, values);
  } else if (type === "pie") {
    drawPieChart(labels, values, false);
  } else if (type === "doughnut") {
    drawPieChart(labels, values, true);
  } else if (type === "half-doughnut") {
    drawHalfDoughnut(labels, values);
  } else {
    drawBarChart(labels, values);
  }

  setStatus(els.statusText, `Rendered ${type} chart with ${labels.length} points.`);
}

function clearCanvas() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
}

function drawBackdrop() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);

  ctx.strokeStyle = "#e1e4ea";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i += 1) {
    const y = 120 + i * 80;
    ctx.beginPath();
    ctx.moveTo(100, y);
    ctx.lineTo(880, y);
    ctx.stroke();
  }
}

function drawTitle(title) {
  ctx.fillStyle = "#111827";
  ctx.font = "700 46px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  const w = ctx.measureText(title).width;
  ctx.fillText(title, (els.canvas.width - w) / 2, 72);
}

function drawBarChart(labels, values) {
  const maxValue = Math.max(...values, 1);
  const left = 120;
  const right = 860;
  const bottom = 520;
  const top = 120;
  const width = right - left;
  const height = bottom - top;
  const barStep = width / labels.length;
  const barWidth = Math.min(80, barStep * 0.62);

  drawAxes(left, top, right, bottom);

  labels.forEach((label, i) => {
    const x = left + i * barStep + (barStep - barWidth) / 2;
    const h = (values[i] / maxValue) * height;
    const y = bottom - h;

    ctx.fillStyle = els.primaryColor.value;
    ctx.fillRect(x, y, barWidth, h);

    if (els.showValues.value === "yes") {
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 30px 'IBM Plex Sans', 'Segoe UI', sans-serif";
      const text = String(values[i]);
      const textW = ctx.measureText(text).width;
      ctx.fillText(text, x + (barWidth - textW) / 2, y + Math.max(38, h * 0.45));
    }

    ctx.fillStyle = "#111827";
    ctx.font = "500 26px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const labelW = ctx.measureText(label).width;
    ctx.fillText(label, x + (barWidth - labelW) / 2, bottom + 34);
  });
}

function drawLineChart(labels, values) {
  const maxValue = Math.max(...values, 1);
  const left = 120;
  const right = 860;
  const bottom = 520;
  const top = 120;
  const width = right - left;
  const height = bottom - top;
  const stepX = labels.length > 1 ? width / (labels.length - 1) : 0;

  drawAxes(left, top, right, bottom);

  ctx.strokeStyle = els.primaryColor.value;
  ctx.lineWidth = 5;
  ctx.beginPath();

  values.forEach((value, i) => {
    const x = left + i * stepX;
    const y = bottom - (value / maxValue) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  values.forEach((value, i) => {
    const x = left + i * stepX;
    const y = bottom - (value / maxValue) * height;

    ctx.fillStyle = els.secondaryColor.value;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();

    if (els.showValues.value === "yes") {
      ctx.fillStyle = "#111827";
      ctx.font = "500 22px 'IBM Plex Sans', 'Segoe UI', sans-serif";
      ctx.fillText(String(value), x - 10, y - 12);
    }

    ctx.fillStyle = "#111827";
    ctx.font = "500 22px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const label = labels[i];
    const lw = ctx.measureText(label).width;
    ctx.fillText(label, x - lw / 2, bottom + 34);
  });
}

function drawAreaChart(labels, values) {
  const maxValue = Math.max(...values, 1);
  const left = 120;
  const right = 860;
  const bottom = 520;
  const top = 120;
  const width = right - left;
  const height = bottom - top;
  const stepX = labels.length > 1 ? width / (labels.length - 1) : 0;

  drawAxes(left, top, right, bottom);

  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, `${els.primaryColor.value}cc`);
  gradient.addColorStop(1, `${els.primaryColor.value}22`);

  ctx.beginPath();
  values.forEach((value, i) => {
    const x = left + i * stepX;
    const y = bottom - (value / maxValue) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(left + (labels.length - 1) * stepX, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = els.primaryColor.value;
  ctx.lineWidth = 4;
  ctx.beginPath();
  values.forEach((value, i) => {
    const x = left + i * stepX;
    const y = bottom - (value / maxValue) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  labels.forEach((label, i) => {
    const x = left + i * stepX;
    ctx.fillStyle = "#111827";
    ctx.font = "500 22px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const lw = ctx.measureText(label).width;
    ctx.fillText(label, x - lw / 2, bottom + 34);
  });
}

function drawPieChart(labels, values, doughnut) {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) {
    setStatus(els.statusText, "Pie chart needs positive values.", true);
    return;
  }

  const cx = 440;
  const cy = 330;
  const radius = 180;
  let start = -Math.PI / 2;

  values.forEach((value, i) => {
    const slice = (Math.max(value, 0) / total) * Math.PI * 2;
    const end = start + slice;

    ctx.fillStyle = i % 2 === 0 ? els.primaryColor.value : shiftColor(els.secondaryColor.value, i * 8);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fill();

    if (els.showValues.value === "yes") {
      const mid = (start + end) / 2;
      const lx = cx + Math.cos(mid) * (radius * 0.7);
      const ly = cy + Math.sin(mid) * (radius * 0.7);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 22px 'IBM Plex Sans', 'Segoe UI', sans-serif";
      const text = String(value);
      const w = ctx.measureText(text).width;
      ctx.fillText(text, lx - w / 2, ly + 7);
    }

    start = end;
  });

  if (doughnut) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLegend(labels, values, 680, 210);
}

function drawHalfDoughnut(labels, values) {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) {
    setStatus(els.statusText, "Half doughnut needs positive values.", true);
    return;
  }

  const cx = 440;
  const cy = 470;
  const radius = 220;
  let start = Math.PI;

  values.forEach((value, i) => {
    const slice = (Math.max(value, 0) / total) * Math.PI;
    const end = start + slice;

    ctx.fillStyle = i % 2 === 0 ? els.primaryColor.value : shiftColor(els.secondaryColor.value, i * 10);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fill();
    start = end;
  });

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.58, Math.PI, Math.PI * 2);
  ctx.fill();

  drawLegend(labels, values, 680, 200);
}

function drawLegend(labels, values, x, y) {
  labels.forEach((label, i) => {
    const yy = y + i * 34;
    ctx.fillStyle = i % 2 === 0 ? els.primaryColor.value : shiftColor(els.secondaryColor.value, i * 10);
    ctx.fillRect(x, yy - 15, 18, 18);
    ctx.fillStyle = "#111827";
    ctx.font = "500 20px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    ctx.fillText(`${label} (${values[i]})`, x + 28, yy);
  });
}

function drawAxes(left, top, right, bottom) {
  ctx.strokeStyle = "#cfd4dd";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
}

function shiftColor(hex, amount) {
  const normalized = hex.replace("#", "");
  const num = parseInt(normalized, 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
