#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

# Keep the checked-in template byte-for-byte reproducible. Release builders may
# supply a real source epoch; local validation uses the stable Unix epoch.
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-0}

xgettext \
    --language=JavaScript \
    --from-code=UTF-8 \
    --package-name=AquaDockPro \
    --msgid-bugs-address=https://github.com/sahid-code404/aqua-dock-pro/issues \
    --keyword=_ \
    --keyword=ngettext:1,2 \
    --files-from=po/POTFILES.in \
    --output=po/aqua-dock-pro.pot

# xgettext does not consistently honor SOURCE_DATE_EPOCH across distributions.
# Normalize its generated header so validation remains deterministic.
sed -i \
    's/^"POT-Creation-Date:.*\\n"$/"POT-Creation-Date: 1970-01-01 00:00+0000\\n"/' \
    po/aqua-dock-pro.pot
