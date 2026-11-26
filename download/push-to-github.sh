#!/usr/bin/env bash
# Publish PROOFLOOM to your GitHub repository in one command.
#
# 1. Create the (public) repo at https://github.com/new — name it `proofloom`,
#    leave "Initialize with README" UNCHECKED.
# 2. Run:   ./push-to-github.sh <your-github-username>
#
# Requires git and a credential helper (gh auth login, or a PAT with repo scope).
set -euo pipefail
USER_NAME="${1:?usage: ./push-to-github.sh <github-username>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$HERE/proofloom-repo.bundle"
WORK="$(mktemp -d /tmp/proofloom-push.XXXXXX)"

git clone -q "$BUNDLE" "$WORK/repo"
cd "$WORK/repo"
git remote add origin "https://github.com/$USER_NAME/proofloom.git"
git push -q -u origin main
echo "✔ Pushed → https://github.com/$USER_NAME/proofloom"
echo "  (repo was assumed pre-created at github.com/new)"
