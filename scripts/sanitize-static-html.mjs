import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function sanitizeStaticHtml(source) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (script) =>
      script.includes("brand-override.js") || script.includes("meta-pixel.js") ? script : "",
    )
    .replace(/<link\b(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']script["'])[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

const target = process.argv[2];
if (target) {
  const path = resolve(process.cwd(), target);
  const source = await readFile(path, "utf8");
  await writeFile(path, sanitizeStaticHtml(source), "utf8");
}
