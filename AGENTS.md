# Developer & AI Agent Guidelines

## Architectural Decisions & User Invariants

### 1. Downloads & Folder Stack Blur (Fan, Grid, List Views)
- **Status**: Disabled/Removed per explicit user directive (2026-10-29).
- **Rule**: Downloads stacks (Fan, Grid, and List views) do NOT use background blur or attach Blur My Shell popup blur surfaces.
- Stacks render with their clean, authentic solid/translucent dark backgrounds (`.aqua-dl-panel`, `.aqua-dl-fan`, `tileStyle`), ensuring maximum contrast, readability, and performance.

### 2. Down-Chevron Stack Anchor Tile Frosted Glass & Blur
- The Down-Chevron drawer anchor (`aquaStackAnchor`, `.aqua-stack-anchor-tile`) remains integrated with the Blur My Shell popup blur pipeline when blur is active.
