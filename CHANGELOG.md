# Changelog

## 218

- Reduced hot-path allocation and made frame timing resilient to invalid deltas.
- Added complete reduced-motion handling without changing normal animation timing.
- Added keyboard dock navigation and a configurable focus shortcut.
- Added configurable click, middle-click, scroll, preview, alignment, and monitor behavior.
- Added one optional custom folder stack and configurable folder sorting.
- Added settings backup, restore, diagnostics, and a migration framework.
- Added safe Trash confirmation and cancellable file/device operations.
- Added a GNOME Shell compatibility boundary, validation scripts, unit tests, and CI.
- Added translation infrastructure and a maintained message catalog template.
- Bounded folder enumeration memory to the visible result limit, even for huge folders.
- Removed the redundant **Open Application** context-menu action.

## 217

- Added layout locking and protected releases that began outside the dock.
- Prevented held-pointer selection gestures from revealing or activating the dock.
- Preserved drag-to-open while the layout is locked.

Earlier versions predate the maintained changelog.
