# Developer & AI Agent Guidelines

## 🔒 Locked Architectural Requirements & Invariants

The following features and architectures are permanently locked per explicit user directives.
**Any future AI assistant or contributor is strictly prohibited from modifying, disabling, removing, or bypassing these without explicit user permission:**

### 1. Downloads & Folder Stack Background Blur (Grid and List Views) — [LOCKED]
- **Status**: Permanently enabled and locked.
- **Rule**: Background blur on grid and list view stack panels (`PanelView`, `aquaDownloadsPanel`, `.aqua-dl-panel`) must remain permanently active and integrated with Blur My Shell popup blur pipeline whenever blur effect is active.
- **Key Invariants**:
  1. **`downloads/panelView.js`**: The panel actor MUST maintain `name = 'aquaDownloadsPanel'`, `_isAquaDock = true`, `_blurType = 'popup'`, `_dockContentParent = Main.uiGroup`, and register with Blur My Shell via `registerBmsTarget(panel, () => radius)` after bounds are set.
  2. **`dock/dockBlur.js`**: `isAquaPopupTarget` and `resolveAquaDockTarget` MUST recognize `aquaDownloadsPanel` and `.aqua-dl-panel` as first-class popup blur targets. `isBmsStackBlurActive` must check both popup blur and dock blur so stacks always blur gracefully.
  3. **`stylesheet.css`**: Must maintain translucent frosted glass styles for `.aqua-dl-panel` when blurred (`.transparent-dash`, `.bms-popup-*`).
  4. **`tests/downloadsBlur.test.js`**: Unit tests verifying stack popup target discovery, popup classification, and blur activation must remain intact and passing.
