# Compile l'APK "Veille" sans Gradle : aapt2 + javac + d8 + zipalign + apksigner.
# Usage : powershell -ExecutionPolicy Bypass -File build.ps1 [-Install]
param([switch]$Install, [int]$VersionCode = 1, [string]$VersionName = "1.0")
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$sdk  = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = [Environment]::GetEnvironmentVariable('JAVA_HOME','User') }
$jbin = "$env:JAVA_HOME\bin"
$bt   = "$sdk\build-tools\35.0.0"
$jar  = "$sdk\platforms\android-35\android.jar"
$out  = "$root\build"

function Invoke-Step($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "Echec : $exe" } }

Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out\gen","$out\classes" | Out-Null

# Icônes (récupérées du site si absentes)
foreach ($i in @(@('mipmap-nodpi\ic_launcher.png','icon-512.png'), @('drawable-nodpi\ic_maskable.png','icon-maskable-512.png'))) {
  $f = "$root\res\$($i[0])"
  if (-not (Test-Path $f)) {
    New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null
    Invoke-WebRequest -UseBasicParsing "https://hugosoihier.github.io/veille/icons/$($i[1])" -OutFile $f
  }
}

Write-Host "1/6 Ressources"
Invoke-Step "$bt\aapt2.exe" @('compile','--dir',"$root\res",'-o',"$out\res.zip")
Invoke-Step "$bt\aapt2.exe" @('link','-o',"$out\base.apk",'-I',$jar,'--manifest',"$root\AndroidManifest.xml",
  '--min-sdk-version','24','--target-sdk-version','35','--version-code',"$VersionCode",'--version-name',$VersionName,
  '--java',"$out\gen","$out\res.zip")

Write-Host "2/6 Java"
$src = @(Get-ChildItem -Recurse "$root\src","$out\gen" -Filter *.java | ForEach-Object FullName)
Invoke-Step "$jbin\javac.exe" (@('-source','8','-target','8','-Xlint:-options','-encoding','UTF-8','-bootclasspath',$jar,'-d',"$out\classes") + $src)

Write-Host "3/6 Dex"
$cls = @(Get-ChildItem -Recurse "$out\classes" -Filter *.class | ForEach-Object FullName)
Invoke-Step "$bt\d8.bat" (@('--release','--min-api','24','--lib',$jar,'--output',$out) + $cls)

Write-Host "4/6 Assemblage"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::Open("$out\base.apk", 'Update')
[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, "$out\classes.dex", 'classes.dex')
$z.Dispose()
Invoke-Step "$bt\zipalign.exe" @('-p','-f','4',"$out\base.apk","$out\aligned.apk")

Write-Host "5/6 Signature"
# Clé de signature : A CONSERVER, indispensable pour mettre à jour l'appli déjà installée.
# Jamais dans le dépôt (voir .gitignore). Chemin et mot de passe modifiables par variables d'environnement.
$ks = if ($env:VEILLE_KEYSTORE) { $env:VEILLE_KEYSTORE } else { "$root\veille.keystore" }
$pass = if ($env:VEILLE_KEYSTORE_PASS) { $env:VEILLE_KEYSTORE_PASS } else { 'veille-apk' }
if (-not (Test-Path $ks)) {
  Invoke-Step "$jbin\keytool.exe" @('-genkeypair','-keystore',$ks,'-alias','veille','-keyalg','RSA','-keysize','2048',
    '-validity','10000','-storepass',$pass,'-keypass',$pass,'-dname','CN=Veille')
}
Invoke-Step "$bt\apksigner.bat" @('sign','--ks',$ks,'--ks-pass',"pass:$pass",'--out',"$root\Veille.apk","$out\aligned.apk")
Write-Host "APK : $root\Veille.apk"

if ($Install) {
  Write-Host "6/6 Installation sur la tablette"
  $adb = "$sdk\platform-tools\adb.exe"
  Invoke-Step $adb @('install','-r',"$root\Veille.apk")
  Invoke-Step $adb @('shell','am','start','-n','io.github.hugosoihier.veille/.MainActivity')
}
