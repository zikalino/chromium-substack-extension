import { clamp, getAssetIdFromQuery, getImageAssetById, saveCanvasAsImage, setStatus, toNumber } from "./shared.js";

const els = {
  statusText: document.querySelector("#status-text"),
  rows: document.querySelector("#table-rows"),
  cols: document.querySelector("#table-cols"),
  align: document.querySelector("#table-align"),
  headerRow: document.querySelector("#table-header-row"),
  cellBg: document.querySelector("#table-cell-bg"),
  headerBg: document.querySelector("#table-header-bg"),
  textColor: document.querySelector("#table-text-color"),
  borderColor: document.querySelector("#table-border-color"),
  addRow: document.querySelector("#add-table-row"),
  addCol: document.querySelector("#add-table-col"),
  removeRow: document.querySelector("#remove-table-row"),
  removeCol: document.querySelector("#remove-table-col"),
  selectionLabel: document.querySelector("#table-selection"),
  cellFormatBg: document.querySelector("#cell-format-bg"),
  cellFormatColor: document.querySelector("#cell-format-color"),
  cellFormatAlign: document.querySelector("#cell-format-align"),
  cellFormatBold: document.querySelector("#cell-format-bold"),
  cellFormatItalic: document.querySelector("#cell-format-italic"),
  gridWrap: document.querySelector("#table-grid-wrap"),
  canvas: document.querySelector("#table-canvas")
};

const ctx = els.canvas.getContext("2d");
let tableData = [];
let cellStyles = [];
let selection = null;
let isMouseSelecting = false;

bindActions();
void init();

async function init() {
  const restored = await restoreSavedTable();
  if (!restored) {
    buildGrid();
  }
  syncFormatControlsFromSelection();
}

function bindActions() {
  document.querySelector("#build-table-grid").addEventListener("click", () => {
    buildGrid();
    setStatus(els.statusText, "Grid rebuilt.");
  });

  els.addRow.addEventListener("click", () => {
    readGridValues();
    const cols = tableData[0]?.length || 1;
    tableData.push(Array.from({ length: cols }, (_, c) => (c === 0 ? `Row ${tableData.length}` : "")));
    cellStyles.push(Array.from({ length: cols }, () => null));
    els.rows.value = String(tableData.length);
    renderGridEditor(tableData.length, cols, true);
    setStatus(els.statusText, "Row added.");
  });

  els.addCol.addEventListener("click", () => {
    readGridValues();
    if (!tableData.length) {
      tableData = [["Header 1"]];
      cellStyles = [[null]];
    }

    tableData.forEach((row, r) => {
      row.push(r === 0 ? `Header ${row.length + 1}` : "");
    });
    cellStyles.forEach((row) => row.push(null));

    els.cols.value = String(tableData[0]?.length || 1);
    renderGridEditor(tableData.length, tableData[0]?.length || 1, true);
    setStatus(els.statusText, "Column added.");
  });

  els.removeRow.addEventListener("click", () => {
    readGridValues();
    if (tableData.length <= 1) {
      return setStatus(els.statusText, "At least one row is required.", true);
    }

    tableData.pop();
    cellStyles.pop();
    normalizeSelectionToBounds();
    els.rows.value = String(tableData.length);
    renderGridEditor(tableData.length, tableData[0]?.length || 1, true);
    setStatus(els.statusText, "Row removed.");
  });

  els.removeCol.addEventListener("click", () => {
    readGridValues();
    const cols = tableData[0]?.length || 1;
    if (cols <= 1) {
      return setStatus(els.statusText, "At least one column is required.", true);
    }

    tableData.forEach((row) => row.pop());
    cellStyles.forEach((row) => row.pop());
    normalizeSelectionToBounds();
    els.cols.value = String(tableData[0]?.length || 1);
    renderGridEditor(tableData.length, tableData[0]?.length || 1, true);
    setStatus(els.statusText, "Column removed.");
  });

  els.gridWrap.addEventListener("mousedown", (event) => {
    const input = event.target instanceof HTMLElement ? event.target.closest("input[data-row][data-col]") : null;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      return;
    }

    if (event.shiftKey && selection) {
      selection.focus = { row, col };
    } else {
      selection = {
        anchor: { row, col },
        focus: { row, col }
      };
    }

    isMouseSelecting = true;
    updateSelectionUi();
    syncFormatControlsFromSelection();
  });

  els.gridWrap.addEventListener("mouseover", (event) => {
    if (!isMouseSelecting || !selection) {
      return;
    }

    const input = event.target instanceof HTMLElement ? event.target.closest("input[data-row][data-col]") : null;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      return;
    }

    selection.focus = { row, col };
    updateSelectionUi();
  });

  window.addEventListener("mouseup", () => {
    isMouseSelecting = false;
  });

  els.gridWrap.addEventListener("keydown", (event) => {
    const input = event.target instanceof HTMLElement ? event.target.closest("input[data-row][data-col]") : null;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const movement = keyToMovement(event.key);
    if (!movement) {
      return;
    }

    const currentRow = Number(input.dataset.row);
    const currentCol = Number(input.dataset.col);
    if (!Number.isFinite(currentRow) || !Number.isFinite(currentCol)) {
      return;
    }

    event.preventDefault();

    const start = event.shiftKey && selection ? selection.focus : { row: currentRow, col: currentCol };
    const next = {
      row: clamp(start.row + movement.row, 0, tableData.length - 1),
      col: clamp(start.col + movement.col, 0, (tableData[0]?.length || 1) - 1)
    };

    if (event.shiftKey && selection) {
      selection.focus = next;
    } else {
      selection = {
        anchor: next,
        focus: next
      };
    }

    updateSelectionUi();
    syncFormatControlsFromSelection();
    focusCell(next.row, next.col);
  });

  els.gridWrap.addEventListener("input", (event) => {
    const input = event.target instanceof HTMLElement ? event.target.closest("input[data-row][data-col]") : null;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col) || !tableData[row]) {
      return;
    }

    tableData[row][col] = input.value;
  });

  [els.align, els.headerRow, els.cellBg, els.headerBg, els.textColor, els.borderColor].forEach((input) => {
    input.addEventListener("change", () => {
      readGridValues();
      renderGridEditor(tableData.length || 1, tableData[0]?.length || 1, true);
    });
  });

  [els.cellFormatBg, els.cellFormatColor, els.cellFormatAlign].forEach((input) => {
    input.addEventListener("change", applyFormatControlsToSelection);
  });

  [els.cellFormatBold, els.cellFormatItalic].forEach((input) => {
    input.addEventListener("change", applyFormatControlsToSelection);
  });

  document.querySelector("#save-table").addEventListener("click", async () => {
    try {
      readGridValues();
      renderTable();
      await saveCanvasAsImage(els.canvas, "Table", els.statusText, {
        assetType: "table",
        editor: {
          type: "table-creator",
          path: "src/creators/table-creator.html"
        },
        editorState: collectTableState()
      });
    } catch (error) {
      setStatus(els.statusText, error.message, true);
    }
  });
}

function keyToMovement(key) {
  if (key === "ArrowUp") return { row: -1, col: 0 };
  if (key === "ArrowDown") return { row: 1, col: 0 };
  if (key === "ArrowLeft") return { row: 0, col: -1 };
  if (key === "ArrowRight") return { row: 0, col: 1 };
  return null;
}

function focusCell(row, col) {
  const input = els.gridWrap.querySelector(`input[data-row=\"${row}\"][data-col=\"${col}\"]`);
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
  }
}

async function restoreSavedTable() {
  const asset = await getImageAssetById(getAssetIdFromQuery());
  const state = asset?.editorState;
  if (!state) {
    return false;
  }

  els.rows.value = String(state.rows || 4);
  els.cols.value = String(state.cols || 4);
  els.align.value = state.align || "left";
  els.headerRow.value = state.headerRow || "yes";
  els.cellBg.value = state.cellBg || els.cellBg.value;
  els.headerBg.value = state.headerBg || els.headerBg.value;
  els.textColor.value = state.textColor || els.textColor.value;
  els.borderColor.value = state.borderColor || els.borderColor.value;

  tableData = Array.isArray(state.tableData)
    ? state.tableData.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell || "")) : []))
    : [];
  tableData = normalizeGrid(tableData.length || 1, tableData[0]?.length || 1, tableData);

  cellStyles = normalizeStyleGrid(tableData.length, tableData[0]?.length || 1, state.cellStyles);
  selection = normalizeSelection(state.selection, tableData.length, tableData[0]?.length || 1);
  renderGridEditor(tableData.length || 1, tableData[0]?.length || 1, true);
  return true;
}

function collectTableState() {
  return {
    rows: tableData.length,
    cols: tableData[0]?.length || 0,
    align: els.align.value,
    headerRow: els.headerRow.value,
    cellBg: els.cellBg.value,
    headerBg: els.headerBg.value,
    textColor: els.textColor.value,
    borderColor: els.borderColor.value,
    tableData,
    cellStyles,
    selection
  };
}

function buildGrid() {
  const rows = clamp(Math.floor(toNumber(els.rows.value, 4)), 1, 30);
  const cols = clamp(Math.floor(toNumber(els.cols.value, 4)), 1, 12);

  tableData = normalizeGrid(rows, cols, tableData);
  cellStyles = normalizeStyleGrid(rows, cols, cellStyles);
  normalizeSelectionToBounds();
  renderGridEditor(rows, cols, true);
}

function renderGridEditor(rows, cols, keepFocus = false) {
  const focus = keepFocus ? getSelectionFocusCell() : null;
  const table = document.createElement("table");
  table.className = "table-input-grid table-wysiwyg-grid";

  const tbody = document.createElement("tbody");

  for (let r = 0; r < rows; r += 1) {
    const tr = document.createElement("tr");
    for (let c = 0; c < cols; c += 1) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = tableData[r]?.[c] || "";
      input.dataset.row = String(r);
      input.dataset.col = String(c);
      input.placeholder = `R${r + 1} C${c + 1}`;
      input.className = "table-cell-input";

      const style = getEffectiveCellStyle(r, c);
      applyStyleToInput(input, style);
      td.style.borderColor = els.borderColor.value;
      td.style.backgroundColor = style.bg;
      td.appendChild(input);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  els.gridWrap.innerHTML = "";
  els.gridWrap.classList.add("table-grid-preview");
  els.gridWrap.classList.toggle("no-header", els.headerRow.value !== "yes");
  els.gridWrap.appendChild(table);

  updateSelectionUi();
  syncFormatControlsFromSelection();

  if (focus) {
    focusCell(focus.row, focus.col);
  }
}

function readGridValues() {
  const inputs = els.gridWrap.querySelectorAll("input[data-row][data-col]");
  inputs.forEach((input) => {
    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col) || !tableData[row]) {
      return;
    }
    tableData[row][col] = input.value;
  });
}

function normalizeGrid(rows, cols, oldData = []) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => oldData[r]?.[c] || (r === 0 ? `Header ${c + 1}` : ""))
  );
}

function normalizeStyleGrid(rows, cols, oldStyles = []) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => normalizeCellStyle(oldStyles?.[r]?.[c]))
  );
}

function normalizeCellStyle(style) {
  if (!style || typeof style !== "object") {
    return null;
  }

  return {
    bg: typeof style.bg === "string" ? style.bg : undefined,
    color: typeof style.color === "string" ? style.color : undefined,
    align: typeof style.align === "string" ? style.align : undefined,
    bold: typeof style.bold === "boolean" ? style.bold : undefined,
    italic: typeof style.italic === "boolean" ? style.italic : undefined
  };
}

function normalizeSelection(candidate, maxRows, maxCols) {
  if (!candidate || typeof candidate !== "object") {
    return {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 0 }
    };
  }

  const anchor = candidate.anchor || { row: 0, col: 0 };
  const focus = candidate.focus || { row: 0, col: 0 };

  return {
    anchor: {
      row: clamp(Number(anchor.row) || 0, 0, maxRows - 1),
      col: clamp(Number(anchor.col) || 0, 0, maxCols - 1)
    },
    focus: {
      row: clamp(Number(focus.row) || 0, 0, maxRows - 1),
      col: clamp(Number(focus.col) || 0, 0, maxCols - 1)
    }
  };
}

function normalizeSelectionToBounds() {
  const rows = tableData.length;
  const cols = tableData[0]?.length || 1;
  selection = normalizeSelection(selection, rows, cols);
}

function getSelectionRange() {
  if (!selection) {
    return null;
  }

  const startRow = Math.min(selection.anchor.row, selection.focus.row);
  const endRow = Math.max(selection.anchor.row, selection.focus.row);
  const startCol = Math.min(selection.anchor.col, selection.focus.col);
  const endCol = Math.max(selection.anchor.col, selection.focus.col);

  return {
    startRow,
    endRow,
    startCol,
    endCol
  };
}

function getSelectionFocusCell() {
  if (!selection) {
    return null;
  }

  return {
    row: selection.focus.row,
    col: selection.focus.col
  };
}

function getSelectedCells() {
  const range = getSelectionRange();
  if (!range) {
    return [];
  }

  const cells = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      cells.push({ row, col });
    }
  }
  return cells;
}

function applyFormatControlsToSelection() {
  const targets = getSelectedCells();
  if (!targets.length) {
    return setStatus(els.statusText, "Select at least one cell first.", true);
  }

  const style = {
    bg: els.cellFormatBg.value,
    color: els.cellFormatColor.value,
    align: els.cellFormatAlign.value,
    bold: Boolean(els.cellFormatBold.checked),
    italic: Boolean(els.cellFormatItalic.checked)
  };

  for (const target of targets) {
    if (!cellStyles[target.row]) {
      cellStyles[target.row] = [];
    }
    cellStyles[target.row][target.col] = { ...style };
  }

  renderGridEditor(tableData.length || 1, tableData[0]?.length || 1, true);
  setStatus(els.statusText, `Style applied to ${targets.length} cell(s).`);
}

function updateSelectionUi() {
  const range = getSelectionRange();

  els.gridWrap.querySelectorAll("td.selected").forEach((td) => {
    td.classList.remove("selected");
  });

  if (!range) {
    els.selectionLabel.textContent = "No cell selected";
    return;
  }

  const count = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
  if (count === 1) {
    els.selectionLabel.textContent = `Selected cell: R${range.startRow + 1}, C${range.startCol + 1}`;
  } else {
    els.selectionLabel.textContent = `Selected range: R${range.startRow + 1}C${range.startCol + 1} to R${range.endRow + 1}C${range.endCol + 1} (${count} cells)`;
  }

  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      const input = els.gridWrap.querySelector(`input[data-row=\"${row}\"][data-col=\"${col}\"]`);
      input?.closest("td")?.classList.add("selected");
    }
  }
}

function syncFormatControlsFromSelection() {
  const targets = getSelectedCells();
  if (!targets.length) {
    const sample = getDefaultCellStyle(0);
    els.cellFormatBg.value = sample.bg;
    els.cellFormatColor.value = sample.color;
    els.cellFormatAlign.value = sample.align;
    els.cellFormatBold.checked = Boolean(sample.bold);
    els.cellFormatItalic.checked = Boolean(sample.italic);
    return;
  }

  const sample = getEffectiveCellStyle(targets[0].row, targets[0].col);
  els.cellFormatBg.value = sample.bg;
  els.cellFormatColor.value = sample.color;
  els.cellFormatAlign.value = sample.align;
  els.cellFormatBold.checked = Boolean(sample.bold);
  els.cellFormatItalic.checked = Boolean(sample.italic);
}

function getDefaultCellStyle(row) {
  const hasHeader = els.headerRow.value === "yes";
  return {
    bg: hasHeader && row === 0 ? els.headerBg.value : els.cellBg.value,
    color: els.textColor.value,
    align: els.align.value,
    bold: hasHeader && row === 0,
    italic: false
  };
}

function getEffectiveCellStyle(row, col) {
  const base = getDefaultCellStyle(row);
  const custom = cellStyles?.[row]?.[col] || null;
  if (!custom) {
    return base;
  }

  return {
    bg: custom.bg || base.bg,
    color: custom.color || base.color,
    align: custom.align || base.align,
    bold: typeof custom.bold === "boolean" ? custom.bold : base.bold,
    italic: typeof custom.italic === "boolean" ? custom.italic : base.italic
  };
}

function applyStyleToInput(input, style) {
  input.style.backgroundColor = style.bg;
  input.style.color = style.color;
  input.style.textAlign = style.align;
  input.style.fontWeight = style.bold ? "700" : "400";
  input.style.fontStyle = style.italic ? "italic" : "normal";
}

function renderTable() {
  const rows = tableData.length;
  const cols = tableData[0]?.length || 0;

  if (!rows || !cols) {
    setStatus(els.statusText, "Create at least one row and column.", true);
    return;
  }

  const borderColor = els.borderColor.value;
  const font = "16px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  const cellPadding = 12;
  const rowHeight = 42;

  ctx.font = font;
  const colWidths = [];
  for (let c = 0; c < cols; c += 1) {
    let maxText = 80;
    for (let r = 0; r < rows; r += 1) {
      const value = String(tableData[r][c] || "");
      const style = getEffectiveCellStyle(r, c);
      ctx.font = `${style.italic ? "italic" : "normal"} ${style.bold ? "700" : "400"} 16px 'IBM Plex Sans', 'Segoe UI', sans-serif`;
      maxText = Math.max(maxText, ctx.measureText(value).width + cellPadding * 2);
    }
    colWidths.push(Math.min(300, maxText));
  }

  const totalWidth = colWidths.reduce((sum, width) => sum + width, 0) + 2;
  const totalHeight = rows * rowHeight + 2;

  els.canvas.width = totalWidth;
  els.canvas.height = totalHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  let y = 1;
  for (let r = 0; r < rows; r += 1) {
    let x = 1;
    for (let c = 0; c < cols; c += 1) {
      const w = colWidths[c];
      const value = String(tableData[r][c] || "");
      const style = getEffectiveCellStyle(r, c);

      ctx.fillStyle = style.bg;
      ctx.fillRect(x, y, w, rowHeight);

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, rowHeight);

      ctx.fillStyle = style.color;
      ctx.font = `${style.italic ? "italic" : "normal"} ${style.bold ? "700" : "400"} 16px 'IBM Plex Sans', 'Segoe UI', sans-serif`;
      ctx.textBaseline = "middle";

      const textY = y + rowHeight / 2;
      if (style.align === "center") {
        const textW = ctx.measureText(value).width;
        ctx.fillText(value, x + (w - textW) / 2, textY);
      } else if (style.align === "right") {
        const textW = ctx.measureText(value).width;
        ctx.fillText(value, x + w - textW - cellPadding, textY);
      } else {
        ctx.fillText(value, x + cellPadding, textY);
      }

      x += w;
    }
    y += rowHeight;
  }

  setStatus(els.statusText, `Prepared table image ${rows}x${cols}.`);
}
