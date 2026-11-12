declare const __ASSET_URLS__: Readonly<Record<string, string>> | undefined;

/** Content-hashed copies of public/{models,art,audio,textures} in a Web release build
 *  (scripts/web-build.mjs); absent in dev, native and tests, which read the files by name. */
const urls = typeof __ASSET_URLS__ === "undefined" ? {} : __ASSET_URLS__;

/**
 * The URL to request for a public asset path. Code always names assets by their plain path; a
 * release build maps it to `name.<hash>.ext`, so changed content gets a new URL that no browser or
 * CDN cache holds, and every hashed file can be cached forever.
 */
export function assetUrl(path: string): string {
  return urls[path] ?? path;
}
