#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
schema_dir=$(mktemp -d)
trap 'rm -rf "$schema_dir"' EXIT

cd "$project_root"

glib-compile-schemas --strict --targetdir="$schema_dir" schemas
jq -e '
    .uuid == "aqua-dock-pro@shaque" and
    (.version | type == "number") and
    ."shell-version" == ["50", "51"] and
    (.description | contains("clipboard"))
' metadata.json >/dev/null

metadata_version=$(jq -r '.version' metadata.json)
changelog_version=$(awk '/^## [0-9]+$/ { print $2; exit }' CHANGELOG.md)
if [[ "$metadata_version" != "$changelog_version" ]]; then
    printf 'metadata.json version (%s) does not match latest CHANGELOG version (%s).\n' \
        "$metadata_version" "$changelog_version" >&2
    exit 1
fi

mapfile -t js_files < <(find . -type f -name '*.js' -not -path './.git/*' | sort)
mapfile -t runtime_js < <(
    find extension.js animation autohide compat core dock downloads effects interactions menus services ui \
        -type f -name '*.js' 2>/dev/null | sort
)
mapfile -t prefs_js < <(find prefs.js prefs -type f -name '*.js' 2>/dev/null | sort)

if grep -nE "from ['\"]gi://(Gtk|Gdk|Adw)" "${runtime_js[@]}"; then
    printf 'GTK/GDK/Adwaita import found in the GNOME Shell runtime.\n' >&2
    exit 1
fi

if grep -nE "from ['\"]gi://(Clutter|Meta|St|Shell)" "${prefs_js[@]}"; then
    printf 'GNOME Shell/Clutter import found in the preferences process.\n' >&2
    exit 1
fi

if grep -nE 'imports\.(ByteArray|byteArray|Lang|lang|Mainloop|mainloop)|run_dispose[[:space:]]*\(' \
    "${js_files[@]}"; then
    printf 'Deprecated or reviewer-hostile GJS API usage found.\n' >&2
    exit 1
fi

if command -v rg >/dev/null; then
    if rg -n 'vertical[[:space:]]*:' downloads ui --glob '*.js'; then
        printf 'Deprecated St.BoxLayout vertical property found; use Clutter.Orientation.\n' >&2
        exit 1
    fi
else
    if grep -rnE 'vertical[[:space:]]*:' downloads ui --include='*.js'; then
        printf 'Deprecated St.BoxLayout vertical property found; use Clutter.Orientation.\n' >&2
        exit 1
    fi
fi

if command -v xgettext >/dev/null && [[ -f po/aqua-dock-pro.pot ]]; then
    pot_before=$(mktemp)
    pot_after=$(mktemp)
    cp po/aqua-dock-pro.pot "$pot_before"
    if ! po/update-pot.sh; then
        cp "$pot_before" po/aqua-dock-pro.pot
        rm -f "$pot_before" "$pot_after"
        exit 1
    fi
    cp po/aqua-dock-pro.pot "$pot_after"
    cp "$pot_before" po/aqua-dock-pro.pot

    if ! diff -u \
        <(grep -v '^#:' "$pot_before") \
        <(grep -v '^#:' "$pot_after") >/dev/null; then
        rm -f "$pot_before" "$pot_after"
        printf 'po/aqua-dock-pro.pot messages were stale; regenerate it with po/update-pot.sh.\n' >&2
        exit 1
    fi
    rm -f "$pot_before" "$pot_after"
fi

gjs -c '
    const GLib = imports.gi.GLib;
    try {
        for (const file of ARGV) {
            const [, bytes] = GLib.file_get_contents(file);
            Reflect.parse(new TextDecoder().decode(bytes), {
                source: file,
                target: "module",
            });
        }
    } catch (error) {
        printerr(error);
        imports.system.exit(1);
    }
' "${js_files[@]}"

gi_paths=()
library_paths=()
for path in /usr/lib64/gnome-shell /usr/lib64/mutter-*; do
    [[ -d "$path" ]] || continue
    gi_paths+=("$path")
    library_paths+=("$path")
done
if ((${#gi_paths[@]})); then
    joined=$(IFS=:; printf '%s' "${gi_paths[*]}")
    export GI_TYPELIB_PATH="${joined}${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    joined=$(IFS=:; printf '%s' "${library_paths[*]}")
    export LD_LIBRARY_PATH="${joined}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

export AQUA_SCHEMA_DIR="$schema_dir"
export GSETTINGS_BACKEND=memory
gjs -m tests/springSolver.test.js
gjs -m tests/iconResolution.test.js
gjs -m tests/layout.test.js
gjs -m tests/layoutStructures.test.js
gjs -m tests/fullscreenPolicy.test.js
gjs -m tests/settings.test.js
gjs -m tests/settingsMigration.test.js
gjs -m tests/animationEngine.test.js
gjs -m tests/genieReduceMotion.test.js
gjs -m tests/fileService.test.js
gjs -m tests/fileEnumerator.test.js
gjs -m tests/fileClipboardPayload.test.js
gjs -m tests/fanGeometry.test.js
gjs -m tests/customItems.test.js
gjs -m tests/previewPaging.test.js
gjs -m tests/locationResolver.test.js
gjs -m tests/mountedDevices.test.js
gjs -m tests/windowFilter.test.js

if [[ ${AQUA_RUN_PREFS_SMOKE:-0} == 1 ]]; then
    gjs -m tests/prefsSmoke.test.js
fi

if [[ "${CI:-}" != "true" ]]; then
    git diff --check
fi

printf 'AquaDockPro validation passed.\n'
