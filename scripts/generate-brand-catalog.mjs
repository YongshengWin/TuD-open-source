import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(projectRoot, "node_modules/simple-icons/data/simple-icons.json");
const packagePath = resolve(projectRoot, "node_modules/simple-icons/package.json");
const outputPath = resolve(projectRoot, "lib/generated/brand-catalog.json");
const versionOutputPath = resolve(projectRoot, "lib/generated/brand-version.ts");
const sourceIconsPath = resolve(projectRoot, "node_modules/simple-icons/icons");
const outputIconsRoot = resolve(projectRoot, "public/brands/simple");

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const { version } = JSON.parse(await readFile(packagePath, "utf8"));
const outputIconsPath = resolve(outputIconsRoot, version);
const icons = source.map((icon) => {
  const aliases = [
    ...(icon.aliases?.aka ?? []),
    ...Object.values(icon.aliases?.loc ?? {}),
    ...(icon.aliases?.dup ?? []).flatMap((entry) => [entry.title, ...(entry.loc ? Object.values(entry.loc) : [])]),
  ].filter((value) => typeof value === "string" && value.trim());

  return {
    title: icon.title,
    slug: icon.slug,
    hex: icon.hex,
    ...(aliases.length ? { aliases } : {}),
  };
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ version, icons })}\n`);
await writeFile(versionOutputPath, `export const SIMPLE_ICONS_VERSION = ${JSON.stringify(version)};\n`);

await rm(outputIconsRoot, { recursive: true, force: true });
await mkdir(outputIconsPath, { recursive: true });
await cp(sourceIconsPath, outputIconsPath, { recursive: true });
console.log(`Generated ${icons.length} searchable brands and local SVG assets for Simple Icons ${version}`);
