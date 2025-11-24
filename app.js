// app.js (ES module)
import {
  loadImage,
  getExifOrientation,
  applyOrientation,
  convertResize,
  canvasToBlob,
  formatSize,
  formatDim,
  safeURL
} from "./utils.js";

import { Cropper } from "./cropper.js";

/* ---------- DOM Elements ---------- */
const fileInput = document.getElementById("fileInput");
const dropArea = document.getElementById("drop-area");
const previewImg = document.getElementById("previewImg");
const previewInfo = document.getElementById("previewInfo");

const resizeTypeEl = document.getElementById("resizeType");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");

const targetSizeInput = document.getElementById("targetSizeKB");
const formatSelect = document.getElementById("formatSelect");

const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const loadingOverlay = document.getElementById("loadingOverlay");

/* ---------- State ---------- */
let currentFile = null;
let currentImage = null;
let currentOrientation = 1; // EXIF orientation

/* Developer sample (optional) */
const SAMPLE_LOCAL_PATH = "/mnt/data/Home Design.png";

/* ---------- UI Helpers ---------- */
function setStatus(text) {
  if (previewInfo) previewInfo.textContent = text;
}
function showLoader() {
  if (loadingOverlay) loadingOverlay.classList.remove("hidden");
}
function hideLoader() {
  if (loadingOverlay) loadingOverlay.classList.add("hidden");
}
function enableDownload(enabled = true) {
  if (!downloadBtn) return;
  downloadBtn.disabled = !enabled;
  downloadBtn.classList.toggle("disabled", !enabled);
}

/* ---------- Drag & Drop + File Input ---------- */
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

["dragenter","dragover","dragleave","drop"].forEach(evt => {
  dropArea && dropArea.addEventListener(evt, preventDefaults, false);
});
["dragenter","dragover"].forEach(() => {
  dropArea && dropArea.addEventListener("dragenter", () => dropArea.classList.add("active"), false);
});
["dragleave","drop"].forEach(() => {
  dropArea && dropArea.addEventListener("dragleave", () => dropArea.classList.remove("active"), false);
});

dropArea && dropArea.addEventListener("drop", (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  handleFiles(dt.files);
}, false);

dropArea && dropArea.addEventListener("click", () => {
  if (fileInput) fileInput.click();
});

fileInput && fileInput.addEventListener("change", (e) => {
  if (fileInput.__droppedFiles && fileInput.__droppedFiles.length) {
    handleFiles(fileInput.__droppedFiles);
    fileInput.__droppedFiles = null;
  } else {
    handleFiles(fileInput.files);
  }
});

/* ---------- Handle Incoming Files ---------- */
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const file = fileList[0];
  if (!file.type || !file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  currentFile = file;
  setStatus("Loading image...");
  try {
    currentOrientation = await getExifOrientation(file).catch(() => 1);
    const img = await loadImage(file);
    currentImage = img;

    // Use object URL for preview
    previewImg.src = safeURL(file);
    previewImg.style.display = "";
    setStatus(`${formatSize(file.size)} • ${img.naturalWidth} × ${img.naturalHeight}px`);
  } catch (err) {
    console.error("Error loading image:", err);
    alert("Could not load the image. See console for details.");
    setStatus("Failed to load image");
  }
  enableDownload(false);
}

/* expose globally for initializer */
window.handleFiles = handleFiles;

/* ---------- Utility: Convert KB to bytes ---------- */
function kbToBytes(kb) {
  return Math.max(0, Math.round(Number(kb) * 1024));
}

/* ---------- Binary-search compressor for lossy formats (JPEG/WebP) ---------- */
/**
 * compressToTargetSize(canvas, mime, targetKB)
 * - canvas: HTMLCanvasElement containing full-resolution image to compress
 * - mime: desired mimetype (image/jpeg or image/webp)
 * - targetKB: integer (KB)
 *
 * Returns a Blob close to requested size (attempts binary search on quality).
 */
async function compressToTargetSize(canvas, mime, targetKB) {
  const targetBytes = kbToBytes(targetKB);
  // quality bounds
  let low = 0.05;
  let high = 0.98;
  let bestBlob = null;
  let bestDiff = Infinity;

  // if target is larger than uncompressed PNG/JPEG baseline, return high quality quickly
  // run up to 12 iterations
  for (let i = 0; i < 12; i++) {
    const q = (low + high) / 2;
    // canvasToBlob from utils.js should accept (canvas, mime, quality)
    const blob = await canvasToBlob(canvas, mime, q).catch(() => null);
    if (!blob) break;
    const size = blob.size;
    const diff = Math.abs(size - targetBytes);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestBlob = blob;
    }

    // stop early if within +/- 3KB
    if (Math.abs(size - targetBytes) <= 3 * 1024) {
      return blob;
    }

    // adjust binary search
    if (size > targetBytes) {
      // file too large -> reduce quality
      high = q;
    } else {
      // file too small -> increase quality
      low = q;
    }
  }

  // if bestBlob found return it, otherwise fallback to default quality
  if (bestBlob) return bestBlob;
  return await canvasToBlob(canvas, mime, 0.8);
}

/* ---------- Process Image (Resize/Compress) ---------- */
async function processImage() {
  if (!currentImage) { alert("Please upload an image first."); return; }

  // target-size is mandatory (option A)
  if (!targetSizeInput || !targetSizeInput.value) {
    alert("Please enter the Target File Size (KB) before processing.");
    return;
  }
  const targetKB = Number(targetSizeInput.value);
  if (!Number.isFinite(targetKB) || targetKB <= 0) {
    alert("Please enter a valid positive number for Target File Size (KB).");
    return;
  }

  setStatus("Processing...");
  processBtn.disabled = true;
  showLoader();

  try {
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;

    const type = resizeTypeEl ? resizeTypeEl.value : "px";
    let wVal = widthInput && widthInput.value ? Number(widthInput.value) : null;
    let hVal = heightInput && heightInput.value ? Number(heightInput.value) : null;

    const dims = convertResize(wVal, hVal, type === "px" ? "px" : (type === "percent" ? "percent" : "longest"), imgW, imgH);
    const targetW = Math.max(1, Math.round(dims.w));
    const targetH = Math.max(1, Math.round(dims.h));

    // prepare source canvas (apply EXIF orientation)
    const s = document.createElement("canvas");
    s.width = imgW;
    s.height = imgH;
    const sctx = s.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(currentImage, 0, 0, imgW, imgH);
    const sourceCanvas = currentOrientation > 1 ? applyOrientation(s, currentOrientation) : s;

    // draw scaled output canvas (target dims)
    const outCanvas = document.createElement("canvas");
    outCanvas.width = targetW;
    outCanvas.height = targetH;
    const outCtx = outCanvas.getContext("2d");
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = "high";
    outCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, targetW, targetH);

    const selectedMime = (formatSelect && formatSelect.value) ? formatSelect.value : "image/jpeg";

    // If PNG selected -> inform user that target-size compression won't work
    if (selectedMime === "image/png") {
      alert("Target file size compression only works with JPEG or WebP. PNG is lossless; target-size compression cannot be guaranteed. The result will be exported as PNG.");
      // export PNG at full quality
      const pngBlob = await canvasToBlob(outCanvas, "image/png", 1);
      const url = safeURL(pngBlob);
      previewImg.src = url;
      setStatus(`${formatSize(pngBlob.size)} • ${formatDim(targetW, targetH)}`);
      downloadBtn.onclick = () => {
        const a = document.createElement("a");
        const base = (currentFile && currentFile.name) ? currentFile.name.replace(/\.[^/.]+$/, "") : "image";
        a.href = url;
        a.download = `${base}_resized.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      enableDownload(true);
      return;
    }

    // For JPEG / WebP -> run binary search compression to match targetKB
    const mime = selectedMime === "image/webp" ? "image/webp" : "image/jpeg";
    const compressedBlob = await compressToTargetSize(outCanvas, mime, targetKB);

    const url = safeURL(compressedBlob);
    previewImg.src = url;
    setStatus(`${formatSize(compressedBlob.size)} • ${formatDim(targetW, targetH)}`);

    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      const base = (currentFile && currentFile.name) ? currentFile.name.replace(/\.[^/.]+$/, "") : "image";
      const ext = mime.split("/")[1] || "jpg";
      a.href = url;
      a.download = `${base}_resized.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    enableDownload(true);
  } catch (err) {
    console.error("Processing error:", err);
    alert("Processing failed. See console for details.");
    setStatus("Processing failed");
  } finally {
    processBtn.disabled = false;
    hideLoader();
  }
}

/* ---------- Init ---------- */
function init() {
  processBtn && processBtn.addEventListener("click", processImage);

  // Enter key handling (not on inputs)
  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (e.key === "Enter" && active && (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA" && active.tagName !== "SELECT")) {
      processImage();
    }
  });

  // ensure file input click bindings exist (initializer script may attach dropped file data)
  // no dev sample loaded by default
}

/* Run init */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* Exports for debugging/testing */
export { processImage, handleFiles };
