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

const toolTabs = document.querySelectorAll(".tool-tab");
const panelResize = document.getElementById("panel-resize");
const panelCompress = document.getElementById("panel-compress");
const panelCrop = document.getElementById("panel-crop");
const panelRotate = document.getElementById("panel-rotate");
const rotateSelect = document.getElementById("rotateSelect");

/* ---------- State ---------- */
let currentFile = null;
let currentImage = null;
let currentOrientation = 1;
let currentCropper = null;
let cropEnabled = false;
let advancedCropActive = false;
let rotationDeg = 0;

/* Dev sample */
const SAMPLE_LOCAL_PATH = "/mnt/data/Home Design.png";

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

/* ---------- Drag & Drop ---------- */
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

["dragenter","dragover","dragleave","drop"].forEach(evt =>
  dropArea?.addEventListener(evt, preventDefaults)
);

["dragenter","dragover"].forEach(() =>
  dropArea?.addEventListener("dragenter", () => dropArea.classList.add("active"))
);

["dragleave","drop"].forEach(() =>
  dropArea?.addEventListener("dragleave", () => dropArea.classList.remove("active"))
);

dropArea?.addEventListener("drop", e => {
  const dt = e.dataTransfer;
  if (!dt) return;
  handleFiles(dt.files);
});

dropArea?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", () => {
  if (fileInput.__droppedFiles?.length) {
    handleFiles(fileInput.__droppedFiles);
    fileInput.__droppedFiles = null;
  } else {
    handleFiles(fileInput.files);
  }
});

/* ---------- Load File ---------- */
async function handleFiles(fileList) {
  if (!fileList?.length) return;

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
    previewImg.style.display = "";
    setStatus(`${formatSize(file.size)} • ${currentImage.naturalWidth} × ${currentImage.naturalHeight}px`);

    rotationDeg = 0;
    rotateSelect.value = "0";

    if (currentCropper) {
      currentCropper.destroy?.();
      currentCropper = null;
      advancedCropActive = false;
    }
    cropEnabled = false;

  } catch (err) {
    console.error(err);
    alert("Could not load the image.");
    setStatus("Failed to load image");
  }

  enableDownload(false);
}

window.handleFiles = handleFiles;

/* ---------- Tab Switching ---------- */
toolTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    toolTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    const target = tab.dataset.tab;

    [panelResize, panelCompress, panelCrop, panelRotate].forEach(p =>
      p?.classList.remove("active")
    );

    document.getElementById("panel-" + target)?.classList.add("active");

    if (target === "crop") {
      initAdvancedCropper();
    } else if (advancedCropActive && currentCropper) {
      currentCropper.destroy?.();
      currentCropper = null;
      advancedCropActive = false;
    }
  });
});

/* ---------- Advanced Cropper ---------- */
function initAdvancedCropper() {
  if (!currentImage) {
    setStatus("Upload an image to crop.");
    return;
  }
  if (advancedCropActive) return;

  const parent = previewImg.parentElement;
  parent.querySelector("canvas.crop-canvas")?.remove();

  const canvasEl = document.createElement("canvas");
  canvasEl.className = "crop-canvas";
  canvasEl.style.maxWidth = "100%";
  canvasEl.style.display = "block";
  parent.insertBefore(canvasEl, previewImg);
  previewImg.style.display = "none";

  const displayW = previewImg.clientWidth || currentImage.naturalWidth;
  const displayH = Math.round((currentImage.naturalHeight / currentImage.naturalWidth) * displayW);

  canvasEl.width = displayW;
  canvasEl.height = displayH;

  const ctx = canvasEl.getContext("2d");
  ctx.drawImage(currentImage, 0, 0, displayW, displayH);

  try {
    currentCropper = new Cropper(canvasEl, currentImage);
    advancedCropActive = true;
    cropEnabled = false;
    setStatus("Crop mode enabled.");
  } catch (err) {
    console.warn("Cropper error:", err);
    canvasEl.remove();
    previewImg.style.display = "";
  }
}

/* ---------- Simple Double-click Crop ---------- */
previewImg.addEventListener("dblclick", async () => {
  if (!currentImage || advancedCropActive) return;

  const parent = previewImg.parentElement;
  let canvasEl = parent.querySelector("canvas.crop-canvas");

  if (!canvasEl) {
    canvasEl = document.createElement("canvas");
    canvasEl.className = "crop-canvas";
    parent.insertBefore(canvasEl, previewImg);
    previewImg.style.display = "none";

    const w = previewImg.clientWidth || currentImage.naturalWidth;
    const h = Math.round((currentImage.naturalHeight / currentImage.naturalWidth) * w);

    canvasEl.width = w;
    canvasEl.height = h;
    canvasEl.getContext("2d").drawImage(currentImage, 0, 0, w, h);

    try {
      currentCropper = new Cropper(canvasEl, currentImage, { simpleMode: true });
      cropEnabled = true;
      setStatus("Drag to crop. Double-click to apply.");
    } catch {
      canvasEl.remove();
      previewImg.style.display = "";
    }
  } else {
    try {
      const croppedCanvas = currentCropper.export();
      const blob = await canvasToBlob(croppedCanvas, "image/png", 1);
      previewImg.src = safeURL(blob);
      previewImg.style.display = "";
      canvasEl.remove();
      currentCropper = null;
      cropEnabled = false;
      enableDownload(true);
      setStatus("Crop applied.");
    } catch {
      setStatus("Crop failed.");
    }
  }
});

/* ---------- Process Image ---------- */
async function processImage() {
  if (!currentImage) return alert("Please upload an image first.");

  setStatus("Processing...");
  processBtn.disabled = true;
  showLoader();

  try {
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;

    const type = resizeTypeEl.value;
    const wVal = widthInput.value ? Number(widthInput.value) : null;
    const hVal = heightInput.value ? Number(heightInput.value) : null;

    const dims = convertResize(
      wVal,
      hVal,
      type === "px" ? "px" : type === "percent" ? "percent" : "longest",
      imgW,
      imgH
    );

    const targetW = Math.max(1, Math.round(dims.w));
    const targetH = Math.max(1, Math.round(dims.h));

    /* KEEP RATIO WAS REMOVED — NOTHING HERE */

    rotationDeg = Number(rotateSelect.value || 0);

    let sourceCanvas;

    if ((advancedCropActive || cropEnabled) && currentCropper) {
      sourceCanvas = currentCropper.export();
    } else {
      const s = document.createElement("canvas");
      s.width = imgW;
      s.height = imgH;
      s.getContext("2d").drawImage(currentImage, 0, 0);

      sourceCanvas =
        currentOrientation > 1 ? applyOrientation(s, currentOrientation) : s;
    }

    let rotatedCanvas = sourceCanvas;

    if (rotationDeg % 360 !== 0) {
      const rad = (rotationDeg * Math.PI) / 180;
      const swap = Math.abs(rotationDeg) % 180 === 90;

      const rW = swap ? sourceCanvas.height : sourceCanvas.width;
      const rH = swap ? sourceCanvas.width : sourceCanvas.height;

      const rC = document.createElement("canvas");
      rC.width = rW;
      rC.height = rH;

      const rCtx = rC.getContext("2d");
      rCtx.translate(rW / 2, rH / 2);
      rCtx.rotate(rad);
      rCtx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);

      rotatedCanvas = rC;
    }

    const outCanvas = document.createElement("canvas");
    outCanvas.width = targetW;
    outCanvas.height = targetH;

    outCanvas
      .getContext("2d")
      .drawImage(rotatedCanvas, 0, 0, rotatedCanvas.width, rotatedCanvas.height, 0, 0, targetW, targetH);

    const mime = formatSelect?.value || "image/jpeg";
    const q = mime === "image/png" ? 1 : Number(qualitySlider.value) / 100;

    const blob = await canvasToBlob(outCanvas, mime, q);
    const url = safeURL(blob);

    previewImg.src = url;
    previewImg.style.display = "";
    setStatus(`${formatSize(blob.size)} • ${formatDim(targetW, targetH)}`);

    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      const base = currentFile?.name.replace(/\.[^/.]+$/, "") || "image";
      const ext = mime.split("/")[1];
      a.href = url;
      a.download = `${base}_resized.${ext}`;
      a.click();
    };

    enableDownload(true);

  } catch (err) {
    console.error(err);
    alert("Processing failed.");
    setStatus("Processing failed.");
  }

  hideLoader();
  processBtn.disabled = false;
}

/* ---------- Init ---------- */
function init() {
  qualitySlider?.addEventListener("input", () => {
    qualityVal.textContent = `${qualitySlider.value}%`;
  });

  processBtn?.addEventListener("click", processImage);

  rotateSelect?.addEventListener("change", () => {
    rotationDeg = Number(rotateSelect.value);
    setStatus(`Rotation: ${rotationDeg}°`);
  });
}

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", init)
  : init();

export { processImage, handleFiles };
