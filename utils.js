// utils.js
// Utilities used by app.js for loading images, EXIF, canvas<->blob conversions,
// and the new compressCanvasToTarget helper (Option C).

/* ---------- image loading helpers ---------- */
export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    if (typeof fileOrUrl === "string") {
      img.src = fileOrUrl;
    } else {
      img.src = URL.createObjectURL(fileOrUrl);
    }
  });
}

// Simple EXIF orientation reader for JPEG using DataView (safe fallback)
export async function getExifOrientation(file) {
  // only attempt for JPEGs
  if (!file || !file.type || !file.type.includes("jpeg") && !file.type.includes("jpg")) return 1;
  const arr = await file.arrayBuffer();
  const view = new DataView(arr);
  if (view.getUint16(0, false) !== 0xFFD8) return 1; // not JPEG
  let offset = 2, length = view.byteLength;
  while (offset < length) {
    if (view.getUint16(offset + 2, false) <= 8) break;
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xFFE1) { // APP1
      if (view.getUint32(offset += 2, false) !== 0x45786966) break; // "Exif"
      const little = view.getUint16(offset += 6, false) === 0x4949;
      offset += view.getUint32(offset + 4, little);
      const tags = view.getUint16(offset, little);
      offset += 2;
      for (let i = 0; i < tags; i++) {
        const tag = view.getUint16(offset + (i * 12), little);
        if (tag === 0x0112) {
          const orient = view.getUint16(offset + (i * 12) + 8, little);
          return orient;
        }
      }
    } else {
      offset += view.getUint16(offset, false);
    }
  }
  return 1;
}

export function applyOrientation(canvas, orientation) {
  if (!canvas || orientation === 1) return canvas;
  const w = canvas.width, h = canvas.height;
  const out = document.createElement("canvas");
  let ctx = out.getContext("2d");
  if ([5,6,7,8].includes(orientation)) {
    out.width = h; out.height = w;
  } else {
    out.width = w; out.height = h;
  }
  // apply transforms (common mapping)
  switch (orientation) {
    case 2: ctx.transform(-1,0,0,1,w,0); break;
    case 3: ctx.transform(-1,0,0,-1,w,h); break;
    case 4: ctx.transform(1,0,0,-1,0,h); break;
    case 5: ctx.transform(0,1,1,0,0,0); break;
    case 6: ctx.transform(0,1,-1,0,h,0); break;
    case 7: ctx.transform(0,-1,-1,0,h,w); break;
    case 8: ctx.transform(0,-1,1,0,0,w); break;
  }
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/* ---------- canvas <-> blob helpers ---------- */
export function canvasToBlob(canvas, mime = "image/jpeg", quality = 0.92) {
  return new Promise((resolve) => {
    // note: canvas.toBlob may ignore quality for PNG; for PNG we always return full-quality PNG
    canvas.toBlob((b) => resolve(b), mime, quality);
  });
}

export async function blobToUint8Array(blob) {
  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(2)} MB`;
}

export function formatDim(w, h) { return `${w} × ${h}px`; }

export function safeURL(obj) {
  // obj can be blob or file or URL string
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return URL.createObjectURL(obj);
}

/* ---------- iterative compression to hit target bytes (Option C) ---------- */
/*
  compressCanvasToTarget(canvas, { mime, targetBytes, maxIterations, tolerance })
  - Performs binary search on quality for JPEG/WebP
  - If min quality still too large, applies tiny noise layers progressively (very low strength)
    to change entropy slightly without visible artifacts, then retries quality search.
  - Returns { blob, achievedBytes, attempts }.

  Notes:
  - For PNG, it's lossless; the function will skip iterative quality search and return PNG blob.
  - targetBytes is integer (bytes).
*/
export async function compressCanvasToTarget(canvas, options = {}) {
  const {
    mime = "image/jpeg",
    targetBytes = null,
    maxIterations = 12,
    tolerance = 0.03 // 3% tolerance
  } = options;

  if (!targetBytes || targetBytes <= 0 || mime === "image/png") {
    // fallback: single export
    const blob = await canvasToBlob(canvas, mime, 0.92);
    return { blob, achievedBytes: blob.size, attempts: 1 };
  }

  // For JPEG/WebP: binary search quality
  let low = 0.08;
  let high = 0.98;
  let best = null;
  let bestDiff = Infinity;
  let attempts = 0;

  // helper to test a quality
  async function testQuality(q) {
    attempts++;
    const b = await canvasToBlob(canvas, mime, q);
    return b;
  }

  // run binary search up to maxIterations
  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;
    const blob = await testQuality(mid);
    const size = blob.size;
    const diff = size - targetBytes;
    const absDiff = Math.abs(diff);

    // track best
    if (absDiff < bestDiff) {
      bestDiff = absDiff;
      best = { blob, size, quality: mid, iterations: i+1 };
      // early exact break if within tolerance
      if (absDiff / targetBytes <= tolerance) break;
    }

    if (size > targetBytes) {
      // too big -> lower quality
      high = mid;
    } else {
      // too small -> increase quality
      low = mid;
    }
  }

  // if best within tolerance -> return
  if (best && Math.abs(best.size - targetBytes) / targetBytes <= tolerance) {
    return { blob: best.blob, achievedBytes: best.size, attempts };
  }

  // If we couldn't reach target (best still larger than target), try noise fallback
  // Only try small noise additions (very subtle, progressive)
  // We'll create copies of canvas and overlay small Gaussian-like noise at low alpha
  const noiseSteps = [0.004, 0.008, 0.015, 0.03]; // alpha levels — very small
  for (let n = 0; n < noiseSteps.length; n++) {
    const alpha = noiseSteps[n];
    // clone canvas
    const noisy = document.createElement("canvas");
    noisy.width = canvas.width;
    noisy.height = canvas.height;
    const nctx = noisy.getContext("2d");
    nctx.drawImage(canvas, 0, 0);

    // generate noise onto an offscreen ImageData
    const w = noisy.width;
    const h = noisy.height;
    const img = nctx.getImageData(0, 0, w, h);
    const data = img.data;
    // apply very sparse noise: modify only 0.5% pixels (randomly) with tiny values
    const pixelCount = w * h;
    const noisePixels = Math.max(1, Math.round(pixelCount * 0.005)); // 0.5% of pixels
    for (let k = 0; k < noisePixels; k++) {
      const idx = Math.floor(Math.random() * pixelCount) * 4;
      // small noise in [-10,10] scaled by alpha
      const nv = Math.floor((Math.random() * 24 - 12) * alpha);
      data[idx] = Math.min(255, Math.max(0, data[idx] + nv));
      data[idx+1] = Math.min(255, Math.max(0, data[idx+1] + nv));
      data[idx+2] = Math.min(255, Math.max(0, data[idx+2] + nv));
      // leave alpha
    }
    nctx.putImageData(img, 0, 0);

    // try binary search again on this noisy canvas (shorter iterations)
    low = 0.06; high = 0.98;
    best = null;
    bestDiff = Infinity;
    for (let i = 0; i < Math.max(6, Math.floor(maxIterations/2)); i++) {
      const mid = (low + high) / 2;
      attempts++;
      const b = await canvasToBlob(noisy, mime, mid);
      const size = b.size;
      const absDiff = Math.abs(size - targetBytes);
      if (absDiff < bestDiff) {
        bestDiff = absDiff;
        best = { blob: b, size, quality: mid, noiseAlpha: alpha };
        if (absDiff / targetBytes <= tolerance) break;
      }
      if (size > targetBytes) high = mid; else low = mid;
    }

    if (best && Math.abs(best.size - targetBytes) / targetBytes <= tolerance) {
      return { blob: best.blob, achievedBytes: best.size, attempts };
    }

    // track best across noise steps
    if (best) {
      // If it's better than previous global best across steps, keep it
      if (!best.globalBest || Math.abs(best.size - targetBytes) < Math.abs((best.globalBest?.size||Infinity) - targetBytes)) {
        best.globalBest = best;
      }
    }
  }

  // final fallback: return the last best found, or single export if none
  if (best && best.blob) {
    return { blob: best.blob, achievedBytes: best.size, attempts };
  }
  const last = await canvasToBlob(canvas, mime, 0.92);
  return { blob: last, achievedBytes: last.size, attempts };
}
