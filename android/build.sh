#!/bin/sh
# Compile l'APK « Veille » sans Gradle (utilisé par GitHub Actions, voir .github/workflows/android.yml).
# Variables : ANDROID_HOME, KEYSTORE (chemin), KEYSTORE_PASS, VERSION_CODE, VERSION_NAME.
set -eu
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
VC="${VERSION_CODE:-1}"
VN="${VERSION_NAME:-1.0}"

rm -rf build Veille.apk
mkdir -p build/gen build/classes

echo "1/5 Ressources"
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 35 --version-code "$VC" --version-name "$VN" \
  --java build/gen build/res.zip

echo "2/5 Java"
javac -source 8 -target 8 -Xlint:-options -encoding UTF-8 -bootclasspath "$JAR" -d build/classes \
  $(find src build/gen -name '*.java')

echo "3/5 Dex"
"$BT/d8" --release --min-api 24 --lib "$JAR" --output build $(find build/classes -name '*.class')

echo "4/5 Assemblage"
(cd build && zip -q base.apk classes.dex)
"$BT/zipalign" -p -f 4 build/base.apk build/aligned.apk

echo "5/5 Signature"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass env:KEYSTORE_PASS --out Veille.apk build/aligned.apk
echo "APK : android/Veille.apk (version $VN, code $VC)"
