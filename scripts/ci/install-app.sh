#!/usr/bin/env bash
# Installs app dependencies exactly like publish-app.yml (public npm + Expo SDK alignment).
set -euo pipefail
cd "$(dirname "$0")/../../app"
TARGET_SDK="${TARGET_SDK:-58}"

rm -f package-lock.json
npm config set registry https://registry.npmjs.org/
npm install --no-audit --no-fund --legacy-peer-deps
CURRENT=$(node -p 'require("expo/package.json").version.split(".")[0]')
if [ "$CURRENT" != "$TARGET_SDK" ]; then
  echo "Upgrading Expo SDK $CURRENT -> $TARGET_SDK to match Expo Go"
  npm install "expo@~$TARGET_SDK.0.0" --no-audit --no-fund --legacy-peer-deps
  CI=1 npx expo install --fix -- --legacy-peer-deps
fi
CI=1 npx expo install expo-updates expo-audio expo-file-system expo-speech expo-notifications expo-image-manipulator expo-document-picker -- --legacy-peer-deps
node -p '"Using expo " + require("expo/package.json").version + ", react-native " + require("react-native/package.json").version'
