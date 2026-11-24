#!/usr/bin/env bash
# How many Vercel deploys the workflows made in the last 24 hours, against the Hobby
# limit of 100 (a rolling window: a slot frees up 24 h after the deploy that took it).
# Counts the "Deploy … to Vercel" steps of Preview and Deploy that succeeded; the ones
# Vercel refused did not take a slot. Needs only the gh CLI, logged in.
#
#   bash scripts/vercel-deploys.sh
set -euo pipefail

LIMIT=100
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
since=$(date -u -d '-24 hours' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)

runs=$(gh api --paginate "repos/$repo/actions/runs?created=>$since&per_page=100" \
  --jq '.workflow_runs[] | select(.name == "Preview" or .name == "Deploy") | .id')

used=0
oldest=""
for id in $runs; do
  times=$(gh api "repos/$repo/actions/runs/$id/jobs" --jq \
    '.jobs[].steps[] | select((.name | test("^Deploy .* to Vercel$")) and .conclusion == "success") | .completed_at')
  for t in $times; do
    used=$((used + 1))
    if [ -z "$oldest" ] || [[ "$t" < "$oldest" ]]; then oldest=$t; fi
  done
done

left=$((LIMIT - used))
echo "Deploys de Vercel en las últimas 24 h: $used de $LIMIT (quedan $left)."
if [ -n "$oldest" ]; then
  echo "El próximo cupo se libera 24 h después de $oldest (UTC)."
fi
if [ "$left" -lt 15 ]; then
  echo "Quedan pocos: juntá cambios en menos PRs y pushes, o esperá." >&2
fi
