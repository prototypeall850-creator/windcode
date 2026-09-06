#!/bin/sh
# Build a self-contained release bundle: dist/ + runtime node_modules/ + package.json.
# Result: windcode-bundle.tar.gz (+ .sha256) — pure JS, platform-independent.
set -eu

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "▸ bundling windcode v$VERSION"

# full install (typescript needed for build), build, then keep runtime deps only
npm install --no-audit --no-fund --silent
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --silent

mkdir -p "$STAGE/windcode"
cp -r dist "$STAGE/windcode/dist"
cp package.json README.md LICENSE "$STAGE/windcode/"
cp -r node_modules "$STAGE/windcode/node_modules"

tar -czf "windcode-bundle.tar.gz" -C "$STAGE" windcode
shasum -a 256 windcode-bundle.tar.gz > windcode-bundle.tar.gz.sha256 2>/dev/null \
  || sha256sum windcode-bundle.tar.gz > windcode-bundle.tar.gz.sha256

echo "▸ OK: $(du -h windcode-bundle.tar.gz | cut -f1) — windcode-bundle.tar.gz + .sha256"
