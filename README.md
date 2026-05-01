# Substack Sidepanel Companion (Chromium Extension)

This repository contains a Manifest V3 Chromium extension focused on Substack author workflows through a sidepanel.

## Current MVP Features

- Sidepanel UI with quick action to open your Substack home/profile.
- Captures Substack profile-like metadata from active Substack pages.
- Subscriber lookup by email from captured page data.
- Shows a publication -> drafts tree from captured/scraped Substack page links.
- Save citation text from context menu or manually in sidepanel.
- Save bookmarks (current page URL) from context menu or manually.
- Save image assets from context menu or URL.
- Compose notes and insert latest citation/image markdown snippets.
- Basic image editor in sidepanel:
  - load image
  - crop (numeric x/y/w/h)
  - resize
  - collage (horizontal) from selected images

## Important Notes About Substack Data

Substack does not expose all subscriber/payment data publicly in a stable anonymous API for browser extensions.

This MVP therefore uses page-context capture from tabs where the user is already authenticated in Substack and currently viewing relevant dashboard/subscriber pages. Detection quality depends on DOM structure available on those pages.

## Project Layout

- `manifest.json`
- `src/background/service-worker.js`
- `src/content/substack-page.js`
- `src/content/general-page.js`
- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.js`
- `src/sidepanel/styles.css`

## Load in Chromium

1. Open Chrome or Chromium-based browser.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select this repository root.

## How to Use

1. Open any Substack page while logged in.
2. Open the extension sidepanel from the toolbar icon.
3. Click `Refresh active Substack tab` to capture profile/publication/subscriber hints.
4. On other pages, highlight text and use right-click -> `Save selection as citation`.
5. Right-click page -> `Save page as bookmark`.
6. Right-click image -> `Save image to sidepanel`.
7. Use notes composer and image editor from sidepanel.

## Next Improvements

- Add robust Substack GraphQL/API integration for authenticated sessions.
- Introduce local indexing and search over citations/bookmarks/images.
- Add richer WYSIWYG note editor and insertion pickers.
- Add advanced image tooling (filters, annotations, grid collage templates).
- Add sync/export (JSON/Markdown).
