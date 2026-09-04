# Agnyra — Pilotez vos campagnes calendriers

Application multi-tenant pour amicales de sapeurs-pompiers. Voir
`CLAUDE.md` pour le contexte complet du projet (vision, chantiers en
cours, décisions prises).

## Structure

```
index.html            point d'entrée (dev, charge les modules séparément)
manifest.json          configuration PWA installable
sw.js                   service worker, cache à deux niveaux
css/style.css           styles
js/                     14 modules ES
icons/                  15 icônes (PNG, tailles exactes)
build.py                secours : régénère un fichier unique
index-monofichier.html  fichier unique généré par build.py (déployable tel quel)
```

## Développement

Le code source réel vit dans `css/` et `js/`. Ne jamais éditer
`index-monofichier.html` à la main : c'est un artefact généré.

Après toute modification d'un module :

```bash
python3 build.py
```

régénère `index-monofichier.html` à partir des sources.

## Publier une mise à jour (une fois en prod)

1. Modifier le ou les fichiers concernés dans `js/` ou `css/`
2. Incrémenter `VERSION` dans `sw.js` (ex. `v3-3` → `v3-4`)
3. **Si `geoloc.js` ou `carte.js` change**, incrémenter aussi
   `CACHE_STATIC` dans `sw.js` — ces deux fichiers vivent dans un cache
   séparé du reste de l'appli, qui n'est pas renouvelé par le simple bump
   de `VERSION`
4. Déployer **tous** les fichiers modifiés en même temps, `sw.js` inclus —
   des versions dépareillées entre modules font planter le chargement de
   l'appli au complet (erreur du type `does not provide an export named...`)

## Déployer sur Firebase Hosting (agnyra.web.app)

Gratuit (plan Spark, comme le reste du projet). Deux façons de faire :

### Automatique, sans rien installer (recommandé)

`.github/workflows/deploy.yml` déploie automatiquement à chaque push sur
`main` (ou `claude/verify-build-index-qymiy0` pour l'instant), exactement
comme pour le projet Planning PIN — zéro CLI, zéro installation, tout se
passe sur les serveurs de GitHub. Une seule config manuelle, entièrement
dans les navigateurs :

1. **Créer le site Hosting** "agnyra" une fois : console Firebase → projet
   `belenos-611bd` → Hosting → "Ajouter un autre site" → taper `agnyra`
   (si déjà pris ailleurs, choisir une variante et l'utiliser à la place
   dans `.firebaserc`/`firebase.json`, champ `target`/`targets`).
2. **Générer une clé de compte de service** : console Firebase → ⚙️
   Paramètres du projet → onglet "Comptes de service" → "Générer une
   nouvelle clé privée" → télécharge un fichier `.json`.
3. **Ajouter cette clé comme secret GitHub** : sur le dépôt GitHub →
   Settings → Secrets and variables → Actions → "New repository secret" →
   nom `FIREBASE_SERVICE_ACCOUNT_AGNYRA`, valeur = tout le contenu du
   fichier `.json` téléchargé à l'étape précédente.

Une fois ces 3 étapes faites, chaque `git push` republie automatiquement
l'app sur `https://agnyra.web.app` (la CI génère le monofichier, vérifie
la syntaxe et numérote `VERSION` dans `sw.js` toute seule — plus besoin de
le faire à la main avant de déployer).

### Manuelle, via la CLI Firebase

```bash
npm install -g firebase-tools   # si pas déjà installé
firebase login                  # ouvre une fenêtre de connexion Google
firebase hosting:sites:create agnyra
firebase deploy --only hosting
```

Dans ce cas, penser à suivre les étapes de "Publier une mise à jour"
ci-dessus (bump `VERSION`/`CACHE_STATIC`) avant de déployer, puisque la CI
ne s'en charge pas pour un déploiement manuel.

## État du projet

Voir `CLAUDE.md` — chantier 5 (bascule de logo Agnyra/caserne) fait,
chantiers 1, 4 (volet équipier) et 6 (Cloud Function, migration complète)
encore ouverts.
