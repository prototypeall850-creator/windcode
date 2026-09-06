#!/bin/sh
# windcode installer — Linux / macOS / Termux.
# Downloads the latest self-contained bundle from GitHub Releases (no npm needed),
# verifies its checksum, installs to ~/.windcode, and puts `windcode` on PATH.
# Usage: curl -fsSL https://raw.githubusercontent.com/prototypeall850-creator/windcode/main/scripts/install.sh | sh
set -eu

REPO="prototypeall850-creator/windcode"
ASSET="windcode-bundle.tar.gz"
INSTALL_DIR="${WINDCODE_HOME:-$HOME/.windcode}"
APP_DIR="$INSTALL_DIR/app"

log() { printf '%s\n' "▸ $*"; }
die() { printf '%s\n' "✗ $*" >&2; exit 1; }

# --- node >= 20 must exist: the bundle contains everything else -------------
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$major" -ge 20 ] 2>/dev/null; then
    need_node=0
    log "node $(node --version) ✓"
  fi
fi
if [ "$need_node" -eq 1 ]; then
  die "Node.js >= 20 tidak ditemukan. Pasang dulu:
  Termux (Android):  pkg install nodejs-lts
  Ubuntu/Debian:     sudo apt install -y nodejs npm
  Fedora:            sudo dnf install -y nodejs
  Windows/ lainnya:  https://nodejs.org
lalu jalankan installer ini lagi."
fi

# --- download helper: curl or wget ------------------------------------------
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "butuh curl atau wget untuk download. Termux: pkg install curl"
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

BASE="https://github.com/$REPO/releases/latest/download"
log "mendownload $ASSET dari GitHub Releases…"
fetch "$BASE/$ASSET" "$TMP/$ASSET"
fetch "$BASE/$ASSET.sha256" "$TMP/$ASSET.sha256" || log "checksum tidak tersedia, lewati verifikasi"

# --- verify checksum ---------------------------------------------------------
if [ -f "$TMP/$ASSET.sha256" ]; then
  expected=$(cut -d' ' -f1 "$TMP/$ASSET.sha256" | tr -d '[:space:]')
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$TMP/$ASSET" | cut -d' ' -f1)
  else
    actual=$(shasum -a 256 "$TMP/$ASSET" | cut -d' ' -f1)
  fi
  if [ "$expected" != "$actual" ]; then
    die "checksum tidak cocok! download korup atau dimanipulasi."
  fi
  log "checksum ✓"
fi

# --- install -----------------------------------------------------------------
log "memasang ke $APP_DIR…"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
tar -xzf "$TMP/$ASSET" -C "$TMP"
cp -r "$TMP/windcode/." "$APP_DIR/"
chmod +x "$APP_DIR/dist/index.js" 2>/dev/null || true

# --- wrapper on PATH ---------------------------------------------------------
wrapper=$(
  cat <<EOF
#!/bin/sh
exec node "$APP_DIR/dist/index.js" "\$@"
EOF
)

case "${PREFIX:-}" in
  *com.termux*) BIN_DIR="$PREFIX/bin" ;;   # Termux: its bin is always on PATH
  *) BIN_DIR="$HOME/.local/bin" ;;
esac
mkdir -p "$BIN_DIR"
printf '%s\n' "$wrapper" > "$BIN_DIR/windcode"
chmod +x "$BIN_DIR/windcode"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    log "CATATAN: $BIN_DIR belum ada di PATH. Tambahkan ke shell profile lu:"
    printf '%s\n' "  export PATH=\"$BIN_DIR:\$PATH\"" >&2
    ;;
esac

log "selesai! coba:"
printf '%s\n' "  windcode --version"
printf '%s\n' "  windcode doctor"
