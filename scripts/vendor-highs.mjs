import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../vendor/highs/", import.meta.url), { recursive: true });
await Promise.all([
  ["../node_modules/highs/build/highs.mjs", "../vendor/highs/highs.mjs"],
  ["../node_modules/highs/build/highs.wasm", "../vendor/highs/highs.wasm"],
  ["../node_modules/highs/LICENSE", "../vendor/highs/LICENSE"]
].map(([source, destination]) => copyFile(new URL(source, import.meta.url), new URL(destination, import.meta.url))));
