# Native distribution notices

The package preserves dependency packages in full, including their LICENSE/COPYING/NOTICE/README files and package.json authorship. `Resources/build.json` records the exact names, versions, license declarations and directories. Font licenses and asset provenance remain under `Resources/public/`.

Supplemental upstream notices (retrieved 2026-11-07):

- Bun 1.4.4: https://github.com/oven-sh/bun/blob/bun-v1.4.4/LICENSE.md (runtime dependencies and JavaScriptCore relinking instructions).
- SDL 2.32.8: https://github.com/libsdl-org/SDL/blob/release-2.32.8/LICENSE.txt
- ANGLE chromium/7151 (native-gles's configured kivy build): https://github.com/google/angle/blob/chromium/7151/LICENSE
- webgl-node 1.6.2: https://github.com/monteslu/webgl-node/blob/v1.6.2/LICENSE
- Yoga 3.2.1: https://github.com/facebook/yoga/blob/v3.2.1/LICENSE
- data-uri-to-buffer 4.0.1: license section of https://github.com/TooTallNate/node-data-uri-to-buffer/blob/4.0.1/README.md
- sharp-libvips 1.2.4: https://github.com/lovell/sharp-libvips/blob/v1.2.4/THIRD-PARTY-NOTICES.md (the package retains `versions.json` identifying the libraries in the binary).
- Generic MIT text: https://github.com/spdx/license-list-data/blob/main/text/MIT.txt

`native-gles@0.7.1` declares MIT in package.json and README but its npm package and upstream v0.7.1 tag have no copyright/license text. Its unmodified package metadata, README and source files are preserved; generic MIT text is supplied here without inventing an upstream copyright attribution. Obtain the missing upstream notice before a public release. This is an acknowledged notice gap, not a claim of completed distribution compliance.

`runtime/application.mjs` is the complete compiler input. To relink with a locally rebuilt, compatible Bun/JSC, run that Bun's `build --compile --compile-autoload-package-json --no-compile-autoload-dotenv --no-compile-autoload-bunfig --no-compile-autoload-tsconfig` on this file, outputting `Contents/MacOS/poketone`. Keep Resources intact. External native libraries can be replaced independently at the paths recorded in build.json.
