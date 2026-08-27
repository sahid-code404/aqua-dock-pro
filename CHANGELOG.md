# Changelog

## 261

- Reorganize Preferences into a clearer task-oriented page order and move everyday controls ahead of fine-grained options, reducing scrolling and visual clutter without changing any GSettings key or runtime behavior.
- Add reusable expandable Advanced groups for detailed dock, Downloads, and popup controls, while tightening labels and descriptions so the common path stays clean without removing configurability.
- Give the Preferences window a roomier default layout for easier scanning, and preserve the v260 runtime/EGO hardening, v259 clipboard fix, and v258 Reduce Motion behavior unchanged.

## 260

- Harden the EGO submission path around GNOME Shell 50 with a dedicated static compatibility audit, stricter package-content checks, and CI gates for runtime/prefs process separation, synchronous Shell I/O, deprecated GJS APIs, dynamic code, and lifecycle-hostile patterns.
- Keep the mounted-device model usable from both Shell and Preferences without transitively importing Shell/St into the preferences process, while preserving the existing mounted-device filtering, actions, idle coalescing, and teardown behavior.
- Modernize the remaining shared GI imports and make long-lived app-state signal ownership explicit so cleanup is directly reviewable without changing favorites, running-app, workspace, monitor, magnification, animation, or dock interaction behavior.
- Advertise only the stable GNOME Shell 50 release to EGO; retain compatibility feature guards internally without claiming an unreleased Shell target.

## 259

- Remove GNOME Shell runtime clipboard access from folder-stack context menus so `St.Clipboard.get_default()` is no longer shipped and the EGO-A-005 clipboard manual-review trigger is eliminated.
- Keep right-click folder-stack interaction useful by replacing Copy with the existing Open action path, without adding subprocess, GTK, or portal clipboard workarounds.
- Remove the obsolete clipboard helper/test and update the extension metadata disclosure; preserve the v258 hard Reduce Motion behavior unchanged.

## 258

- Make Reduce Motion a hard no-motion mode: magnification, held-item zoom, spring integration, pill spreading, and magnification hit-zone expansion now stay at resting geometry instead of following live pointer targets without interpolation.
- Route reorder, drag-to-open, drop-gap, flyer, badge, and icon-restore transitions through the same reduced-motion policy, and settle any already-running drag-owned transitions immediately when Reduce Motion is enabled.
- Add regression coverage for hard magnification flattening and reduced-motion state-change notifications while preserving all existing animation curves and timings when Reduce Motion is disabled.

## 257

- Keep runtime GSettings writes immediate across settings migrations by avoiding Gio.Settings.delay() on the long-lived SettingsManager object and advancing migration state only after each step succeeds.
- Make stock-Dash takeover transactional so failed property enforcement restores the original Dash state and reaches the existing bounded retry path instead of being reported as a false success.
- Make app launch-watch setup transactional and close preview window-action menus as soon as their Meta.Window begins unmanaging, eliminating the remaining rare subscription/stale-action failure paths.
- Acquire the shared location-metadata resolver only while Downloads, custom folders, or custom dock locations actually need metadata, releasing its cache/subscription when those features are inactive.
- Preserve the existing magnification curve, spring/bounce/Genie physics, popup geometry, icon sizing, styling, and normal interaction timings; profiling-dependent global Shell event consolidation remains intentionally unchanged.

## 256

- Harden live Meta.Window access in intellihide, app activation/cycling, and preview construction so windows disappearing mid-callback cannot abort the remaining update path.
- Pay the configured auto-hide delay only once while magnification contracts, then use short bounded rechecks so the dock hides promptly after the visual dependency settles.
- Preserve the last valid notification snapshot when Shell source enumeration temporarily fails, retry transient Trash state reads, and retry stock-dash takeover without disabling an otherwise healthy dock set.
- Restore Genie’s process-global animation slowdown immediately when the effect is disabled, make controller teardown failure-isolated, clear stale drop delegates, and keep dash ownership retryable after a failed hand-off.
- Avoid redundant tooltip restyling for delay-only changes and unnecessary autohide geometry work for timing/sensitivity-only settings while keeping the existing magnification curve, spring physics, popup visuals, and normal interaction timings unchanged.

## 255

- Reclassify border width and interface text scale through the full geometry/update path so the hidden auto-hide rim and already-open popup typography cannot remain stale.
- Add bounded dock-rebuild retries, dynamically narrow shared app/window subscriptions, avoid caching transient null app icons, and reconcile/poll notification sources only when Shell signals are incomplete.
- Bound failed location-metadata throttling, release mounted-device busy ownership immediately on extension cancellation, and make pressure reveal require a true dwell instead of allowing slow edge drift.
- Close stale app window menu actions when their Meta.Window disappears and avoid double-counting recursive Trash deletion failures.
- Keep the existing magnification curve, spring physics, bounce/Genie timings, CSS, icon sizing, and normal popup geometry unchanged.

## 254

- Make Reduce Motion apply every pointer and held-item target synchronously, and prevent stale preview generations or invalid external DnD sources from disrupting current UI state.
- Release dodge-only window subscriptions when intellihide no longer needs them, retry transient Trash monitor and settings-read failures with bounded backoff, and use GIO's desktop Trash backend for consistent state and Empty Trash behavior.
- Refresh and bound location metadata caches, include notification source identity in snapshot invalidation, and share stable application icons across dock instances to reduce redundant multi-monitor work.
- Avoid unchanged dock-chrome geometry writes and compress separators/spacers only as a last-resort screen-fit measure for pathological custom layouts, preserving normal layout geometry and animation physics.
- Add regression coverage for reduced-motion target frames, structure-heavy screen fitting, desktop Trash URI ownership, and enforce metadata/changelog version synchronization in validation.

## 253

- Harden dock rebuilds, DnD hand-offs, preview refreshes, shared Trash/Downloads callbacks, and same-layout item reconciliation so transient failures cannot leave stale or partially updated runtime state.
- Make Reduce Motion settle active dock, folder-stack, preview, autohide, bounce/pulse, and custom Genie motion immediately while keeping all normal animation physics and timings unchanged.
- Retry transient Downloads monitor startup failures, surface folder-enumeration errors instead of treating them as empty folders, preserve failed settings batches for the next valid retry, and align the icon-size schema minimum with the 26px Preferences limit.
- Restore full relayout for auto-hide mode changes so reserved work-area struts always match the current visibility policy.

## 252

- Classify every GSettings key by structural, geometry, style, autohide, tooltip, item-refresh, passive, or internal impact so non-structural updates can take the smallest safe path.
- Skip full dock relayout, animation-model rebuild, Genie geometry refresh, and unrelated subsystem work for pure style, tooltip, badge/indicator, autohide, and passive behavior/popup settings; geometry and unknown changes retain the previous full apply path.
- Add schema-wide regression coverage requiring every settings key to belong to exactly one impact group and every direct-update key to declare its runtime config mapping.

## 251

- Move mounted-device enumeration and mount metadata normalization into one shared VolumeMonitor-backed store so multi-monitor docks no longer repeat `get_mounts()` and Gio mount inspection for the same system event.
- Coalesce bursts of mount/volume/drive signals once in the shared store while keeping per-dock visibility filters, stable entry objects, and current mount handles intact.
- Add regression coverage for per-dock device filtering, hidden-device handling, duplicate stable IDs, and presentation-object isolation.

## 250

- Centralize GNOME MessageTray and notification-source signal ownership so multi-monitor docks share one set of notification listeners instead of wiring the same global sources once per dock.
- Fan out only meaningful normalized badge-count changes while preserving the existing app-ID counting rules and conservative fallback for Shell sources without reliable change signals.
- Release all shared notification callbacks, source signal IDs, cached source references, and snapshots when the last dock unsubscribes or the extension is disabled.

## 249

- Reuse notification snapshots across dock instances when Shell notification sources and counts are unchanged, reducing repeated app-ID resolution and map allocation on multi-monitor refreshes.
- Skip dock-wide apply/relayout work for keybinding-only and internal settings batches that do not affect dock presentation.
- Clear shared notification snapshot state across extension enable/disable boundaries so no source references survive lifecycle teardown.

## 248

- Share app/window tracking, location metadata resolution, mounted-device signals, Downloads monitoring, and Trash state work across dock instances to reduce multi-monitor idle overhead.
- Coalesce asynchronous location metadata completion and retry transient lookup failures after a bounded cooldown instead of keeping a session-long failure.
- Apply auto-hide mode changes in place instead of rebuilding every dock.
- Declare both user-initiated clipboard features in metadata and add EGO-oriented runtime/prefs separation checks plus package-content auditing in CI.

## 247

- Hold an already-hidden dock through concurrent window destroy/minimize compositor effects and re-evaluate visibility only after those effects finish.
- Prevent focus, restack, pointer, and dodge-intellihide updates from briefly revealing the dock from an intermediate window snapshot.
- Release the transition guard on the next idle turn after Mutter reports all pending window effects completed, with no continuous polling.

## 246

- Pre-hide the dock when a covering window starts closing or minimizing and a fullscreen window remains underneath on the same monitor/workspace.
- Use the display's complete Meta.Window inventory before workspace/actor fallbacks for fullscreen ownership checks.

## 245

- Stabilize fullscreen ownership across restacks by combining Mutter's monitor fullscreen state with live fullscreen Meta.Window checks.
- Confirm a fullscreen-clear transition before allowing normal auto-hide visibility to resume.

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