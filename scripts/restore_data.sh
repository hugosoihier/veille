#!/bin/sh
# Récupère data.json depuis la branche « data » (si elle existe) pour que la collecte parte
# des données précédentes (articles déjà vus, traductions déjà faites).
# Usage : sh scripts/restore_data.sh <url-du-dépôt>
remote="$1"
if [ -z "$remote" ]; then echo "usage: restore_data.sh <remote>"; exit 0; fi
tmp=$(mktemp -d)
if git init -q "$tmp" && git -C "$tmp" fetch -q --depth=1 "$remote" data 2>/dev/null; then
  if git -C "$tmp" show FETCH_HEAD:data.json > data.json.restored 2>/dev/null; then
    mv data.json.restored data.json && echo "Données précédentes restaurées."
  else
    echo "La branche data ne contient pas encore de data.json."
  fi
else
  echo "Pas encore de branche data."
fi
rm -rf "$tmp" data.json.restored
exit 0
