// cropper.js - small Cropper placeholder (simple selection & export)
export class Cropper {
  constructor(canvasEl, imageEl) {
    this.canvas = canvasEl;
    this.ctx = this.canvas.getContext('2d');
    this.image = imageEl;
    this.start = null;
    this.rect = null;
    this.dragging = false;
    this.init();
  }

  init() {
    // Simple click-drag rectangle selection on the visible canvas
    this.canvas.addEventListener('mousedown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.start = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.dragging = true;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.rect = {
        x: Math.min(this.start.x, x),
        y: Math.min(this.start.y, y),
        w: Math.abs(this.start.x - x),
        h: Math.abs(this.start.y - y)
      };
      // draw overlay
      this.draw();
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
  }

  draw() {
    // redraw image then overlay rectangle
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.ctx.drawImage(this.image,0,0,this.canvas.width,this.canvas.height);
    if (this.rect) {
      this.ctx.strokeStyle = '#7fc6ff';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
    }
  }

  export() {
    // return a canvas with the cropped area at natural resolution (approx)
    if (!this.rect) return this.canvas;
    const out = document.createElement('canvas');
    const scaleX = this.image.naturalWidth / this.canvas.width;
    const scaleY = this.image.naturalHeight / this.canvas.height;
    out.width = Math.max(1, Math.round(this.rect.w * scaleX));
    out.height = Math.max(1, Math.round(this.rect.h * scaleY));
    const ctx = out.getContext('2d');
    ctx.drawImage(this.image,
      Math.round(this.rect.x * scaleX),
      Math.round(this.rect.y * scaleY),
      Math.round(this.rect.w * scaleX),
      Math.round(this.rect.h * scaleY),
      0,0,out.width,out.height);
    return out;
  }
}
