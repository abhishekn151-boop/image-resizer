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

/* ---------- State ---------- */
let currentFile = null;
let currentImage = null;
let currentOrientation = 1;

/* ---------- Helpers ---------- */
function setStatus(text) {
  if (previewInfo) previewInfo.textContent = text;
}
function showLoader() {
  loadingOverlay?.classList.remove("hidden");
}
function hideLoader() {
  loadingOverlay?.classList.add("hidden");
}
function enableDownload(flag) {
  downloadBtn.disabled = !flag;
  downloadBtn.classList.toggle("disabled", !flag);
}

/* ---------- FIXED: Upload event ---------- */
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

["dragenter","dragover","dragleave","drop"].forEach(event => {
  dropArea.addEventListener(event, preventDefaults);
});

dropArea.addEventListener("dragover", () => dropArea.classList.add("active"));
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("active"));

dropArea.addEventListener("drop", (e) => {
  dropArea.classList.remove("active");
  handleFiles(e.dataTransfer.files);
});

/* --- CLICK TO OPEN FILE PICKER --- */
dropArea.addEventListener("click", () => fileInput.click());

/* --- INPUT CHANGE --- */
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
});

/* ---------- File Handling ---------- */
async function handleFiles(files) {
  if (!files || !files.length) return;

  const file = files[0];
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  currentFile = file;
  setStatus("Loading image...");

  try {
    currentOrientation = await getExifOrientation(file).catch(() => 1);
    const img = await loadImage(file);
    currentImage = img;

    previewImg.src = safeURL(file);
    previewImg.style.display = "block";

    setStatus(`${formatSize(file.size)} • ${img.naturalWidth} × ${img.naturalHeight}px`);
    enableDownload(false);

  } catch (err) {
    console.error(err);
    alert("Could not load the image.");
    setStatus("Failed to load image");
  }
}

window.handleFiles = handleFiles;

/* ---------- Smart target-size matching ---------- */
async function tryMatchTargetSize(sourceCanvas, targetKB, mimePref) {
  const targetBytes = targetKB * 1024;
  let canvas = sourceCanvas;
  let mime = mimePref;

  const minQ = 0.25;
  const maxQ = 0.98;

  for (let step = 0; step < 8; step++) {

    if (mime === "image/png") {
      // PNG cannot shrink by quality → scale image
      const blob = await canvasToBlob(canvas, mime, 1);
      if (blob.size <= targetBytes) return { blob, width: canvas.width, height: canvas.height, mime };

      // scale down
      const scaled = document.createElement("canvas");
      scaled.width = Math.round(canvas.width * 0.85);
      scaled.height = Math.round(canvas.height * 0.85);
      scaled.getContext("2d").drawImage(canvas, 0, 0, scaled.width, scaled.height);
      canvas = scaled;
      continue;
    }

    // JPEG / WebP → binary search quality
    let low = minQ;
    let high = maxQ;
    let best = null;

    for (let i = 0; i < 16; i++) {
      const q = (low + high) / 2;

      const blob = await canvasToBlob(canvas, mime, q);
      const diff = Math.abs(blob.size - targetBytes);

      if (!best || diff < best.diff) best = { blob, diff };

      if (blob.size > targetBytes) high = q;
      else low = q;

      if (diff < targetBytes * 0.03) break;
    }

    if (best) return { blob: best.blob, width: canvas.width, height: canvas.height, mime };

    // else scale image and retry
    const scaled = document.createElement("canvas");
    scaled.width = Math.round(canvas.width * 0.85);
    scaled.height = Math.round(canvas.height * 0.85);
    scaled.getContext("2d").drawImage(canvas, 0, 0, scaled.width, scaled.height);
    canvas = scaled;
  }

  const fallback = await canvasToBlob(canvas, mime, 0.75);
  return { blob: fallback, width: canvas.width, height: canvas.height, mime };
}

/* ---------- Processing ---------- */
async function processImage() {
  if (!currentImage) return alert("Please upload an image.");

  const targetKB = Number(targetSizeKBInput.value);
  if (!targetKB || targetKB <= 0) return alert("Enter target size in KB.");

  showLoader();
  processBtn.disabled = true;
  setStatus("Processing...");

  try {
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;

    let wVal = widthInput.value ? Number(widthInput.value) : imgW;
    let hVal = heightInput.value ? Number(heightInput.value) : imgH;

    const dims = convertResize(wVal, hVal, resizeTypeEl.value, imgW, imgH);

    // Draw initial scaled canvas
    const init = document.createElement("canvas");
    init.width = dims.w;
    init.height = dims.h;
    init.getContext("2d").drawImage(currentImage, 0, 0, dims.w, dims.h);

    // Final compression
    const mime = formatSelect.value;
    const result = await tryMatchTargetSize(init, targetKB, mime);

    const url = safeURL(result.blob);
    previewImg.src = url;
    setStatus(`${formatSize(result.blob.size)} • ${result.width}×${result.height}`);

    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "image_resized." + (result.mime.split("/")[1] || "jpg");
      a.click();
    };

    enableDownload(true);

  } catch (err) {
    console.error(err);
    alert("Processing failed. See console.");
    setStatus("Error");
  }

  hideLoader();
  processBtn.disabled = false;
}

/* ---------- Init ---------- */
function init() {
  processBtn.addEventListener("click", processImage);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

export { processImage, handleFiles };
