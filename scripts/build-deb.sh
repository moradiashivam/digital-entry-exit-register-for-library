#!/usr/bin/env bash
# Builds a Debian/Ubuntu .deb package containing the single-file Linux binary.
#
#   cd mysql-app && npm run deb
#
# Output: dist/library-register_<version>_amd64.deb
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION="$(node -p "require('./package.json').version")"
PKG="library-register"
STAGE="$ROOT/dist/deb"
BIN="$ROOT/dist/library-register"
DPKG_DEB="${DPKG_DEB:-dpkg-deb}"

echo "==> Bundling application"
npx esbuild src/server.js --bundle --platform=node --format=cjs \
  --target=node20 --outfile=dist/bundle.cjs --log-level=error

echo "==> Building Linux binary"
npx pkg dist/bundle.cjs --config pkg.config.json --targets node22-linux-x64 --fallback-to-source \
  --output "$BIN"

echo "==> Staging package tree"
rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN" \
         "$STAGE/opt/$PKG" \
         "$STAGE/usr/bin" \
         "$STAGE/lib/systemd/system" \
         "$STAGE/usr/share/doc/$PKG"

install -m 0755 "$BIN" "$STAGE/opt/$PKG/library-register"
install -m 0644 "$ROOT/.env.example" "$STAGE/opt/$PKG/.env.example"
ln -sf "/opt/$PKG/library-register" "$STAGE/usr/bin/library-register"

install -m 0644 "$ROOT/packaging/debian/library-register.service" \
  "$STAGE/lib/systemd/system/library-register.service"
install -m 0644 "$ROOT/README.md" "$STAGE/usr/share/doc/$PKG/README.md"

SIZE_KB=$(du -sk "$STAGE" | cut -f1)

cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: web
Priority: optional
Architecture: amd64
Maintainer: Library Register <support@localhost>
Installed-Size: $SIZE_KB
Depends: adduser
Recommends: mysql-server | mariadb-server
Description: Library Entry & Exit Register
 Multi-tenant library entry and exit register with kiosk mode, face
 recognition, reports and an owner console. Runs as a systemd service on
 http://localhost:4000 and stores its settings in /opt/library-register/.env.
EOF

for f in postinst prerm postrm; do
  install -m 0755 "$ROOT/packaging/debian/$f" "$STAGE/DEBIAN/$f"
done

echo "==> Building .deb"
OUT="$ROOT/dist/${PKG}_${VERSION}_amd64.deb"
"$DPKG_DEB" --root-owner-group --build "$STAGE" "$OUT"
echo "Done: $OUT"
