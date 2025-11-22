// app.js (ES module)
// NOTE: Ensure index.html loads this script with: <script type="module" src="app.js"></script>

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

// Optional: expects JSZip to be available as window.JSZip if you want ZIP functionality

// --- DOM Elements (matches index.html)
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

const canvas = document.createElement("canvas"); // offscreen processing canvas
const ctx = canvas.getContext("2d");

let currentFile = null;
let currentImage = null;
let currentOrientation = -1;
let currentCropper = null;
let cropEnabled = false;

// Developer-provided local sample path (from conversation history)
// Keep this path as-is if you want the local sample auto-try during development:
const SAMPLE_LOCAL_PATH = "/mnt/data/Untitled.png";

/* ---------- UI helpers ---------- */
function setStatus(text) {
  if (previewInfo) previewInfo.textContent = text;
}

function enableDownload(enabled = true) {
  downloadBtn.disabled = !enabled;
  downloadBtn.classList.toggle("disabled", !enabled);
}

/* ---------- File / Drag & Drop handling ---------- */
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

dropArea.addEventListener("drop", (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  handleFiles(files);
}, false);

dropArea.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

/* ---------- Handle incoming FileList ---------- */
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  // pick first file for preview (tool focuses on single-image flow by default)
  const file = fileList[0];
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  currentFile = file;
  setStatus("Loading image...");
  try {
    // read EXIF orientation first (JPEGs)
    currentOrientation = await getExifOrientation(file);

    // load image element
    const img = await loadImage(file);
    currentImage = img;

    // show preview (use safe object URL)
    previewImg.src = safeURL(file);
    previewImg.style.display = "";
    setStatus(`${formatSize(file.size)} • ${img.naturalWidth} × ${img.naturalHeight}px`);

    // clear any existing cropper
    if (currentCropper) {
      // recreate canvas for cropper on the preview (we'll attach to an offscreen canvas overlay to keep UI simple)
      currentCropper = null;
    }
  } catch (err) {
    console.error("Error loading image:", err);
    alert("Could not load the image. See console for details.");
    setStatus("Failed to load image");
  }
  enableDownload(false);
}

/* ---------- Resize + Process Logic ---------- */
async function processImage() {
  if (!currentImage) {
    alert("Please upload an image first.");
    return;
  }

  setStatus("Processing...");
  processBtn.disabled = true;

  // Determine target size
  const imgW = currentImage.naturalWidth;
  const imgH = currentImage.naturalHeight;

  const type = resizeTypeEl.value; // "px" | "percent" | "longest"
  let wVal = widthInput.value ? Number(widthInput.value) : null;
  let hVal = heightInput.value ? Number(heightInput.value) : null;

  // convert units
  const dims = convertResize(wVal, hVal, type === "px" ? "px" : (type === "percent" ? "percent" : "longest"), imgW, imgH);
  let targetW = Math.max(1, Math.round(dims.w));
  let targetH = Math.max(1, Math.round(dims.h));

  // Maintain aspect ratio if checked and only one dimension provided
  if (keepRatioEl.checked) {
    if (widthInput.value && !heightInput.value) {
      targetH = Math.round((targetW / imgW) * imgH);
    } else if (!widthInput.value && heightInput.value) {
      targetW = Math.round((targetH / imgH) * imgW);
    }
  }

  // If crop is enabled and cropper is present, export cropped canvas instead
  let sourceCanvas;
  if (cropEnabled && currentCropper) {
    const cropped = currentCropper.export();
    sourceCanvas = cropped;
  } else {
    // draw original image (apply orientation if needed)
    // draw the image to an intermediate canvas of original size (or scaled if extremely large)
    const source = document.createElement("canvas");
    source.width = imgW;
    source.height = imgH;
    const sctx = source.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(currentImage, 0, 0, imgW, imgH);

    if (currentOrientation > 1) {
      sourceCanvas = applyOrientation(source, currentOrientation);
    } else {
      sourceCanvas = source;
    }
  }

  // Create output canvas with requested dimensions
  const outCanvas = document.createElement("canvas");
  outCanvas.width = targetW;
  outCanvas.height = targetH;
  const outCtx = outCanvas.getContext("2d");
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";

  // draw scaled content
  outCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, targetW, targetH);

  // choose mime & quality
  const mime = formatSelect.value || "image/jpeg";
  const q = mime === "image/png" ? 1 : (Number(qualitySlider.value) / 100);

  // convert to blob
  const blob = await canvasToBlob(outCanvas, mime, q);

  // show result preview (use object URL)
  const url = safeURL(blob);
  previewImg.src = url; // replaces preview with processed result
  setStatus(`${formatSize(blob.size)} • ${formatDim(targetW, targetH)}`);

  // attach download
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
  processBtn.disabled = false;
}

/* ---------- ZIP multiple files (simple helper) ---------- */
async function zipAndDownload(files) {
  if (!window.JSZip) {
    alert("JSZip library not loaded. ZIP download unavailable.");
    return;
  }
  const zip = new JSZip();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    zip.file(f.name || `file_${i}.png`, f);
  }
  setStatus("Preparing ZIP...");
  const zblob = await zip.generateAsync({ type: "blob" });
  const url = safeURL(zblob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "images.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus("Done (ZIP ready)");
}

/* ---------- Optional: Try load local sample (developer helper) ---------- */
/*
  The conversation included a local image path: /mnt/data/Untitled.png
  If you want to auto-populate the preview during local testing, uncomment the call below.
  Cloud environments (browsers) can't read arbitrary server file paths; this is intended
  for environments where that path is served or transformed to a URL by tooling.
*/
async function tryLoadLocalSample() {
  try {
    // attempt to load sample path - may fail in browser if not accessible
    const resp = await fetch(SAMPLE_LOCAL_PATH, { method: "GET" });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const fileLike = new File([blob], "sample.png", { type: blob.type });
    await handleFiles([fileLike]);
  } catch (e) {
    // ignore - this is only a development aid
    // console.debug("Local sample not available:", e);
  }
}

/* ---------- Initialization ---------- */
function init() {
  qualitySlider.addEventListener("input", () => {
    qualityVal.textContent = `${qualitySlider.value}%`;
  });

  processBtn.addEventListener("click", processImage);

  downloadBtn.addEventListener("click", () => {
    if (downloadBtn.disabled) return;
    // download onclick is set after processing
  });

  // Keyboard enter to process
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.activeElement === null) {
      processImage();
    }
  });

  // Add crop toggle via double-click on preview (simple UX)
  previewImg.addEventListener("dblclick", async () => {
    if (!currentImage) return;
    // attach a visible canvas for cropping in place of preview
    const parent = previewImg.parentElement;
    let canvasEl = parent.querySelector("canvas.crop-canvas");
    if (!canvasEl) {
      canvasEl = document.createElement("canvas");
      canvasEl.className = "crop-canvas";
      canvasEl.style.maxWidth = "100%";
      canvasEl.style.display = "block";
      parent.insertBefore(canvasEl, previewImg);
      previewImg.style.display = "none";

      // size canvas to preview display size but keep mapping to natural image inside cropper
      const displayW = previewImg.clientWidth || currentImage.naturalWidth;
      const displayH = Math.round((currentImage.naturalHeight / currentImage.naturalWidth) * displayW);
      canvasEl.width = displayW;
      canvasEl.height = displayH;

      // render the image scaled to fit canvas
      const cctx = canvasEl.getContext("2d");
      cctx.drawImage(currentImage, 0, 0, canvasEl.width, canvasEl.height);

      currentCropper = new Cropper(canvasEl, currentImage);
      cropEnabled = true;
      setStatus("Crop mode enabled — drag to adjust. Double-click again to exit crop mode.");
    } else {
      // exit crop mode: export cropped canvas to previewImage
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

  // Try to load the conversation-local sample automatically (developer convenience)
  tryLoadLocalSample();
}

// run init on module load
init();

// export some functions for debugging (optional)
export {
  processImage,
  handleFiles,
  zipAndDownload,
  tryLoadLocalSample
};
