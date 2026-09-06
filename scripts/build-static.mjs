import {versionStaticAssets} from './version-static-assets.mjs';
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStaticHtml } from "./sanitize-static-html.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const stylesheetEntries = [
  "assets/vendor/323884057c4e3c99.css",
  "assets/vendor/88cf7f98a186df7b.css",
  "assets/vendor/52930a6f13bf476e.css",
  "assets/vendor/e1c393490654a1af.css",
  "assets/vendor/c56943c483505f7c.css",
  "assets/vendor/8305b7da1f1dd502.css",
  "assets/brand-theme.css",
];
const staticEntries = [
  "index.html",
  "brand-override.js",
  "videos.html",
  "_routes.json",
  "_next",
  "assets",
  "videos",
  "herramienta",
  "estudio",
  "editor",
  "productos",
  "cuenta",
  "planes",
  "campus",
  "curso",
  "gracias",
  "comparar",
  "robots.txt",
  "sitemap.xml",
  "404.html",
  "guias",
  "plantilla-guion-anuncio",
  "llms.txt",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of staticEntries) {
  if (entry === "index.html") {
    const source = await readFile(resolve(root, "ecom-index.html"), "utf8");
    const styles = (
      await Promise.all(
        stylesheetEntries.map(async (stylesheet) =>
          readFile(resolve(root, stylesheet), "utf8"),
        ),
      )
    ).join("\n");
    const html = sanitizeStaticHtml(source).replace(
      /<link\b(?=[^>]*\bdata-site-styles=["']true["'])[^>]*>/i,
      `<style data-site-styles="true" data-ae-brand-theme="true">${styles}</style>`,
    );
    await writeFile(resolve(output, entry), html, "utf8");
    continue;
  }
  await cp(resolve(root, entry), resolve(output, entry), {
    recursive: true,
    filter: (source) =>
      !source.endsWith(".DS_Store") &&
      !source.startsWith(resolve(root, "videos", "edit")),
  });
}

const bundledStyles = (
  await Promise.all(
    stylesheetEntries.map(async (stylesheet) =>
      readFile(resolve(root, stylesheet), "utf8"),
    ),
  )
).join("\n");
await writeFile(resolve(output, "assets/site.css"), bundledStyles, "utf8");

await versionStaticAssets(output);
