/* --------------------------------------------------
   BACKGROUND REMOVER — Full JS
   Uses TensorFlow BodyPix for segmentation
-------------------------------------------------- */

let net = null;              // BodyPix model
let originalImg = null;      // loaded image
let segmentationMask = null; // raw mask
let paintedMask = null;      // edited mask for brush
let canvas = null;
let ctx = null;
let brushMode = "erase";     // erase or restore
let isDrawing = false;

/* ---------- ELEMENTS ---------- */
const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("fileInput");
const cameraBtn = document.getElementById("cameraBtn");
const previewCanvas = document.getElementById("previewCanvas");
const loadingBox = document.getElementById("loadingBox");

const controlsSection = document.getElementById("controlsSection");

const smoothSlider = document.getElementById("smoothSlider");
const opacitySlider = document.getElementById("opacitySlider");
const eraseBtn = document.getElementById("eraseBtn");
const restoreBtn = document.getElementById("restoreBtn");
const downloadBtn = document.getElementById("downloadBtn");

/* --------------------------------------------------
   LOAD BODYPIX MODEL
-------------------------------------------------- */
async function loadModel() {
  loadingBox.classList.remove("hidden");
  loadingBox.querySelector("p").textContent = "Loading AI Model...";

  net = await bodyPix.load({
    architecture: "MobileNetV1",
    outputStride: 16,
    multiplier: 0.75,
    quantBytes: 2,
  });

  loadingBox.classList.add("hidden");
}
loadModel();

/* --------------------------------------------------
   HANDLE UPLOAD
-------------------------------------------------- */
dropArea.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  handleFile(fileInput.files[0]);
  fileInput.value = "";
});

dropArea.addEventListener("dragover", e => e.preventDefault());
dropArea.addEventListener("drop", e => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});

/* --------------------------------------------------
   CAMERA CAPTURE
-------------------------------------------------- */
cameraBtn.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";
  input.onchange = () => handleFile(input.files[0]);
  input.click();
});

/* --------------------------------------------------
   MAIN — HANDLE FILE
-------------------------------------------------- */
function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    alert("Please upload an image");
    return;
  }

  const img = new Image();
  img.onload = async () => {
    originalImg = img;
    await removeBackground();
    enableControls();
  };
  img.src = URL.createObjectURL(file);
}

/* --------------------------------------------------
   REMOVE BACKGROUND USING BODYPIX
-------------------------------------------------- */
async function removeBackground() {
  loadingBox.classList.remove("hidden");
  loadingBox.querySelector("p").textContent = "Removing background...";

  canvas = previewCanvas;
  ctx = canvas.getContext("2d");

  canvas.width = originalImg.width;
  canvas.height = originalImg.height;

  const segmentation = await net.segmentPerson(originalImg, {
    internalResolution: "medium",
    segmentationThreshold: 0.7,
  });

  segmentationMask = segmentation.data; // raw mask (0/1)
  paintedMask = new Uint8ClampedArray(segmentationMask); // editable mask

  drawFinalImage();
  loadingBox.classList.add("hidden");
}

/* --------------------------------------------------
   DRAW FINAL IMAGE WITH MASK + SETTINGS
-------------------------------------------------- */
function drawFinalImage() {
  if (!originalImg || !paintedMask) return;

  canvas.width = originalImg.width;
  canvas.height = originalImg.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Create image mask
  const imgData = ctx.createImageData(canvas.width, canvas.height);

  for (let i = 0; i < paintedMask.length; i++) {
    const show = paintedMask[i] === 1;
    const idx = i * 4;

    // Copy pixel from original image
    const pxData = getPixel(originalImg, i);

    imgData.data[idx] = pxData.r;
    imgData.data[idx + 1] = pxData.g;
    imgData.data[idx + 2] = pxData.b;

    imgData.data[idx + 3] = show ? opacitySlider.value * 2.55 : 0; // transparency
  }

  ctx.putImageData(imgData, 0, 0);

  if (smoothSlider.value > 0) {
    applyFeatherBlur();
  }
}

/* --------------------------------------------------
   READ PIXEL FROM ORIGINAL IMAGE
-------------------------------------------------- */
function getPixel(img, index) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.drawImage(img, 0, 0);

  const x = index % img.width;
  const y = Math.floor(index / img.width);

  const data = tempCtx.getImageData(x, y, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

/* --------------------------------------------------
   APPLY FEATHER SMOOTHING
-------------------------------------------------- */
function applyFeatherBlur() {
  ctx.filter = `blur(${smoothSlider.value}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";
}

/* --------------------------------------------------
   ENABLE CONTROL PANEL
-------------------------------------------------- */
function enableControls() {
  controlsSection.classList.remove("hidden");
}

/* --------------------------------------------------
   MASK EDITING — BRUSH
-------------------------------------------------- */
function canvasXY(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - rect.left) * (canvas.width / rect.width)),
    y: Math.round((e.clientY - rect.top) * (canvas.height / rect.height)),
  };
}

previewCanvas.addEventListener("mousedown", e => {
  isDrawing = true;
  editMask(e);
});
previewCanvas.addEventListener("mousemove", e => {
  if (isDrawing) editMask(e);
});
document.addEventListener("mouseup", () => (isDrawing = false));

function editMask(e) {
  const pos = canvasXY(e);
  const size = 25;

  for (let y = -size; y <= size; y++) {
    for (let x = -size; x <= size; x++) {
      const px = pos.x + x;
      const py = pos.y + y;

      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;

      const idx = py * canvas.width + px;

      if (brushMode === "erase") paintedMask[idx] = 0;
      else paintedMask[idx] = 1;
    }
  }

  drawFinalImage();
}

eraseBtn.onclick = () => {
  brushMode = "erase";
  eraseBtn.style.background = "#1f9bff";
  restoreBtn.style.background = "#273556";
};

restoreBtn.onclick = () => {
  brushMode = "restore";
  restoreBtn.style.background = "#1f9bff";
  eraseBtn.style.background = "#273556";
};

/* --------------------------------------------------
   SLIDERS
-------------------------------------------------- */
smoothSlider.oninput = drawFinalImage;
opacitySlider.oninput = drawFinalImage;

/* --------------------------------------------------
   DOWNLOAD PNG
-------------------------------------------------- */
downloadBtn.addEventListener("click", () => {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = "background-removed.png";
  a.click();
});
