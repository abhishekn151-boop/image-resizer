/* ---------------------------------------------------------
 * utils.js
 * Helper utilities for image loading, metadata, units,
 * EXIF orientation, and safe canvas operations.
 * --------------------------------------------------------- */


/* ---------------------------------------------------------
 * 1. Read image file → HTMLImageElement
 * --------------------------------------------------------- */
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;

    // Convert file to blob URL
    const url = URL.createObjectURL(file);
    img.src = url;
  });
}


/* ---------------------------------------------------------
 * 2. Read File as ArrayBuffer
 * --------------------------------------------------------- */
export function readFileBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}


/* ---------------------------------------------------------
 * 3. Extract EXIF Orientation (auto rotate images)
 * --------------------------------------------------------- */
export async function getExifOrientation(file) {
  try {
    const buffer = await readFileBuffer(file);
    const view = new DataView(buffer);

    if (view.getUint16(0, false) !== 0xFFD8) return -1; // Not a JPEG

    let offset = 2;
    const length = view.byteLength;

    while (offset < length) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      if (marker === 0xFFE1) {
        const exifLength = view.getUint16(offset, false);
        offset += 2;

        if (view.getUint32(offset, false) !== 0x45786966) return -1; // "Exif"
        offset += 6;

        const tiffOffset = offset;
        const little = view.getUint16(tiffOffset, false) === 0x4949;
        const dirOffset = view.getUint32(tiffOffset + 4, little);

        let entries = view.getUint16(tiffOffset + dirOffset, little);
        let entryOffset = tiffOffset + dirOffset + 2;

        for (let i = 0; i < entries; i++) {
          const tag = view.getUint16(entryOffset, little);

          if (tag === 0x0112) {
            const value = view.getUint16(entryOffset + 8, little);
            return value;
          }

          entryOffset += 12;
        }
      } else if ((marker & 0xFF00) !== 0xFF00) break;
      else offset += view.getUint16(offset, false);
    }
  } catch (e) {}

  return -1;
}


/* ---------------------------------------------------------
 * 4. Apply EXIF orientation using canvas
 * --------------------------------------------------------- */
export function applyOrientation(canvas, orientation) {
  if (orientation <= 1) return canvas; // No rotation needed

  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");

  // New rotated canvas
  const newCanvas = document.createElement("canvas");
  const newCtx = newCanvas.getContext("2d");

  if (orientation === 6 || orientation === 8) {
    newCanvas.width = h;
    newCanvas.height = w;
  } else {
    newCanvas.width = w;
    newCanvas.height = h;
  }

  switch (orientation) {
    case 2: newCtx.scale(-1, 1); newCtx.drawImage(canvas, -w, 0); break;           // Mirror X
    case 3: newCtx.rotate(Math.PI); newCtx.drawImage(canvas, -w, -h); break;       // 180°
    case 4: newCtx.scale(1, -1); newCtx.drawImage(canvas, 0, -h); break;           // Mirror Y
    case 5: newCtx.rotate(0.5 * Math.PI); newCtx.scale(1, -1); newCtx.drawImage(canvas, 0, -h); break;
    case 6: newCtx.rotate(0.5 * Math.PI); newCtx.drawImage(canvas, 0, -h); break;  // 90° CW
    case 7: newCtx.rotate(0.5 * Math.PI); newCtx.scale(-1, 1); newCtx.drawImage(canvas, -w, -h); break;
    case 8: newCtx.rotate(-0.5 * Math.PI); newCtx.drawImage(canvas, -w, 0); break; // 90° CCW
  }

  return newCanvas;
}


/* ---------------------------------------------------------
 * 5. Convert resize units
 * --------------------------------------------------------- */

export function convertResize(width, height, type, imgW, imgH) {
  if (type === "px") {
    return { w: width || imgW, h: height || imgH };
  }

  if (type === "percent") {
    const w = width ? (imgW * (width / 100)) : imgW;
    const h = height ? (imgH * (height / 100)) : imgH;
    return { w: Math.round(w), h: Math.round(h) };
  }

  if (type === "longest") {
    const maxSide = width || imgW;
    const ratio = imgW > imgH ? maxSide / imgW : maxSide / imgH;
    return {
      w: Math.round(imgW * ratio),
      h: Math.round(imgH * ratio)
    };
  }

  return { w: imgW, h: imgH };
}


/* ---------------------------------------------------------
 * 6. Convert canvas → Blob
 * --------------------------------------------------------- */
export function canvasToBlob(canvas, mime, quality = 0.8) {
  return new Promise(resolve =>
    canvas.toBlob(blob => resolve(blob), mime, quality)
  );
}


/* ---------------------------------------------------------
 * 7. Format file size readable
 * --------------------------------------------------------- */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}


/* ---------------------------------------------------------
 * 8. Format dimensions
 * --------------------------------------------------------- */
export function formatDim(w, h) {
  return `${w} × ${h}px`;
}


/* ---------------------------------------------------------
 * 9. Create object URL safely
 * --------------------------------------------------------- */
export function safeURL(blob) {
  return URL.createObjectURL(blob);
}


/* ---------------------------------------------------------
 * 10. Safe async wrapper
 * --------------------------------------------------------- */
export function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}
