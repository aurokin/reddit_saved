import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateBinaryEntryModule,
  generateManifestModule,
  listDistFiles,
} from "../scripts/embed-web-assets";

describe("listDistFiles", () => {
  let distDir: string;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), "reddit-cached-embed-"));
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  test("lists files recursively as sorted dist-relative paths", () => {
    mkdirSync(join(distDir, "assets"), { recursive: true });
    writeFileSync(join(distDir, "index.html"), "<html></html>");
    writeFileSync(join(distDir, "favicon.svg"), "<svg/>");
    writeFileSync(join(distDir, "assets", "index-abc123.js"), "console.log(1);");
    writeFileSync(join(distDir, "assets", "index-abc123.css"), "body{}");

    expect(listDistFiles(distDir)).toEqual([
      "assets/index-abc123.css",
      "assets/index-abc123.js",
      "favicon.svg",
      "index.html",
    ]);
  });

  test("excludes sourcemaps", () => {
    mkdirSync(join(distDir, "assets"), { recursive: true });
    writeFileSync(join(distDir, "index.html"), "<html></html>");
    writeFileSync(join(distDir, "assets", "index-abc123.js"), "console.log(1);");
    writeFileSync(join(distDir, "assets", "index-abc123.js.map"), "{}");

    expect(listDistFiles(distDir)).toEqual(["assets/index-abc123.js", "index.html"]);
  });

  test("returns an empty list for an empty dist", () => {
    expect(listDistFiles(distDir)).toEqual([]);
  });
});

describe("generateManifestModule", () => {
  test("emits one type:file import per dist file and a pathname-keyed manifest", () => {
    const module = generateManifestModule(
      ["assets/index-abc123.js", "index.html"],
      "../../web/dist",
    );

    expect(module).toContain(
      'import asset_0 from "../../web/dist/assets/index-abc123.js" with { type: "file" };',
    );
    expect(module).toContain(
      'import asset_1 from "../../web/dist/index.html" with { type: "file" };',
    );
    expect(module).toContain('"/assets/index-abc123.js": asset_0 as unknown as string,');
    expect(module).toContain('"/index.html": asset_1 as unknown as string,');
    expect(module).toContain("export const manifest: AssetManifest = {");
  });
});

describe("generateBinaryEntryModule", () => {
  test("registers the manifest before booting the CLI entry", () => {
    const module = generateBinaryEntryModule();
    const registerIdx = module.indexOf("setEmbeddedAssets(manifest);");
    const bootIdx = module.indexOf('await import("./index");');

    expect(registerIdx).toBeGreaterThan(-1);
    expect(bootIdx).toBeGreaterThan(registerIdx);
  });
});
