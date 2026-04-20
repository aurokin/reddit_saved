const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const runtimeFiles = [
  "app-config.js",
  "background.js",
  "cookies.js",
  "popup.html",
  "popup.js",
  "README.md",
];
const targets = [
  { name: "chrome", manifest: "manifest.json" },
  { name: "firefox", manifest: "manifest.firefox.json" },
];

fs.rmSync(distDir, { recursive: true, force: true });

for (const target of targets) {
  const targetDir = path.join(distDir, target.name);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of runtimeFiles) {
    fs.copyFileSync(path.join(rootDir, file), path.join(targetDir, file));
  }
  fs.copyFileSync(path.join(rootDir, target.manifest), path.join(targetDir, "manifest.json"));
}
