# JP-4A.5 — Persistent Catalog Snapshot & Delta Sync

Deferred. **Not implemented in Round 5A.** Do not mix this into PR #5.

## Problem

The app currently enumerates large portions / all selected Jellyfin (and similarly Plex) library contents during catalog sync, including Docker deployments. Docker does not automatically provide a persistent catalog database or delta cache.

## Planned architecture

Initial:
Jellyfin/Plex → full sync → persistent IndexedDB catalog snapshot

Next startup:
IndexedDB snapshot → build store immediately → background delta/reconciliation → update only changed items/images

Cache identity should eventually include:

- provider
- server identity
- user identity
- selected libraries
- schema version

Image cache should be keyed using stable media/image revision metadata, not API tokens.

Deletion reconciliation must be considered separately.

No secrets, tokens, or private titles in diagnostics.
