import assert from "node:assert/strict";
import test from "node:test";
import { plateFromParts } from "../lib/license-plate.ts";
import { findPlateRegions } from "../lib/plate-image.ts";

function picture(draw) {
  const width = 160, height = 110;
  const pixels = new Uint8Array(width * height).fill(41);
  draw((x, y, w, h, gray) => {
    for (let row = y; row < y + h; row++) pixels.fill(gray, row * width + x, row * width + x + w);
  });
  return findPlateRegions(pixels, width, height);
}

test("detects a compact high-contrast plate in a wider vehicle photo", () => {
  const regions = picture(rect => {
    rect(0, 80, 160, 30, 210);
    rect(14, 19, 46, 3, 230);
    rect(90, 56, 41, 9, 165);
    for (let x = 94; x < 128; x += 5) rect(x, 58, 2, 5, 25);
  });
  assert.deepEqual(regions[0], { x: 90, y: 56, width: 41, height: 9 });
});

test("flat photos and wide background bands yield no plate regions", () => {
  assert.deepEqual(picture(rect => rect(0, 80, 160, 30, 210)), []);
});

test("recognizes the main block and region only when both are valid", () => {
  assert.equal(plateFromParts("K 381 CT", "250"), "К381СТ250");
  assert.equal(plateFromParts("P795XK", "16"), "Р795ХК16");
  assert.equal(plateFromParts("P795K", "16"), null);
  assert.equal(plateFromParts("P795XK", "1G"), null);
});
