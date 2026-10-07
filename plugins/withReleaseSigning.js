const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Signs release builds with the EigenAge key when the machine has it, and
 * with the debug key otherwise, so anyone can still build the repo.
 *
 * The key and its passwords never enter the repo: they are read from Gradle
 * properties (`~/.gradle/gradle.properties`):
 *
 *   EIGENAGE_STORE_FILE, EIGENAGE_STORE_PASSWORD,
 *   EIGENAGE_KEY_ALIAS, EIGENAGE_KEY_PASSWORD
 *
 * `android/` is generated (`expo prebuild`), so the signing lives here rather
 * than in its build.gradle.
 */
const MARK = "// EigenAge release signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (g.includes(MARK)) return c;
    g = g.replace(
      /signingConfigs \{\n/,
      `signingConfigs {
        ${MARK}
        if (project.hasProperty('EIGENAGE_STORE_FILE')) {
            release {
                storeFile file(EIGENAGE_STORE_FILE)
                storePassword EIGENAGE_STORE_PASSWORD
                keyAlias EIGENAGE_KEY_ALIAS
                keyPassword EIGENAGE_KEY_PASSWORD
            }
        }
`,
    );
    g = g.replace(
      /(release \{\n\s*\/\/ Caution![^\n]*\n[^\n]*\n\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('EIGENAGE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    c.modResults.contents = g;
    return c;
  });
};
