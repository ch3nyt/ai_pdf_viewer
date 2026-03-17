const PADDING_Y = 15;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPageShellFromRange(range) {
  let container = range.commonAncestorContainer;
  if (container?.nodeType === Node.TEXT_NODE) {
    container = container.parentElement;
  }
  return container?.closest?.(".page-shell") || null;
}

function getRectsFromRange(range) {
  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    }));
}

function computeUnion(rects) {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function convertViewportRectToPdf(viewport, rect) {
  const [pdfX1, pdfY1] = viewport.convertToPdfPoint(rect.left, rect.top);
  const [pdfX2, pdfY2] = viewport.convertToPdfPoint(rect.right, rect.bottom);
  return {
    x1: Math.min(pdfX1, pdfX2),
    y1: Math.min(pdfY1, pdfY2),
    x2: Math.max(pdfX1, pdfX2),
    y2: Math.max(pdfY1, pdfY2)
  };
}

function cropRectsFromCanvas(canvas, rects) {
  const union = computeUnion(rects);
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.ceil(union.width));
  output.height = Math.max(1, Math.ceil(union.height));
  const ctx = output.getContext("2d");

  for (const rect of rects) {
    const sx = rect.left;
    const sy = rect.top;
    const sw = rect.width;
    const sh = rect.height;

    const dx = rect.left - union.left;
    const dy = rect.top - union.top;

    ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, sw, sh);
  }

  return output.toDataURL("image/png");
}

export class SelectionCapture {
  constructor({ getPageRenderState, viewerContainer, onManualCapture }) {
    this.getPageRenderState = getPageRenderState;
    this.viewerContainer = viewerContainer;
    this.onManualCapture = onManualCapture;
    this.manualEnabled = false;
    this.dragState = null;
    this.boxEl = null;
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
  }

  extractSelectionContext(range) {
    const pageShell = getPageShellFromRange(range);
    if (!pageShell) {
      return null;
    }
    const pageNumber = Number(pageShell.dataset.pageNumber);
    const pageState = this.getPageRenderState(pageNumber);
    if (!pageState?.viewport || !pageState?.canvas) {
      return null;
    }

    const clientRects = getRectsFromRange(range);
    if (clientRects.length === 0) {
      return null;
    }

    const shellRect = pageShell.getBoundingClientRect();
    const canvasWidth = pageState.canvas.width;
    const canvasHeight = pageState.canvas.height;

    const viewportRects = clientRects.map((rect) => {
      const left = clamp(rect.left - shellRect.left, 0, canvasWidth);
      const right = clamp(rect.right - shellRect.left, 0, canvasWidth);
      const top = clamp(rect.top - shellRect.top - PADDING_Y, 0, canvasHeight);
      const bottom = clamp(rect.bottom - shellRect.top + PADDING_Y, 0, canvasHeight);
      return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
      };
    });

    const filtered = viewportRects.filter((r) => r.width > 1 && r.height > 1);
    if (filtered.length === 0) {
      return null;
    }

    const selectionRectsPdf = filtered.map((rect) =>
      convertViewportRectToPdf(pageState.viewport, rect)
    );

    return {
      pageNum: pageNumber,
      viewportRects: filtered,
      selectionRectsPdf,
      unionViewport: computeUnion(filtered),
      pageState
    };
  }

  captureFromRange(range) {
    const context = this.extractSelectionContext(range);
    if (!context) {
      return null;
    }
    const imageDataUrl = cropRectsFromCanvas(context.pageState.canvas, context.viewportRects);
    return {
      pageNum: context.pageNum,
      imageDataUrl,
      sourceImage: imageDataUrl,
      coordsPdf: context.selectionRectsPdf[0] || null,
      selectionRectsPdf: context.selectionRectsPdf,
      viewportRects: context.viewportRects,
      unionViewport: context.unionViewport
    };
  }

  setManualEnabled(enabled) {
    this.manualEnabled = enabled;
    this.viewerContainer.classList.toggle("manual-capture-mode", enabled);
  }

  bindManualHandlers() {
    this.viewerContainer.addEventListener("mousedown", (event) => {
      if (!this.manualEnabled) {
        return;
      }
      const pageShell = event.target.closest(".page-shell");
      if (!pageShell) {
        return;
      }
      event.preventDefault();
      const pageNumber = Number(pageShell.dataset.pageNumber);
      const shellRect = pageShell.getBoundingClientRect();
      const x = clamp(event.clientX - shellRect.left, 0, shellRect.width);
      const y = clamp(event.clientY - shellRect.top, 0, shellRect.height);
      this.dragState = { pageShell, pageNumber, shellRect, startX: x, startY: y, x, y };

      this.boxEl = document.createElement("div");
      this.boxEl.className = "manual-capture-box";
      pageShell.appendChild(this.boxEl);

      document.addEventListener("mousemove", this.boundMouseMove);
      document.addEventListener("mouseup", this.boundMouseUp);
      this.paintDragBox();
    });
  }

  handleMouseMove(event) {
    if (!this.dragState) {
      return;
    }
    const { shellRect } = this.dragState;
    this.dragState.x = clamp(event.clientX - shellRect.left, 0, shellRect.width);
    this.dragState.y = clamp(event.clientY - shellRect.top, 0, shellRect.height);
    this.paintDragBox();
  }

  handleMouseUp() {
    if (!this.dragState) {
      return;
    }
    const { pageNumber, startX, startY, x, y } = this.dragState;
    const pageState = this.getPageRenderState(pageNumber);
    const left = Math.min(startX, x);
    const right = Math.max(startX, x);
    const top = Math.min(startY, y);
    const bottom = Math.max(startY, y);

    if (pageState?.viewport && pageState?.canvas && right - left > 5 && bottom - top > 5) {
      const rect = {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
      };
      const dataUrl = cropRectsFromCanvas(pageState.canvas, [rect]);
      const payload = {
        pageNum: pageNumber,
        imageDataUrl: dataUrl,
        sourceImage: dataUrl,
        coordsPdf: convertViewportRectToPdf(pageState.viewport, rect),
        selectionRectsPdf: [convertViewportRectToPdf(pageState.viewport, rect)],
        viewportRects: [rect],
        unionViewport: rect,
        manual: true
      };
      this.onManualCapture(payload);
    }

    if (this.boxEl) {
      this.boxEl.remove();
      this.boxEl = null;
    }
    this.dragState = null;
    document.removeEventListener("mousemove", this.boundMouseMove);
    document.removeEventListener("mouseup", this.boundMouseUp);
  }

  paintDragBox() {
    if (!this.dragState || !this.boxEl) {
      return;
    }
    const left = Math.min(this.dragState.startX, this.dragState.x);
    const top = Math.min(this.dragState.startY, this.dragState.y);
    const width = Math.abs(this.dragState.x - this.dragState.startX);
    const height = Math.abs(this.dragState.y - this.dragState.startY);

    this.boxEl.style.left = `${left}px`;
    this.boxEl.style.top = `${top}px`;
    this.boxEl.style.width = `${width}px`;
    this.boxEl.style.height = `${height}px`;
  }
}
