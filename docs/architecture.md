# Architecture Notes

## Runtime Components

- Background service worker:
  - central message router
  - storage lifecycle and defaults
  - context menu actions
  - sidepanel command handlers
  - active-tab Substack refresh scraper
- Content scripts:
  - Substack pages: collect profile/subscription/publication hints
  - General pages: minimal context signal
- Sidepanel page:
  - renders state
  - invokes commands
  - local image editing via canvas

## Storage Model (`chrome.storage.local`)

- `substackUserProfile`: profile metadata
- `substackSubscriptions`: map by email -> subscriber record
- `substackPublications`: publication and draft tree
- `citations`: array
- `bookmarks`: array
- `imageAssets`: array
- `notesDraft`: string

## Security/Privacy Considerations

- Stored data remains local to browser profile.
- No external backend is used in MVP.
- Host permissions are broad for workflow convenience; consider reducing scope before production.
- DOM-scrape logic is fragile to Substack UI changes and should be replaced with stable APIs where possible.
