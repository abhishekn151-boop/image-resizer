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

// DOM elements
const fileInput = document.getElementById("fileInput");
const dropArea = document.getElementById("drop-area");
const previewImg = document.getElementById("previewImg");
const previewInfo = document.getElementById("previewInfo");

const resizeTypeEl = document.getElementById("resizeType");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const keepRatioEl = document.getElementById("keepRatio");

const qualitySlider = document.getElementById("qualitySlider");
const qualityVal = document.getElementById("qualityVal");
const formatSelect = document.getElementById("formatSelect");

const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");

// -------- LOADING ANIMATION --------
function showLoader() {
  document.getElementById("loadingOverlay").classList.remove("hidden");
}
function hideLoader() {
  document.getElementById("loadingOverlay").classList.add("hidden");
}

// -------- MINIMUM LOADER TIME --------
function wait(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// -------- HELPERS --------
function setStatus(text) {
  if (previewInfo) previewInfo.textContent = text;
}

function enableDownload(enabled = true) {
  downloadBtn.disabled = !enabled;
  downloadBtn.classList.toggle("disabled", !enabled);
}

// -------- DRAG & DROP --------
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

["dragenter", "dragover", "dragleave", "drop"].forEach(evt =>
  dropArea.addEventListener(evt, preventDefaults, false)
);

["dragenter", "dragover"].forEach(() =>
  dropArea.addEventListener("dragenter", () => dropArea.classList.add("active"), false)
);

["dragleave", "drop"].forEach(() =>
  dropArea.addEventListener("dragleave", () => dropArea.classList.remove("active"), false)
);

dropArea.addEventListener("click", () => fileInput.click());
dropArea.addEventListener("drop", (e) => {
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

// -------- HANDLE FILES --------
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const file = fileList[0];
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  currentFile = file;
  setStatus("Loading image...");
  enableDownload(false);

  try {
    currentOrientation = await getExifOrientation(file);

    const img = await loadImage(file);
    currentImage = img;

    previewImg.src = safeURL(file);
    previewImg.style.display = "";

    setStatus(`${formatSize(file.size)} • ${img.naturalWidth} × ${img.naturalHeight}px`);

    if (currentCropper) currentCropper = null;

  } catch (err) {
    console.error("Error loading image:", err);
    setStatus("Failed to load image");
  }
}

// -------- PROCESS IMAGE --------
async function processImage() {
  if (!currentImage) {
    alert("Please upload an image first.");
    return;
  }

  // ---------- SHOW LOADER ----------
  setStatus("Processing...");
  processBtn.disabled = true;
  showLoader();

  const imgW = currentImage.naturalWidth;
  const imgH = currentImage.naturalHeight;

  const type = resizeTypeEl.value;
  let wVal = widthInput.value ? Number(widthInput.value) : null;
  let hVal = heightInput.value ? Number(heightInput.value) : null;

  const dims = convertResize(
    wVal,
    hVal,
    type === "px" ? "px" : (type === "percent" ? "percent" : "longest"),
    imgW,
    imgH
  );

  let targetW = Math.max(1, Math.round(dims.w));
  let targetH = Math.max(1, Math.round(dims.h));

  if (keepRatioEl.checked) {
    if (widthInput.value && !heightInput.value) {
      targetH = Math.round((targetW / imgW) * imgH);
    } 
    else if (!widthInput.value && heightInput.value) {
      targetW = Math.round((targetH / imgH) * imgW);
    }
  }

  let sourceCanvas;

  if (cropEnabled && currentCropper) {
    sourceCanvas = currentCropper.export();

  } else {
    const source = document.createElement("canvas");
    source.width = imgW;
    source.height = imgH;

    const sctx = source.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(currentImage, 0, 0, imgW, imgH);

    sourceCanvas = currentOrientation > 1
      ? applyOrientation(source, currentOrientation)
      : source;
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = targetW;
  outCanvas.height = targetH;

  const outCtx = outCanvas.getContext("2d");
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";

  outCtx.drawImage(
    sourceCanvas,
    0, 0, sourceCanvas.width, sourceCanvas.height,
    0, 0, targetW, targetH
  );

  const mime = formatSelect.value || "image/jpeg";
  const q = mime === "image/png" ? 1 : Number(qualitySlider.value) / 100;

  const blob = await canvasToBlob(outCanvas, mime, q);
  const url = safeURL(blob);

  previewImg.src = url;
  setStatus(`${formatSize(blob.size)} • ${formatDim(targetW, targetH)}`);

  downloadBtn.onclick = () => {
    const a = document.createElement("a");
    const base = currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") : "image";
    const ext = mime.split("/")[1] || "jpg";

    a.href = url;
    a.download = `${base}_resized.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  enableDownload(true);

  // ---------- MINIMUM LOADER VISIBILITY ----------
  await wait(400);

  // ---------- HIDE LOADER ----------
  hideLoader();
  processBtn.disabled = false;
}

// -------- INITIALIZATION --------
function init() {
  qualitySlider.addEventListener("input", () => {
    qualityVal.textContent = `${qualitySlider.value}%`;
  });

  processBtn.addEventListener("click", processImage);

  previewImg.addEventListener("dblclick", async () => {
    if (!currentImage) return;

    const parent = previewImg.parentElement;
    let canvasEl = parent.querySelector("canvas.crop-canvas");

    if (!canvasEl) {
      canvasEl = document.createElement("canvas");
      canvasEl.className = "crop-canvas";
      canvasEl.style.maxWidth = "100%";
      canvasEl.style.display = "block";

      parent.insertBefore(canvasEl, previewImg);
      previewImg.style.display = "none";

      const displayW = previewImg.clientWidth || currentImage.naturalWidth;
      const displayH = Math.round((currentImage.naturalHeight / currentImage.naturalWidth) * displayW);

      canvasEl.width = displayW;
      canvasEl.height = displayH;

      const cctx = canvasEl.getContext("2d");
      cctx.drawImage(currentImage, 0, 0, canvasEl.width, canvasEl.height);

      currentCropper = new Cropper(canvasEl, currentImage);
      cropEnabled = true;
      setStatus("Crop mode enabled — drag and resize.");

    } else {
      const croppedCanvas = currentCropper.export();
      const b = await canvasToBlob(croppedCanvas, "image/png", 1);

      previewImg.src = safeURL(b);
      previewImg.style.display = "";
      canvasEl.remove();

      currentCropper = null;
      cropEnabled = false;

      setStatus("Crop applied.");
      enableDownload(true);
    }
  });
}

init();
