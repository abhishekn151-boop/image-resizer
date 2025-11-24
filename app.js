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
const formatSelect = document.getElementById("formatSelect"); // may be null

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
let currentOrientation = 1; // EXIF orientation
let currentCropper = null;  // advanced cropper instance
let cropEnabled = false;    // simple crop mode flag
let advancedCropActive = false;
let rotationDeg = 0;

/* Developer sample (local path from conversation history) */
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
  // prefer dropped files attached via initializer if present
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

    // reset rotation / crop state when new file loaded
    rotationDeg = 0;
    rotateSelect && (rotateSelect.value = "0");

    if (currentCropper) {
      currentCropper.destroy && currentCropper.destroy();
      currentCropper = null;
      advancedCropActive = false;
    }
    cropEnabled = false;
  } catch (err) {
    console.error("Error loading image:", err);
    alert("Could not load the image. See console for details.");
    setStatus("Failed to load image");
  }
  enableDownload(false);
}

/* expose globally for initializer */
window.handleFiles = handleFiles;

/* ---------- Tab switching (Resize, Compress, Crop, Rotate) ---------- */
toolTabs && toolTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    toolTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    // show/hide panels
    [panelResize, panelCompress, panelCrop, panelRotate].forEach(p => p && p.classList.remove("active"));
    const panel = document.getElementById("panel-" + target);
    panel && panel.classList.add("active");

    // if switching to crop panel, initialize advanced cropper
    if (target === "crop") {
      initAdvancedCropper();
    } else {
      // if leaving crop panel, destroy advanced cropper (but do not apply unless user exported)
      if (currentCropper && advancedCropActive) {
        currentCropper.destroy && currentCropper.destroy();
        currentCropper = null;
        advancedCropActive = false;
      }
    }
  });
});

/* ---------- Advanced Cropper Initialization ---------- */
function initAdvancedCropper() {
  if (!currentImage || !previewImg) {
    setStatus("Upload an image to use the crop tool.");
    return;
  }
  // if already active, do nothing
  if (currentCropper && advancedCropActive) {
    setStatus("Advanced cropper active. Drag to refine.");
    return;
  }

  // create overlay canvas sized to preview display
  const parent = previewImg.parentElement;
  // remove existing crop canvas if present
  const existing = parent.querySelector("canvas.crop-canvas");
  if (existing) existing.remove();

  const canvasEl = document.createElement("canvas");
  canvasEl.className = "crop-canvas";
  canvasEl.style.maxWidth = "100%";
  canvasEl.style.display = "block";
  // insert before preview image
  parent.insertBefore(canvasEl, previewImg);
  previewImg.style.display = "none";

  // size canvas to preview display size but keep mapping to natural image
  const displayW = previewImg.clientWidth || currentImage.naturalWidth;
  const displayH = Math.round((currentImage.naturalHeight / currentImage.naturalWidth) * displayW);
  canvasEl.width = displayW;
  canvasEl.height = displayH;

  // draw scaled image onto canvas
  const cctx = canvasEl.getContext("2d");
  cctx.clearRect(0,0,canvasEl.width,canvasEl.height);
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = "high";
  cctx.drawImage(currentImage, 0, 0, canvasEl.width, canvasEl.height);

  // instantiate cropper (assumes Cropper class accepts (canvas, sourceImage))
  try {
    currentCropper = new Cropper(canvasEl, currentImage, { /* options if supported */ });
    advancedCropActive = true;
    cropEnabled = false; // advanced cropper takes precedence
    setStatus("Advanced cropper enabled. Drag handles to adjust.");
  } catch (err) {
    console.warn("Advanced Cropper init failed:", err);
    // fallback: remove canvas and show preview image again
    canvasEl.remove();
    previewImg.style.display = "";
    currentCropper = null;
    advancedCropActive = false;
    setStatus("Advanced cropper unavailable; double-click preview to use simple crop.");
  }
}

/* ---------- Simple double-click crop (toggle) ---------- */
previewImg && previewImg.addEventListener("dblclick", async () => {
  if (!currentImage) return;

  // if advanced cropper active, ignore (advanced UI handles crop)
  if (advancedCropActive) {
    setStatus("Advanced cropper active. Use its controls.");
    return;
  }

  const parent = previewImg.parentElement;
  let canvasEl = parent.querySelector("canvas.crop-canvas");
  if (!canvasEl) {
    // enter simple crop mode
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

    // basic cropper: reuse Cropper if available (works with canvas), otherwise simple fixed selection could be implemented
    try {
      currentCropper = new Cropper(canvasEl, currentImage, { simpleMode: true });
      cropEnabled = true;
      setStatus("Crop mode enabled — drag to adjust. Double-click again to apply.");
    } catch (err) {
      console.warn("Simple cropper init failed:", err);
      // fallback: remove canvas and show preview
      canvasEl.remove();
      previewImg.style.display = "";
      currentCropper = null;
      cropEnabled = false;
      setStatus("Crop unavailable.");
    }

  } else {
    // apply simple crop
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

/* ---------- Process Image (Resize/Compress/Crop/Rotate) ---------- */
async function processImage() {
  if (!currentImage) { alert("Please upload an image first."); return; }
  setStatus("Processing...");
  processBtn.disabled = true;
  showLoader();

  try {
    // figure out target dims
    const imgW = currentImage.naturalWidth;
    const imgH = currentImage.naturalHeight;

    const type = resizeTypeEl ? resizeTypeEl.value : "px";
    let wVal = widthInput && widthInput.value ? Number(widthInput.value) : null;
    let hVal = heightInput && heightInput.value ? Number(heightInput.value) : null;

    const dims = convertResize(wVal, hVal, type === "px" ? "px" : (type === "percent" ? "percent" : "longest"), imgW, imgH);
    let targetW = Math.max(1, Math.round(dims.w));
    let targetH = Math.max(1, Math.round(dims.h));

    if (keepRatioEl && keepRatioEl.checked) {
      if (widthInput && widthInput.value && !(heightInput && heightInput.value)) {
        targetH = Math.round((targetW / imgW) * imgH);
      } else if (heightInput && heightInput.value && !(widthInput && widthInput.value)) {
        targetW = Math.round((targetH / imgH) * imgW);
      }
    }

    // determine rotation (from rotateSelect)
    rotationDeg = rotateSelect ? Number(rotateSelect.value) : 0;

    // get source canvas (apply crop or full image)
    let sourceCanvas;
    if (advancedCropActive && currentCropper) {
      // cropper.export() should return a canvas at natural scale (or at displayed scale - we handle accordingly)
      sourceCanvas = currentCropper.export ? currentCropper.export() : null;
    } else if (cropEnabled && currentCropper) {
      sourceCanvas = currentCropper.export ? currentCropper.export() : null;
    } else {
      // draw the full natural image to canvas
      const s = document.createElement("canvas");
      s.width = imgW;
      s.height = imgH;
      const sctx = s.getContext("2d");
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(currentImage, 0, 0, imgW, imgH);

      // apply EXIF orientation if necessary
      sourceCanvas = currentOrientation > 1 ? applyOrientation(s, currentOrientation) : s;
    }

    if (!sourceCanvas) throw new Error("No source canvas available");

    // apply rotation if needed
    let rotatedCanvas = sourceCanvas;
    if (rotationDeg % 360 !== 0) {
      const rad = (rotationDeg * Math.PI) / 180;
      // swap dims for 90/270
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

    // create output canvas with target size and draw scaled
    const outCanvas = document.createElement("canvas");
    outCanvas.width = targetW;
    outCanvas.height = targetH;
    const outCtx = outCanvas.getContext("2d");
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = "high";

    outCtx.drawImage(rotatedCanvas, 0, 0, rotatedCanvas.width, rotatedCanvas.height, 0, 0, targetW, targetH);

    // choose mime & quality
    const mime = (formatSelect && formatSelect.value) ? formatSelect.value : "image/jpeg";
    const q = mime === "image/png" ? 1 : ((qualitySlider && qualitySlider.value) ? Number(qualitySlider.value) / 100 : 0.8);

    // convert to blob
    const blob = await canvasToBlob(outCanvas, mime, q);

    // preview result
    const url = safeURL(blob);
    previewImg.src = url;
    previewImg.style.display = "";
    setStatus(`${formatSize(blob.size)} • ${formatDim(targetW, targetH)}`);

    // download handler
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

/* ---------- Try to load developer sample (local path) ---------- */
async function tryLoadLocalSample() {
  try {
    const resp = await fetch(SAMPLE_LOCAL_PATH, { method: "GET" });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const fileLike = new File([blob], "sample.png", { type: blob.type });
    await handleFiles([fileLike]);
  } catch (e) {
    // silent
    // console.debug("Local sample not available:", e);
  }
}

/* ---------- Init ---------- */
function init() {
  // quality slider UI
  if (qualitySlider && qualityVal) {
    qualitySlider.addEventListener("input", () => {
      qualityVal.textContent = `${qualitySlider.value}%`;
    });
  }

  // process & download
  processBtn && processBtn.addEventListener("click", processImage);
  downloadBtn && downloadBtn.addEventListener("click", () => {
    if (downloadBtn.disabled) return;
    // onclick assigned after processing
  });

  // rotate select immediate preview update (optional)
  rotateSelect && rotateSelect.addEventListener("change", () => {
    // we only update rotationDeg now; final rotation applied at processing
    rotationDeg = Number(rotateSelect.value);
    setStatus(`Rotation: ${rotationDeg}° (applied on process)`);
  });

  // keyboard Enter -> trigger process if not focusing input
  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (e.key === "Enter" && active && (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA" && active.tagName !== "SELECT")) {
      processImage();
    }
  });

  // init sample loader (development convenience)
  // NOTE: uncomment tryLoadLocalSample() if you want the dev image auto-loaded:
  // tryLoadLocalSample();
}

/* Run init when DOM is ready */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* Exports for debugging/testing */
export { processImage, handleFiles, tryLoadLocalSample };
