#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The helpers are macOS-only; nothing to build on $(uname -s)." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
out=electron/resources
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for helper in speech-helper perm-helper auth-helper; do
  for arch in arm64 x86_64; do
    swiftc -O \
      -target "$arch-apple-macos11.0" \
      "$out/$helper.swift" \
      -o "$tmp/$helper.$arch"
  done
  lipo -create -output "$out/$helper" "$tmp/$helper.arm64" "$tmp/$helper.x86_64"
  chmod +x "$out/$helper"
  echo "built $out/$helper ($(lipo -archs "$out/$helper"))"
done
