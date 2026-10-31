# Developer & AI Agent Guidelines

## Architectural Decisions & User Invariants

### 1. Downloads & Folder Stack Blur (Grid, List, and Fan View Pills Enabled)
- **Status**: Updated per explicit user directive (2026-10-30).
- **Rule**:
  - **Grid & List Views**: Frosted glass background blur matching the dock pill is enabled for Grid and List view panels (`PanelView`, `aquaDownloadsPanel`, `.aqua-dl-panel`), integrated with the Blur My Shell blur pipeline when `blurEffect` is active.
  - **Fan View Pills**: Frosted glass background blur matching the dock pill is enabled for Fan View label pills (`aquaDownloadsFanPill`, `.aqua-dl-fan-label-pill`, `_labelPill`), integrated with the Blur My Shell popup blur pipeline when `blurEffect` is active. Exactly ONE pill (the currently hovered or selected row) is registered with blur at any given time, with unselected pills using crisp translucent fallback styling to eliminate Mutter multi-pass render stutter.
  - **Fan View Container**: The outer Fan View fixed canvas (`aquaDownloadsFan`, `_dockBlurEnabled = false`) and row button wrappers (`aquaDownloadsFanItem`) remain unblurred to avoid blurring empty arc space.
  - **Fallback**: Fallback cleanly to solid/translucent dark backgrounds (`tileStyle.js`) when `blurEffect` is disabled, high contrast is active, or BMS is unavailable.

### 2. Down-Chevron Stack Anchor Tile Frosted Glass & Blur
- The Down-Chevron drawer anchor (`aquaStackAnchor`, `.aqua-stack-anchor-tile`) remains integrated with the Blur My Shell popup blur pipeline when blur is active.
