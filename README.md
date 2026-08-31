# Belenos — Gestion de tournée de calendriers

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

## État du projet

Voir `CLAUDE.md` — chantier 5 (bascule de logo Belenos/caserne) fait,
chantiers 1 à 4 et 6 (multi-tenant, sécurité Firestore, migration) à venir.
