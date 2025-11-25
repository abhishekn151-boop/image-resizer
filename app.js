// app.js (ES module)
// Fully updated: upload fixed, target-size compression, no warnings, no ratio option.

import {
  loadImage,
  getExifOrientation,
  applyOrientation,
  convertResize,
  canvasToBlob,
  formatSize,
  formatDim,
  safeURL,
  compressCanvasToTarget,
  getImageDPI
} from "./utils.js";

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
  loadingOverlay.classList.remove("hidden");
}

function hideLoader() {
  loadingOverlay.classList.add("hidden");
}

function enableDownload(state) {
  downloadBtn.disabled = !state;
  downloadBtn.classList.toggle("disabled", !state);
}

/* ---------- Drag & Drop Handling (FIXED) ---------- */
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

["dragenter", "dragover", "dragleave", "drop"].forEach(evt => {
  dropArea.addEventListener(evt, preventDefaults);
});

dropArea.addEventListener("dragover", () => dropArea.classList.add("active"));
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("active"));

dropArea.addEventListener("drop", (e) => {
  dropArea.classList.remove("active");
  if (e.dataTransfer.files.length > 0) {
    handleFiles(e.dataTransfer.files);
  }
});

/* ---------- Click to open input ---------- */
dropArea.addEventListener("click", () => fileInput.click());

/* ---------- File input change ---------- */
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFiles(fileInput.files);
  }
});

/* ---------- Handle File Upload ---------- */
async function handleFiles(files) {
  const file = files[0];
  if (!file || !file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  currentFile = file;
  setStatus("Loading image...");

  try {
    currentOrientation = await getExifOrientation(file).catch(() => 1);
    const img = await loadImage(file);
currentImage = img;

// Read true DPI and store it
currentImage.__dpi = await getImageDPI(file);
    previewImg.src = safeURL(file);
    previewImg.style.display = "block";

    setStatus(`${formatSize(file.size)} • ${img.naturalWidth} × ${img.naturalHeight}px`);
    enableDownload(false);

  } catch (err) {
    console.error("Error loading image:", err);
    alert("Could not load the image.");
    setStatus("Error loading image");
  }
}

window.handleFiles = handleFiles;

/* ---------- PROCESS IMAGE ---------- */
async function processImage() {
  if (!currentImage) return alert("Please upload an image first.");

  const targetKB = Number(targetSizeKBInput.value);
  if (!targetKB || targetKB <= 0) return alert("Enter a valid target file size (KB).");

  showLoader();
  processBtn.disabled = true;
  setStatus("Processing...");

  try {
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;

    let userW = widthInput.value ? Number(widthInput.value) : imgW;
    let userH = heightInput.value ? Number(heightInput.value) : imgH;

    const dpiValue = currentImage.__dpi || 96;
    const dims = convertResize(userW, userH, resizeTypeEl.value, imgW, imgH, dpiValue);

    /* Draw initial resized canvas */
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = dims.w;
    baseCanvas.height = dims.h;

    const ctx = baseCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Apply orientation, then scale image into new canvas
    const originalCanvas = document.createElement("canvas");
    originalCanvas.width = imgW;
    originalCanvas.height = imgH;
    originalCanvas.getContext("2d").drawImage(currentImage, 0, 0);

    const orientedCanvas =
      currentOrientation !== 1
        ? applyOrientation(originalCanvas, currentOrientation)
        : originalCanvas;

    ctx.drawImage(orientedCanvas, 0, 0, dims.w, dims.h);

    /* Apply target-size compression (Smart System — No slider) */
    const result = await compressCanvasToTarget(baseCanvas, {
      mime: formatSelect.value,
      targetBytes: targetKB * 1024
    });

    const url = safeURL(result.blob);
    previewImg.src = url;

    setStatus(`${formatSize(result.achievedBytes)} • ${formatDim(result.width, result.height)}`);

    /* Download */
    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      const ext = (formatSelect.value.split("/")[1] || "jpg");
      const baseName = currentFile.name.replace(/\.[^/.]+$/, "");
      a.href = url;
      a.download = `${baseName}_resized.${ext}`;
      a.click();
    };

    enableDownload(true);

  } catch (err) {
    console.error(err);
    alert("Processing failed. Check console.");
    setStatus("Processing failed");
  }

  hideLoader();
  processBtn.disabled = false;
}

/* ---------- INIT ---------- */
function init() {
  processBtn.addEventListener("click", processImage);
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init);
else init();

export { processImage, handleFiles };
