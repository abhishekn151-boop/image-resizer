// utils.js - small helper library for image load, orientation, canvas -> blob
export function safeURL(obj) {
  try {
    return URL.createObjectURL(obj);
  } catch (e) {
    return "";
  }
}

export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B","KB","MB","GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

export function formatDim(w,h) { return `${w} × ${h}px`; }

export function loadImage(fileOrBlob) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = (e) => rej(e);
    img.src = (fileOrBlob instanceof Blob) ? URL.createObjectURL(fileOrBlob) : fileOrBlob;
  });
}

// getExifOrientation: minimal implementation (returns 1 if not jpeg or on failure)
export async function getExifOrientation(file) {
  try {
    if (!file || !file.type || !file.type.includes("jpeg")) return 1;
    const arrayBuffer = await file.arrayBuffer();
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0, false) !== 0xFFD8) return 1;
    let offset = 2, length = view.byteLength;
    while (offset < length) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFE1) {
        const exifLength = view.getUint16(offset, false);
        offset += 2;
        const exifStr = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer, offset, 4));
        if (exifStr !== "Exif") return 1;
        // Not a full EXIF parser here — return 1 to avoid rotation issues in most cases
        return 1;
      } else {
        const size = view.getUint16(offset, false);
        offset += size;
      }
    }
  } catch (e) {
    return 1;
  }
  return 1;
}

export function applyOrientation(canvas, orientation) {
  // simple passthrough for now (we handled most images already)
  return canvas;
}

export function convertResize(wVal, hVal, unit, imgW, imgH) {
  // unit: "px" | "percent" | "longest"
  let w = wVal || null, h = hVal || null;
  if (unit === "percent") {
    const pctW = w ? (w/100) : null;
    const pctH = h ? (h/100) : null;
    return {
      w: pctW ? imgW * pctW : imgW,
      h: pctH ? imgH * pctH : imgH
    };
  } else if (unit === "longest") {
    const target = w || h || imgW;
    if (imgW >= imgH) {
      const scale = target / imgW;
      return { w: imgW * scale, h: imgH * scale };
    } else {
      const scale = target / imgH;
      return { w: imgW * scale, h: imgH * scale };
    }
  } else { // px
    return { w: w || imgW, h: h || imgH };
  }
}

export function canvasToBlob(canvas, mime = "image/jpeg", quality = 0.8) {
  return new Promise((res) => {
    canvas.toBlob((b) => res(b), mime, quality);
  });
}
