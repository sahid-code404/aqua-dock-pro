# Changelog

## 267

- Add explicit GNOME Shell 51 compatibility while preserving GNOME Shell 50 behavior and metadata support.
- Route the GNOME native application menu through a version-aware popup-open compatibility boundary so GNOME 50 keeps `PopupAnimation.FULL` while GNOME 51 uses the new `{ animate, fadeOnly }` parameters object.
- Validate the extension against both Fedora 44 / GNOME 50 and Fedora 45 / GNOME 51, and add static guards against GNOME 51-removed Shell APIs.

## 266

- Make the right-click context menu for real Downloads and custom-folder stack items show only `Copy`; remove the redundant `Open` action from that menu.
- Preserve normal left-click opening behavior for stack items and keep the standard `text/uri-list` clipboard implementation from v265 unchanged.
- Preserve v264 popup anchoring, v263 GNOME app-menu fallback, and v262 Genie/Reduce Motion behavior unchanged.

## 265

- Restore a right-click Copy action for real items in Downloads and custom-folder stacks across fan, grid, and list views while preserving the existing Open action.
- Publish copied items as the standard `text/uri-list` file clipboard format for broad file/URI paste compatibility without spawning helpers or importing GTK/GDK into the Shell process.
- Declare the user-triggered folder-stack clipboard access in metadata, confine Shell clipboard access to one audited helper, and add payload regression coverage while preserving v264 menu anchoring and v262 Genie/Reduce Motion behavior.

## 264

- Fix both AquaDockPro and GNOME native application context menus opening off-centre while an icon is magnified by anchoring popups to an unscaled point on the visible icon edge.
- Keep bottom-dock menus centred directly above the icon and left/right dock menus centred on the outward icon edge without changing menu actions, styling, magnification, or hover behaviour.
- Preserve the v263 native GNOME menu fallback and v262 Genie/Reduce Motion compatibility unchanged.

## 263

- Add an opt-in GNOME default application context-menu fallback that uses GNOME Shell 50's exported native `AppMenu` for application icons instead of recreating the menu.
- Preserve GNOME's native menu styling and actions while keeping AquaDockPro's custom menus for Downloads, folders, files, devices, and Trash; the native menu follows the active dock edge on vertical layouts.
- Route the new preference through the live settings pipeline, close stale popup state when it changes, add schema/config regression coverage, and preserve the v262 Genie/Reduce Motion compatibility plus v260 EGO hardening.

## 262

- Keep Genie/Magic Lamp integration active when AquaDockPro Reduce Motion is enabled, so external window-effect extensions still receive the dock icon geometry they depend on.
- Decouple the explicit Genie integration switch from AquaDockPro's general animation policy while leaving Reduce Motion as a hard disable for AquaDockPro magnification, bounce, fades, drag/reorder motion, previews, stacks, and auto-hide motion.
- Add a regression test proving Reduce Motion cannot disable Genie integration and preserve all v261 Preferences organization plus v260 EGO hardening unchanged.

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
