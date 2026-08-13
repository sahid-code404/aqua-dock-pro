# Changelog

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
