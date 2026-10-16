#!/bin/bash
# Rebuilds docs/USER_MANUAL.pdf from docs/USER_MANUAL.md. Run it after every change to the manual.
# Needs pandoc and a Chromium/Chrome binary (set CHROME=/path/to/chrome if it is not on PATH).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DOCS="$HERE/.."
CHROME=${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}
[ -n "$CHROME" ] || { echo "Chromium/Chrome not found; set CHROME=/path/to/binary" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cp "$HERE/user-manual.css" "$TMP/"
pandoc "$DOCS/USER_MANUAL.md" -f gfm -t html5 -s --metadata title="AgapSense User Manual" \
  --css user-manual.css -o "$TMP/manual.html"
# pandoc's standalone template prints the title again; the Markdown already has its own H1.
sed -i 's#<header id="title-block-header">.*</header>##; /<header id="title-block-header">/,/<\/header>/d' "$TMP/manual.html"
"$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="$DOCS/USER_MANUAL.pdf" "file://$TMP/manual.html" 2>/dev/null
echo "Wrote $DOCS/USER_MANUAL.pdf"
