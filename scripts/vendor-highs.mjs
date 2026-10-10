import { copyFile, mkdir } from "node:fs/promises";

// Copy the installed solver and its licence into the site's vendor folder.
await mkdir(new URL("../vendor/highs/", import.meta.url), { recursive: true });
await Promise.all([
  ["../node_modules/highs/build/highs.mjs", "../vendor/highs/highs.mjs"],
  ["../node_modules/highs/build/highs.wasm", "../vendor/highs/highs.wasm"],
  ["../node_modules/highs/LICENSE", "../vendor/highs/LICENSE"]
].map(([source, destination]) => copyFile(new URL(source, import.meta.url), new URL(destination, import.meta.url))));
