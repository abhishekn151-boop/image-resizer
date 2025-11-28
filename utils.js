// utils.js
// Utilities used by app.js for loading images, EXIF, canvas<->blob conversions,
// and the compressCanvasToTarget helper.

/* ---------- image loading helpers ---------- */
export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;

    if (typeof fileOrUrl === "string") {
      img.src = fileOrUrl;
    } else {
      img.src = URL.createObjectURL(fileOrUrl);
    }
  });
}

/* ---------- EXIF orientation reader (JPEG only) ---------- */
export async function getExifOrientation(file) {
  if (!file || !file.type.includes("jpeg") && !file.type.includes("jpg")) return 1;

  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  if (view.getUint16(0, false) !== 0xFFD8) return 1; // not JPEG

  let offset = 2;
  const length = view.byteLength;

  while (offset < length) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xFFE1) { // APP1
      if (view.getUint32(offset + 2, false) !== 0x45786966) break; // "Exif"
      const little = view.getUint16(offset + 8, false) === 0x4949;
      let tiff = offset + 10;

      const tags = view.getUint16(tiff + 2, little);
      let dir = tiff + 4;

      for (let i = 0; i < tags; i++) {
        const tag = view.getUint16(dir + i * 12, little);
        if (tag === 0x0112) {
          return view.getUint16(dir + i * 12 + 8, little);
        }
      }
      break;
    } else {
      offset += view.getUint16(offset, false);
    }
  }
  return 1;
}

/* ---------- Apply EXIF orientation to canvas ---------- */
export function applyOrientation(canvas, orientation) {
  if (orientation === 1) return canvas;

  const w = canvas.width;
  const h = canvas.height;

  const out = document.createElement("canvas");
  const ctx = out.getContext("2d");

  if ([5,6,7,8].includes(orientation)) {
    out.width = h;
    out.height = w;
  } else {
    out.width = w;
    out.height = h;
  }

  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
  }

  ctx.drawImage(canvas, 0, 0);
  return out;
}

/* ---------- canvas <-> blob helpers ---------- */
export function canvasToBlob(canvas, mime = "image/jpeg", quality = 0.92) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        // Safari fallback
        const dataURL = canvas.toDataURL(mime, quality);
        resolve(dataURLToBlob(dataURL));
      }
    }, mime, quality);
  });
}

// helper
function dataURLToBlob(dataURL) {
  const parts = dataURL.split(",");
  const byteString = atob(parts[1]);
  const mime = parts[0].split(":")[1].split(";")[0];

  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDim(w, h) {
  return `${w} × ${h}px`;
}

export function safeURL(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return URL.createObjectURL(obj);
}

/* ---------- Extract DPI from JPEG (fallback 96 DPI) ---------- */
export async function getImageDPI(file) {
  try {
    if (!file || !file.type) return 96;
    const type = file.type.toLowerCase();
    if (!type.includes("jpeg") && !type.includes("jpg")) return 96;

    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // Check SOI
    if (view.getUint16(0, false) !== 0xFFD8) return 96;

    let offset = 2;
    const length = view.byteLength;

    while (offset < length) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      const size = view.getUint16(offset, false);

      // APP0 JFIF marker
      if (marker === 0xFFE0) {
        // Check "JFIF"
        if (view.getUint32(offset + 2, false) === 0x4A464946) {
          const units = view.getUint8(offset + 7); // 1 = DPI, 2 = Dots/cm
          const xDensity = view.getUint16(offset + 8, false);

          if (units === 1 && xDensity > 0) return xDensity;        // DPI
          if (units === 2 && xDensity > 0) return Math.round(xDensity * 2.54); // Convert dp/cm → DPI
        }
      }

      offset += size;
    }
  } catch (e) {}

  return 96; // fallback
}

/* ---------- Resize / Dimension Helper ---------- */
export function convertResize(wVal, hVal, type, imgW, imgH, dpi = 96) {

  // Resize by pixels
  if (type === "px") {
    return {
      w: wVal || imgW,
      h: hVal || imgH
    };
  }

  // Resize by percent ( with aspect-ratio preservation )
if (type === "percent") {

  // If only width% is given → scale everything equally
  if (wVal && !hVal) {
    const scale = wVal / 100;
    return {
      w: imgW * scale,
      h: imgH * scale,
    };
  }

  // If only height% is given → scale everything equally
  if (hVal && !wVal) {
    const scale = hVal / 100;
    return {
      w: imgW * scale,
      h: imgH * scale,
    };
  }

  // If both provided → apply separately
  return {
    w: imgW * (wVal / 100),
    h: imgH * (hVal / 100),
  };
}

  // Resize by centimeters (true DPI)
if (type === "cm") {
  const PX_PER_CM = dpi / 2.54; // dpi comes from app.js

  const newW = wVal ? Math.round(wVal * PX_PER_CM) : imgW;
  const newH = hVal ? Math.round(hVal * PX_PER_CM) : imgH;

  return { w: newW, h: newH };
}
  
  // Fallback
  return { w: imgW, h: imgH };
}

/* ---------- SMART TARGET-SIZE COMPRESSION (OPTION C) ---------- */
export async function compressCanvasToTarget(canvas, options = {}) {
  const {
    mime = "image/jpeg",
    targetBytes = 0,
    maxIterations = 12,
    tolerance = 0.03
  } = options;

  if (!targetBytes || mime === "image/png") {
    const blob = await canvasToBlob(canvas, mime, 1);
    return {
      blob,
      achievedBytes: blob.size,
      width: canvas.width,
      height: canvas.height
    };
  }

  let low = 0.1;
  let high = 0.98;

  let best = null;
  let bestDiff = Infinity;

  for (let i = 0; i < maxIterations; i++) {
    const q = (low + high) / 2;

    const blob = await canvasToBlob(canvas, mime, q);
    const size = blob.size;
    const diff = Math.abs(size - targetBytes);

    if (diff < bestDiff) {
      bestDiff = diff;
      best = { blob, size };
    }

    if (size > targetBytes) {
      high = q;
    } else {
      low = q;
    }

    if (diff / targetBytes <= tolerance) break;
  }

  return {
    blob: best.blob,
    achievedBytes: best.size,
    width: canvas.width,
    height: canvas.height
  };
}
