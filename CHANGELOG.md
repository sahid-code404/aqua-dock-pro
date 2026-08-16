# Changelog

## 244

- Extend app scroll actions through the full invisible magnification area above and beside dock icons.
- Keep the dock hidden without flashing while a covered fullscreen window remains on the active monitor.
- Give folder stacks clearer separation from their dock icon and use the standard desktop URI-list clipboard format for broader paste compatibility.
- Preserve the default-on preference for showing the dock pill rim while auto-hidden and verify its disabled state.

## 243

- Skip settled magnification transforms, unchanged spread and pointer writes, duplicate drag samples, and repeated geometry reads in interaction hot paths.
- Reuse safe notification, workspace, favorites, and app-system snapshots while retaining conservative fallbacks and complete teardown.
- Make source validation fail immediately when malformed JavaScript is found.

## 242

- Reduce animation-frame, pointer, notification, preview, and popup overhead without changing dock geometry, timing, styling, or interactions.
- Harden temporary actor, popup, monitor, asynchronous I/O, and extension-disable cleanup paths.

## 241

- Mirror folder-stack fans away from left and right docks, retain a clear gap from the pill, and keep the Copy menu outside each file row.
- Position fan, grid, and list stacks from the stable resting icon geometry on vertical docks.

## 240

- Add an opt-in dock-items editor for multiple folder stacks, files, web links, separators, and spacers.
- Add monitor-aware paged window previews with keyboard navigation and optional window actions.
- Resolve real folder metadata/custom icons asynchronously and keep their artwork stable while icons shrink or magnify.
- Add accessibility preferences for reduced motion, high contrast, interface text size, and richer screen-reader labels.

## 239

- Remove the Shell theme's invisible outer minimum width from the stack-item Copy menu.

## 238

- Place the compact stack-item Copy menu beside its visible filename pill.

## 237

- Override GNOME Shell's global popup minimum so the one-item Copy menu uses its natural compact width.

## 236

- Keep the stack-item Copy menu compact without changing other dock context menus.

## 235

- Add a right-click Copy action for real items in Downloads and custom-folder stacks.
- Replace the fixed auto-hide marker with the dock pill's own dynamically sized screen-facing rim.

## 234

- Keep crowded docks within the monitor while scaling corners proportionally and containing running indicators inside the pill.
- Add configurable spacing between dock icons.
- Show an edge marker while the dock is auto-hidden.

## 233

- Keep the screen-fit shrinking switch visible near the top of Dock layout preferences.

## 232

- Add a preference to disable automatic screen-fit shrinking and preserve manual dock sizing.

## 231

- Trim verbose source comments across the project.
- Remove redundant block headers while preserving GNOME Shell compatibility and physics notes.

## 225

- Limit pill contraction by edge speed so middle icons collapse smoothly.

## 224

- Move pill growth to a centered GPU transform to prevent icon layout stutter.

## 223

- Defer autohide sliding until magnification contraction settles.

## 222

- Bound magnification spring after long compositor stalls to maintain frame sync.

## 221

- Smooth pill contraction after app launches by retaining sub-pixel geometry.
- Prevent magnification spread from compressing below resting width.
- Replace percentage indicator radii with pill radii to fix stylesheet warnings.

## 220

- Remove classic dock motion profile in favor of spring physics solver.
- Make Super+D dock focus shortcut a toggle with Escape key handling.
- Replace keyboard focus outline with a compact pill indicator.
- Restrict reactive magnification area to actual icon boundaries.

## 219

- Add multi-tier rest and peak icon textures to keep icons sharp when magnified.
- Add GNOME Shell 51 beta compatibility.
- Make Trash state checks asynchronous and cancellable.
- Unify workspace and monitor isolation across indicators, previews, and menus.
- Fix notification badge retention and stale mounted device handles.

## 218

- Add keyboard navigation and configurable focus shortcut.
- Add custom folder stack and configurable folder sorting.
- Add settings backup, restore, diagnostics, and schema migration framework.
- Add GNOME Shell compatibility boundary, validation scripts, and unit tests.
- Bound folder enumeration memory limits for large directories.

## 217

- Add layout locking and drag-to-open protection.
- Prevent held pointer selection gestures from revealing or activating the dock.
