#!/usr/bin/env python3
"""Ouvre une issue GitHub quand une source reste en échec, et la ferme quand elle revient.

Lancé par GitHub Actions après la collecte (outil `gh`, jeton GITHUB_TOKEN).
Seuil : FAILS_THRESHOLD collectes consécutives en échec (≈ 30 à 60 min avec une collecte toutes les 5 min).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data.json")
LABEL = "source-en-echec"
PREFIX = "Source en échec : "
FAILS_THRESHOLD = int(os.environ.get("FAILS_THRESHOLD", "6"))


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def main():
    try:
        with open(DATA, encoding="utf-8") as fh:
            status = json.load(fh).get("status", {})
    except (OSError, ValueError):
        print("Pas de data.json : rien à vérifier.")
        return 0

    gh("label", "create", LABEL, "--color", "d93f0b", "--description", "Flux de veille injoignable", "--force")
    issues = json.loads(gh("issue", "list", "--label", LABEL, "--state", "open", "--json", "number,title", "--limit", "100"))
    open_by_source = {i["title"][len(PREFIX):]: i["number"] for i in issues if i["title"].startswith(PREFIX)}

    for name, st in status.items():
        failing = not st.get("ok") and st.get("fails", 0) >= FAILS_THRESHOLD
        if failing and name not in open_by_source:
            body = (f"La source **{name}** ne répond plus depuis {st.get('fails')} collectes "
                    f"(depuis {st.get('since', '?')}).\n\nDernière erreur : `{st.get('error', 'inconnue')}`\n\n"
                    "Vérifier l'adresse dans `config.json`. Cette issue se fermera seule quand la source répondra à nouveau.")
            gh("issue", "create", "--title", PREFIX + name, "--label", LABEL, "--body", body)
            print(f"Issue ouverte : {name}")
        elif st.get("ok") and name in open_by_source:
            gh("issue", "close", str(open_by_source[name]), "--comment", "La source répond de nouveau : fermeture automatique.")
            print(f"Issue fermée : {name}")

    # Sources retirées de config.json : on ferme leur issue.
    for name, number in open_by_source.items():
        if name not in status:
            gh("issue", "close", str(number), "--comment", "Source retirée de la configuration.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
