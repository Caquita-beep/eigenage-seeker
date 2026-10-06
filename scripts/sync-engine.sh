#!/bin/sh
# Copies the Exposure engine from the website into src/engine/.
#
# The engine is written once, in eigenage-web/src/lib/exposure, and tested
# there. This app runs the same maths on the phone, so the files are copied
# rather than ported: edit them in the website, then run this. Never edit
# src/engine/ by hand — the next sync overwrites it.
#
# Two rewrites make them run here: the RPC client lives next to them instead of
# in ../solana, and its URL comes from an EXPO_PUBLIC_ variable (inlined at build
# time) with the public mainnet endpoint as the fallback.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
web=${EIGENAGE_WEB:-$here/../eigenage-web}
src=$web/src/lib/exposure
out=$here/src/engine

[ -d "$src" ] || { echo "no engine at $src (set EIGENAGE_WEB)" >&2; exit 1; }
rm -rf "$out"
mkdir -p "$out"

for f in "$src"/*.ts; do
  name=$(basename "$f")
  case "$name" in
    *.test.ts|snapshot.ts|body.ts) continue ;;  # tests run in the website; snapshot needs Postgres; body.ts is the website page's view
  esac
  sed 's#"\.\./solana/rpc"#"./rpc"#' "$f" > "$out/$name"
done

# The WHOOP reader and its synthetic member, beside the engine they feed. They
# import the engine as ../exposure/*, which from src/engine/whoop/ is ../*.
mkdir -p "$out/whoop"
for f in "$web"/src/lib/whoop/*.ts; do
  name=$(basename "$f")
  case "$name" in *.test.ts) continue ;; esac
  sed 's#"\.\./exposure/#"../#' "$f" > "$out/whoop/$name"
done

sed 's#process\.env\.SOLANA_RPC_URL#(process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com")#' \
  "$web/src/lib/solana/rpc.ts" > "$out/rpc.ts"

rev=$(git -C "$web" rev-parse --short HEAD 2>/dev/null || echo unknown)
# Synced from a working tree with changes not yet committed: say so, or the
# stamp names a commit that does not contain what was copied.
if [ -n "$(git -C "$web" status --porcelain -- src/lib/exposure src/lib/whoop src/lib/solana/rpc.ts 2>/dev/null)" ]; then
  rev="$rev+uncommitted"
fi
printf '// Synced from eigenage-web@%s by scripts/sync-engine.sh. Do not edit.\n' "$rev" > "$out/SOURCE.ts"
echo "engine synced from eigenage-web@$rev: $(ls "$out" | wc -l | tr -d ' ') files"
