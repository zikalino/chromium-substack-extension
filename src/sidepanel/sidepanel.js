const state = {
  userProfile: null,
  subscriptions: {},
  publications: [],
  citations: [],
  bookmarks: [],
  imageAssets: []
};

const selectedImageIds = new Set();
let isPremiumPlan = false;

const BASIC_PLAN_ITEMS = [
  { label: "Register to Yunnan", url: "https://yunnan.substack.com/subscribe", upgrades: true },
  { label: "Register to Developer Experience", url: "https://zikalino.substack.com/signup", upgrades: true },
  { label: "Sponsor on GitHub", url: "https://github.com/sponsors", upgrades: true }
];

const PREMIUM_PLAN_ITEMS = [
  { label: "Yunnan Substack", url: "https://yunnan.substack.com/" },
  { label: "Developer Experience Substack", url: "https://zikalino.substack.com/" }
];

const els = {
  statusText: document.querySelector("#status-text"),
  userProfile: document.querySelector("#user-profile"),
  publicationTree: document.querySelector("#publication-tree"),
  citationText: document.querySelector("#citation-text"),
  citationUrl: document.querySelector("#citation-url"),
  citationList: document.querySelector("#citation-list"),
  bookmarkUrl: document.querySelector("#bookmark-url"),
  bookmarkTitle: document.querySelector("#bookmark-title"),
  bookmarkList: document.querySelector("#bookmark-list"),
  imageUrl: document.querySelector("#image-url"),
  imageGrid: document.querySelector("#image-grid"),
  planMenu: document.querySelector("#plan-menu"),
  planButton: document.querySelector("#plan-button"),
  planSubmenu: document.querySelector("#plan-submenu"),
};

bindActions();
bindSectionToggles();
bindDialogs();
bindDropZone();
bindImageAddMenu();
bindStorageRefresh();
init().catch((error) => setStatus(error.message, true));

async function init() {
  await refreshState();
  renderAll();
}

function bindActions() {
  bindPlanMenu();

  document.querySelector("#go-to-my-substack").addEventListener("click", async () => {
    await sendMessage({ type: "sidepanel:go-to-my-substack" });
  });

  document.querySelector("#refresh-substack").addEventListener("click", async () => {
    try {
      await sendMessage({ type: "sidepanel:refresh-active-substack" });
      await refreshState();
      renderAll();
      setStatus("Substack data refreshed from active tab.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.querySelector("#reload-extension").addEventListener("click", () => {
    chrome.runtime.reload();
  });

  document.querySelector("#check-subscriber").addEventListener("click", () => {
    const emailInput = document.querySelector("#subscriber-email");
    const email = (emailInput?.value || "").trim().toLowerCase();
    if (!email) {
      return setResult("Please enter an email.", true);
    }

    const subscriber = state.subscriptions[email];
    if (!subscriber?.isSubscriber) {
      return setResult("Not found in captured subscriber data.", true);
    }

    const paidText = subscriber.isPaid ? "Paid" : "Free";
    const amountText = subscriber.amount ? ` at $${subscriber.amount}` : "";
    setResult(`${email}: ${paidText}${amountText}`);
  });

  document.querySelector("#save-citation").addEventListener("click", async () => {
    const text = els.citationText.value.trim();
    const pageUrl = els.citationUrl.value.trim();
    if (!text) {
      return setStatus("Citation text is required.", true);
    }

    try {
      const saved = await sendMessage({
        type: "sidepanel:add-citation",
        payload: { text, pageUrl, title: "Manual citation" }
      });
      state.citations.unshift(saved);
      els.citationText.value = "";
      els.citationUrl.value = "";
      document.querySelector("#dialog-add-citation")?.close();
      renderCitations();
      setStatus("Citation saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.querySelector("#save-bookmark").addEventListener("click", async () => {
    const pageUrl = els.bookmarkUrl.value.trim();
    const title = els.bookmarkTitle.value.trim() || "Manual bookmark";
    if (!pageUrl) {
      return setStatus("URL is required.", true);
    }

    try {
      const saved = await sendMessage({
        type: "sidepanel:add-bookmark",
        payload: { pageUrl, title }
      });
      state.bookmarks.unshift(saved);
      els.bookmarkUrl.value = "";
      els.bookmarkTitle.value = "";
      document.querySelector("#dialog-add-bookmark")?.close();
      renderBookmarks();
      setStatus("URL saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.querySelector("#save-image").addEventListener("click", async () => {
    const sourceUrl = els.imageUrl.value.trim();
    if (!sourceUrl) {
      return setStatus("Image URL is required.", true);
    }

    setStatus("Saving image…");
    try {
      const saved = await sendMessage({
        type: "sidepanel:add-image",
        payload: { sourceUrl, title: "Manual image" }
      });
      state.imageAssets.unshift(saved);
      els.imageUrl.value = "";
      document.querySelector("#dialog-add-image")?.close();
      renderImages();
      setStatus("Image saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function bindPlanMenu() {
  renderPlanMenu();

  els.planButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !els.planSubmenu?.classList.contains("hidden");
    if (isOpen) {
      closePlanMenu();
      return;
    }

    els.planSubmenu?.classList.remove("hidden");
    els.planButton?.setAttribute("aria-expanded", "true");
  });

  els.planSubmenu?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest("button[data-url]");
    if (!(button instanceof HTMLElement)) {
      return;
    }

    const url = button.getAttribute("data-url");
    const upgrades = button.getAttribute("data-upgrades") === "true";
    if (!url) {
      return;
    }

    await chrome.tabs.create({ url });
    if (upgrades && !isPremiumPlan) {
      isPremiumPlan = true;
      renderPlanMenu();
    }
    closePlanMenu();
  });

  document.addEventListener("click", () => {
    closePlanMenu();
  });
}

function bindStorageRefresh() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local" || !changes.imageAssets) {
      return;
    }

    await refreshState();
    renderImages();
    setStatus("Image assets refreshed.");
  });
}

function renderPlanMenu() {
  if (!els.planButton || !els.planSubmenu) {
    return;
  }

  const items = isPremiumPlan ? PREMIUM_PLAN_ITEMS : BASIC_PLAN_ITEMS;
  els.planButton.textContent = isPremiumPlan ? "Premium" : "Basic";
  els.planButton.classList.toggle("basic", !isPremiumPlan);
  els.planButton.classList.toggle("premium", isPremiumPlan);

  els.planSubmenu.innerHTML = items
    .map(
      (item) =>
        `<button type="button" role="menuitem" data-url="${escapeHtml(item.url)}" data-upgrades="${Boolean(item.upgrades)}">${escapeHtml(item.label)}</button>`
    )
    .join("");
}

function closePlanMenu() {
  els.planSubmenu?.classList.add("hidden");
  els.planButton?.setAttribute("aria-expanded", "false");
}

async function refreshAndRender(message) {
  await refreshState();
  renderAll();
  if (message) {
    setStatus(message);
  }
}

async function refreshState() {
  const response = await sendMessage({ type: "sidepanel:get-state" });
  Object.assign(state, response);
}

function renderAll() {
  renderUserProfile();
  renderPublicationTree();
  renderCitations();
  renderBookmarks();
  renderImages();

  const profileName = state.userProfile?.name || "No Substack profile captured yet";
  setStatus(profileName);
}

function renderUserProfile() {
  const profile = state.userProfile;
  if (!profile) {
    els.userProfile.innerHTML = `<li class="list-item">Open a Substack page to capture profile and subscriber metadata.</li>`;
    return;
  }

  els.userProfile.innerHTML = `
    <li class="list-item">
      <p><strong>Name:</strong> ${escapeHtml(profile.name || "")}</p>
      <p><strong>Email:</strong> ${escapeHtml(profile.email || "Unknown")}</p>
      <p><strong>Home:</strong> <a href="${escapeHtml(profile.homeUrl || "#")}" target="_blank" rel="noreferrer">${escapeHtml(profile.homeUrl || "-")}</a></p>
    </li>
  `;
}

function renderPublicationTree() {
  if (!state.publications.length) {
    els.publicationTree.innerHTML = `<li class="list-item">No publications discovered yet. Open your Substack dashboard and click refresh.</li>`;
    return;
  }

  els.publicationTree.innerHTML = state.publications
    .map((publication) => {
      const drafts = Array.isArray(publication.drafts) ? publication.drafts : [];
      const draftList = drafts.length
        ? drafts
            .map(
              (draft) =>
                `<li class="draft"><a href="${escapeHtml(draft.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(draft.title || "Draft")}</a></li>`
            )
            .join("")
        : `<li class="draft">No drafts found</li>`;

      return `<li class="publication"><strong>${escapeHtml(publication.title || "Publication")}</strong><ul>${draftList}</ul></li>`;
    })
    .join("");
}

function renderCitations() {
  if (!state.citations.length) {
    els.citationList.innerHTML = `<li class="list-item">No citations saved yet.</li>`;
    return;
  }

  els.citationList.innerHTML = state.citations
    .slice(0, 50)
    .map(
      (item) => `
        <li class="list-item" draggable="true" data-type="citation" data-content="${escapeHtml(item.text)}" data-url="${escapeHtml(item.pageUrl || "")}">
          <div class="item-header">
            <button class="btn-insert" data-type="citation" data-text="${escapeHtml(item.text)}" data-url="${escapeHtml(item.pageUrl || "")}" title="Insert into editor">«</button>
            <button class="btn-trash" data-delete="citation" data-id="${item.id}" title="Delete">🗑️</button>
          </div>
          <p>${escapeHtml(item.text || "")}</p>
          <p><a href="${escapeHtml(item.pageUrl || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.pageUrl || "source")}</a></p>
        </li>
      `
    )
    .join("");

  bindDeleteButtons();
  bindInsertButtons();
  bindDragHandlers();
}

function renderBookmarks() {
  if (!state.bookmarks.length) {
    els.bookmarkList.innerHTML = `<li class="list-item">No URLs saved yet.</li>`;
    return;
  }

  els.bookmarkList.innerHTML = state.bookmarks
    .slice(0, 50)
    .map(
      (item) => `
        <li class="list-item" draggable="true" data-type="bookmark" data-url="${escapeHtml(item.pageUrl || "")}">
          <div class="item-header">
            <button class="btn-insert" data-type="bookmark" data-url="${escapeHtml(item.pageUrl || "")}" title="Insert into editor">«</button>
            <button class="btn-trash" data-delete="bookmark" data-id="${item.id}" title="Delete">🗑️</button>
          </div>
          <p>${escapeHtml(item.title || "URL")}</p>
          <p><a href="${escapeHtml(item.pageUrl || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.pageUrl || "")}</a></p>
        </li>
      `
    )
    .join("");

  bindDeleteButtons();
  bindInsertButtons();
  bindDragHandlers();
}

function renderImages() {
  if (!state.imageAssets.length) {
    els.imageGrid.innerHTML = `<div class="list-item">No images saved yet.</div>`;
    return;
  }

  els.imageGrid.innerHTML = state.imageAssets
    .slice(0, 60)
    .map((asset) => {
      const selectedClass = selectedImageIds.has(asset.id) ? "selected" : "";
      const src = asset.dataUrl || asset.sourceUrl;
      const editorPath = asset.editor?.path || "";
      const assetType = asset.assetType || "image";
      return `
        <article class="image-card ${selectedClass}" data-id="${asset.id}" data-editor-path="${escapeHtml(editorPath)}" data-asset-type="${escapeHtml(assetType)}" draggable="true" data-type="image" data-src="${escapeHtml(src)}">
          <div class="image-card-controls">
            <button class="btn-insert-image" data-type="image" data-src="${escapeHtml(src)}" title="Insert into editor">«</button>
            <button class="btn-trash" data-delete="image" data-id="${asset.id}" title="Delete">🗑️</button>
          </div>
          <img src="${escapeHtml(src)}" alt="${escapeHtml(asset.title || "image")}" />
        </article>
      `;
    })
    .join("");

  bindDeleteButtons();
  bindImageSelection();
  bindInsertButtons();
  bindDragHandlers();
}

function bindImageSelection() {
  const cards = els.imageGrid.querySelectorAll(".image-card");
  cards.forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.tagName === "BUTTON") {
        return;
      }

      const id = card.getAttribute("data-id");
      if (!id) {
        return;
      }

      if (selectedImageIds.has(id)) {
        selectedImageIds.delete(id);
      } else {
        selectedImageIds.add(id);
      }

      renderImages();
    });

    card.addEventListener("dblclick", (event) => {
      if (event.target instanceof HTMLElement && event.target.tagName === "BUTTON") {
        return;
      }

      const id = card.getAttribute("data-id");
      if (!id) {
        return;
      }

      const asset = state.imageAssets.find((item) => item.id === id);
      if (!asset) {
        return;
      }

      openAssetEditor(asset);
    });
  });
}

function openAssetEditor(asset) {
  const editorPath = asset.editor?.path || fallbackEditorPath(asset);
  if (!editorPath) {
    setStatus("This asset does not have an associated editor.", true);
    return;
  }

  const popupUrl = new URL(chrome.runtime.getURL(editorPath));
  popupUrl.searchParams.set("assetId", asset.id);

  const bounds = getEditorWindowBounds(editorPath);
  chrome.windows.create({
    url: popupUrl.toString(),
    type: "popup",
    width: bounds.width,
    height: bounds.height
  });
}

function fallbackEditorPath(asset) {
  if ((asset.assetType || "") === "image") {
    return "src/image-editor/image-editor.html";
  }

  return "";
}

function getEditorWindowBounds(editorPath) {
  const defaults = { width: 980, height: 760 };
  if (editorPath.endsWith("diagram-editor.html")) {
    return { width: 1200, height: 840 };
  }
  if (editorPath.endsWith("graph-tool.html")) {
    return { width: 1320, height: 860 };
  }
  if (editorPath.endsWith("image-editor.html")) {
    return { width: 960, height: 720 };
  }
  return defaults;
}

function bindDeleteButtons() {
  document.querySelectorAll("button[data-delete]").forEach((button) => {
    button.onclick = async () => {
      const bucket = button.getAttribute("data-delete");
      const id = button.getAttribute("data-id");
      if (!bucket || !id) {
        return;
      }

      try {
        await sendMessage({ type: "sidepanel:delete-item", payload: { bucket, id } });

        if (bucket === "citation") {
          state.citations = state.citations.filter((c) => c.id !== id);
          renderCitations();
        } else if (bucket === "bookmark") {
          state.bookmarks = state.bookmarks.filter((b) => b.id !== id);
          renderBookmarks();
        } else if (bucket === "image") {
          selectedImageIds.delete(id);
          state.imageAssets = state.imageAssets.filter((img) => img.id !== id);
          renderImages();
        }

        setStatus(`${bucket} deleted`);
      } catch (error) {
        setStatus(error.message, true);
      }
    };
  });
}

function setStatus(text, isError = false) {
  els.statusText.textContent = text;
  els.statusText.style.color = isError ? "#9e2a2b" : "#6b7567";
}

function setResult(text, isError = false) {
  const el = document.querySelector("#subscriber-result");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", Boolean(isError));
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown error");
  }
  return response.payload;
}

function bindDropZone() {
  const grid = els.imageGrid;
  if (!grid) return;

  grid.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    grid.classList.add("drop-active");
  });

  grid.addEventListener("dragleave", (e) => {
    if (!grid.contains(e.relatedTarget)) {
      grid.classList.remove("drop-active");
    }
  });

  grid.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    grid.classList.remove("drop-active");

    const dt = e.dataTransfer;
    let sourceUrl = "";

    if (dt.files.length > 0) {
      const file = Array.from(dt.files).find((f) => f.type.startsWith("image/"));
      if (file) {
        sourceUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ""));
          reader.readAsDataURL(file);
        });
      }
    }

    if (!sourceUrl) sourceUrl = dt.getData("text/html") || "";
    if (!sourceUrl) sourceUrl = dt.getData("text/uri-list") || "";
    if (!sourceUrl) sourceUrl = dt.getData("text/plain") || "";

    if (!sourceUrl) return setStatus("No image found in dropped data.", true);

    setStatus("Saving dropped image…");
    try {
      const saved = await sendMessage({
        type: "sidepanel:add-image",
        payload: { sourceUrl, title: "Dropped image" }
      });
      state.imageAssets.unshift(saved);
      renderImages();
      setStatus("Dropped image saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function bindImageAddMenu() {
  const menuWrap = document.querySelector("#image-add-menu");
  const btn = document.querySelector("#btn-add-image");
  const submenu = document.querySelector("#image-add-submenu");
  if (!btn || !submenu) return;

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !submenu.classList.contains("hidden");
    if (isOpen) {
      submenu.classList.add("hidden");
      return;
    }
    submenu.classList.remove("hidden");
  });

  submenu.addEventListener("click", async (event) => {
    event.stopPropagation();
    const button = event.target.closest("button[data-action]");
    if (!(button instanceof HTMLElement)) return;
    const action = button.getAttribute("data-action");
    submenu.classList.add("hidden");

    if (action === "from-url") {
      document.querySelector("#dialog-add-image")?.showModal();
      return;
    }

    if (action === "from-clipboard") {
      const preview = document.querySelector("#clipboard-image-preview");
      if (preview) { preview.src = ""; preview.classList.add("hidden"); }
      if (els.imageUrl) els.imageUrl.value = "";

      try {
        if (navigator.clipboard?.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const imageType = item.types.find((t) => t.startsWith("image/"));
            if (imageType) {
              const blob = await item.getType(imageType);
              const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(String(reader.result || ""));
                reader.readAsDataURL(blob);
              });
              if (els.imageUrl) els.imageUrl.value = dataUrl;
              if (preview) { preview.src = dataUrl; preview.classList.remove("hidden"); }
              break;
            }
            if (item.types.includes("text/plain")) {
              const blob = await item.getType("text/plain");
              const text = await blob.text();
              const isImageUrl =
                /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg|avif)/i.test(text) ||
                text.startsWith("data:image/");
              if (isImageUrl && els.imageUrl) els.imageUrl.value = text;
            }
          }
        }
      } catch {
        // Clipboard access denied — leave fields empty
      }
      document.querySelector("#dialog-add-image")?.showModal();
      return;
    }

    const creatorMap = {
      "map":             { url: "src/creators/map-creator.html",    width: 980,  height: 760 },
      "diagram-editor":  { url: "src/creators/diagram-editor.html",  width: 1200, height: 840 },
      "graph-tool":      { url: "src/creators/graph-tool.html",      width: 1320, height: 860 },
      "table":           { url: "src/creators/table-creator.html",   width: 980,  height: 760 },
    };
    const creator = creatorMap[action];
    if (creator) {
      chrome.windows.create({ url: chrome.runtime.getURL(creator.url), type: "popup", width: creator.width, height: creator.height });
    }
  });

  document.addEventListener("click", () => {
    submenu.classList.add("hidden");
  });
}

function bindSectionToggles() {
  document.querySelectorAll(".btn-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = btn.closest(".card")?.querySelector(".section-body");
      if (!body) return;
      const isCollapsed = body.classList.contains("collapsed");
      body.classList.toggle("collapsed", !isCollapsed);
      btn.textContent = isCollapsed ? "^" : ">";
      btn.title = isCollapsed ? "Collapse section" : "Expand section";
    });
  });
}

function bindDialogs() {
  document.querySelectorAll(".btn-add[data-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dialog = document.querySelector(`#${btn.dataset.dialog}`);
      dialog?.showModal();
    });
  });

  document.querySelectorAll(".btn-dialog-close, .btn-dialog-cancel").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest("dialog")?.close();
    });
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
  });
}

function bindInsertButtons() {
  document.querySelectorAll(".btn-insert").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      let content = "";

      if (type === "citation") {
        const text = btn.dataset.text || "";
        const url = btn.dataset.url || "";
        content = `> ${text}\n\nSource: ${url || "N/A"}`;
      } else if (type === "bookmark") {
        const url = btn.dataset.url || "";
        content = url;
      }

      try {
        await sendMessage({
          type: "sidepanel:insert-into-editor",
          payload: { content }
        });
        setStatus("Inserted into editor.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });

  document.querySelectorAll(".btn-insert-image").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const src = btn.dataset.src || "";
      if (!src) {
        return setStatus("No image source.", true);
      }

      try {
        // Fetch image and convert to data URL here in the sidepanel context.
        const blob = await fetch(src).then((r) => r.blob());
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("Failed to read image"));
          reader.readAsDataURL(blob);
        });

        await sendMessage({
          type: "sidepanel:insert-image-into-editor",
          payload: { dataUrl }
        });
        setStatus("Image inserted into editor.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
}

function bindDragHandlers() {
  document.querySelectorAll("[draggable='true']").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      const type = item.dataset.type;
      let content = "";

      if (type === "citation") {
        const text = item.dataset.content || "";
        const url = item.dataset.url || "";
        content = `> ${text}\n\nSource: ${url || "N/A"}`;
      } else if (type === "bookmark") {
        const url = item.dataset.url || "";
        content = url;
      } else if (type === "image") {
        const src = item.dataset.src || "";
        content = `![image](${src})`;
      }

      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", content);
    });
  });
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
