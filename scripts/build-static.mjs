import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStaticHtml } from "./sanitize-static-html.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const staticEntries = [
  "index.html",
  "brand-override.js",
  "videos.html",
  "_routes.json",
  "assets",
  "videos",
  "herramienta",
  "campus",
  "curso",
  "gracias",
  "comparar",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of staticEntries) {
  if (entry === "index.html") {
    const source = await readFile(resolve(root, entry), "utf8");
    await writeFile(resolve(output, entry), sanitizeStaticHtml(source), "utf8");
    continue;
  }
  await cp(resolve(root, entry), resolve(output, entry), {
    recursive: true,
    filter: (source) => !source.endsWith(".DS_Store"),
  });
}
