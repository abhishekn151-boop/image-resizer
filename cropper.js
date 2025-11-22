/* -----------------------------------------------------------
 * cropper.js
 * Lightweight cropping tool for the image resizer.
 * No external libraries required.
 * ----------------------------------------------------------- */

export class Cropper {
  constructor(canvas, img) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.img = img;

    // Crop area defaults
    this.crop = {
      x: canvas.width * 0.1,
      y: canvas.height * 0.1,
      w: canvas.width * 0.8,
      h: canvas.height * 0.8,
    };

    this.dragging = false;
    this.resizing = false;
    this.resizeHandle = null;
    this.aspect = null; // null = free crop

    // Bind events
    canvas.addEventListener("mousedown", this.onMouseDown.bind(this));
    canvas.addEventListener("mousemove", this.onMouseMove.bind(this));
    canvas.addEventListener("mouseup", this.onMouseUp.bind(this));

    this.render();
  }

  /* -----------------------------------------------------------
   * Render image + crop overlay
   * ----------------------------------------------------------- */
  render() {
    const { ctx, canvas, img, crop } = this;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Overlay shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear crop area
    ctx.clearRect(crop.x, crop.y, crop.w, crop.h);

    // Draw crop border
    ctx.strokeStyle = "#00c8ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

    // Draw resize handles
    this.drawHandle(crop.x, crop.y);
    this.drawHandle(crop.x + crop.w, crop.y);
    this.drawHandle(crop.x, crop.y + crop.h);
    this.drawHandle(crop.x + crop.w, crop.y + crop.h);
  }

  drawHandle(x, y) {
    const size = 10;
    this.ctx.fillStyle = "#00c8ff";
    this.ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }

  /* -----------------------------------------------------------
   * Detect if mouse is on handle
   * ----------------------------------------------------------- */
  getHandleAt(x, y) {
    const { crop } = this;
    const handles = {
      tl: [crop.x, crop.y],
      tr: [crop.x + crop.w, crop.y],
      bl: [crop.x, crop.y + crop.h],
      br: [crop.x + crop.w, crop.y + crop.h],
    };

    for (const [key, [hx, hy]] of Object.entries(handles)) {
      if (Math.abs(x - hx) < 10 && Math.abs(y - hy) < 10) {
        return key;
      }
    }
    return null;
  }

  /* -----------------------------------------------------------
   * Mouse Down
   * ----------------------------------------------------------- */
  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { crop } = this;

    const handle = this.getHandleAt(x, y);
    if (handle) {
      this.resizing = true;
      this.resizeHandle = handle;
      return;
    }

    // Check if inside crop area → drag
    if (x > crop.x && x < crop.x + crop.w && y > crop.y && y < crop.y + crop.h) {
      this.dragging = true;
      this.dragOffsetX = x - crop.x;
      this.dragOffsetY = y - crop.y;
    }
  }

  /* -----------------------------------------------------------
   * Mouse Move
   * ----------------------------------------------------------- */
  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { crop } = this;

    if (this.dragging) {
      crop.x = x - this.dragOffsetX;
      crop.y = y - this.dragOffsetY;
      this.render();
      return;
    }

    if (this.resizing) {
      this.resizeCrop(x, y);
      this.render();
      return;
    }
  }

  /* -----------------------------------------------------------
   * Mouse Up
   * ----------------------------------------------------------- */
  onMouseUp() {
    this.dragging = false;
    this.resizing = false;
    this.resizeHandle = null;
  }

  /* -----------------------------------------------------------
   * Resize crop based on handle
   * ----------------------------------------------------------- */
  resizeCrop(x, y) {
    const { crop } = this;

    switch (this.resizeHandle) {
      case "tl":
        crop.w += crop.x - x;
        crop.h += crop.y - y;
        crop.x = x;
        crop.y = y;
        break;
      case "tr":
        crop.w = x - crop.x;
        crop.h += crop.y - y;
        crop.y = y;
        break;
      case "bl":
        crop.w += crop.x - x;
        crop.x = x;
        crop.h = y - crop.y;
        break;
      case "br":
        crop.w = x - crop.x;
        crop.h = y - crop.y;
        break;
    }

    // Apply aspect ratio
    if (this.aspect) {
      crop.h = crop.w / this.aspect;
    }

    // Minimum size
    crop.w = Math.max(crop.w, 30);
    crop.h = Math.max(crop.h, 30);
  }

  /* -----------------------------------------------------------
   * Set aspect ratio
   * ----------------------------------------------------------- */
  setAspect(ratio) {
    // ratio = width / height
    this.aspect = ratio;
    this.render();
  }

  /* -----------------------------------------------------------
   * Get cropped canvas
   * ----------------------------------------------------------- */
  export() {
    const { crop, canvas, img } = this;

    const temp = document.createElement("canvas");
    temp.width = crop.w;
    temp.height = crop.h;

    const tctx = temp.getContext("2d");
    tctx.drawImage(
      img,
      (crop.x / canvas.width) * img.width,
      (crop.y / canvas.height) * img.height,
      (crop.w / canvas.width) * img.width,
      (crop.h / canvas.height) * img.height,
      0,
      0,
      crop.w,
      crop.h
    );

    return temp;
  }
}
