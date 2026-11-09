# Developer & AI Agent Guidelines

## Architectural Decisions & User Invariants

### 1. Downloads & Folder Stack Blur (Grid, List, and Fan View Pills Enabled)
- **Status**: Updated per explicit user directive (2026-10-30).
- **Rule**:
  - **Grid & List Views**: Frosted glass background blur matching the dock pill is enabled for Grid and List view panels (`PanelView`, `aquaDownloadsPanel`, `.aqua-dl-panel`), integrated with the Blur My Shell blur pipeline when `blurEffect` is active.
  - **Fan View Pills**: Frosted glass background blur matching the dock pill is enabled for Fan View label pills (`aquaDownloadsFanPill`, `.aqua-dl-fan-label-pill`, `_labelPill`), integrated with the Blur My Shell popup blur pipeline when `blurEffect` is active.
  - **Fan View Container**: The outer Fan View fixed canvas (`aquaDownloadsFan`, `_dockBlurEnabled = false`) and row button wrappers (`aquaDownloadsFanItem`) remain unblurred to avoid blurring empty arc space.
  - **Fallback**: Fallback cleanly to solid/translucent dark backgrounds (`tileStyle.js`) when `blurEffect` is disabled, high contrast is active, or BMS is unavailable.

### 2. Stack Anchor Tile & Chevron Icon Removal
- **Status**: Updated per explicit user directive (2026-11-09).
- **Rule**:
  - The Down-Chevron drawer anchor ('v' icon tile, `aquaStackAnchor`, `.aqua-stack-anchor-tile`) has been removed from when downloads or folder stacks open.
  - When a stack opens, the clicked dock icon (e.g. folder or downloads icon) remains visible in its natural state rather than being hidden or replaced by a chevron tile.
  - Downloads and folder stack views continue to anchor cleanly to the dock item's coordinates.
