# Developer & AI Agent Guidelines

## Architectural Decisions & User Invariants

### 1. Downloads & Folder Stack Blur (Grid & List Views Enabled; Fan View Disabled)
- **Status**: Updated per explicit user directive (2026-10-30).
- **Rule**:
  - **Grid & List Views**: Frosted glass background blur matching the dock pill is enabled for Grid and List view panels (`PanelView`, `aquaDownloadsPanel`, `.aqua-dl-panel`), integrated with the Blur My Shell blur pipeline when `blurEffect` is active.
  - **Fan View**: Strictly does NOT use background blur (`_dockBlurEnabled = false`), rendering with its clean authentic solid/translucent dark backgrounds (`.aqua-dl-fan`, `tileStyle.js`) for maximum contrast, readability, and performance.

### 2. Down-Chevron Stack Anchor Tile Frosted Glass & Blur
- The Down-Chevron drawer anchor (`aquaStackAnchor`, `.aqua-stack-anchor-tile`) remains integrated with the Blur My Shell popup blur pipeline when blur is active.
