export type ImageRegion = { x: number; y: number; width: number; height: number };

// Bright horizontal components give OCR a close-up when the original shows the whole car.
export function findPlateRegions(gray: Uint8Array, width: number, height: number): ImageRegion[] {
  const visited = new Uint8Array(gray.length);
  const queue = new Int32Array(gray.length);
  const candidates: { box: ImageRegion; score: number }[] = [];
  for (const threshold of [115, 145]) {
    visited.fill(0);
    for (let index = 0; index < gray.length; index++) {
      if (visited[index] || gray[index] < threshold) continue;
      let left = width, right = 0, top = height, bottom = 0, brightness = 0, end = 0;
      function add(pixel: number) {
        if (visited[pixel] || gray[pixel] < threshold) return;
        visited[pixel] = 1;
        queue[end++] = pixel;
      }
      add(index);
      for (let head = 0; head < end; head++) {
        const pixel = queue[head];
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        brightness += gray[pixel];
        if (x > 0) add(pixel - 1);
        if (x < width - 1) add(pixel + 1);
        if (y > 0) add(pixel - width);
        if (y < height - 1) add(pixel + width);
      }
      const w = right - left + 1, h = bottom - top + 1;
      const fill = end / (w * h);
      if (w < 26 || h < 6 || w > width * .94 || w / h < 2.8 || w / h > 6.6 || fill < .44) continue;
      const margin = Math.max(2, Math.floor(h / 5));
      let neighboring = 0, samples = 0;
      for (let y = Math.max(0, top - margin); y <= Math.min(height - 1, bottom + margin); y++) {
        for (let x = Math.max(0, left - margin); x <= Math.min(width - 1, right + margin); x++) {
          if (x >= left && x <= right && y >= top && y <= bottom) continue;
          neighboring += gray[y * width + x];
          samples++;
        }
      }
      const score = (brightness / end - neighboring / samples) * fill;
      if (score > 18) candidates.push({ box: { x: left, y: top, width: w, height: h }, score });
    }
  }
  const regions: ImageRegion[] = [];
  for (const { box } of candidates.sort((a, b) => b.score - a.score)) {
    // The same plate can be found at both thresholds.
    const duplicate = regions.some(previous => {
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      return x > previous.x && x < previous.x + previous.width && y > previous.y && y < previous.y + previous.height;
    });
    if (!duplicate) regions.push(box);
    if (regions.length === 3) break;
  }
  return regions;
}
