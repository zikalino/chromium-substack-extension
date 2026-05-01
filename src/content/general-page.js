function inferPageContext() {
  return {
    url: window.location.href,
    title: document.title || "Untitled page",
    hasTextSelection: Boolean(window.getSelection()?.toString().trim())
  };
}

chrome.runtime
  .sendMessage({ type: "page:context", payload: inferPageContext() })
  .catch(() => {
    // Ignore if service worker is asleep or not listening for this message.
  });
