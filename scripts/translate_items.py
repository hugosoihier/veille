#!/usr/bin/env python3
"""Traduit en français les articles en anglais de data.json (hors-ligne, Argos Translate).

Utilisation (GitHub Actions) :
    python scripts/translate_items.py --count   # affiche le nombre de textes à traduire
    python scripts/translate_items.py           # traduit, dans la limite du budget de temps

- Seuls les articles marqués "lang": "en" sont traduits (champ défini par feed dans config.json).
- Les traductions sont gardées dans data.json (title_fr, summary_fr, action_fr) : un texte déjà
  traduit n'est jamais retraduit.
- Les plus récents sont traduits en premier. Si le budget de temps est atteint, le reste est
  traité à la collecte suivante.
- La traduction est automatique : elle peut être imparfaite, l'appli l'indique à l'écran.

Variable d'environnement VEILLE_FAKE_TRANSLATE=1 : faux traducteur, uniquement pour les tests.
"""
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, "data.json")
BUDGET_S = int(os.environ.get("TRANSLATE_BUDGET_S", "480"))
SAVE_EVERY = 15

# (champ source, champ traduit)
FIELDS = (("title", "title_fr"), ("summary", "summary_fr"), ("action", "action_fr"))
SPACE_RE = re.compile(r"\s+")


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def source_text(item, src):
    """Texte à traduire. Pour les titres de failles CISA, seule la partie descriptive est traduite
    (l'identifiant CVE et le nom du produit restent intacts)."""
    if src == "title" and item.get("title_tail"):
        return item["title_tail"]
    return item.get(src)


def pending(items):
    todo = []
    for it in sorted(items, key=lambda i: i.get("date", ""), reverse=True):
        if it.get("lang") != "en":
            continue
        for src, dst in FIELDS:
            if source_text(it, src) and not it.get(dst):
                todo.append((it, src, dst))
    return todo


def load(path=OUTPUT):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save(data, path=OUTPUT):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_translator():
    if os.environ.get("VEILLE_FAKE_TRANSLATE"):
        return lambda text: "[FR] " + text
    import argostranslate.package as package
    import argostranslate.translate as translate

    def ready():
        langs = {lang.code: lang for lang in translate.get_installed_languages()}
        return "en" in langs and "fr" in langs and langs["en"].get_translation(langs["fr"]) is not None

    if not ready():
        log("Téléchargement du modèle anglais → français…")
        package.update_package_index()
        pkg = next(p for p in package.get_available_packages() if p.from_code == "en" and p.to_code == "fr")
        package.install_from_path(pkg.download())
    return lambda text: translate.translate(text, "en", "fr")


def main():
    data = load() if os.path.exists(OUTPUT) else {"items": []}
    todo = pending(data.get("items", []))

    if "--count" in sys.argv:
        print(len(todo))
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a", encoding="utf-8") as fh:
                fh.write(f"count={len(todo)}\n")
        return 0

    if not todo:
        log("Rien à traduire.")
        return 0

    log(f"{len(todo)} texte(s) à traduire")
    translator = load_translator()
    started = time.time()
    done = 0
    for item, src, dst in todo:
        if time.time() - started > BUDGET_S:
            log(f"Budget de {BUDGET_S} s atteint : le reste sera traité à la prochaine collecte.")
            break
        try:
            result = SPACE_RE.sub(" ", translator(source_text(item, src))).strip()
        except Exception as exc:  # un texte qui échoue ne bloque pas les autres
            log(f"Échec de traduction ({item.get('id')}/{src}) : {exc}")
            continue
        if not result:
            continue
        if src == "title" and item.get("title_tail"):
            result = item.get("title_head", "") + result
        item[dst] = result
        done += 1
        if done % SAVE_EVERY == 0:
            save(data)
    save(data)
    log(f"{done} texte(s) traduit(s), {len(todo) - done} restant(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
