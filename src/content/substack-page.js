function collectSubstackPageData() {
  const profileAnchor = document.querySelector("a[href*='.substack.com'], a[href*='substack.com/profile']");
  const homeUrl = profileAnchor?.href || window.location.origin;

  const userNameNode = document.querySelector("[data-testid='profile-name'], h1, .profile-name");
  const emailNode = document.querySelector("[href^='mailto:']");

  const subscriptionRows = Array.from(document.querySelectorAll("[data-subscriber-email], .subscriber-row, tr"));
  const subscriptions = {};

  for (const row of subscriptionRows) {
    const email = row.getAttribute("data-subscriber-email") || row.querySelector("[href^='mailto:']")?.textContent?.trim();
    if (!email) {
      continue;
    }

    const text = row.textContent?.toLowerCase() || "";
    const isPaid = text.includes("paid") || text.includes("active member");

    const amountMatch = text.match(/\$\s?([0-9]+(?:\.[0-9]{1,2})?)/);
    const amount = amountMatch ? Number(amountMatch[1]) : null;

    subscriptions[email.toLowerCase()] = {
      isSubscriber: true,
      isPaid,
      amount,
      detectedAt: new Date().toISOString(),
      sourceUrl: window.location.href
    };
  }

  const publicationContainers = Array.from(document.querySelectorAll("[data-publication-id], .publication, section"));
  const publications = [];

  for (const container of publicationContainers) {
    const heading = container.querySelector("h1, h2, h3, [data-publication-name]");
    const title = heading?.textContent?.trim();
    if (!title) {
      continue;
    }

    const draftLinks = Array.from(container.querySelectorAll("a[href*='/publish'], a[href*='/draft']"));
    const drafts = draftLinks.map((link, index) => ({
      id: `${title}-${index}-${link.getAttribute("href") || ""}`,
      title: link.textContent?.trim() || "Untitled draft",
      url: new URL(link.getAttribute("href") || "", window.location.origin).toString()
    }));

    publications.push({
      id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
      drafts
    });
  }

  return {
    userProfile: {
      name: userNameNode?.textContent?.trim() || "Substack user",
      email: emailNode?.textContent?.trim() || "",
      homeUrl,
      sourceUrl: window.location.href
    },
    subscriptions,
    publications
  };
}

function sendPageData() {
  if (!window.location.hostname.includes("substack.com")) {
    return;
  }

  const payload = collectSubstackPageData();
  chrome.runtime.sendMessage({ type: "substack:page-data", payload }).catch((error) => {
    console.debug("Unable to send substack page data", error);
  });
}

sendPageData();
window.addEventListener("load", sendPageData);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "content:insert-into-editor") {
    try {
      insertIntoSubstackEditor(message.payload?.content || "");
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  } else if (message?.type === "content:paste-into-editor") {
    pasteIntoEditor()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (message?.type === "content:insert-image-into-editor") {
    try {
      insertImageViaClipboardEvent(message.payload?.dataUrl || "");
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  }
});

function findVisibleEditor() {
  const selectors = [
    ".ProseMirror[contenteditable='true']",
    "[contenteditable='true']",
    "[role='textbox']"
  ];

  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return el;
      }
    }
  }

  return null;
}

function insertIntoSubstackEditor(content) {
  if (!content) {
    throw new Error("No content to insert.");
  }

  const editor = findVisibleEditor();
  if (!editor) {
    throw new Error("No visible editor found on this page.");
  }

  editor.focus();

  const selection = window.getSelection();

  // If the selection is outside the editor, move cursor to the end of the editor.
  if (!selection.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // ProseMirror handles `beforeinput` with inputType "insertText" natively.
  const insertEvent = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: content
  });

  editor.dispatchEvent(insertEvent);

  // Fallback for non-ProseMirror editors if the event wasn't consumed.
  if (!insertEvent.defaultPrevented) {
    document.execCommand("insertText", false, content);
  }
}

function insertImageViaClipboardEvent(dataUrl) {
  if (!dataUrl) {
    throw new Error("No image data to insert.");
  }

  const editor = findVisibleEditor();
  if (!editor) {
    throw new Error("No visible editor found on this page.");
  }

  editor.focus();

  // Build a DataTransfer with text/html so ProseMirror's paste handler picks it up.
  const dt = new DataTransfer();
  dt.setData("text/html", `<img src="${dataUrl}">`);
  dt.setData("text/plain", "");

  const pasteEvent = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true
  });

  // clipboardData is read-only on ClipboardEvent, override it.
  Object.defineProperty(pasteEvent, "clipboardData", { value: dt });

  editor.dispatchEvent(pasteEvent);
}