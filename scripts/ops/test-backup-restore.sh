#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ops-test: %s\n' "$*" >&2
  exit 1
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)
cd "$repo_root"

command -v bun >/dev/null 2>&1 || fail 'bun is required'
bun test scripts/ops/ops-contract.test.mjs

if [[ ${OPS_RUN_TOOL_FIXTURES:-} == true ]]; then
  [[ -n ${OPS_TEST_FIXTURE_DIR:-} ]] ||
    fail 'OPS_TEST_FIXTURE_DIR is required when OPS_RUN_TOOL_FIXTURES=true'
  valid_fixture="$OPS_TEST_FIXTURE_DIR/audit-valid.json"
  tampered_fixture="$OPS_TEST_FIXTURE_DIR/audit-tampered.json"
  [[ -r $valid_fixture && -r $tampered_fixture ]] ||
    fail 'fixture directory must contain readable audit-valid.json and audit-tampered.json'

  node "$script_dir/verify-audit-chain.mjs" "$valid_fixture" >/dev/null
  if node "$script_dir/verify-audit-chain.mjs" "$tampered_fixture" >/dev/null 2>&1; then
    fail 'tampered audit fixture unexpectedly verified'
  fi
fi

printf '{"ok":true,"sourceTests":true,"fixtureToolsExercised":%s}\n' \
  "$([[ ${OPS_RUN_TOOL_FIXTURES:-} == true ]] && printf true || printf false)"
