#!/bin/bash
export PATH=/bin:/usr/bin
STATE="${FAKE_RT_STATE:-/tmp/workmates-fake-rt}"
mkdir -p "$STATE"

case "$1" in
  --version) echo "fake-runtime 1.0"; exit 0 ;;
  volume)
    case "$2" in
      create) touch "$STATE/vol-$3"; exit 0 ;;
      rm) rm -f "$STATE/vol-$3"; exit 0 ;;
    esac ;;
  ps)
    for f in "$STATE"/ct-*; do
      [ -e "$f" ] || continue
      name="${f##*/ct-}"
      if [ -s "$f" ] && grep -q running "$f"; then
        printf '%s\tUp 2 minutes\n' "$name"
      else
        printf '%s\tExited (0)\n' "$name"
      fi
    done
    exit 0 ;;
  run)
    shift
    while [ $# -gt 0 ]; do
      if [ "$1" = "--name" ]; then NAME="$2"; shift; fi
      shift
    done
    echo running > "$STATE/ct-$NAME"
    mkdir -p "$STATE/work-$NAME"
    exit 0 ;;
  start) echo running > "$STATE/ct-$2"; exit 0 ;;
  stop) echo stopped > "$STATE/ct-$2"; exit 0 ;;
  rm) rm -f "$STATE/ct-$3" 2>/dev/null || rm -f "$STATE/ct-$2"; exit 0 ;;
  exec)
    NAME="$2"; shift 4
    cd "$STATE/work-$NAME" 2>/dev/null || exit 1
    sh -c "$1" ;;
esac
