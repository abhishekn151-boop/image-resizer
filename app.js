// app.js (ES module)
import {
  loadImage,
  getExifOrientation,
  applyOrientation,
  convertResize,
  canvasToBlob,
  formatSize,
  formatDim,
  safeURL,
  compressCanvasToTarget
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

const targetSizeInput = document.getElementById("targetSize"); // NEW (KB)
const formatSelect = document.getElementById("formatSelect");

const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const loadingOverlay = document.getElementById("loadingOverlay");
const loaderText = document.getElementById("loaderText");

let currentFile = null;
let currentImage = null;
let currentOrientation = 1;
let currentCropper = null;
let cropEnabled = false;

/* ---------- UI helpers ---------- */
function setStatus(text) {
  if (previewInfo) previewInfo.textContent = text;
}
function showLoader(text = "Processing image...") {
  if (loaderText) loaderText.textContent = text;
  loadingOverlay && loadingOverlay.classList.remove("hidden");
}
function hideLoader() {
  loadingOverlay && loadingOverlay.classList.add("hidden");
}
function enableDownload(enabled = true) {
  downloadBtn.disabled = !enabled;
  downloadBtn.classList.toggle("disabled", !enabled);
}

/* ---------- Drag & Drop handling ---------- */
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
["dragenter","dragover","dragleave","drop"].forEach(evt => dropArea && dropArea.addEventListener(evt, preventDefaults, false));
["dragenter","dragover"].forEach(() => dropArea && dropArea.addEventListener("dragenter", () => dropArea.classList.add("active"), false));
["dragleave","drop"].forEach(() => dropArea && dropArea.addEventListener("dragleave", () => dropArea.classList.remove("active"), false));
dropArea && dropArea.addEventListener("drop", (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  handleFiles(dt.files);
}, false);
dropArea && dropArea.addEventListener("click", () => fileInput && fileInput.click());
fileInput && fileInput.addEventListener("change", (e) => {
  if (fileInput.__droppedFiles && fileInput.__droppedFiles.length) {
    handleFiles(fileInput.__droppedFiles);
    fileInput.__droppedFiles = null;
  } else {
    handleFiles(fileInput.files);
  }
});

/* ---------- Handle incoming FileList ---------- */
export async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const file = fileList[0];
  if (!file.type || !file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  currentFile = file;
  setStatus("Loading image...");
  try {
    // EXIF
    currentOrientation = await getExifOrientation(file).catch(() => 1);
    const img = await loadImage(file);
    currentImage = img;
    previewImg.src = safeURL(file);
    previewImg.style.display = "";
    setStatus(`${formatSize(file.size)} • ${img.naturalWidth} × ${img.naturalHeight}px`);

    // reset crop/rotation
    if (currentCropper) {
      currentCropper = null;
      cropEnabled = false;
    }
  } catch (err) {
    console.error("Error loading image:", err);
    alert("Could not load the image. See console for details.");
    setStatus("Failed to load image");
  }
  enableDownload(false);
}

/* ---------- Process Image with Option C algorithm ---------- */
async function processImage() {
  if (!currentImage) { alert("Please upload an image first."); return; }

  processBtn.disabled = true;
  showLoader("Preparing image...");

  try {
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;
    const type = resizeTypeEl ? resizeTypeEl.value : "px";
    let wVal = widthInput && widthInput.value ? Number(widthInput.value) : null;
    let hVal = heightInput && heightInput.value ? Number(heightInput.value) : null;

    const dims = convertResize(wVal, hVal, type === "px" ? "px" : (type === "percent" ? "percent" : "longest"), imgW, imgH);
    let targetW = Math.max(1, Math.round(dims.w));
    let targetH = Math.max(1, Math.round(dims.h));

    // build source canvas (crop or full)
    let sourceCanvas;
    if (cropEnabled && currentCropper && currentCropper.export) {
      sourceCanvas = currentCropper.export();
    } else {
      const s = document.createElement("canvas");
      s.width = imgW;
      s.height = imgH;
      const sctx = s.getContext("2d");
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(currentImage, 0, 0, imgW, imgH);
      sourceCanvas = currentOrientation > 1 ? applyOrientation(s, currentOrientation) : s;
    }

    // scale to target dims onto a working canvas
    const work = document.createElement("canvas");
    work.width = targetW;
    work.height = targetH;
    const wctx = work.getContext("2d");
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = "high";
    wctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, targetW, targetH);

    // target size input (KB -> bytes)
    const targetKB = targetSizeInput && targetSizeInput.value ? Number(targetSizeInput.value) : null;
    const targetBytes = targetKB ? Math.max(1, Math.round(targetKB * 1024)) : null;

    const mime = formatSelect && formatSelect.value ? formatSelect.value : "image/jpeg";

    if (targetBytes) {
      showLoader("Searching for best compression (this may take a few seconds)...");
      // run the Option C compressor
      const result = await compressCanvasToTarget(work, { mime, targetBytes, maxIterations: 14, tolerance: 0.025 });
      const blob = result.blob;
      const url = safeURL(blob);
      previewImg.src = url;
      setStatus(`${formatSize(blob.size)} • ${formatDim(targetW, targetH)}`);
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
    } else {
      // simple direct export (no target)
      showLoader("Exporting image...");
      const blob = await canvasToBlob(work, mime, 0.92);
      const url = safeURL(blob);
      previewImg.src = url;
      setStatus(`${formatSize(blob.size)} • ${formatDim(targetW, targetH)}`);
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
    }

  } catch (err) {
    console.error("Processing failed:", err);
    alert("Processing failed — see console.");
    setStatus("Processing failed");
    enableDownload(false);
  } finally {
    processBtn.disabled = false;
    hideLoader();
  }
}

/* ---------- Init ---------- */
function init() {
  // quick UI wiring
  processBtn && processBtn.addEventListener("click", processImage);
  downloadBtn && downloadBtn.addEventListener("click", () => { if (downloadBtn.disabled) return; });

  // keyboard: Enter triggers process when not in input
  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (e.key === "Enter" && active && (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA" && active.tagName !== "SELECT")) {
      processImage();
    }
  });

  // double-click preview toggles simple crop (if Cropper available)
  previewImg && previewImg.addEventListener("dblclick", async () => {
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

      try {
        currentCropper = new Cropper(canvasEl, currentImage, { simpleMode: true });
        cropEnabled = true;
        setStatus("Crop mode enabled — drag to adjust. Double-click again to apply.");
      } catch (err) {
        console.warn("Simple cropper init failed:", err);
        canvasEl.remove();
        previewImg.style.display = "";
        currentCropper = null;
        cropEnabled = false;
        setStatus("Crop unavailable.");
      }
    } else {
      try {
        const croppedCanvas = currentCropper.export();
        const b = await canvasToBlob(croppedCanvas, "image/png", 1);
        previewImg.src = safeURL(b);
        previewImg.style.display = "";
        canvasEl.remove();
        currentCropper = null;
        cropEnabled = false;
        setStatus("Crop applied.");
        enableDownload(true);
      } catch (err) {
        console.error("Applying crop failed:", err);
        setStatus("Crop failed.");
      }
    }
  });

  // ready
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
