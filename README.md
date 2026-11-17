# Tableau de bord Veille — appli installable (PWA)

Une appli qui s'installe sur la tablette comme une application normale (icône, plein écran,
fonctionne même si la connexion coupe un moment).

- **Accueil** : heure, météo, niveau de veille, chiffres de la semaine, points à retenir, échéances
  (Patch Tuesday, jours fériés), état des services, actualités.
- **Veille** : alertes, avis et failles, avec filtres, recherche et repérage « Périmètre ».
- **Infos** : météo détaillée (24 h + 6 jours), calendrier, état des services, actualités.
- **Réglages** : thème Clair (par défaut) ou Soir, titre affiché, liste des logiciels suivis, état de chaque source.

Comment ça marche : GitHub exécute `scripts/fetch_feeds.py` toutes les 30 minutes (gratuit), qui
enregistre `data.json`. La tablette affiche le site hébergé par GitHub Pages. Elle n'a besoin que
d'Internet, jamais du réseau interne.

## Mise en ligne (une seule fois)

1. Sur github.com, créer un dépôt **public** nommé par exemple `veille`.
2. Décompresser ce zip, puis sur la page du dépôt : **Add file → Upload files** et glisser **tout le
   contenu du dossier** (y compris les dossiers `.github`, `scripts` et `icons`). Valider (Commit).
3. **Settings → Pages** : Source = *Deploy from a branch*, branche `main`, dossier `/ (root)`.
4. **Settings → Actions → General → Workflow permissions** : choisir *Read and write permissions*.
5. Onglet **Actions** → « Mise à jour des données de veille » → **Run workflow**.
   Après une minute, `data.json` apparaît dans le dépôt.
6. L'adresse de l'appli est `https://VOTRE-COMPTE.github.io/veille/` (visible dans Settings → Pages).

## Installation sur la tablette

1. Ouvrir l'adresse dans **Chrome**.
2. Menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).
3. Lancer l'icône : l'appli s'ouvre en plein écran. L'écran reste allumé tant qu'elle est au premier plan.
4. Aller dans **Réglages** et adapter la liste des logiciels suivis au parc du service.

La tablette doit pouvoir joindre `*.github.io` et `api.open-meteo.com` (Wi-Fi invité ou carte SIM).

## Traduction en français

Les articles en anglais (CISA, Cisco, Fortinet, BleepingComputer) sont traduits automatiquement par
GitHub Actions avec Argos Translate (logiciel libre, hors-ligne, sans clé ni compte). Titre et résumé
s'affichent en français ; le titre original reste visible dans le détail de l'article.
- La traduction est automatique : elle peut être imparfaite, l'appli le précise à l'écran.
- La toute première exécution est longue (installation du traducteur, 10 à 20 minutes). Ensuite, seuls
  les nouveaux articles sont traduits, et les traductions déjà faites sont conservées.
- Une source en anglais se déclare avec `"lang": "en"` dans `config.json`.

## Si l'écran est vide

L'appli affiche elle-même la cause :
- « Fichier de données introuvable » : la première collecte n'a pas eu lieu. Onglet **Actions** du dépôt →
  « Mise à jour des données de veille » → **Run workflow**, et vérifier **Settings → Actions → General →
  Workflow permissions = Read and write**.
- « Aucun article reçu des sources » : les adresses de flux ne répondent pas. Le détail de chaque source
  est dans **Réglages → Données et application** (point rouge = en échec, avec le message d'erreur).
- « Page ouverte comme un fichier local » : ouvrir l'adresse `https://…github.io/…`, pas le fichier du disque.

## Mettre à jour l'appli

Re-déposer les fichiers sur GitHub (Add file → Upload files, mêmes noms : ils sont remplacés).
Sur la tablette, l'appli se met à jour seule à la prochaine ouverture ; sinon Réglages → **Actualiser maintenant**.

## Confidentialité

- Le dépôt et l'adresse sont publics, mais ne contiennent que des informations publiques
  (flux CERT-FR, CISA, presse, pages d'état).
- La liste des logiciels utilisés et le titre sont enregistrés **uniquement dans la tablette**
  (Réglages). Ils ne sont jamais envoyés ni publiés. Ne les écrivez pas dans `config.json`.
- Évitez de mettre le nom de l'organisation dans le dépôt (nom, description, README).

## Personnaliser les sources

Éditer `config.json` sur GitHub (icône crayon) : `feeds` (RSS/Atom, `type` : alerte, avis, cti, vuln,
actualite, news), `services` (pages d'état au format Statuspage), `kev`. Le workflow se relance seul.
Si une source est en échec, elle apparaît en orange en bas de page et dans Réglages.

## Limites

- Le repérage du périmètre est un filtre par mots-clés : il peut manquer une faille ou en signaler une
  hors sujet. Il ne remplace pas la veille officielle du service.
- Le « niveau de veille » est un indicateur interne, pas un niveau officiel.
- La vigilance météo officielle (Météo-France) n'est pas incluse : elle demande une clé d'API.
- Si les mises à jour s'arrêtent, regarder l'onglet **Actions** du dépôt (GitHub peut suspendre
  les tâches planifiées d'un dépôt resté inactif).

## Mise à jour toutes les 5 minutes (v2.3)

- Le workflow GitHub Actions s'exécute toutes les 5 minutes. Les délais de GitHub sont « au mieux » : comptez en pratique 5 à 15 minutes entre deux collectes.
- Les données sont publiées sur la branche `data` (un seul commit, remplacé à chaque fois), pour ne pas reconstruire le site à chaque collecte. L'appli lit `data.json` sur cette branche (cache du CDN d'environ 5 minutes) et se rabat sur `data.json` de `main` si la branche n'existe pas encore.
- L'appli recharge les données toutes les 5 minutes et au retour au premier plan.

## Plein écran et navigation

Le bouton « Plein écran » (en haut à droite) bascule le navigateur en plein écran. La navigation entre les pages se fait sans rechargement pour que le plein écran reste actif.

## Conseils de protection

Chaque vulnérabilité affiche des conseils généraux (équipe informatique / utilisateurs) déduits par règles du type de faille et du produit. Ils ne remplacent pas l'avis officiel (bouton « Lien »).
