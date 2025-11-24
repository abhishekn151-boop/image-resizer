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

const qualitySlider = document.getElementById("qualitySlider");
const qualityVal = document.getElementById("qualityVal");
const formatSelect = document.getElementById("formatSelect");

const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const loadingOverlay = document.getElementById("loadingOverlay");

const rotateSelect = document.getElementById("rotateSelect");

/* ---------- State ---------- */
let currentFile = null;
let currentImage = null;
let currentOrientation = 1;
let currentCropper = null;
let cropEnabled = false;
let advancedCropActive = false;
let rotationDeg = 0;

/* ---------- UI Helpers ---------- */
function setStatus(text) {
  if (previewInfo) previewInfo.textContent = text;
}
function showLoader() {
  loadingOverlay?.classList.remove("hidden");
}
function hideLoader() {
  loadingOverlay?.classList.add("hidden");
}
function enableDownload(enabled = true) {
  downloadBtn.disabled = !enabled;
  downloadBtn.classList.toggle("disabled", !enabled);
}

/* ---------- Drag & Drop + File Input ---------- */
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

["dragenter", "dragover", "dragleave", "drop"].forEach(evt => {
  dropArea?.addEventListener(evt, preventDefaults, false);
});

["dragenter", "dragover"].forEach(() => {
  dropArea?.addEventListener("dragenter", () => dropArea.classList.add("active"));
});
["dragleave", "drop"].forEach(() => {
  dropArea?.addEventListener("dragleave", () => dropArea.classList.remove("active"));
});

dropArea?.addEventListener("drop", e => {
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
});

dropArea?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", () => {
  handleFiles(fileInput.files);
});

/* ---------- Handle Incoming Files ---------- */
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const file = fileList[0];
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  currentFile = file;
  setStatus("Loading image...");

  try {
    currentOrientation = await getExifOrientation(file).catch(() => 1);
    currentImage = await loadImage(file);

    previewImg.src = safeURL(file);
    previewImg.style.display = "block";

    setStatus(`${formatSize(file.size)} • ${currentImage.naturalWidth} × ${currentImage.naturalHeight}px`);

    rotationDeg = 0;
    rotateSelect && (rotateSelect.value = "0");

    if (currentCropper) {
      currentCropper.destroy?.();
      currentCropper = null;
      advancedCropActive = false;
    }

  } catch (err) {
    console.error(err);
    alert("Error loading image.");
  }

  enableDownload(false);
}

window.handleFiles = handleFiles;

/* ---------- PROCESS IMAGE ---------- */
async function processImage() {
  if (!currentImage) {
    alert("Please upload an image first.");
    return;
  }

  showLoader();
  processBtn.disabled = true;
  setStatus("Processing...");

  try {
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;

    let wVal = widthInput.value ? Number(widthInput.value) : null;
    let hVal = heightInput.value ? Number(heightInput.value) : null;

    const dims = convertResize(
      wVal,
      hVal,
      resizeTypeEl.value === "percent" ? "percent" :
      resizeTypeEl.value === "longest" ? "longest" :
      "px",
      imgW,
      imgH
    );

    let targetW = Math.max(1, Math.round(dims.w));
    let targetH = Math.max(1, Math.round(dims.h));

    // crop logic
    let sourceCanvas;
    if (advancedCropActive && currentCropper) {
      sourceCanvas = currentCropper.export();
    } else if (cropEnabled && currentCropper) {
      sourceCanvas = currentCropper.export();
    } else {
      const s = document.createElement("canvas");
      s.width = imgW;
      s.height = imgH;
      const c = s.getContext("2d");
      c.drawImage(currentImage, 0, 0);

      sourceCanvas = currentOrientation > 1 ? applyOrientation(s, currentOrientation) : s;
    }

    // rotation logic
    let rotatedCanvas = sourceCanvas;
    if (rotationDeg % 360 !== 0) {
      const rad = rotationDeg * Math.PI / 180;
      const swap = Math.abs(rotationDeg) % 180 === 90;

      const rC = document.createElement("canvas");
      rC.width = swap ? sourceCanvas.height : sourceCanvas.width;
      rC.height = swap ? sourceCanvas.width : sourceCanvas.height;

      const rCtx = rC.getContext("2d");
      rCtx.translate(rC.width / 2, rC.height / 2);
      rCtx.rotate(rad);
      rCtx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
      rotatedCanvas = rC;
    }

    // output canvas
    const outCanvas = document.createElement("canvas");
    outCanvas.width = targetW;
    outCanvas.height = targetH;

    const oCtx = outCanvas.getContext("2d");
    oCtx.imageSmoothingEnabled = true;
    oCtx.imageSmoothingQuality = "high";
    oCtx.drawImage(rotatedCanvas, 0, 0, rotatedCanvas.width, rotatedCanvas.height, 0, 0, targetW, targetH);

    const mime = formatSelect.value || "image/jpeg";
    const q = mime === "image/png" ? 1 : qualitySlider.value / 100;

    const blob = await canvasToBlob(outCanvas, mime, q);

    const url = safeURL(blob);
    previewImg.src = url;

    setStatus(`${formatSize(blob.size)} • ${formatDim(targetW, targetH)}`);

    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = (currentFile?.name || "image").replace(/\.[^.]+$/, "") + "_resized." + mime.split("/")[1];
      a.click();
    };

    enableDownload(true);

  } catch (err) {
    console.error(err);
    alert("Processing failed.");
  }

  hideLoader();
  processBtn.disabled = false;
}

/* ---------- Init ---------- */
function init() {
  qualitySlider?.addEventListener("input", () => {
    qualityVal.textContent = `${qualitySlider.value}%`;
  });

  rotateSelect?.addEventListener("change", () => {
    rotationDeg = Number(rotateSelect.value);
    setStatus(`Rotation set to ${rotationDeg}°`);
  });

  processBtn?.addEventListener("click", processImage);
}

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", init)
  : init();

export { processImage, handleFiles };
