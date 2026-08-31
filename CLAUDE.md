# Belenos — Contexte du projet

## Qu'est-ce que c'est

Belenos est une refonte multi-tenant de l'application de gestion de tournée de
calendriers utilisée par les amicales de sapeurs-pompiers volontaires en
France. Elle est dérivée du code d'une application mono-tenant déjà en
production pour l'Amicale des Sapeurs-Pompiers de Pacy-sur-Eure.

Le nom référence Belenos, divinité gauloise du feu et du soleil, dont le
culte est attesté sur le sol français.

**Objectif final** : un seul site, une seule base Firebase, plusieurs
casernes cloisonnées par organisation (au lieu d'une installation séparée
par caserne comme aujourd'hui).

## Décisions déjà prises (ne pas remettre en question sans discussion)

- **Architecture** : multi-tenant single-site, isolation des données par
  `organisationId` dans Firestore (pas d'instance séparée par caserne).
- **Logo** : roue solaire blanche à huit rayons se terminant en flammes,
  sur fond rouge. Généré dans toutes les tailles nécessaires (`icons/`).
- **Logique de marque** :
  - Le logo **Belenos** s'affiche sur l'écran de connexion, fixe, comme
    identité du produit (indépendant de la caserne).
  - Une fois connecté, chaque utilisateur voit le logo **de sa caserne**
    (choix du membre, sidebar admin, exports PDF, fiches, notifications).
- **Migration** : les données de production actuelles (une seule caserne,
  Pacy-sur-Eure) seront migrées vers une `organisation Pacy` au moment du
  basculement en prod.

## Les six chantiers du multi-tenant

1. **Collection `organisations`** (nom, logo, couleur par caserne) — *à faire*
2. **Rattacher `secteurs` / `équipes` / `passages` à un `organisationId`** — *à faire*
3. **Identification de la caserne à la connexion** (PIN global ou code
   caserne) — *à faire*
4. **Règles de sécurité Firestore cloisonnant les données par organisation**
   — *à faire, chantier le plus sensible, à tester à fond avant toute prod*
5. **Bascule de logo (Belenos → logo caserne) après connexion** — ✅ **fait**
   (voir détail ci-dessous)
6. **Migration des données Pacy vers une organisation "Pacy"** — *à faire,
   au moment du cutover*

L'ordre de traitement retenu : commencer par le point 5 (le plus visible,
le moins risqué), puis attaquer les points 1 à 4 dans l'ordre, le point 4
demandant le plus de prudence.

## État détaillé du chantier 5 (fait)

Dans `js/app.js` :
- `const LOGO_BELENOS` — logo produit fixe (roue solaire), utilisé
  **uniquement** dans `renderLogin()`.
- `const LOGO_CASERNE_ACTUELLE` (renommage de l'ancien `LOGO_SP`) — logo de
  la caserne connectée, utilisé partout après authentification : choix du
  membre (`afficherChoixMembre`), sidebar admin (`layoutAdmin`), export PDF
  (`pdf.js` / `logoBase64`), fiche secteur, notifications de résumé
  quotidien.
- **TODO explicite dans le code** : `LOGO_CASERNE_ACTUELLE` est pour
  l'instant une valeur figée (le logo Pacy). Elle devra être remplacée par
  une valeur chargée dynamiquement depuis la collection `organisations`
  quand le chantier 1 sera fait.

Bug corrigé au passage : les 15 fichiers d'icônes (`icons/*.png`) étaient en
réalité du **JPEG renommé en `.png`**, sans transparence, à des dimensions
ne correspondant pas à leur nom de fichier (ex. `icon192.png` faisait
196×196 px réels). Réencodés en vrai PNG aux tailles exactes annoncées —
un vrai mismatch aurait pu bloquer l'installabilité PWA sous Chrome.

Fichiers mis à jour en conséquence : `manifest.json`, `index.html`, `sw.js`
(version de cache incrémentée), `build.py` (bloc `<head>` dupliqué).

## Points ouverts / non tranchés

- **Couleur** : le rouge exact du logo est `#B81C1D`, le rouge de l'app
  (`--rouge`, `theme_color`) est `#CC1D1D`. Proches mais pas identiques.
  Aucune harmonisation faite pour l'instant.
- **`start_url` / `scope` / `id` du manifest** : toujours
  `/calendriers-sp-pacy-v2/`, hérité de l'ancien dépôt. À décider si Belenos
  aura un nouveau chemin/domaine de déploiement propre.
- **Chemins des icônes** : les fichiers sont référencés sans tiret
  (`icons/icon192.png`) alors que l'ancien `manifest.json` utilisait des
  tirets (`icons/icon-192.png`). À confirmer que la structure de dossier
  réelle du dépôt correspond.

## Structure du code

Build modulaire → fichier unique. Ne jamais éditer `index-monofichier.html`
directement : c'est un artefact généré, régénéré par `build.py` à partir de
`css/style.css` et des modules `js/*.js`.

```
css/style.css
js/firebase.js, secteurs.js, tournee.js, carte.js, historique.js,
   gamification.js, pdf.js, vocal.js, geoloc.js, install.js, maj.js,
   notifications.js, journal.js, app.js   (14 modules, app.js en dernier)
build.py                → génère index-monofichier.html
index.html               → shell de dev, charge les modules directement
manifest.json, sw.js
icons/                    → 15 tailles (icon48 → icon512, maskable192/512, favicon32)
```

Après toute modification des modules, relancer `python3 build.py` pour
regénérer le monofichier avant de tester/déployer.

## Outils & infra

- **Backend** : Firebase / Firestore, architecture single-site multi-tenant
- **Build** : script Python maison (`build.py`), pas de bundler externe
- **PWA** : service worker (`sw.js`) avec cache versionné
