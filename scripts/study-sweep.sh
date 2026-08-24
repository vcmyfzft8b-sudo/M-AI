#!/bin/bash
# Model sweep for study-material generation (cards, quiz, practice).
# EXTRACT_MODEL is passed in so the sweep can run on whatever extraction model won the note sweep.
set -u
cd "$(dirname "$0")/.."
mkdir -p evals/sweep
EXTRACT_MODEL="${EXTRACT_MODEL:-gemini-3.5-flash-lite}"

run_config() {
  local name="$1"; shift
  echo "=== study config: $name ($*) ==="
  env GEMINI_NOTE_EXTRACT_MODEL="$EXTRACT_MODEL" "$@" \
    node --experimental-strip-types --no-warnings scripts/study-eval.mjs \
    --fixture=synapse-en,pogodbe-sl --variant=v2 2>&1 | grep -E "^running|^synapse|^pogodbe" | tee "evals/sweep/study.$name.txt"
}

run_config "study35" X=1
run_config "study31" GEMINI_STUDY_ITEMS_MODEL=gemini-3.1-flash-lite
run_config "study25" GEMINI_STUDY_ITEMS_MODEL=gemini-2.5-flash-lite

echo "STUDY SWEEP DONE"
