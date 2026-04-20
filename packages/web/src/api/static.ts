import { extname, isAbsolute, relative, resolve } from "node:path";

/** Route-like URLs should fall back to index.html; asset/file requests should not. */
export function shouldServeSpaFallback(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/assets/")) return false;
  return extname(pathname) === "";
}

/** Resolve a request pathname beneath dist/ without allowing absolute-path or
 *  traversal escapes. Returns null for the root route or invalid paths. */
export function resolveDistAssetPath(distDir: string, pathname: string): string | null {
  if (pathname === "/") return null;

  const relativePath = pathname.replace(/^\/+/, "");
  if (!relativePath) return null;

  const assetPath = resolve(distDir, relativePath);
  const relativeToDist = relative(distDir, assetPath);
  if (relativeToDist.startsWith("..") || isAbsolute(relativeToDist)) {
    return null;
  }

  return assetPath;
}
