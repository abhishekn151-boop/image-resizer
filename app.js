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

const targetSizeKBInput = document.getElementById("targetSizeKB");
const formatSelect = document.getElementById("formatSelect");

const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const loadingOverlay = document.getElementById("loadingOverlay");

let currentFile = null;
let currentImage = null;
let currentOrientation = 1;
let currentCropper = null;

/* ---------- Helpers ---------- */
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

/* ---------- File input & drag/drop ---------- */
function preventDefaults(e){ e.preventDefault(); e.stopPropagation(); }
['dragenter','dragover','dragleave','drop'].forEach(evt => {
  dropArea && dropArea.addEventListener(evt, preventDefaults, false);
});
['dragenter','dragover'].forEach(() => {
  dropArea && dropArea.addEventListener('dragenter', () => dropArea.classList.add('active'), false);
});
['dragleave','drop'].forEach(() => {
  dropArea && dropArea.addEventListener('dragleave', () => dropArea.classList.remove('active'), false);
});
dropArea && dropArea.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  handleFiles(dt.files);
});
dropArea && dropArea.addEventListener('click', () => {
  if (fileInput) fileInput.click();
});
fileInput && fileInput.addEventListener('change', (e) => {
  if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
});

/* ---------- Load / Preview ---------- */
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const file = fileList[0];
  if (!file.type || !file.type.startsWith('image/')) {
    alert('Please upload an image file.');
    return;
  }
  currentFile = file;
  setStatus('Loading image...');
  try {
    currentOrientation = await getExifOrientation(file).catch(()=>1);
    const img = await loadImage(file);
    currentImage = img;
    previewImg.src = safeURL(file);
    previewImg.style.display = '';
    setStatus(`${formatSize(file.size)} • ${img.naturalWidth} × ${img.naturalHeight}px`);
    enableDownload(false);
  } catch (err) {
    console.error('Error loading image:', err);
    alert('Could not load the image. See console.');
    setStatus('Failed to load image');
  }
}
window.handleFiles = handleFiles;

/* ---------- core: tryMatchTargetSize ---------- */

/**
 * Attempts to produce a Blob whose size is close to targetKB.
 * Strategy:
 *  1. If format is PNG -> non-lossy: try resizing (scale down) until target achieved.
 *  2. For JPEG/WebP: binary search quality between qHigh and qLow to reach size.
 *  3. If quality = minQuality and still larger, scale down dimensions slightly and repeat.
 *
 * Returns { blob, width, height, mime }
 */
async function tryMatchTargetSize(sourceCanvas, targetKB, mimePref) {
  const targetBytes = Math.max(1, Math.floor(targetKB * 1024));
  // Ensure sourceCanvas is available
  let canvas = sourceCanvas;
  const maxAttempts = 8;
  // Compression params
  const minQuality = 0.22; // don't go below this for visible quality (you can adjust)
  const maxQuality = 0.98;
  const qualityEpsilon = 0.01;

  // For PNG: conversion to PNG ignores quality param. We'll fallback to resizing if PNG requested.
  let mime = mimePref || 'image/jpeg';

  // Safety cap to avoid infinite loops
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // If user asked PNG but targetBytes is small, convert to webp or jpeg automatically for smaller sizes.
    let tryMime = mime;
    if (tryMime === 'image/png' && targetBytes < 50 * 1024) {
      // PNG unlikely to reach small targets; prefer webp (browser support dependent)
      tryMime = 'image/webp';
    }

    // For lossy formats, binary search quality
    if (tryMime === 'image/jpeg' || tryMime === 'image/webp') {
      let low = minQuality;
      let high = maxQuality;
      let bestBlob = null;
      let bestDiff = Infinity;
      let lastMid = -1;

      // First check with high quality to get a size baseline
      const baseline = await canvasToBlob(canvas, tryMime, high);
      if (baseline.size <= targetBytes) {
        return { blob: baseline, width: canvas.width, height: canvas.height, mime: tryMime };
      }

      // Binary search loop
      for (let i = 0; i < 18; i++) { // enough iterations to converge
        const mid = +( (low + high) / 2 ).toFixed(3);
        if (mid === lastMid) break;
        lastMid = mid;

        const b = await canvasToBlob(canvas, tryMime, mid);
        const diff = Math.abs(b.size - targetBytes);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestBlob = b;
        }
        if (b.size > targetBytes) {
          // need smaller size -> reduce quality
          high = mid;
        } else {
          // b.size <= target -> we can try higher quality (bigger size closer to target)
          low = mid;
        }
        // break early when within 2% or small absolute bytes
        if (diff <= Math.max(2000, targetBytes * 0.02)) break;
      }

      // If bestBlob is within acceptable tolerance, return
      if (bestBlob && Math.abs(bestBlob.size - targetBytes) <= Math.max(3000, targetBytes * 0.03)) {
        return { blob: bestBlob, width: canvas.width, height: canvas.height, mime: tryMime };
      }

      // If still too big, we'll scale down the image and retry (reduce dimensions by 85% and loop)
      if (bestBlob && bestBlob.size <= targetBytes) {
        // found smaller than target but not close enough, return best
        return { blob: bestBlob, width: canvas.width, height: canvas.height, mime: tryMime };
      } else {
        // scale down
        const scaleFactor = 0.85; // moderate step
        const newW = Math.max(1, Math.round(canvas.width * scaleFactor));
        const newH = Math.max(1, Math.round(canvas.height * scaleFactor));
        const scaled = document.createElement('canvas');
        scaled.width = newW;
        scaled.height = newH;
        const sctx = scaled.getContext('2d');
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, newW, newH);
        canvas = scaled;
        // continue attempts
        continue;
      }
    } else {
      // tryMime is PNG or other lossless: we have to scale down dimensions
      const b = await canvasToBlob(canvas, tryMime, 1);
      if (b.size <= targetBytes) {
        return { blob: b, width: canvas.width, height: canvas.height, mime: tryMime };
      }
      // scale down
      const scaleFactor = 0.85;
      const newW = Math.max(1, Math.round(canvas.width * scaleFactor));
      const newH = Math.max(1, Math.round(canvas.height * scaleFactor));
      const scaled = document.createElement('canvas');
      scaled.width = newW;
      scaled.height = newH;
      const sctx = scaled.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, newW, newH);
      canvas = scaled;
      continue;
    }
  }

  // If we exit loop, return final canvas blob as fallback
  const fallbackBlob = await canvasToBlob(canvas, mime, 0.8);
  return { blob: fallbackBlob, width: canvas.width, height: canvas.height, mime: mime };
}

/* ---------- Process Image UI action ---------- */
async function processImage() {
  if (!currentImage) { alert('Please upload an image first.'); return; }
  const targetKB = Number(targetSizeKBInput && targetSizeKBInput.value ? targetSizeKBInput.value : 0);
  if (!targetKB || targetKB <= 0) {
    alert('Please enter a valid target file size in KB.');
    return;
  }

  setStatus('Processing...');
  processBtn.disabled = true;
  showLoader();

  try {
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;

    const type = resizeTypeEl ? resizeTypeEl.value : 'px';
    let wVal = widthInput && widthInput.value ? Number(widthInput.value) : null;
    let hVal = heightInput && heightInput.value ? Number(heightInput.value) : null;

    const dims = convertResize(wVal, hVal, type === 'px' ? 'px' : (type === 'percent' ? 'percent' : 'longest'), imgW, imgH);
    let targetW = Math.max(1, Math.round(dims.w));
    let targetH = Math.max(1, Math.round(dims.h));

    // create source canvas (original orientation applied)
    const source = document.createElement('canvas');
    source.width = imgW;
    source.height = imgH;
    const sctx = source.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(currentImage, 0, 0, imgW, imgH);
    const sourceCanvas = currentOrientation > 1 ? applyOrientation(source, currentOrientation) : source;

    // create a canvas scaled to targetW/targetH to be used as initial canvas
    const initCanvas = document.createElement('canvas');
    initCanvas.width = targetW;
    initCanvas.height = targetH;
    const ictx = initCanvas.getContext('2d');
    ictx.imageSmoothingEnabled = true;
    ictx.imageSmoothingQuality = 'high';
    ictx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, targetW, targetH);

    // call matching procedure
    const desiredMime = formatSelect && formatSelect.value ? formatSelect.value : 'image/jpeg';
    const result = await tryMatchTargetSize(initCanvas, targetKB, desiredMime);

    const blob = result.blob;
    const url = safeURL(blob);
    previewImg.src = url;
    previewImg.style.display = '';
    setStatus(`${formatSize(blob.size)} • ${formatDim(result.width, result.height)}`);

    // set download button
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      const base = (currentFile && currentFile.name) ? currentFile.name.replace(/\.[^/.]+$/, '') : 'image';
      const ext = (result.mime && result.mime.split('/')[1]) ? result.mime.split('/')[1] : 'jpg';
      a.href = url;
      a.download = `${base}_resized.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    enableDownload(true);
  } catch (err) {
    console.error('Processing error:', err);
    alert('Processing failed. See console for details.');
    setStatus('Processing failed');
  } finally {
    processBtn.disabled = false;
    hideLoader();
  }
}

/* ---------- Init ---------- */
function init() {
  processBtn && processBtn.addEventListener('click', processImage);
  // keyboard enter triggers process when not focusing input controls
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (e.key === 'Enter' && active && (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && active.tagName !== 'SELECT')) {
      processImage();
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { processImage, handleFiles };
