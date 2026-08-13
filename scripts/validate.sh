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
    ."shell-version" == ["50", "51.beta"]
' metadata.json >/dev/null

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
    pot_before=$(sha256sum po/aqua-dock-pro.pot | cut -d' ' -f1)
    po/update-pot.sh
    pot_after=$(sha256sum po/aqua-dock-pro.pot | cut -d' ' -f1)
    [[ "$pot_before" == "$pot_after" ]] || {
        printf 'po/aqua-dock-pro.pot was stale; regenerate it with po/update-pot.sh.\n' >&2
        exit 1
    }
fi

mapfile -t js_files < <(find . -type f -name '*.js' -not -path './.git/*' | sort)
gjs -c '
    const GLib = imports.gi.GLib;
    for (const file of ARGV) {
        const [, bytes] = GLib.file_get_contents(file);
        Reflect.parse(new TextDecoder().decode(bytes), {
            source: file,
            target: "module",
        });
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
gjs -m tests/settings.test.js
gjs -m tests/fileEnumerator.test.js
gjs -m tests/mountedDevices.test.js
gjs -m tests/windowFilter.test.js

if [[ ${AQUA_RUN_PREFS_SMOKE:-0} == 1 ]]; then
    gjs -m tests/prefsSmoke.test.js
fi

if [[ "${CI:-}" != "true" ]]; then
    git diff --check
fi

printf 'AquaDockPro validation passed.\n' 
