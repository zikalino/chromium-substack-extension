import { clamp, getAssetIdFromQuery, getImageAssetById, parseDataLines, saveCanvasAsImage, setStatus } from "./shared.js";

const els = {
  statusText: document.querySelector("#status-text"),
  mapMode: document.querySelector("#map-mode"),
  cityLines: document.querySelector("#city-lines"),
  connectionLines: document.querySelector("#connection-lines"),
  layoutType: document.querySelector("#layout-type"),
  mapTitle: document.querySelector("#map-title"),
  geocodeResults: document.querySelector("#geocode-results"),
  canvas: document.querySelector("#map-canvas")
};

const ctx = els.canvas.getContext("2d");

bindActions();
void init();

async function init() {
  const restored = await restoreSavedMap();
  if (!restored) {
    loadExample();
  }
  void renderMap();
}

function bindActions() {
  document.querySelector("#load-example").addEventListener("click", () => {
    loadExample();
    void renderMap();
  });

  document.querySelector("#render-map").addEventListener("click", () => {
    void renderMap();
  });

  els.mapMode.addEventListener("change", () => {
    const isManual = els.mapMode.value === "manual";
    els.layoutType.disabled = !isManual;
    if (isManual) {
      setStatus(els.statusText, "Manual node layout mode selected.");
    } else {
      setStatus(els.statusText, "Geocoded route mode selected.");
    }
  });

  document.querySelector("#save-map").addEventListener("click", async () => {
    try {
      await saveCanvasAsImage(els.canvas, `Map: ${els.mapTitle.value.trim() || "Untitled"}`, els.statusText, {
        assetType: "map",
        editor: {
          type: "map-creator",
          path: "src/creators/map-creator.html"
        },
        editorState: collectMapState()
      });
    } catch (error) {
      setStatus(els.statusText, error.message, true);
    }
  });
}

async function restoreSavedMap() {
  const asset = await getImageAssetById(getAssetIdFromQuery());
  const state = asset?.editorState;
  if (!state) {
    return false;
  }

  els.mapMode.value = state.mapMode || "geocoded";
  els.cityLines.value = Array.isArray(state.cities) ? state.cities.join("\n") : "";
  els.connectionLines.value = Array.isArray(state.connections) ? state.connections.join("\n") : "";
  els.layoutType.value = state.layoutType || "circle";
  els.mapTitle.value = state.title || els.mapTitle.value;
  els.geocodeResults.textContent = "";
  return true;
}

function collectMapState() {
  return {
    mapMode: els.mapMode.value,
    cities: normalizeCityList(els.cityLines.value),
    connections: parseDataLines(els.connectionLines.value),
    layoutType: els.layoutType.value,
    title: els.mapTitle.value.trim()
  };
}

function loadExample() {
  els.cityLines.value = ["Lisbon", "Madrid", "Paris", "Brussels", "Amsterdam"].join("\n");
  els.connectionLines.value = [
    "Lisbon-Madrid",
    "Madrid-Paris",
    "Paris-Brussels",
    "Brussels-Amsterdam"
  ].join("\n");
}

async function renderMap() {
  const mode = els.mapMode.value;
  if (mode === "manual") {
    renderManualMap();
    return;
  }

  await renderGeocodedMap();
}

function renderManualMap() {
  const cityNames = parseDataLines(els.cityLines.value);
  const links = parseConnections(els.connectionLines.value);

  if (!cityNames.length && !links.length) {
    setStatus(els.statusText, "Add at least one city.", true);
    return;
  }

  els.geocodeResults.textContent = "";

  const allCities = new Set(cityNames);
  for (const link of links) {
    allCities.add(link.from);
    allCities.add(link.to);
  }

  const nodes = Array.from(allCities).map((name) => ({ name }));
  const positions = layoutNodes(nodes, els.layoutType.value, els.canvas.width, els.canvas.height);

  drawBackground();
  drawTitle(els.mapTitle.value.trim() || "City Connection Map");
  drawConnections(links, positions);
  drawNodes(nodes, positions);
  setStatus(els.statusText, `Rendered manual map with ${nodes.length} cities.`);
}

async function renderGeocodedMap() {
  const cities = normalizeCityList(els.cityLines.value);
  if (cities.length < 2) {
    setStatus(els.statusText, "Enter at least two city names for geocoded mode.", true);
    return;
  }

  setStatus(els.statusText, "Resolving city coordinates...");
  try {
    const resolved = [];
    for (const city of cities) {
      const point = await geocodeCity(city);
      resolved.push(point);
    }

    const explicitLinks = parseConnections(els.connectionLines.value);
    const links = explicitLinks.length ? explicitLinks : buildSequentialLinks(resolved);
    const byQuery = new Map(resolved.map((item) => [item.query.toLowerCase(), item]));

    const bounds = computeBounds(resolved);
    const frame = getMapFrame();

    drawBackground();
    setStatus(els.statusText, "Loading map tiles...");
    const tilesLoaded = await fetchAndDrawOSMTiles(bounds, frame);

    drawTitle(els.mapTitle.value.trim() || "City Route Map");
    if (!tilesLoaded) {
      drawGeographyGrid(resolved);
    }
    drawGeocodedConnections(links, byQuery, resolved);
    drawGeocodedNodes(resolved);
    if (tilesLoaded) {
      drawOSMAttribution(frame);
    }

    els.geocodeResults.textContent = resolved
      .map((item) => `${item.query} -> ${item.name} (${item.latitude.toFixed(3)}, ${item.longitude.toFixed(3)})`)
      .join(" | ");
    setStatus(els.statusText, `Rendered geocoded route for ${resolved.length} cities.`);
  } catch (error) {
    setStatus(els.statusText, error.message || "Could not resolve cities.", true);
  }
}

function parseConnections(text) {
  const lines = parseDataLines(text);
  const links = [];

  for (const line of lines) {
    const normalized = line.replaceAll("->", "-").replaceAll(" to ", "-");
    const [pair, labelRaw] = normalized.split(":");
    const segments = pair.split("-").map((part) => part.trim()).filter(Boolean);

    if (segments.length < 2) {
      continue;
    }

    links.push({
      from: segments[0],
      to: segments[1],
      label: (labelRaw || "").trim()
    });
  }

  return links;
}

function layoutNodes(nodes, layoutType, width, height) {
  const positions = new Map();
  const count = nodes.length;
  const topPadding = 110;
  const pad = 70;

  if (layoutType === "grid") {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const xStep = (width - pad * 2) / Math.max(cols - 1, 1);
    const yStep = (height - topPadding - pad) / Math.max(rows - 1, 1);

    nodes.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const jitterX = (Math.sin(i * 17) * 0.5) * Math.min(14, xStep * 0.2);
      const jitterY = (Math.cos(i * 13) * 0.5) * Math.min(14, yStep * 0.2);
      positions.set(node.name, {
        x: clamp(pad + col * xStep + jitterX, pad, width - pad),
        y: clamp(topPadding + row * yStep + jitterY, topPadding, height - pad)
      });
    });

    return positions;
  }

  const cx = width / 2;
  const cy = (height + topPadding) / 2;
  const radius = Math.min(width * 0.36, height * 0.33);

  nodes.forEach((node, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(count, 1) - Math.PI / 2;
    positions.set(node.name, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    });
  });

  return positions;
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, els.canvas.width, els.canvas.height);
  gradient.addColorStop(0, "#f7efe1");
  gradient.addColorStop(1, "#e9f5ef");
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

function drawConnections(links, positions) {
  ctx.strokeStyle = "rgba(47, 95, 79, 0.6)";
  ctx.fillStyle = "#2f5f4f";
  ctx.lineWidth = 3;
  ctx.font = "500 15px 'IBM Plex Sans', 'Segoe UI', sans-serif";

  for (const link of links) {
    const from = positions.get(link.from);
    const to = positions.get(link.to);
    if (!from || !to) {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    if (link.label) {
      ctx.fillStyle = "#264f42";
      ctx.fillText(link.label, midX + 8, midY - 6);
      ctx.fillStyle = "#2f5f4f";
    }
  }
}

function drawNodes(nodes, positions) {
  for (const node of nodes) {
    const pos = positions.get(node.name);
    if (!pos) {
      continue;
    }

    const radius = 32;
    const nodeGradient = ctx.createRadialGradient(pos.x - 8, pos.y - 8, 4, pos.x, pos.y, radius);
    nodeGradient.addColorStop(0, "#f8b67a");
    nodeGradient.addColorStop(1, "#d9652b");

    ctx.fillStyle = nodeGradient;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#a94f1f";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 16px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const textWidth = ctx.measureText(node.name).width;
    ctx.fillText(node.name, pos.x - textWidth / 2, pos.y + 6);
  }
}

function drawGeographyGrid(points) {
  const bounds = computeBounds(points);
  const frame = getMapFrame();
  const t = getMapTransform(bounds, frame);

  const mercW = (t.mercLon(bounds.maxLon) - t.mx0) * t.scale;
  const mercH = (t.mercLat(bounds.minLat) - t.my0) * t.scale;
  const renderedRect = { x: t.offsetX, y: t.offsetY, width: mercW, height: mercH };

  ctx.strokeStyle = "rgba(56, 79, 68, 0.22)";
  ctx.lineWidth = 1;

  for (let lon = Math.floor(bounds.minLon / 5) * 5; lon <= bounds.maxLon; lon += 5) {
    const start = projectLatLon(bounds.minLat, lon, bounds, frame);
    const end = projectLatLon(bounds.maxLat, lon, bounds, frame);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (let lat = Math.floor(bounds.minLat / 5) * 5; lat <= bounds.maxLat; lat += 5) {
    const start = projectLatLon(lat, bounds.minLon, bounds, frame);
    const end = projectLatLon(lat, bounds.maxLon, bounds, frame);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(47, 95, 79, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(renderedRect.x, renderedRect.y, renderedRect.width, renderedRect.height);
}

function drawGeocodedConnections(links, byQuery, points) {
  const bounds = computeBounds(points);
  const frame = getMapFrame();

  ctx.font = "500 14px 'IBM Plex Sans', 'Segoe UI', sans-serif";

  for (const link of links) {
    const from = byQuery.get(link.from.toLowerCase());
    const to = byQuery.get(link.to.toLowerCase());
    if (!from || !to) {
      continue;
    }

    const p1 = projectLatLon(from.latitude, from.longitude, bounds, frame);
    const p2 = projectLatLon(to.latitude, to.longitude, bounds, frame);

    // White halo for contrast over map tiles
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    ctx.strokeStyle = "rgba(30, 80, 55, 0.9)";
    ctx.fillStyle = "#1e5037";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    drawArrowHead(p1.x, p1.y, p2.x, p2.y, 10);

    if (link.label) {
      ctx.fillStyle = "#264f42";
      ctx.fillText(link.label, (p1.x + p2.x) / 2 + 8, (p1.y + p2.y) / 2 - 6);
    }
  }
}

function drawGeocodedNodes(points) {
  const bounds = computeBounds(points);
  const frame = getMapFrame();

  for (const city of points) {
    const pos = projectLatLon(city.latitude, city.longitude, bounds, frame);
    const radius = 10;

    // Drop shadow
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#d9652b";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label with white halo
    ctx.font = "600 15px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    const label = city.name;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeText(label, pos.x + 12, pos.y - 10);
    ctx.fillStyle = "#1a2e1a";
    ctx.fillText(label, pos.x + 12, pos.y - 10);
  }
}

function buildSequentialLinks(points) {
  const links = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    links.push({
      from: points[i].query,
      to: points[i + 1].query,
      label: ""
    });
  }
  return links;
}

function normalizeCityList(input) {
  return String(input || "")
    .split(/[\n,;]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function geocodeCity(city) {
  const endpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
  endpoint.searchParams.set("name", city);
  endpoint.searchParams.set("count", "1");
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("format", "json");

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to geocode \"${city}\" (HTTP ${response.status}).`);
  }

  const payload = await response.json();
  const match = payload.results?.[0];
  if (!match) {
    throw new Error(`Could not find city \"${city}\".`);
  }

  const suffix = [match.admin1, match.country].filter(Boolean).join(", ");
  return {
    query: city,
    name: suffix ? `${match.name}, ${suffix}` : match.name,
    country: match.country || "",
    latitude: Number(match.latitude),
    longitude: Number(match.longitude)
  };
}

function computeBounds(points) {
  const lats = points.map((point) => clamp(point.latitude, -85, 85));
  const lons = points.map((point) => point.longitude);

  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);

  const latPad = Math.max(2, (maxLat - minLat) * 0.22);
  const lonPad = Math.max(2, (maxLon - minLon) * 0.22);

  minLat = clamp(minLat - latPad, -85, 85);
  maxLat = clamp(maxLat + latPad, -85, 85);
  minLon -= lonPad;
  maxLon += lonPad;

  if (Math.abs(maxLat - minLat) < 3) {
    minLat -= 2;
    maxLat += 2;
  }
  if (Math.abs(maxLon - minLon) < 3) {
    minLon -= 2;
    maxLon += 2;
  }

  return { minLat, maxLat, minLon, maxLon };
}

function getMapFrame() {
  return {
    x: 70,
    y: 110,
    width: els.canvas.width - 140,
    height: els.canvas.height - 180
  };
}

// Returns the transform needed to draw the map with correct 1:1 Mercator aspect ratio,
// centered inside `frame` (letterboxed if the frame aspect differs from the map's).
function getMapTransform(bounds, frame) {
  const mercLon = (lon) => (lon + 180) / 360;
  const mercLat = (lat) => {
    const rad = (clamp(lat, -85, 85) * Math.PI) / 180;
    return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
  };

  const mx0 = mercLon(bounds.minLon);
  const mx1 = mercLon(bounds.maxLon);
  const my0 = mercLat(bounds.maxLat); // top edge
  const my1 = mercLat(bounds.minLat); // bottom edge

  const mercW = Math.max(mx1 - mx0, 1e-6);
  const mercH = Math.max(my1 - my0, 1e-6);

  // Uniform scale: fit the Mercator rectangle into the frame while preserving aspect
  const scale = Math.min(frame.width / mercW, frame.height / mercH);

  // Center the rendered area inside the frame
  const offsetX = frame.x + (frame.width  - mercW * scale) / 2;
  const offsetY = frame.y + (frame.height - mercH * scale) / 2;

  return { mx0, my0, scale, offsetX, offsetY, mercLon, mercLat };
}

function projectLatLon(lat, lon, bounds, frame) {
  const { mx0, my0, scale, offsetX, offsetY, mercLon, mercLat } = getMapTransform(bounds, frame);
  return {
    x: offsetX + (mercLon(lon) - mx0) * scale,
    y: offsetY + (mercLat(lat) - my0) * scale
  };
}

function drawArrowHead(x1, y1, x2, y2, size) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.fillStyle = "#2f5f4f";
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function latLonToTile(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const lat_rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lat_rad) + 1 / Math.cos(lat_rad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function tileToBounds(x, y, z) {
  const n = Math.pow(2, z);
  const tileToLon = (tx) => (tx / n) * 360 - 180;
  const tileToLat = (ty) => {
    const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
    return (rad * 180) / Math.PI;
  };
  return {
    minLon: tileToLon(x),
    maxLon: tileToLon(x + 1),
    maxLat: tileToLat(y),
    minLat: tileToLat(y + 1)
  };
}

function loadTileImage(x, y, z) {
  const n = Math.pow(2, z);
  const tx = ((x % n) + n) % n;
  const url = `https://tile.openstreetmap.org/${z}/${tx}/${y}.png`;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function fetchAndDrawOSMTiles(bounds, frame) {
  const span = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLon - bounds.minLon);
  let z;
  if (span > 80) z = 3;
  else if (span > 40) z = 4;
  else if (span > 20) z = 5;
  else if (span > 10) z = 6;
  else if (span > 5) z = 7;
  else z = 8;

  const tileNW = latLonToTile(bounds.maxLat, bounds.minLon, z);
  const tileSE = latLonToTile(bounds.minLat, bounds.maxLon, z);

  const countX = tileSE.x - tileNW.x + 1;
  const countY = tileSE.y - tileNW.y + 1;
  if (countX * countY > 36) return false;

  const fetchJobs = [];
  for (let ty = tileNW.y; ty <= tileSE.y; ty++) {
    for (let tx = tileNW.x; tx <= tileSE.x; tx++) {
      fetchJobs.push(loadTileImage(tx, ty, z).then((img) => ({ img, tx, ty })));
    }
  }

  let tiles;
  try {
    tiles = await Promise.all(fetchJobs);
  } catch {
    return false;
  }

  if (tiles.every((t) => !t.img)) return false;

  ctx.save();
  ctx.beginPath();
  // Clip to the actual rendered map area (not the full frame, which may be wider/taller)
  const t = getMapTransform(bounds, frame);
  const mercW = (t.mercLon(bounds.maxLon) - t.mx0) * t.scale;
  const mercH = (t.mercLat(bounds.minLat) - t.my0) * t.scale;
  ctx.rect(t.offsetX, t.offsetY, mercW, mercH);
  ctx.clip();

  for (const { img, tx, ty } of tiles) {
    if (!img) continue;
    const tb = tileToBounds(tx, ty, z);
    const topLeft = projectLatLon(tb.maxLat, tb.minLon, bounds, frame);
    const bottomRight = projectLatLon(tb.minLat, tb.maxLon, bounds, frame);
    ctx.drawImage(img, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  ctx.restore();
  return true;
}

function drawOSMAttribution(frame) {  const bounds_placeholder = null; // bounds not needed — just use frame bottom-right  const text = "© OpenStreetMap contributors";
  ctx.font = "11px sans-serif";
  const tw = ctx.measureText(text).width;
  const px = frame.x + frame.width - tw - 6;
  const py = frame.y + frame.height - 4;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(px - 4, py - 14, tw + 8, 18);
  ctx.fillStyle = "#333";
  ctx.fillText(text, px, py);
}
