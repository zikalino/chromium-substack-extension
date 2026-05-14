import { clamp, getAssetIdFromQuery, getImageAssetById, saveCanvasAsImage, setStatus } from "./shared.js";

const els = {
  statusText: document.querySelector("#status-text"),
  mapMode: document.querySelector("#map-mode"),
  citiesTableBody: document.querySelector("#cities-table-body"),
  addCityRowBtn: document.querySelector("#add-city-row"),
  regionsTableBody: document.querySelector("#regions-table-body"),
  addRegionRowBtn: document.querySelector("#add-region-row"),
  layoutType: document.querySelector("#layout-type"),
  mapTitle: document.querySelector("#map-title"),
  geocodeResults: document.querySelector("#geocode-results"),
  canvas: document.querySelector("#map-canvas")
};

const ctx = els.canvas.getContext("2d");

// City data structure: array of { query, displayName, latitude, longitude, country }
// Region data structure: array of { query, displayName, osmId, osmType, color, lineWidth, geojson }
const state = {
  cities: [],
  regions: []
};

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

  els.addCityRowBtn.addEventListener("click", () => {
    addCityRow();
  });

  els.addRegionRowBtn.addEventListener("click", () => {
    addRegionRow();
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
  const restoredState = asset?.editorState;
  if (!restoredState) {
    return false;
  }

  els.mapMode.value = restoredState.mapMode || "geocoded";
  els.layoutType.value = restoredState.layoutType || "circle";
  els.mapTitle.value = restoredState.title || els.mapTitle.value;
  
  // Restore cities
  if (Array.isArray(restoredState.cities)) {
    state.cities = restoredState.cities.map((city) => ({
      query: String(city.query || ""),
      displayName: String(city.displayName || ""),
      latitude: Number(city.latitude || 0),
      longitude: Number(city.longitude || 0),
      country: String(city.country || ""),
      connections: Array.isArray(city.connections)
        ? city.connections.map((item) => String(item || "").trim()).filter(Boolean)
        : []
    }));
    renderCitiesTable();
  }

  // Restore regions
  if (Array.isArray(restoredState.regions)) {
    state.regions = restoredState.regions.map((r) => ({
      query: String(r.query || ""),
      displayName: String(r.displayName || ""),
      osmId: r.osmId || null,
      osmType: r.osmType || null,
      color: String(r.color || "#e63946"),
      lineWidth: Number(r.lineWidth || 3),
      // Do not persist heavy boundary geometry in storage.
      geojson: null
    }));
    renderRegionsTable();
  }

  // Backward compatibility for older saved maps using global connection lines.
  if (Array.isArray(restoredState.connections) && state.cities.length) {
    migrateLegacyConnections(restoredState.connections);
    renderCitiesTable();
  }

  els.geocodeResults.textContent = "";
  return true;
}

function collectMapState() {
  return {
    mapMode: els.mapMode.value,
    cities: state.cities,
    regions: state.regions.map((r) => ({
      query: r.query,
      displayName: r.displayName,
      osmId: r.osmId,
      osmType: r.osmType,
      color: r.color,
      lineWidth: r.lineWidth
    })),
    layoutType: els.layoutType.value,
    title: els.mapTitle.value.trim()
  };
}

function migrateLegacyConnections(connectionLines) {
  const indexByKey = new Map();
  for (let i = 0; i < state.cities.length; i += 1) {
    const city = state.cities[i];
    const query = String(city.query || "").trim();
    const display = String(city.displayName || city.query || "").trim();
    if (query) {
      indexByKey.set(query.toLowerCase(), i);
    }
    if (display) {
      indexByKey.set(display.toLowerCase(), i);
    }
  }

  for (const line of connectionLines) {
    const normalized = String(line || "").replaceAll("->", "-").replaceAll(" to ", "-");
    const segments = normalized.split("-").map((part) => part.trim()).filter(Boolean);
    if (segments.length < 2) {
      continue;
    }

    const sourceIndex = indexByKey.get(segments[0].toLowerCase());
    if (sourceIndex === undefined) {
      continue;
    }
    if (!Array.isArray(state.cities[sourceIndex].connections)) {
      state.cities[sourceIndex].connections = [];
    }
    state.cities[sourceIndex].connections.push(segments[1]);
  }

  for (const city of state.cities) {
    city.connections = Array.from(new Set((city.connections || []).filter(Boolean)));
  }
}

function loadExample() {
  state.cities = [
    {
      query: "Lisbon",
      displayName: "Lisbon",
      latitude: 38.7223,
      longitude: -9.1393,
      country: "Portugal",
      connections: ["Madrid"]
    },
    {
      query: "Madrid",
      displayName: "Madrid",
      latitude: 40.4168,
      longitude: -3.7038,
      country: "Spain",
      connections: ["Paris"]
    },
    {
      query: "Paris",
      displayName: "Paris",
      latitude: 48.8566,
      longitude: 2.3522,
      country: "France",
      connections: ["Brussels"]
    },
    {
      query: "Brussels",
      displayName: "Brussels",
      latitude: 50.8503,
      longitude: 4.3517,
      country: "Belgium",
      connections: ["Amsterdam"]
    },
    {
      query: "Amsterdam",
      displayName: "Amsterdam",
      latitude: 52.3676,
      longitude: 4.9041,
      country: "Netherlands",
      connections: []
    }
  ];
  renderCitiesTable();
}

function renderCitiesTable() {
  els.citiesTableBody.innerHTML = "";
  for (let i = 0; i < state.cities.length; i++) {
    addCityTableRow(i);
  }
  // Add one empty row at the end if table is empty
  if (state.cities.length === 0) {
    addCityTableRow(0);
  }
}

function ensureCityAtIndex(index) {
  while (state.cities.length <= index) {
    state.cities.push({
      query: "",
      displayName: "",
      latitude: 0,
      longitude: 0,
      country: "",
      connections: []
    });
  }
  if (!Array.isArray(state.cities[index].connections)) {
    state.cities[index].connections = [];
  }
}

function addCityTableRow(index) {
  const city = state.cities[index];
  const tr = document.createElement("tr");
  
  const cityCell = document.createElement("td");
  cityCell.className = "city-input-cell";
  const cityInput = document.createElement("input");
  cityInput.type = "text";
  cityInput.placeholder = "Search city...";
  cityInput.value = city?.query || "";
  cityInput.dataset.index = String(index);
  
  let searchTimeout;
  cityInput.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    ensureCityAtIndex(index);
    state.cities[index].query = query;
    // New free-typed query invalidates prior approved coordinates.
    state.cities[index].latitude = 0;
    state.cities[index].longitude = 0;
    if (!state.cities[index].displayName) {
      state.cities[index].displayName = query;
    }
    
    if (!query) {
      closeAutocomplete(cityInput);
      return;
    }
    
    searchTimeout = setTimeout(async () => {
      const matches = await searchCities(query);
      showAutocomplete(cityInput, matches, index);
    }, 300);
  });

  cityInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const dropdown = cityCell.querySelector(".city-autocomplete");
    const firstItem = dropdown?.querySelector(".city-autocomplete-item");
    if (firstItem) {
      firstItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      return;
    }
    const query = cityInput.value.trim();
    if (query) {
      await resolveCityAtIndex(index, query);
    }
  });
  
  cityInput.addEventListener("blur", () => {
    setTimeout(() => closeAutocomplete(cityInput), 200);
  });
  
  cityCell.appendChild(cityInput);
  tr.appendChild(cityCell);
  
  const displayCell = document.createElement("td");
  const displayInput = document.createElement("input");
  displayInput.type = "text";
  displayInput.placeholder = "Will auto-fill...";
  displayInput.value = city?.displayName || "";
  displayInput.dataset.index = String(index);
  displayInput.addEventListener("input", (event) => {
    ensureCityAtIndex(index);
    state.cities[index].displayName = event.target.value.trim();
  });
  displayCell.appendChild(displayInput);
  tr.appendChild(displayCell);

  const connectionsCell = document.createElement("td");
  connectionsCell.className = "city-connections-cell";
  const stack = document.createElement("div");
  stack.className = "connections-stack";
  const cityConnections = Array.isArray(city?.connections) ? city.connections : [];

  if (!cityConnections.length) {
    stack.appendChild(createConnectionEditor(index, ""));
  } else {
    for (const connectionValue of cityConnections) {
      stack.appendChild(createConnectionEditor(index, connectionValue));
    }
  }

  const addConnectionBtn = document.createElement("button");
  addConnectionBtn.type = "button";
  addConnectionBtn.className = "connection-add-btn";
  addConnectionBtn.textContent = "+ Add link";
  addConnectionBtn.addEventListener("click", () => {
    ensureCityAtIndex(index);
    state.cities[index].connections.push("");
    renderCitiesTable();
  });
  stack.appendChild(addConnectionBtn);
  connectionsCell.appendChild(stack);
  tr.appendChild(connectionsCell);
  
  const actionCell = document.createElement("td");
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "city-remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => removeCityRow(index));
  actionCell.appendChild(removeBtn);
  tr.appendChild(actionCell);
  
  els.citiesTableBody.appendChild(tr);
}

function createConnectionEditor(cityIndex, value) {
  const row = document.createElement("div");
  row.className = "connection-row";

  const inputWrap = document.createElement("div");
  inputWrap.className = "connection-input-wrap";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Connect to city...";
  input.value = value || "";

  input.addEventListener("input", (event) => {
    ensureCityAtIndex(cityIndex);
    state.cities[cityIndex].connections = collectConnectionValues(row.parentElement);

    const query = event.target.value.trim();
    if (!query) {
      closeConnectionAutocomplete(input);
      return;
    }

    const suggestions = getConnectionSuggestions(cityIndex, query);
    showConnectionAutocomplete(input, suggestions, (selected) => {
      input.value = selected;
      state.cities[cityIndex].connections = collectConnectionValues(row.parentElement);
    });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const dropdown = row.querySelector(".connection-autocomplete");
    const firstItem = dropdown?.querySelector(".connection-autocomplete-item");
    if (firstItem) {
      event.preventDefault();
      firstItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => closeConnectionAutocomplete(input), 180);
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "connection-remove-btn";
  removeBtn.textContent = "-";
  removeBtn.title = "Remove link";
  removeBtn.addEventListener("click", () => {
    const container = row.parentElement;
    row.remove();
    ensureCityAtIndex(cityIndex);
    state.cities[cityIndex].connections = collectConnectionValues(container);
    if (!state.cities[cityIndex].connections.length) {
      state.cities[cityIndex].connections.push("");
    }
    renderCitiesTable();
  });

  inputWrap.appendChild(input);
  row.appendChild(inputWrap);
  row.appendChild(removeBtn);
  return row;
}

function collectConnectionValues(container) {
  return Array.from(container.querySelectorAll(".connection-row input"))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function getConnectionSuggestions(sourceCityIndex, query) {
  const term = query.toLowerCase();
  const sourceCity = state.cities[sourceCityIndex];
  const sourceName = String(sourceCity?.displayName || sourceCity?.query || "").trim().toLowerCase();

  const unique = new Set();
  for (let i = 0; i < state.cities.length; i += 1) {
    const city = state.cities[i];
    if (!city) {
      continue;
    }
    const display = String(city.displayName || city.query || "").trim();
    if (!display) {
      continue;
    }
    const displayLower = display.toLowerCase();
    if (displayLower === sourceName) {
      continue;
    }
    if (displayLower.includes(term)) {
      unique.add(display);
    }
  }

  return Array.from(unique).slice(0, 8);
}

function showConnectionAutocomplete(input, suggestions, onSelect) {
  closeConnectionAutocomplete(input);
  if (!suggestions.length) {
    return;
  }

  const dropdown = document.createElement("div");
  dropdown.className = "connection-autocomplete";

  const row = input.closest(".connection-row");
  const rowRect = row.getBoundingClientRect();
  const estimatedHeight = Math.min(140, suggestions.length * 30 + 2);
  const spaceBelow = window.innerHeight - rowRect.bottom;
  const spaceAbove = rowRect.top;
  if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
    dropdown.classList.add("open-up");
  }

  for (const suggestion of suggestions) {
    const item = document.createElement("div");
    item.className = "connection-autocomplete-item";
    item.textContent = suggestion;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      onSelect(suggestion);
      closeConnectionAutocomplete(input);
    });
    dropdown.appendChild(item);
  }

  row.classList.add("autocomplete-open");
  input.parentElement.appendChild(dropdown);
}

function closeConnectionAutocomplete(input) {
  const row = input.closest(".connection-row");
  const dropdown = input.parentElement.querySelector(".connection-autocomplete");
  if (dropdown) {
    dropdown.remove();
  }
  if (row) {
    row.classList.remove("autocomplete-open");
  }
}

function addCityRow() {
  state.cities.push({
    query: "",
    displayName: "",
    latitude: 0,
    longitude: 0,
    country: "",
    connections: []
  });
  renderCitiesTable();
  // Focus the new city input
  const inputs = els.citiesTableBody.querySelectorAll("input[placeholder='Search city...']");
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

// ── Regions table ────────────────────────────────────────────────────────────

function renderRegionsTable() {
  els.regionsTableBody.innerHTML = "";
  if (!state.regions.length) {
    return;
  }
  for (let i = 0; i < state.regions.length; i++) {
    els.regionsTableBody.appendChild(createRegionRow(i));
  }
}

function addRegionRow() {
  state.regions.push({
    query: "",
    displayName: "",
    osmId: null,
    osmType: null,
    color: "#e63946",
    lineWidth: 3,
    geojson: null
  });
  renderRegionsTable();
  const inputs = els.regionsTableBody.querySelectorAll("input.region-search-input");
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

function createRegionRow(index) {
  const region = state.regions[index];
  const tr = document.createElement("tr");

  // --- search cell ---
  const searchCell = document.createElement("td");
  searchCell.className = "region-input-cell";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "region-search-input";
  searchInput.placeholder = "Search province / country...";
  searchInput.value = region.displayName || region.query || "";

  let searchTimeout;
  searchInput.addEventListener("input", (event) => {
    clearTimeout(searchTimeout);
    const query = event.target.value.trim();
    state.regions[index].query = query;
    state.regions[index].osmId = null;
    state.regions[index].geojson = null;
    if (!query) {
      closeRegionAutocomplete(searchInput);
      return;
    }
    searchTimeout = setTimeout(async () => {
      const matches = await searchRegions(query);
      showRegionAutocomplete(searchInput, matches, index);
    }, 400);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const dropdown = searchCell.querySelector(".region-autocomplete");
    const firstItem = dropdown?.querySelector(".region-autocomplete-item");
    if (firstItem) {
      event.preventDefault();
      firstItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
  });

  searchInput.addEventListener("blur", () => {
    setTimeout(() => closeRegionAutocomplete(searchInput), 180);
  });

  searchCell.appendChild(searchInput);
  tr.appendChild(searchCell);

  // --- controls cell ---
  const controlsCell = document.createElement("td");
  const controls = document.createElement("div");
  controls.className = "region-controls";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "region-color-input";
  colorInput.value = region.color || "#e63946";
  colorInput.title = "Border color";
  colorInput.addEventListener("input", (event) => {
    state.regions[index].color = event.target.value;
  });

  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.className = "region-width-input";
  widthInput.value = String(region.lineWidth ?? 3);
  widthInput.min = "1";
  widthInput.max = "12";
  widthInput.title = "Line width (px)";
  widthInput.addEventListener("input", (event) => {
    state.regions[index].lineWidth = Math.max(1, Number(event.target.value) || 3);
  });

  controls.appendChild(colorInput);
  controls.appendChild(widthInput);
  controlsCell.appendChild(controls);
  tr.appendChild(controlsCell);

  // --- remove cell ---
  const removeCell = document.createElement("td");
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "region-remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => {
    state.regions.splice(index, 1);
    renderRegionsTable();
  });
  removeCell.appendChild(removeBtn);
  tr.appendChild(removeCell);

  return tr;
}

async function searchRegions(query) {
  try {
    const endpoint = new URL("https://nominatim.openstreetmap.org/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("limit", "8");
    endpoint.searchParams.set("featuretype", "settlement,country,state");
    endpoint.searchParams.set("addressdetails", "1");
    endpoint.searchParams.set("accept-language", "en");

    const response = await fetch(endpoint, {
      headers: { "Accept-Language": "en" }
    });
    if (!response.ok) {
      return [];
    }
    const results = await response.json();
    // Filter to administrative/boundary types only
    return results
      .filter((r) => r.osm_type && r.osm_id && ["administrative", "boundary"].includes(r.class || r.type))
      .map((r) => ({
        osmId: String(r.osm_id),
        osmType: r.osm_type,
        displayName: r.display_name.split(",").slice(0, 2).join(",").trim(),
        fullName: r.display_name,
        type: r.type
      }));
  } catch (error) {
    console.error("Region search error:", error);
    return [];
  }
}

function showRegionAutocomplete(input, matches, regionIndex) {
  closeRegionAutocomplete(input);
  if (!matches.length) {
    return;
  }

  const dropdown = document.createElement("div");
  dropdown.className = "region-autocomplete";

  const cellRect = input.parentElement.getBoundingClientRect();
  const estimatedHeight = Math.min(160, matches.length * 46 + 2);
  const spaceBelow = window.innerHeight - cellRect.bottom;
  if (spaceBelow < estimatedHeight && cellRect.top > spaceBelow) {
    dropdown.classList.add("open-up");
  }

  for (const match of matches) {
    const item = document.createElement("div");
    item.className = "region-autocomplete-item";
    item.innerHTML = `${match.displayName}<small>${match.fullName}</small>`;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      state.regions[regionIndex].query = match.fullName;
      state.regions[regionIndex].displayName = match.displayName;
      state.regions[regionIndex].osmId = match.osmId;
      state.regions[regionIndex].osmType = match.osmType;
      state.regions[regionIndex].geojson = null;
      renderRegionsTable();
    });
    dropdown.appendChild(item);
  }

  input.parentElement.classList.add("autocomplete-open");
  input.parentElement.appendChild(dropdown);
}

function closeRegionAutocomplete(input) {
  const dropdown = input.parentElement.querySelector(".region-autocomplete");
  if (dropdown) {
    dropdown.remove();
  }
  input.parentElement.classList.remove("autocomplete-open");
}

async function fetchRegionGeoJSON(osmType, osmId) {
  // Use Nominatim details endpoint to get GeoJSON polygon
  const endpoint = new URL("https://nominatim.openstreetmap.org/details");
  endpoint.searchParams.set("osmtype", osmType.charAt(0).toUpperCase());
  endpoint.searchParams.set("osmid", osmId);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("polygon_geojson", "1");
  endpoint.searchParams.set("accept-language", "en");

  const response = await fetch(endpoint, {
    headers: { "Accept-Language": "en" }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch region boundary (HTTP ${response.status}).`);
  }
  const data = await response.json();
  return data.geometry || null;
}


function removeCityRow(index) {
  state.cities.splice(index, 1);
  renderCitiesTable();
}

async function searchCities(query) {
  try {
    const endpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
    endpoint.searchParams.set("name", query);
    endpoint.searchParams.set("count", "8");
    endpoint.searchParams.set("language", "en");
    endpoint.searchParams.set("format", "json");
    
    const response = await fetch(endpoint);
    if (!response.ok) return [];
    
    const payload = await response.json();
    return (payload.results || []).map(r => ({
      name: r.name,
      admin1: r.admin1 || "",
      country: r.country || "",
      latitude: r.latitude,
      longitude: r.longitude,
      displayName: r.name,
      fullName: [r.name, r.admin1, r.country].filter(Boolean).join(", ")
    }));
  } catch (error) {
    console.error("City search error:", error);
    return [];
  }
}

function showAutocomplete(input, matches, cityIndex) {
  closeAutocomplete(input);
  
  if (!matches.length) return;
  
  const dropdown = document.createElement("div");
  dropdown.className = "city-autocomplete";

  const rowRect = input.parentElement.getBoundingClientRect();
  const estimatedHeight = Math.min(150, matches.length * 34 + 2);
  const spaceBelow = window.innerHeight - rowRect.bottom;
  const spaceAbove = rowRect.top;
  if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
    dropdown.classList.add("open-up");
  }
  
  for (const match of matches) {
    const item = document.createElement("div");
    item.className = "city-autocomplete-item";
    item.textContent = match.fullName;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectCityMatch(match, cityIndex);
      closeAutocomplete(input);
    });
    dropdown.appendChild(item);
  }

  input.parentElement.classList.add("autocomplete-open");
  input.parentElement.appendChild(dropdown);
}

function closeAutocomplete(input) {
  const dropdown = input.parentElement.querySelector(".city-autocomplete");
  if (dropdown) {
    dropdown.remove();
  }
  input.parentElement.classList.remove("autocomplete-open");
}

function selectCityMatch(match, cityIndex) {
  ensureCityAtIndex(cityIndex);
  
  state.cities[cityIndex] = {
    query: match.name + (match.admin1 ? `, ${match.admin1}` : "") + (match.country ? `, ${match.country}` : ""),
    displayName: match.displayName,
    latitude: match.latitude,
    longitude: match.longitude,
    country: match.country,
    connections: Array.isArray(state.cities[cityIndex].connections)
      ? state.cities[cityIndex].connections
      : []
  };
  
  renderCitiesTable();
}

async function resolveCityAtIndex(cityIndex, query) {
  try {
    const point = await geocodeCity(query);
    ensureCityAtIndex(cityIndex);
    state.cities[cityIndex] = {
      query,
      displayName: state.cities[cityIndex].displayName || point.displayName,
      latitude: point.latitude,
      longitude: point.longitude,
      country: point.country,
      connections: Array.isArray(state.cities[cityIndex].connections)
        ? state.cities[cityIndex].connections
        : []
    };
    renderCitiesTable();
  } catch {
    // Keep typed text as-is and let render validation show the status message.
  }
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
  const cityNames = state.cities
    .map((city) => (city.displayName || city.query || "").trim())
    .filter(Boolean);
  const links = buildManualLinksFromCityConnections(state.cities);

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
  const candidates = state.cities
    .map((city) => ({
      ...city,
      query: String(city.query || "").trim(),
      displayName: String(city.displayName || "").trim()
    }))
    .filter((city) => city.query);

  const cities = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const city = candidates[i];
    if (city.latitude && city.longitude) {
      cities.push(city);
      continue;
    }

    const resolved = await geocodeCity(city.query);
    const merged = {
      ...city,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      country: resolved.country,
      displayName: city.displayName || resolved.displayName
    };
    cities.push(merged);
  }

  state.cities = cities;
  renderCitiesTable();
  
  if (cities.length < 2) {
    setStatus(els.statusText, "Enter at least two city names for geocoded mode.", true);
    return;
  }

  setStatus(els.statusText, "Preparing geocoded map...");
  try {
    const explicitLinks = buildGeocodedLinksFromCityConnections(cities);
    const links = explicitLinks.length ? explicitLinks : buildSequentialLinks(cities);
    const byQuery = new Map(cities.map((item) => [item.query.toLowerCase(), item]));

    const bounds = computeBounds(cities);
    const frame = getMapFrame();

    drawBackground();
    setStatus(els.statusText, "Loading map tiles...");
    const tilesLoaded = await fetchAndDrawOSMTiles(bounds, frame);

    drawTitle(els.mapTitle.value.trim() || "City Route Map");
    if (!tilesLoaded) {
      drawGeographyGrid(cities);
    }

    // Draw region boundaries before cities/connections
    const regionsToRender = state.regions.filter((r) => r.osmId && r.osmType);
    if (regionsToRender.length) {
      setStatus(els.statusText, "Loading region boundaries...");
      for (const region of regionsToRender) {
        try {
          if (!region.geojson) {
            region.geojson = await fetchRegionGeoJSON(region.osmType, region.osmId);
          }
          if (region.geojson) {
            drawRegionBoundary(region.geojson, bounds, frame, region.color, region.lineWidth);
          }
        } catch (err) {
          console.warn(`Could not draw boundary for ${region.displayName}:`, err);
        }
      }
    }

    drawGeocodedConnections(links, byQuery, cities);
    drawGeocodedNodes(cities);
    if (tilesLoaded) {
      drawOSMAttribution(frame);
    }

    els.geocodeResults.textContent = cities
      .map((item) => `${item.displayName} (${item.latitude.toFixed(3)}, ${item.longitude.toFixed(3)})`)
      .join(" | ");
    setStatus(els.statusText, `Rendered geocoded route for ${cities.length} cities.`);
  } catch (error) {
    setStatus(els.statusText, error.message || "Could not resolve cities.", true);
  }
}

function buildManualLinksFromCityConnections(cities) {
  const displayNameLookup = new Map();
  for (const city of cities) {
    const display = String(city.displayName || city.query || "").trim();
    const query = String(city.query || "").trim();
    if (!display) {
      continue;
    }
    displayNameLookup.set(display.toLowerCase(), display);
    if (query) {
      displayNameLookup.set(query.toLowerCase(), display);
    }
  }

  const links = [];

  for (const city of cities) {
    const from = String(city.displayName || city.query || "").trim();
    if (!from) {
      continue;
    }
    const connections = Array.isArray(city.connections) ? city.connections : [];
    for (const connection of connections) {
      const targetRaw = String(connection || "").trim();
      if (!targetRaw) {
        continue;
      }
      const targetResolved = displayNameLookup.get(targetRaw.toLowerCase()) || targetRaw;
      links.push({
        from,
        to: targetResolved,
        label: ""
      });
    }
  }

  return links;
}

function buildGeocodedLinksFromCityConnections(cities) {
  const queryLookup = new Map();
  for (const city of cities) {
    const query = String(city.query || "").trim();
    const display = String(city.displayName || city.query || "").trim();
    if (!query) {
      continue;
    }
    queryLookup.set(query.toLowerCase(), query);
    if (display) {
      queryLookup.set(display.toLowerCase(), query);
    }
  }

  const links = [];
  for (const city of cities) {
    const from = String(city.query || "").trim();
    if (!from) {
      continue;
    }
    const connections = Array.isArray(city.connections) ? city.connections : [];
    for (const connection of connections) {
      const targetRaw = String(connection || "").trim();
      if (!targetRaw) {
        continue;
      }
      const targetResolved = queryLookup.get(targetRaw.toLowerCase()) || targetRaw;
      links.push({
        from,
        to: targetResolved,
        label: ""
      });
    }
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

function drawRegionBoundary(geojson, bounds, frame, color, lineWidth) {
  ctx.save();
  ctx.strokeStyle = color || "#e63946";
  ctx.lineWidth = lineWidth || 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);

  const drawRing = (coords) => {
    if (!coords || coords.length < 2) {
      return;
    }
    ctx.beginPath();
    let started = false;
    for (const [lon, lat] of coords) {
      const pos = projectLatLon(lat, lon, bounds, frame);
      if (!started) {
        ctx.moveTo(pos.x, pos.y);
        started = true;
      } else {
        ctx.lineTo(pos.x, pos.y);
      }
    }
    ctx.closePath();
    ctx.stroke();
  };

  const drawGeometry = (geometry) => {
    if (!geometry) {
      return;
    }
    if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) {
        drawRing(ring);
      }
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          drawRing(ring);
        }
      }
    } else if (geometry.type === "GeometryCollection") {
      for (const geom of geometry.geometries || []) {
        drawGeometry(geom);
      }
    }
  };

  drawGeometry(geojson);
  ctx.restore();
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
    const label = city.displayName || city.name;
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
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function geocodeCity(city) {
  // Parse city input to extract name, state/province, and country
  // Supports: "CityName", "CityName, Province", "CityName, Province, Country", etc.
  const parts = city.split(",").map(p => p.trim());
  const cityName = parts[0];
  const state = parts[1] || "";
  const country = parts[2] || "";

  const endpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
  endpoint.searchParams.set("name", cityName);
  endpoint.searchParams.set("count", "5"); // Get top 5 to find best match
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("format", "json");
  
  if (country) {
    endpoint.searchParams.set("country", country);
  }
  if (state) {
    endpoint.searchParams.set("admin1", state);
  }

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to geocode \"${city}\" (HTTP ${response.status}).`);
  }

  const payload = await response.json();
  const results = payload.results || [];
  
  let match = null;
  
  // If state or country specified, find best match
  if (state || country) {
    match = results.find(r => {
      const adminMatch = !state || (r.admin1 && r.admin1.toLowerCase() === state.toLowerCase());
      const countryMatch = !country || (r.country && r.country.toLowerCase() === country.toLowerCase());
      return adminMatch && countryMatch;
    });
  }
  
  // Fall back to first result if no specific match found
  match = match || results[0];
  
  if (!match) {
    throw new Error(`Could not find city \"${city}\".`);
  }

  const suffix = [match.admin1, match.country].filter(Boolean).join(", ");
  return {
    query: city,
    name: suffix ? `${match.name}, ${suffix}` : match.name,
    displayName: match.name,
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
