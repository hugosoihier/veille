#!/bin/sh
# Publie data.json sur la branche « data » : un seul commit, remplacé à chaque fois.
# Pas d'historique qui grossit, et aucun rebuild de GitHub Pages (Pages ne suit que « main »).
# Usage : sh scripts/publish_data.sh <url-du-dépôt>
remote="$1"
if [ ! -f data.json ]; then echo "Pas de data.json à publier."; exit 0; fi
if [ -z "$remote" ]; then echo "usage: publish_data.sh <remote>"; exit 1; fi
src="$(pwd)/data.json"
tmp=$(mktemp -d)
cp "$src" "$tmp/data.json"
cd "$tmp" || exit 1
git init -q -b data
git config user.name "veille-bot"
git config user.email "veille-bot@users.noreply.github.com"
git add data.json
git commit -q -m "Données du $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q -f "$remote" data
echo "data.json publié sur la branche data."
