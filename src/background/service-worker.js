const STORAGE_KEYS = {
  userProfile: "substackUserProfile",
  subscriptions: "substackSubscriptions",
  publications: "substackPublications",
  citations: "citations",
  bookmarks: "bookmarks",
  images: "imageAssets",
  notes: "notesDraft",
  bookmarkDraftPrefix: "bookmarkDraft:"
};

const MENU_IDS = {
  addCitation: "substack-add-citation",
  addBookmark: "substack-add-bookmark",
  addImage: "substack-add-image"
};

// Keep capture drafts ephemeral so opening the URL capture tab does not consume storage quota.
const BOOKMARK_DRAFT_CACHE = new Map();
const MAX_BOOKMARK_DRAFTS = 10;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await createMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error("Failed to set panel behavior", error);
  });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_IDS.addCitation && info.selectionText) {
    await addCitation({
      text: info.selectionText,
      pageUrl: info.pageUrl || tab?.url || "",
      title: tab?.title || "Untitled page"
    });
    return;
  }

  if (info.menuItemId === MENU_IDS.addBookmark) {
    await addBookmark({
      pageUrl: info.pageUrl || tab?.url || "",
      title: tab?.title || "Untitled page"
    });
    return;
  }

  if (info.menuItemId === MENU_IDS.addImage && info.srcUrl) {
    await addImage({
      sourceUrl: info.srcUrl,
      pageUrl: info.pageUrl || tab?.url || "",
      title: tab?.title || "Image"
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => {
      console.error("Message handling error", error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "substack:page-data":
      return saveSubstackPageData(message.payload);
    case "sidepanel:get-state":
      return loadState();
    case "sidepanel:add-citation":
      return addCitation(message.payload);
    case "sidepanel:add-bookmark":
      return addBookmark(message.payload);
    case "sidepanel:create-bookmark-draft-from-active":
      return createBookmarkDraftFromActiveTab();
    case "bookmark-draft:get":
      return getBookmarkDraft(message.payload);
    case "bookmark-draft:delete":
      return deleteBookmarkDraft(message.payload);
    case "sidepanel:add-image":
      return addImage(message.payload);
    case "sidepanel:save-notes":
      return saveNotes(message.payload);
    case "sidepanel:go-to-my-substack":
      return goToMySubstack(sender?.tab?.id);
    case "sidepanel:refresh-active-substack":
      return refreshFromActiveSubstackTab();
    case "sidepanel:delete-item":
      return deleteItem(message.payload);
    case "sidepanel:get-tab-context":
      return getActiveTabContext();
    case "sidepanel:insert-into-editor":
      return insertIntoEditorTab(message.payload);
    case "sidepanel:insert-bookmark-into-editor":
      return insertBookmarkIntoEditorTab(message.payload);
    case "sidepanel:insert-image-into-editor":
      return insertImageIntoEditorTab(message.payload);
    default:
      throw new Error(`Unsupported message type: ${message?.type}`);
  }
}

async function ensureDefaults() {
  const defaults = {
    [STORAGE_KEYS.userProfile]: null,
    [STORAGE_KEYS.subscriptions]: {},
    [STORAGE_KEYS.publications]: [],
    [STORAGE_KEYS.citations]: [],
    [STORAGE_KEYS.bookmarks]: [],
    [STORAGE_KEYS.images]: [],
    [STORAGE_KEYS.notes]: ""
  };

  const current = await chrome.storage.local.get(Object.keys(defaults));
  const patch = {};

  for (const [key, value] of Object.entries(defaults)) {
    if (typeof current[key] === "undefined") {
      patch[key] = value;
    }
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

async function createMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_IDS.addCitation,
    title: "Save selection as citation",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: MENU_IDS.addBookmark,
    title: "Save page as bookmark",
    contexts: ["page", "selection", "image", "link"]
  });

  chrome.contextMenus.create({
    id: MENU_IDS.addImage,
    title: "Save image to sidepanel",
    contexts: ["image"]
  });
}

async function addCitation(payload = {}) {
  const citations = await readArray(STORAGE_KEYS.citations);
  const citation = {
    id: crypto.randomUUID(),
    text: payload.text?.trim() || "",
    pageUrl: payload.pageUrl || "",
    title: payload.title || "Untitled",
    createdAt: new Date().toISOString()
  };

  if (!citation.text) {
    throw new Error("Citation text cannot be empty.");
  }

  citations.unshift(citation);
  await chrome.storage.local.set({ [STORAGE_KEYS.citations]: citations.slice(0, 500) });
  return citation;
}

async function addBookmark(payload = {}) {
  const bookmarks = await readArray(STORAGE_KEYS.bookmarks);
  const bookmark = {
    id: crypto.randomUUID(),
    pageUrl: payload.pageUrl || "",
    title: payload.title || "Untitled",
    screenshotDataUrl: payload.screenshotDataUrl || "",
    imageUrls: normalizeImageUrlList(payload.imageUrls),
    imageDetails: normalizeImageDetails(payload.imageDetails),
    createdAt: new Date().toISOString()
  };

  if (!bookmark.pageUrl) {
    throw new Error("Bookmark URL cannot be empty.");
  }

  bookmarks.unshift(bookmark);
  await chrome.storage.local.set({ [STORAGE_KEYS.bookmarks]: bookmarks.slice(0, 500) });
  return bookmark;
}

async function createBookmarkDraftFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  const pageCapture = await sendToContentScript(
    tab.id,
    { type: "content:capture-page-assets" },
    ["src/content/general-page.js"]
  );
  if (!pageCapture?.ok) {
    throw new Error(pageCapture?.error || "Could not capture active page details.");
  }

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const imageDetails = normalizeImageDetails(pageCapture.payload?.imageDetails || []);
  const draft = {
    id: crypto.randomUUID(),
    title: pageCapture.payload?.title || tab.title || "Untitled page",
    pageUrl: pageCapture.payload?.resolvedUrl || pageCapture.payload?.url || tab.url || "",
    screenshotDataUrl: screenshotDataUrl || "",
    includeScreenshot: true,
    imageUrls: imageDetails.length
      ? imageDetails.map((item) => item.url)
      : normalizeImageUrlList(pageCapture.payload?.imageUrls || []),
    imageDetails
  };

  if (!draft.pageUrl) {
    throw new Error("Could not capture a valid URL from the active tab.");
  }

  cacheBookmarkDraft(draft.id, draft);

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/creators/url-creator.html?draftId=${encodeURIComponent(draft.id)}`)
  });

  return { draftId: draft.id };
}

async function getBookmarkDraft(payload = {}) {
  const draftId = String(payload.draftId || "").trim();
  if (!draftId) {
    throw new Error("Draft id is required.");
  }

  const cachedDraft = BOOKMARK_DRAFT_CACHE.get(draftId);
  if (cachedDraft) {
    return cachedDraft;
  }

  const key = getBookmarkDraftStorageKey(draftId);
  const result = await chrome.storage.local.get([key]);
  return result[key] || null;
}

async function deleteBookmarkDraft(payload = {}) {
  const draftId = String(payload.draftId || "").trim();
  if (!draftId) {
    return { deleted: false };
  }

  BOOKMARK_DRAFT_CACHE.delete(draftId);

  const key = getBookmarkDraftStorageKey(draftId);
  await chrome.storage.local.remove([key]);
  return { deleted: true };
}

function cacheBookmarkDraft(draftId, draft) {
  if (!draftId) {
    return;
  }

  BOOKMARK_DRAFT_CACHE.set(draftId, draft);
  while (BOOKMARK_DRAFT_CACHE.size > MAX_BOOKMARK_DRAFTS) {
    const firstKey = BOOKMARK_DRAFT_CACHE.keys().next().value;
    if (!firstKey) {
      break;
    }
    BOOKMARK_DRAFT_CACHE.delete(firstKey);
  }
}

function getBookmarkDraftStorageKey(draftId) {
  return `${STORAGE_KEYS.bookmarkDraftPrefix}${draftId}`;
}

function normalizeImageUrlList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const list = [];

  for (const rawItem of value) {
    const item = String(rawItem || "").trim();
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    list.push(item);
  }

  return list;
}

function normalizeImageDetails(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const list = [];

  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== "object") {
      continue;
    }

    const url = String(rawItem.url || "").trim();
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);

    list.push({
      url,
      source: String(rawItem.source || "").trim(),
      notes: String(rawItem.notes || "").trim()
    });
  }

  return list;
}

async function addImage(payload = {}) {
  const images = await readArray(STORAGE_KEYS.images);
  const normalizedSourceUrl = normalizeImageSourceUrl(payload.sourceUrl || "");
  const sourceIsDataUrl = isImageDataUrl(normalizedSourceUrl);
  const imageAsset = {
    id: crypto.randomUUID(),
    // Avoid storing duplicate payload for data URLs.
    sourceUrl: sourceIsDataUrl ? "" : normalizedSourceUrl,
    pageUrl: payload.pageUrl || "",
    title: payload.title || "Image",
    createdAt: new Date().toISOString(),
    dataUrl: "",
    assetType: typeof payload.assetType === "string" ? payload.assetType : "image",
    editor: normalizeEditorMetadata(payload.editor),
    editorState: normalizeEditorState(payload.editorState)
  };

  if (!normalizedSourceUrl) {
    throw new Error("Image source URL cannot be empty.");
  }

  imageAsset.dataUrl = sourceIsDataUrl
    ? normalizedSourceUrl
    : await fetchAsDataUrl(normalizedSourceUrl);
  images.unshift(imageAsset);

  await persistImagesWithQuotaGuard(images);
  return imageAsset;
}

async function persistImagesWithQuotaGuard(images) {
  // Keep newest first and cap count, then prune oldest entries until quota accepts.
  let next = images.slice(0, 200);

  while (next.length > 0) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.images]: next });
      return;
    } catch (error) {
      const message = String(error?.message || "");
      if (!/quota/i.test(message) || next.length <= 1) {
        throw error;
      }
      next = next.slice(0, next.length - 1);
    }
  }

  throw new Error("Storage quota exceeded. Could not save image asset.");
}

function normalizeEditorMetadata(editor) {
  if (!editor || typeof editor !== "object") {
    return null;
  }

  return {
    type: typeof editor.type === "string" ? editor.type : "",
    path: typeof editor.path === "string" ? editor.path : ""
  };
}

function normalizeEditorState(editorState) {
  if (!editorState || typeof editorState !== "object") {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(editorState));
  } catch {
    return null;
  }
}

async function getActiveTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  const isSubstackEditor = /substack\.com.*\/publish\/post\//.test(url);
  return { url, isSubstackEditor };
}

async function sendToContentScript(tabId, message, fallbackFiles = ["src/content/substack-page.js"]) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Content script not yet injected (tab was open before extension loaded). Inject it now.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: fallbackFiles
    });
    // Brief wait for the listener to register before retrying.
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      throw new Error("Could not reach content script on the active tab.");
    }
  }
}

async function getActiveSubstackTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  if (!tab.url?.includes("substack.com")) {
    throw new Error("Active tab is not a Substack page.");
  }
  return tab;
}

async function insertIntoEditorTab(payload) {
  const tab = await getActiveSubstackTab();
  const result = await sendToContentScript(tab.id, {
    type: "content:insert-into-editor",
    payload
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Insertion failed.");
  }

  return result;
}

async function insertBookmarkIntoEditorTab(payload = {}) {
  const bookmarkId = String(payload.bookmarkId || "").trim();
  if (!bookmarkId) {
    throw new Error("Bookmark id is required.");
  }

  const bookmarks = await readArray(STORAGE_KEYS.bookmarks);
  const bookmark = bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error("Bookmark not found.");
  }

  const tab = await getActiveSubstackTab();
  const result = await sendToContentScript(tab.id, {
    type: "content:insert-bookmark-into-editor",
    payload: { bookmark }
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Bookmark insertion failed.");
  }

  return result;
}

async function insertImageIntoEditorTab(payload) {
  const tab = await getActiveSubstackTab();
  const result = await sendToContentScript(tab.id, {
    type: "content:insert-image-into-editor",
    payload
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Image insertion failed.");
  }

  return result;
}

async function fetchAsDataUrl(url) {
  if (isImageDataUrl(url)) {
    return url;
  }

  try {
    const response = await fetch(url);
    const blob = await response.blob();

    if (!blob.type.startsWith("image/")) {
      throw new Error(`Source is not an image (received: ${blob.type || "unknown"}).`);
    }

    const reader = new FileReader();

    const dataUrl = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image data."));
      reader.readAsDataURL(blob);
    });

    return dataUrl;
  } catch (error) {
    console.warn("Failed to fetch image data URL, falling back to source URL", error);
    return url;
  }
}

function normalizeImageSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (isImageDataUrl(raw) || isHttpUrl(raw) || raw.startsWith("blob:")) {
    return raw;
  }

  if (raw.startsWith("data:text/html")) {
    const html = decodeDataHtml(raw);
    const imageSrc = extractImageSourceFromHtml(html);
    if (imageSrc) {
      return normalizeExtractedImageSrc(imageSrc);
    }
  }

  if (raw.startsWith("<")) {
    const imageSrc = extractImageSourceFromHtml(raw);
    if (imageSrc) {
      return normalizeExtractedImageSrc(imageSrc);
    }
  }

  return raw;
}

function decodeDataHtml(dataUrl) {
  const match = /^data:text\/html(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) {
    return "";
  }

  const isBase64 = Boolean(match[1]);
  const payload = match[2] || "";

  try {
    if (isBase64) {
      return atob(payload);
    }

    return decodeURIComponent(payload);
  } catch {
    return "";
  }
}

function extractImageSourceFromHtml(html) {
  if (!html) {
    return "";
  }

  const imgSrcMatch = /<img[^>]*\ssrc=["']([^"']+)["']/i.exec(html);
  if (imgSrcMatch?.[1]) {
    return imgSrcMatch[1].trim();
  }

  const ogImageMatch = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (ogImageMatch?.[1]) {
    return ogImageMatch[1].trim();
  }

  return "";
}

function normalizeExtractedImageSrc(src) {
  const value = String(src || "").trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  return value;
}

function isImageDataUrl(value) {
  return /^data:image\//i.test(String(value || ""));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

async function loadState() {
  const state = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    userProfile: state[STORAGE_KEYS.userProfile],
    subscriptions: state[STORAGE_KEYS.subscriptions] || {},
    publications: state[STORAGE_KEYS.publications] || [],
    citations: state[STORAGE_KEYS.citations] || [],
    bookmarks: state[STORAGE_KEYS.bookmarks] || [],
    imageAssets: state[STORAGE_KEYS.images] || [],
    notesDraft: state[STORAGE_KEYS.notes] || ""
  };
}

async function saveSubstackPageData(payload = {}) {
  const patch = {};

  if (payload.userProfile) {
    patch[STORAGE_KEYS.userProfile] = payload.userProfile;
  }

  if (payload.subscriptions) {
    const current = await chrome.storage.local.get(STORAGE_KEYS.subscriptions);
    patch[STORAGE_KEYS.subscriptions] = {
      ...(current[STORAGE_KEYS.subscriptions] || {}),
      ...payload.subscriptions
    };
  }

  if (Array.isArray(payload.publications)) {
    patch[STORAGE_KEYS.publications] = payload.publications;
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }

  return patch;
}

async function goToMySubstack(senderTabId) {
  const { [STORAGE_KEYS.userProfile]: profile } = await chrome.storage.local.get(STORAGE_KEYS.userProfile);

  let targetUrl = profile?.homeUrl || "https://substack.com";
  if (!targetUrl.includes("substack.com")) {
    targetUrl = "https://substack.com";
  }

  if (senderTabId) {
    await chrome.tabs.update(senderTabId, { url: targetUrl });
  } else {
    await chrome.tabs.create({ url: targetUrl });
  }

  return { targetUrl };
}

async function refreshFromActiveSubstackTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url?.includes("substack.com")) {
    throw new Error("Active tab is not a Substack page.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const publicationNodes = Array.from(document.querySelectorAll("a[href*='/publish']"));
      const draftsByPublication = new Map();

      for (const node of publicationNodes) {
        const href = node.getAttribute("href") || "";
        const title = (node.textContent || "").trim() || "Untitled";
        const publicationKey = href.split("/publish")[0] || "default";

        if (!draftsByPublication.has(publicationKey)) {
          draftsByPublication.set(publicationKey, {
            id: publicationKey,
            title: publicationKey === "default" ? "Default publication" : publicationKey.replace(/^\//, ""),
            drafts: []
          });
        }

        draftsByPublication.get(publicationKey).drafts.push({
          id: `${href}-${title}`,
          title,
          url: new URL(href, window.location.origin).toString()
        });
      }

      return Array.from(draftsByPublication.values());
    }
  });

  if (Array.isArray(result?.result)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.publications]: result.result });
  }

  return { publications: result?.result || [] };
}

async function saveNotes(payload = {}) {
  await chrome.storage.local.set({ [STORAGE_KEYS.notes]: payload.notes || "" });
  return { ok: true };
}

async function deleteItem(payload = {}) {
  const { bucket, id } = payload;

  const keyByBucket = {
    citation: STORAGE_KEYS.citations,
    bookmark: STORAGE_KEYS.bookmarks,
    image: STORAGE_KEYS.images
  };

  const storageKey = keyByBucket[bucket];
  if (!storageKey) {
    throw new Error("Unknown bucket");
  }

  const collection = await readArray(storageKey);
  const nextCollection = collection.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [storageKey]: nextCollection });
  return { ok: true };
}

async function readArray(storageKey) {
  const state = await chrome.storage.local.get(storageKey);
  const value = state[storageKey];
  return Array.isArray(value) ? value : [];
}
