#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--" ]; then
  shift
fi

WORKSPACE="${1:-}"
if [ -z "$WORKSPACE" ]; then
  echo "Usage: $0 <workspace-name>"
  echo "Example: $0 chat-service"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -d "$PROJECT_ROOT/apps/$WORKSPACE/src" ]; then
  WORKSPACE_DIR="apps/$WORKSPACE"
elif [ -d "$PROJECT_ROOT/packages/$WORKSPACE/src" ]; then
  WORKSPACE_DIR="packages/$WORKSPACE"
else
  echo "ERROR: Cannot find workspace directory for $WORKSPACE"
  echo "Looked in: apps/$WORKSPACE/src, packages/$WORKSPACE/src"
  exit 1
fi

PACKAGE_NAME="@fa/$WORKSPACE"

echo "=== Targeted Verification: $PACKAGE_NAME ==="
echo ""

echo "[1/4] Typecheck..."
pnpm --filter "$PACKAGE_NAME" run typecheck

TEST_FILES="$(find "$PROJECT_ROOT/$WORKSPACE_DIR/src" -type f \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" \) -print | sort)"
if [ -n "$TEST_FILES" ]; then
  echo ""
  echo "[2/4] Typecheck tests..."
  TEMP_TSCONFIG="$(mktemp "$PROJECT_ROOT/.tsconfig.tests-$WORKSPACE.XXXXXX.json")"
  trap 'rm -f "$TEMP_TSCONFIG"' EXIT
  {
    echo "{"
    echo "  \"extends\": \"./tsconfig.tests-check.json\","
    echo "  \"include\": ["
    first=1
    while IFS= read -r file_path; do
      relative_path="${file_path#"$PROJECT_ROOT"/}"
      if [ "$first" -eq 0 ]; then
        echo ","
      fi
      printf "    \"%s\"" "$relative_path"
      first=0
    done <<< "$TEST_FILES"
    echo ""
    echo "  ]"
    echo "}"
  } > "$TEMP_TSCONFIG"
  pnpm exec tsc --project "$TEMP_TSCONFIG" --noEmit
else
  echo ""
  echo "[2/4] Typecheck tests..."
  echo "No test files found for $PACKAGE_NAME."
fi

echo ""
echo "[3/4] Lint..."
pnpm exec eslint "$WORKSPACE_DIR"

echo ""
echo "[4/4] Tests..."
pnpm exec vitest run "$WORKSPACE_DIR"

echo ""
echo "=== Verification passed for $PACKAGE_NAME ==="
