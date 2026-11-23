import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const tesseract = require.resolve("tesseract.js/package.json");
const requireCore = createRequire(tesseract);
const core = dirname(requireCore.resolve("tesseract.js-core/package.json"));
const model = dirname(require.resolve("@tesseract.js-data/eng/package.json"));
const output = new URL("../public/ocr/", import.meta.url);

await mkdir(output, { recursive: true });
await Promise.all([
  [join(dirname(tesseract), "dist/worker.min.js"), "worker.min.js"],
  [join(dirname(tesseract), "dist/worker.min.js.LICENSE.txt"), "worker.min.js.LICENSE.txt"],
  [join(core, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
  [join(core, "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js"],
  [join(core, "LICENSE"), "LICENSE.txt"],
  [join(model, "4.0.0_best_int/eng.traineddata.gz"), "eng.traineddata.gz"],
].map(([source, name]) => copyFile(source, new URL(name, output))));
