# Agnyra — Contexte du projet

## Qu'est-ce que c'est

Agnyra est une refonte multi-tenant de l'application de gestion de tournée de
calendriers utilisée par les amicales de sapeurs-pompiers volontaires en
France. Elle est dérivée du code d'une application mono-tenant déjà en
production pour l'Amicale des Sapeurs-Pompiers de Pacy-sur-Eure.

**Objectif final** : un seul site, une seule base Firebase, plusieurs
casernes cloisonnées par organisation (au lieu d'une installation séparée
par caserne comme aujourd'hui).

## Identité de marque

### Le nom

**AGNYRA** est un nom créé autour de la racine **Agni**, divinité du feu dans
la tradition védique. Le feu constitue le point de départ symbolique de
l'identité de l'application : il fait écho à l'univers des sapeurs-pompiers,
tout en représentant la transmission, la tradition et le lien entre les
personnes. Le nom a volontairement été adapté pour obtenir une identité
moderne et distinctive, adaptée à une application numérique.

### Le logo

Trois éléments principaux :
- **Le casque de sapeur-pompier** — protection, engagement, identité des
  femmes et des hommes auxquels l'application est destinée.
- **La flamme rouge** — rappelle l'origine du nom, symbolise le feu,
  l'énergie et la tradition des sapeurs-pompiers.
- **Le calendrier** — la fonction première de l'application : organiser et
  suivre les campagnes de calendriers, les tournées et leur gestion.

### Les couleurs

- **Rouge** : le feu, l'action, l'univers des sapeurs-pompiers.
- **Anthracite** : la fiabilité, la sobriété, le professionnalisme.
- **Blanc** : la simplicité, la lisibilité, la modernité.

### Accroche

> **AGNYRA — Pilotez vos campagnes calendriers.**

### Statut au 04/09/2026

Le renommage **Belenos → Agnyra** a été fait dans tout le code, les textes et
la configuration (voir liste de fichiers dans "Historique des chantiers"
ci-dessous). **Le nouveau logo est intégré** : `LOGO_AGNYRA` dans `js/app.js`
et les 15 icônes de `icons/` ont été régénérées à partir du fichier fourni
(casque + flamme + calendrier, fond blanc). `sw.js` : `CACHE_STATIC` a été
incrémenté (`sp-static-3` → `sp-static-4`) pour que les installations PWA
existantes récupèrent les nouvelles icônes.

**Nettoyage cosmétique complet** (04/09) : couleur rouge harmonisée sur le
rouge exact du logo Agnyra (`#E50410`, remplace `#CC1D1D` dans
`css/style.css`, `manifest.json`, `index.html`/`build.py`, `js/pdf.js`,
fiche secteur imprimable et carte) ; tous les textes UI qui affichaient
encore "SP Pacy"/"Pacy-sur-Eure" en dur ont été rendus dynamiques
(`APP.organisationNom`) ; en-têtes de commentaires des modules restants
alignés sur "Agnyra".

**Logo de caserne enfin dynamique par organisation** (04/09) : le logo
affiché après connexion n'est plus le même pour toutes les casernes.
`APP.organisationLogo`/`APP.organisationCouleur` sont alimentés à chaque
connexion/changement de caserne (`appliquerOrganisation()`), à partir de
`organisations/{slug}.logoBase64`/`.couleur`. Une caserne sans logo affiche
ses propres initiales sur fond coloré (`logoCaserneHTML()`) au lieu
d'hériter à tort du logo de Pacy. `organisations/pacy.logoBase64` a depuis
été renseigné en base (via un script one-off, exécuté puis supprimé) :
`LOGO_CASERNE_ACTUELLE` et son cas particulier dans
`resoudreLogoOrganisation()` ont été retirés du code, plus aucune caserne
n'a de logo figé en dur.

## Décisions déjà prises (ne pas remettre en question sans discussion)

- **Architecture** : multi-tenant single-site, isolation des données par
  `organisationId` dans Firestore (pas d'instance séparée par caserne).
- **Logique de marque** :
  - Le logo **Agnyra** s'affiche sur l'écran de connexion, fixe, comme
    identité du produit (indépendant de la caserne).
  - Une fois connecté, chaque utilisateur voit le logo **de sa caserne**
    (choix du membre, sidebar admin, exports PDF, fiches, notifications).
- **Migration** : les données de production actuelles (une seule caserne,
  Pacy-sur-Eure) ont été copiées vers `belenos-611bd` avec `organisationId:
  "pacy"` (voir chantier 6) ; `calendrier-pacy` reste l'unique source de
  vérité utilisée par les vrais équipiers tant que le cutover n'est pas
  décidé.
- **Projet Firebase de développement/test** : `belenos-611bd`, distinct du
  projet de production `calendrier-pacy`. Le nom du projet Firebase n'a pas
  été renommé suite au rebranding Agnyra (renommer un projet Firebase
  existant n'est pas trivial) — c'est un identifiant technique, sans
  visibilité utilisateur.

## Les six chantiers du multi-tenant

1. **Collection `organisations`** (nom, logo, couleur par caserne) —
   ✅ **fait**. `creerOrganisation`/`obtenirOrganisation`/`listerOrganisations`
   dans `js/firebase.js`. 3 casernes créées : `pacy`, `ezy`, `saint-andre`.
2. **Rattacher `secteurs` / `équipes` / `passages` à un `organisationId`** —
   ✅ **fait**, câblé de bout en bout (pas juste tagué à la création : les
   lectures sont filtrées par caserne courante via `fsGetAllOrg`/
   `fsListenOrg`, voir "Cloisonnement des lectures" ci-dessous).
3. **Identification de la caserne à la connexion** — ✅ **fait**. Décision
   tranchée : code caserne explicite (pas de PIN global). Équipier et admin
   choisissent leur caserne via une **grille de logos** cliquables
   (`rendreTuileCaserne`, alimentée par `listerOrganisations()`). Un
   super-admin (voir plus bas) choisit sa caserne à chaque session ; un
   admin de caserne classique n'a rien à choisir (`organisationId` fixé sur
   son document `admins/{email}`).
4. **Règles de sécurité Firestore cloisonnant les données par organisation**
   — ⚠️ **fait côté admin, volontairement ouvert côté équipier**.
   - Admin : un admin ne lit/écrit que les données de sa caserne
     (`peutAdministrerOrganisation()` dans `firestore.rules`), avec un rôle
     **super-admin** (`superAdmin:true` sur `admins/{email}`) qui peut
     créer/gérer n'importe quelle caserne.
   - Équipier (session Firebase anonyme via code PIN) : **accès ouvert sans
     vérification de caserne** sur `equipes`/`secteurs`/`passages`/`pins`
     (get/list/create/update). Une session anonyme ne porte aucune info de
     caserne dans son jeton — un cloisonnement robuste demande une **Cloud
     Function** qui vérifie le PIN côté serveur et délivre un jeton avec
     `organisationId`/`equipeId` en claims. Le code de cette fonction existe
     (`functions/verifierCodeEquipe`) mais n'est **pas déployé** : ça exige
     le plan Blaze (payant, même si l'usage réel resterait gratuit), écarté
     tant qu'une seule caserne est réellement active. **À refermer avant
     d'onboarder une vraie 2ᵉ caserne active** (voir marqueur ⚠️ dans
     `firestore.rules`).
   - `historique_saisons` fait exception : cloisonné dès le départ, sans
     compromis (voir chantier archivage plus bas).
5. **Bascule de logo (Agnyra → logo caserne) après connexion** —
   ✅ **fait** (voir détail ci-dessous).
6. **Migration des données Pacy vers une organisation "Pacy"** —
   ✅ **fait pour `equipes`/`secteurs`/`passages`/`pins`/`journal`/`config`**
   (script `scripts/migration-pacy-vers-belenos.html`, lecture seule sur
   `calendrier-pacy`, écriture vers `belenos-611bd`, ID préservés, pins
   re-clés au format `<organisationId>_<pin>`). **`historique_saisons` n'a
   pas été migré.** Ceci reste une préparation/test : `calendrier-pacy`
   continue de servir les vrais équipiers, aucun cutover réel n'a eu lieu.

Chantiers encore ouverts, chacun avec une condition de déclenchement claire
(pas de raison de s'y attaquer avant) :
- **Cloud Function équipier** : avant d'onboarder une vraie 2ᵉ caserne active
  en parallèle de Pacy.
- **Cutover réel** (rebrancher l'app utilisée par les vrais équipiers sur
  `belenos-611bd`) : décision produit séparée, hors du scope de ce dépôt de
  code.
- **Migration de `historique_saisons`** : au moment où ce cutover est décidé.

## Cloisonnement des lectures (au-delà des règles Firestore)

Point distinct des règles de sécurité : même quand les règles autorisent un
accès, le code lui-même doit filtrer par caserne pour que changer de caserne
change ce qui s'affiche. `APP.organisationId` (dans `app.js`) ne suffit pas
à lui seul — un état miroir `organisationCourante()` dans `js/firebase.js`
(mis à jour via `definirOrganisationApp()`) permet à `secteurs.js`/
`tournee.js`/`historique.js` de filtrer leurs lectures sans dépendre de
`APP` :
- `fsGetAllOrg(col)` / `fsListenOrg(col, cb)` : variantes de
  `fsGetAll`/`fsListen` filtrées sur la caserne courante.
- Utilisées partout où l'app lisait une collection entière sans filtre
  (tableau de bord, classement, statistiques, export CSV/PDF).
- **Deux bugs de sécurité des données trouvés et corrigés** en construisant
  ce filtrage : `effacerTousLesPassages()` et `reinitialiserSaison()`
  supprimaient des données de **toutes** les casernes, pas seulement celle
  de l'admin connecté.
- Requêtes déjà scopées par une clé plus précise (`equipeId`, `secteurId`)
  laissées telles quelles — pas de fuite possible, une équipe/secteur
  appartient déjà à une seule caserne par construction.

## État détaillé du chantier 5 (fait)

Dans `js/app.js` :
- `const LOGO_AGNYRA` (ex-`LOGO_BELENOS`) — logo produit fixe, utilisé
  **uniquement** dans `renderLogin()` et `afficherChoixCaserneAdmin()`.
- `APP.organisationLogo`/`APP.organisationCouleur` — logo/couleur de la
  caserne connectée, alimentés par `appliquerOrganisation(org)` à chaque
  connexion/changement de caserne (admin, équipier PIN, choix du
  super-admin), utilisés partout après authentification : choix du membre
  (`afficherChoixMembre`), sidebar admin (`layoutAdmin`), export PDF
  (`pdf.js` / `logoBase64`), fiche secteur, notifications de résumé
  quotidien. `logoCaserneHTML(style)` rend soit l'`<img>` du logo, soit un
  repli en initiales colorées si `organisations/{slug}.logoBase64` est
  vide (même logique que la grille de choix de caserne).
- **Tous les textes** UI qui affichaient "SP Pacy"/"Pacy-sur-Eure" en dur
  (en-tête terrain équipier, export PDF du bilan, fiche secteur
  imprimable, écran de choix du membre) ont été corrigés pour utiliser
  `APP.organisationNom` — y compris pour l'équipier connecté par PIN, dont
  la session ne portait pas encore ce nom (ajout d'une clé
  `sessionStorage.organisationInfo`, alimentée à la connexion et
  restaurée/nettoyée comme `equipe`/`membre`).
- Le nom/logo de la caserne **est** déjà dynamique dans la barre latérale
  admin (`APP.organisationNom`, mis à jour à la connexion/au changement de
  caserne) et dans la grille de choix de caserne (logo ou initiales de
  repli si `logoBase64` est vide).

Bug corrigé au passage (avant le rebranding) : les 15 fichiers d'icônes
(`icons/*.png`) étaient en réalité du **JPEG renommé en `.png`**, sans
transparence, à des dimensions ne correspondant pas à leur nom de fichier.
Réencodés en vrai PNG aux tailles exactes annoncées.

## Points ouverts / non tranchés

- **`start_url` / `scope` / `id` du manifest** : toujours
  `/calendriers-sp-pacy-v2/`, hérité de l'ancien dépôt mono-tenant. Encore
  plus daté depuis le renommage en Agnyra — à décider avec le nouveau
  chemin/domaine de déploiement.

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
firestore.rules           → règles de sécurité (à republier manuellement en console)
functions/                → Cloud Function équipier, écrite mais non déployée
scripts/                  → scripts one-off (seed, migration), à supprimer une fois utilisés
```

Après toute modification des modules, relancer `python3 build.py` pour
regénérer le monofichier avant de tester/déployer. Une CI GitHub Actions
(`.github/workflows/build.yml`) échoue si le monofichier committé n'est pas
à jour, ou si un module a une erreur de syntaxe.

## Outils & infra

- **Backend** : Firebase / Firestore (`belenos-611bd` pour le développement/
  test, `calendrier-pacy` en production réelle), architecture single-site
  multi-tenant
- **Build** : script Python maison (`build.py`), pas de bundler externe
- **PWA** : service worker (`sw.js`) avec cache versionné
- **CI** : GitHub Actions, build + vérification syntaxique à chaque push
