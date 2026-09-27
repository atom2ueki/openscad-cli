# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 the openscad-cli authors
#
# AppImage packaging for openscad-cli (linux/amd64 and linux/arm64).
#
#   packaging/appimage/build.sh <version>
#
# The result is a single executable file containing the CLI, the headless
# engine and their shared libraries. Requires docker and appimagetool.
set -euo pipefail

VERSION="${1:-0.0.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="openscad-cli-${VERSION}-linux-$(uname -m)"
APPDIR="${REPO_ROOT}/build/appimage/${NAME}"

echo "==> staging $NAME"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/openscad" "$APPDIR/usr/lib"

cd "$REPO_ROOT"

# 1. The CLI: pure JavaScript plus the skill.
npm ci
npm run build
cp -R dist "$APPDIR/usr/lib/openscad-cli"
cp -R skill "$APPDIR/usr/share/openscad-cli"
cp LICENSE NOTICE THIRD_PARTY_LICENSES.md README.md "$APPDIR/usr/share/openscad/"

# 2. The headless engine, with its shared libraries bundled.
packaging/build-engine.sh full
ENGINE_BIN="$(find build/engine -maxdepth 3 -type f -name 'openscad*' -perm +111 | head -1)"
cp "$ENGINE_BIN" "$APPDIR/usr/bin/openscad"

# Collect the engine's non-system shared libraries so the AppImage is
# self-contained. System glibc/libstdc++/libgcc are provided by the kernel and
# are deliberately excluded.
echo "==> collecting shared libraries"
if command -v ldd >/dev/null 2>&1 && [ "$(uname -s)" = "Linux" ]; then
  ldd "$APPDIR/usr/bin/openscad" 2>/dev/null | awk '/=> \//{print $3}' | sort -u | while read -r lib; do
    case "$lib" in
      /lib/*|/usr/lib/*) continue ;;  # glibc and friends
    esac
    [ -f "$lib" ] && cp -L "$lib" "$APPDIR/usr/lib/" || true
  done
fi

# 3. The MCAD library, so models that use gears or bearings resolve offline.
if [ -d engine/libraries/MCAD ]; then
  mkdir -p "$APPDIR/usr/share/openscad/libraries"
  cp -R engine/libraries/MCAD "$APPDIR/usr/share/openscad/libraries/"
fi

# 4. Entry point.
cp packaging/appimage/AppRun "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
ln -sf ../lib/openscad-cli/dist/cli.js "$APPDIR/usr/bin/openscad-cli"
mkdir -p "$APPDIR/usr/share/applications"
cat > "$APPDIR/openscad-cli.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=openscad-cli
Comment=Agent-facing CLI for the OpenSCAD core engine
Exec=openscad-cli
Terminal=true
Categories=Development;Graphics;CAD;
DESKTOP
cp "$APPDIR/openscad-cli.desktop" "$APPDIR/usr/share/applications/"

echo "==> building the AppImage"
docker run --rm -v "$REPO_ROOT:/repo" -w /repo debian:bookworm-slim bash -c "
  apt-get update >/dev/null &&
  apt-get install -y --no-install-recommends wget desktop-file-utils file >/dev/null &&
  wget -q https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage -O /tmp/appimagetool &&
  chmod +x /tmp/appimagetool &&
  ARCH=$(uname -m) /tmp/appimagetool --no-appstream /repo/$APPDIR /repo/build/appimage/${NAME}.AppImage
"

echo "==> done: build/appimage/${NAME}.AppImage"
