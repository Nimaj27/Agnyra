#!/usr/bin/env bash
# Initialise le dépôt Git Belenos et fait le premier commit.
# À exécuter une fois, depuis la racine de ce dossier, après extraction du zip.
#
# Usage :
#   chmod +x setup.sh
#   ./setup.sh
#
# Optionnel : donner l'URL du remote en argument pour le connecter et pousser direct
#   ./setup.sh git@github.com:tonuser/belenos.git

set -euo pipefail

if [ -d ".git" ]; then
  echo "→ Un dépôt Git existe déjà ici. Rien à initialiser."
else
  echo "→ Initialisation du dépôt Git..."
  git init
  git branch -M main
fi

echo "→ Ajout des fichiers..."
git add .

if git diff --cached --quiet; then
  echo "→ Rien à committer (fichiers déjà identiques au dernier commit)."
else
  git commit -m "Initial commit — Belenos, chantier 5 (bascule logo Belenos/caserne) fait

- Logo Belenos fixe sur l'écran de connexion (LOGO_BELENOS)
- Logo caserne après authentification (LOGO_CASERNE_ACTUELLE, ex-LOGO_SP)
- Icônes PWA corrigées (JPEG mal étiqueté .png -> vrai PNG, tailles exactes)
- manifest.json / index.html / sw.js / build.py alignés sur l'identité Belenos

Chantiers restants : voir CLAUDE.md (points 1-4 et 6)"
  echo "→ Commit initial créé."
fi

if [ "${1:-}" != "" ]; then
  echo "→ Connexion au remote $1..."
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$1"
  else
    git remote add origin "$1"
  fi
  echo "→ Push vers origin main..."
  git push -u origin main
  echo "✅ Dépôt initialisé et poussé vers $1"
else
  echo "✅ Dépôt initialisé localement."
  echo "   Pour le connecter à GitHub :"
  echo "   git remote add origin <url-de-ton-repo>"
  echo "   git push -u origin main"
fi
