#!/bin/bash
echo "📦 Démarrage de SkAItch en mode PRODUCTION..."

echo "1/2 - Compilation du projet (Build)..."
npm run build

if [ $? -eq 0 ]; then
  echo "2/2 - Lancement du serveur de prévisualisation..."
  npm run preview
else
  echo "❌ Erreur lors de la compilation. Le serveur n'a pas pu démarrer."
  exit 1
fi
