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

## Déployer sur Firebase Hosting (belenos-611bd)

Gratuit (plan Spark, comme le reste du projet). Une seule fois :

```bash
npm install -g firebase-tools   # si pas déjà installé
firebase login                  # ouvre une fenêtre de connexion Google
```

Puis à chaque déploiement, depuis la racine du dépôt :

```bash
firebase deploy --only hosting
```

L'app sera accessible sur `https://belenos-611bd.web.app`. `.firebaserc`
et la section `hosting` de `firebase.json` sont déjà configurés (dossier
public = racine du dépôt, fichiers non-web comme `CLAUDE.md`/`firestore.
rules`/`scripts/`/`functions/` exclus). Ne pas oublier les étapes de
"Publier une mise à jour" ci-dessus (bump `VERSION`/`CACHE_STATIC`) avant
de déployer un changement visible.

## État du projet

Voir `CLAUDE.md` — chantier 5 (bascule de logo Agnyra/caserne) fait,
chantiers 1, 4 (volet équipier) et 6 (Cloud Function, migration complète)
encore ouverts.
