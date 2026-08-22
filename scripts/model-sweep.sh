#!/bin/bash
# Per-stage model sweep for the content-driven note pipeline.
# Each config swaps ONE stage (or all) so the quality floor of each stage is visible on its own.
set -u
cd "$(dirname "$0")/.."
mkdir -p evals/sweep

run_config() {
  local name="$1"; shift
  echo "=== config: $name ($*) ==="
  env "$@" node --experimental-strip-types --no-warnings scripts/note-eval.mjs \
    --fixture=synapse-en,pogodbe-sl --variant=v2 --repeat=2 --save 2>&1 | grep -E "^running|^synapse|^pogodbe"
  cp evals/output/results.json "evals/sweep/notes.$name.json"
}

REF=gemini-3.5-flash-lite

# reference: everything on 3.5-flash-lite
run_config "ref-all35" X=1

# extraction floor — the mechanical stage, biggest single cost slice
run_config "ext25"  GEMINI_NOTE_EXTRACT_MODEL=gemini-2.5-flash-lite
run_config "ext31"  GEMINI_NOTE_EXTRACT_MODEL=gemini-3.1-flash-lite

# outline floor — the judgment stage
run_config "outline25" GEMINI_NOTE_OUTLINE_MODEL=gemini-2.5-flash-lite
run_config "outline31" GEMINI_NOTE_OUTLINE_MODEL=gemini-3.1-flash-lite

# write floor — the expensive per-token stage
run_config "write25" GEMINI_NOTE_WRITE_MODEL=gemini-2.5-flash-lite
run_config "write31" GEMINI_NOTE_WRITE_MODEL=gemini-3.1-flash-lite

# whole pipeline on cheap models
run_config "all25" GEMINI_NOTE_EXTRACT_MODEL=gemini-2.5-flash-lite GEMINI_NOTE_OUTLINE_MODEL=gemini-2.5-flash-lite GEMINI_NOTE_WRITE_MODEL=gemini-2.5-flash-lite
run_config "all31" GEMINI_NOTE_EXTRACT_MODEL=gemini-3.1-flash-lite GEMINI_NOTE_OUTLINE_MODEL=gemini-3.1-flash-lite GEMINI_NOTE_WRITE_MODEL=gemini-3.1-flash-lite

echo "SWEEP DONE"
