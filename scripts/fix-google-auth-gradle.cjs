// Patches @codetrix-studio/capacitor-google-auth to fix Gradle compatibility issues:
// 1. jcenter() → mavenCentral() (jcenter removed in newer Gradle)
// 2. proguard-android.txt → proguard-android-optimize.txt (required by newer AGP)
// This runs automatically via the "postinstall" npm script.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', '@codetrix-studio', 'capacitor-google-auth', 'android', 'build.gradle');

if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, 'utf8');
  let patched = false;

  if (content.includes('jcenter()')) {
    content = content.replace(/jcenter\(\)/g, 'mavenCentral()');
    patched = true;
  }

  if (content.includes("proguard-android.txt")) {
    content = content.replace(/proguard-android\.txt/g, 'proguard-android-optimize.txt');
    patched = true;
  }

  if (patched) {
    fs.writeFileSync(file, content);
    console.log('[fix-google-auth-gradle] Patched jcenter + proguard issues');
  }
}
