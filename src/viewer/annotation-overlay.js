function normalizePdfRect(rect) {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2)
  };
}

function pdfRectToViewportRect(viewport, rect) {
  const safe = normalizePdfRect(rect);
  const p1 = viewport.convertToViewportPoint(safe.x1, safe.y1);
  const p2 = viewport.convertToViewportPoint(safe.x2, safe.y2);
  const left = Math.min(p1[0], p2[0]);
  const top = Math.min(p1[1], p2[1]);
  const right = Math.max(p1[0], p2[0]);
  const bottom = Math.max(p1[1], p2[1]);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function tightenRectForDisplay(rect) {
  const insetY = Math.min(12, Math.max(1, rect.height * 0.42));
  const insetX = Math.min(10, Math.max(1, rect.width * 0.08));
  const nextTop = rect.top + insetY;
  const nextHeight = Math.max(1, rect.height - insetY * 2);
  return {
    ...rect,
    left: rect.left + insetX,
    top: nextTop,
    width: Math.max(1, rect.width - insetX * 2),
    height: nextHeight
  };
}

function ensureOverlayLayer(pageShell) {
  let layer = pageShell.querySelector(".annotation-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "annotation-layer";
    pageShell.appendChild(layer);
  }
  layer.innerHTML = "";
  return layer;
}

export class AnnotationOverlay {
  constructor({ getPageRenderState, onOpenAnnotation }) {
    this.getPageRenderState = getPageRenderState;
    this.onOpenAnnotation = onOpenAnnotation;
  }

  renderPageAnnotations(pageNum, annotations) {
    const pageState = this.getPageRenderState(pageNum);
    if (!pageState?.pageShell || !pageState?.viewport) {
      return;
    }
    const layer = ensureOverlayLayer(pageState.pageShell);

    for (const annotation of annotations) {
      const rects =
        annotation.selectionRectsPdf?.length > 0
          ? annotation.selectionRectsPdf
          : annotation.coordsPdf
            ? [annotation.coordsPdf]
            : [];
      if (rects.length === 0) {
        continue;
      }

      const viewportRects = rects
        .map((rect) => pdfRectToViewportRect(pageState.viewport, rect))
        .map((rect) => tightenRectForDisplay(rect));
      viewportRects.forEach((rect) => {
        const highlight = document.createElement("div");
        highlight.className = `annotation-highlight annotation-${annotation.type || "note"}`;
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        highlight.title = annotation.type === "ai" ? "Open AI note" : "Open note";
        highlight.dataset.annotationId = annotation.id;
        layer.appendChild(highlight);
      });

      const first = viewportRects[0];
      if (first) {
        const icon = document.createElement("button");
        icon.className = "annotation-icon";
        icon.type = "button";
        icon.textContent = annotation.type === "ai" ? "AI" : "N";
        icon.style.left = `${first.left + first.width + 4}px`;
        icon.style.top = `${first.top - 4}px`;
        icon.addEventListener("click", (event) => {
          event.stopPropagation();
          this.onOpenAnnotation(annotation, event.currentTarget.getBoundingClientRect());
        });
        icon.addEventListener("mouseenter", () => {
          this.setGroupHover(layer, annotation.id, true);
        });
        icon.addEventListener("mouseleave", () => {
          this.setGroupHover(layer, annotation.id, false);
        });
        layer.appendChild(icon);
      }
    }
  }

  setGroupHover(layer, annotationId, on) {
    const targets = layer.querySelectorAll(
      `.annotation-highlight[data-annotation-id="${annotationId}"]`
    );
    for (const node of targets) {
      node.classList.toggle("group-hover", on);
    }
  }
}
