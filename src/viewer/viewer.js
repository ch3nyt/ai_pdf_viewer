import { MESSAGE_TYPES, PORT_NAMES } from "../common/messages.js";
import { ACTION_PROMPTS } from "../common/prompts.js";
import {
  deleteAnnotation,
  listAnnotationsByPdf,
  getAnnotationsByPdfPage,
  openDb,
  upsertAnnotation
} from "../storage/db.js";
import { AnnotationOverlay } from "./annotation-overlay.js";
import { NotesEditor } from "./notes-editor.js";
import { SelectionCapture } from "./selection-capture.js";
import { TooltipMenu } from "./tooltip-menu.js";
import { renderRichText } from "./latex-renderer.js";

const state = {
  fileUrl: "",
  pdfId: "",
  pdfDoc: null,
  pdfjsLib: null,
  pageCount: 0,
  currentPage: 1,
  scale: 1.0,
  renderObserver: null,
  renderedPages: new Set(),
  pageRenderStates: new Map(),
  manualCapture: false,
  latestSelectionContext: null,
  selectedAnnotationId: null,
  annotationSort: "updated_desc",
  hoveredAnnotationId: null,
  inlineChatMessages: [],
  inlineChatContext: null,
  inlineChatAnnotationId: null,
  pendingActionCapture: null,
  pendingActionAnchorRect: null
};

const ui = {
  loading: document.getElementById("loading-state"),
  pagesRoot: document.getElementById("pages-root"),
  pageIndicator: document.getElementById("page-indicator"),
  zoomIndicator: document.getElementById("zoom-indicator"),
  pdfId: document.getElementById("pdf-id"),
  prevPage: document.getElementById("prev-page"),
  nextPage: document.getElementById("next-page"),
  zoomOut: document.getElementById("zoom-out"),
  zoomIn: document.getElementById("zoom-in"),
  toggleManualCapture: document.getElementById("toggle-manual-capture"),
  viewerContainer: document.getElementById("viewer-container"),
  aiResponse: document.getElementById("ai-response"),
  noteEditorRoot: document.getElementById("note-editor"),
  sidebarRoot: document.getElementById("sidebar"),
  settingModel: document.getElementById("setting-model"),
  settingChatModel: document.getElementById("setting-chat-model"),
  settingApiKey: document.getElementById("setting-api-key"),
  settingUseMock: document.getElementById("setting-use-mock"),
  saveSettings: document.getElementById("save-settings"),
  editCurrentAnnotation: document.getElementById("edit-current-annotation"),
  deleteCurrentAnnotation: document.getElementById("delete-current-annotation"),
  annotationList: document.getElementById("annotation-list"),
  annotationSort: document.getElementById("annotation-sort"),
  localOpenPanel: document.getElementById("local-open-panel"),
  localPdfInput: document.getElementById("local-pdf-input"),
  dropZone: document.getElementById("drop-zone"),
  inlineNotePopover: document.getElementById("inline-note-popover"),
  inlineNoteTitle: document.getElementById("inline-note-title"),
  inlineNotePreview: document.getElementById("inline-note-preview"),
  inlineNoteInput: document.getElementById("inline-note-input"),
  inlineNoteClose: document.getElementById("inline-note-close"),
  inlineNoteEdit: document.getElementById("inline-note-edit"),
  inlineNoteSave: document.getElementById("inline-note-save"),
  inlineNoteDelete: document.getElementById("inline-note-delete"),
  inlineChatPopover: document.getElementById("inline-chat-popover"),
  inlineChatHeader: document.getElementById("inline-chat-header"),
  inlineChatClose: document.getElementById("inline-chat-close"),
  inlineChatMessages: document.getElementById("inline-chat-messages"),
  inlineChatInput: document.getElementById("inline-chat-input"),
  inlineChatSend: document.getElementById("inline-chat-send"),
  inlineChatContext: document.getElementById("inline-chat-context")
};

const tooltipMenu = new TooltipMenu({
  onAction: (action, range) => {
    handleSelectionAction(action, range).catch((error) => {
      ui.aiResponse.textContent = `AI 分析失敗: ${error.message}`;
    });
  }
});

const selectionCapture = new SelectionCapture({
  getPageRenderState: (pageNum) => state.pageRenderStates.get(pageNum) || null,
  viewerContainer: ui.viewerContainer,
  onManualCapture: (payload) => {
    state.manualCapture = false;
    selectionCapture.setManualEnabled(false);
    ui.toggleManualCapture.textContent = "Box Select";
    state.latestSelectionContext = payload;
    state.pendingActionCapture = payload;
    renderSelectionPreview();
    const pageState = state.pageRenderStates.get(payload.pageNum);
    const shellRect = pageState?.pageShell?.getBoundingClientRect();
    if (shellRect) {
      const rect = {
        left: shellRect.left + payload.unionViewport.left,
        bottom: shellRect.top + payload.unionViewport.top + payload.unionViewport.height
      };
      state.pendingActionAnchorRect = {
        left: rect.left,
        top: rect.bottom - 8,
        right: rect.left + payload.unionViewport.width,
        bottom: rect.bottom
      };
      tooltipMenu.showNearRect(rect, null, { persistent: true });
    }
  }
});
selectionCapture.bindManualHandlers();

const notesEditor = new NotesEditor({
  root: ui.noteEditorRoot,
  onSave: async (payload) => {
    const saved = await upsertAnnotation({
      id: payload.annotationId || undefined,
      pdfId: state.pdfId,
      pageNum: payload.pageNum,
      coordsPdf: payload.coordsPdf,
      selectionRectsPdf: payload.selectionRectsPdf || [],
      type: payload.type || "note",
      action: payload.action || null,
      content: payload.content,
      sourceImage: payload.sourceImage || null,
      threadId: payload.threadId || null,
      createdAt: payload.createdAt || undefined
    });
    await hydratePage(saved.pageNum);
    setSelectedAnnotation(saved);
    await refreshAnnotationList();
  }
});

const annotationOverlay = new AnnotationOverlay({
  getPageRenderState: (pageNum) => state.pageRenderStates.get(pageNum) || null,
  onOpenAnnotation: (annotation, anchorRect) => {
    setSelectedAnnotation(annotation);
    if (annotation.action === "chat_context") {
      openAiChatFromAnnotation(annotation, anchorRect);
      return;
    }
    openInlinePopover(annotation, anchorRect);
  }
});

function getFileUrlFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("file") || "";
}

function isDebugTextLayerEnabled() {
  const params = new URLSearchParams(window.location.search);
  const value = (params.get("debugTextLayer") || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function updatePageIndicator() {
  ui.pageIndicator.textContent = `Page ${state.currentPage} / ${state.pageCount || "-"}`;
}

function updateZoomIndicator() {
  ui.zoomIndicator.textContent = `${Math.round(state.scale * 100)}%`;
}

function updatePdfIdLabel(pdfId) {
  if (!pdfId) {
    ui.pdfId.textContent = "PDF ID: -";
    return;
  }
  ui.pdfId.textContent = `PDF ID: ${pdfId.slice(0, 12)}...`;
}

function showLocalOpenPanel(show) {
  ui.localOpenPanel.classList.toggle("hidden", !show);
}

function setLoading(text) {
  ui.loading.textContent = text || "";
}

function formatTime(ts) {
  if (!ts) {
    return "-";
  }
  return new Date(ts).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function summarizeContent(content) {
  const clean = String(content || "").replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 120)}...` : clean || "(empty)";
}

function sortAnnotations(items, mode) {
  const list = items.slice();
  if (mode === "updated_asc") {
    return list.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  }
  if (mode === "page_asc") {
    return list.sort((a, b) => (a.pageNum || 0) - (b.pageNum || 0) || (a.updatedAt || 0) - (b.updatedAt || 0));
  }
  if (mode === "page_desc") {
    return list.sort((a, b) => (b.pageNum || 0) - (a.pageNum || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function setSelectedAnnotation(annotation) {
  if (!annotation) {
    state.selectedAnnotationId = null;
    ui.aiResponse.textContent = "尚未選取註解。";
    ui.editCurrentAnnotation.disabled = true;
    ui.deleteCurrentAnnotation.disabled = true;
    closeInlinePopover();
    return;
  }

  state.selectedAnnotationId = annotation.id;
  ui.aiResponse.innerHTML = renderRichText(annotation.content || "");
  ui.editCurrentAnnotation.disabled = false;
  ui.deleteCurrentAnnotation.disabled = false;
}

function closeInlinePopover() {
  ui.inlineNotePopover.classList.add("hidden");
  ui.inlineNotePopover.dataset.annotationId = "";
}

function closeInlineChatPopover() {
  ui.inlineChatPopover.classList.add("hidden");
}

function pdfRectToViewportRect(viewport, rect) {
  const p1 = viewport.convertToViewportPoint(rect.x1, rect.y1);
  const p2 = viewport.convertToViewportPoint(rect.x2, rect.y2);
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
  return {
    ...rect,
    left: rect.left + insetX,
    top: rect.top + insetY,
    width: Math.max(1, rect.width - insetX * 2),
    height: Math.max(1, rect.height - insetY * 2)
  };
}

function clearSelectionPreview() {
  const layers = ui.pagesRoot.querySelectorAll(".selection-preview-layer");
  for (const layer of layers) {
    layer.remove();
  }
}

function clearCurrentSelectionContext() {
  state.latestSelectionContext = null;
  state.pendingActionCapture = null;
  state.pendingActionAnchorRect = null;
  clearSelectionPreview();
}

function ensureSelectionPreviewLayer(pageShell) {
  let layer = pageShell.querySelector(".selection-preview-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "selection-preview-layer";
    pageShell.appendChild(layer);
  }
  layer.innerHTML = "";
  return layer;
}

function renderSelectionPreview() {
  clearSelectionPreview();
  const ctx = state.latestSelectionContext;
  if (!ctx || !ctx.pageNum) {
    return;
  }
  const pageState = state.pageRenderStates.get(ctx.pageNum);
  if (!pageState?.pageShell || !pageState?.viewport) {
    return;
  }
  const layer = ensureSelectionPreviewLayer(pageState.pageShell);
  const rectsPdf = Array.isArray(ctx.selectionRectsPdf) ? ctx.selectionRectsPdf : [];
  const rects = rectsPdf
    .map((rect) => pdfRectToViewportRect(pageState.viewport, rect))
    .map((rect) => tightenRectForDisplay(rect));
  for (const rect of rects) {
    const node = document.createElement("div");
    node.className = "selection-preview-rect";
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
    layer.appendChild(node);
  }
}

function positionFloatingPopover(popoverEl, anchorRect) {
  if (!anchorRect || !popoverEl) {
    return;
  }
  const spacing = 10;
  const maxLeft = window.innerWidth - popoverEl.offsetWidth - 8;
  const preferredRight = anchorRect.right + spacing;
  const fallbackLeft = anchorRect.left - popoverEl.offsetWidth - spacing;
  let left = preferredRight;
  if (left > maxLeft) {
    left = Math.max(8, fallbackLeft);
  }

  const maxTop = window.innerHeight - popoverEl.offsetHeight - 8;
  const top = Math.min(maxTop, Math.max(8, anchorRect.top));
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function openInlinePopover(annotation, anchorRect) {
  if (!annotation) {
    return;
  }
  closeInlineChatPopover();
  ui.inlineNotePopover.dataset.annotationId = annotation.id;
  ui.inlineNoteTitle.textContent = annotation.type === "ai" ? "AI Note" : "Note";
  ui.inlineNoteInput.value = annotation.content || "";
  ui.inlineNotePreview.innerHTML = renderRichText(annotation.content || "");
  ui.inlineNoteInput.classList.add("hidden");
  ui.inlineNoteInput.readOnly = true;
  ui.inlineNoteSave.disabled = true;
  ui.inlineNotePopover.classList.remove("hidden");
  // Wait for layout so position can use actual popover size.
  window.requestAnimationFrame(() => {
    positionFloatingPopover(ui.inlineNotePopover, anchorRect);
  });
}

function enableInlineNoteEditing(enabled) {
  ui.inlineNoteInput.readOnly = !enabled;
  ui.inlineNoteInput.classList.toggle("hidden", !enabled);
  ui.inlineNoteSave.disabled = !enabled;
  if (enabled) {
    ui.inlineNoteInput.focus();
  }
}

function makePopoverDraggable(popoverEl, handleEl) {
  if (!popoverEl || !handleEl) {
    return;
  }
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handleEl.addEventListener("mousedown", (event) => {
    dragging = true;
    const rect = popoverEl.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    popoverEl.dataset.pinned = "1";
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    const maxLeft = window.innerWidth - popoverEl.offsetWidth - 8;
    const maxTop = window.innerHeight - popoverEl.offsetHeight - 8;
    const left = Math.min(maxLeft, Math.max(8, event.clientX - offsetX));
    const top = Math.min(maxTop, Math.max(8, event.clientY - offsetY));
    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
  });
}

function renderInlineChatMessages() {
  ui.inlineChatMessages.innerHTML = state.inlineChatMessages
    .map(
      (msg) => `<div class="inline-chat-item ${msg.role}">
        <strong>${msg.role === "assistant" ? "Assistant" : "You"}</strong>
        <div>${renderRichText(msg.content || "")}</div>
      </div>`
    )
    .join("");
  ui.inlineChatMessages.scrollTop = ui.inlineChatMessages.scrollHeight;
}

function openInlineChatPopover(anchorRect) {
  closeInlinePopover();
  ui.inlineChatPopover.classList.remove("hidden");
  renderInlineChatMessages();
  window.requestAnimationFrame(() => {
    if (ui.inlineChatPopover.dataset.pinned !== "1") {
      positionFloatingPopover(ui.inlineChatPopover, anchorRect);
    }
    ui.inlineChatInput.focus();
  });
}

async function persistInlineChatAsAnnotation() {
  const ctx = state.inlineChatContext;
  if (!ctx) {
    return;
  }
  const content = state.inlineChatMessages
    .map((msg) => `${msg.role === "assistant" ? "Assistant" : "User"}: ${msg.content}`)
    .join("\n\n");
  if (!content.trim()) {
    return;
  }
  const saved = await upsertAnnotation({
    id: state.inlineChatAnnotationId || undefined,
    pdfId: state.pdfId,
    pageNum: ctx.pageNum,
    coordsPdf: ctx.coordsPdf,
    selectionRectsPdf: ctx.selectionRectsPdf || [],
    type: "ai",
    action: "chat_context",
    content,
    sourceImage: ctx.sourceImage || null,
    meta: {
      selectedText: ctx.selectedText || "",
      chatMessages: state.inlineChatMessages.map((msg) => ({
        role: msg.role,
        content: msg.content
      }))
    }
  });
  state.inlineChatAnnotationId = saved.id;
  await hydratePage(saved.pageNum);
  await refreshAnnotationList();
}

async function sendInlineChatMessage() {
  const content = ui.inlineChatInput.value.trim();
  if (!content) {
    return;
  }
  const includeContext = ui.inlineChatContext.checked;
  ui.inlineChatInput.value = "";
  state.inlineChatMessages.push({ role: "user", content });
  state.inlineChatMessages.push({ role: "assistant", content: "" });
  renderInlineChatMessages();
  ui.inlineChatSend.disabled = true;
  ui.inlineChatSend.textContent = "Sending...";

  const context = state.inlineChatContext || state.latestSelectionContext;
  const contextNote =
    includeContext && context
      ? `page=${context.pageNum}; selectedText=${context.selectedText || ""}; rects=${JSON.stringify(
          context.selectionRectsPdf || []
        )}`
      : "";
  const history = state.inlineChatMessages
    .filter((msg) => msg.content && (msg.role === "user" || msg.role === "assistant"))
    .map((msg) => ({ role: msg.role, content: msg.content }));

  try {
    const streamed = await streamCompletion({
      mode: "chat",
      payload: { history, contextNote },
      onAccumulated: (acc) => {
        state.inlineChatMessages[state.inlineChatMessages.length - 1].content = acc;
        renderInlineChatMessages();
      }
    });
    state.inlineChatMessages[state.inlineChatMessages.length - 1].content = streamed;
    renderInlineChatMessages();
    await persistInlineChatAsAnnotation();
  } catch (error) {
    state.inlineChatMessages[state.inlineChatMessages.length - 1].content =
      `[stream error] ${error.message || error}`;
    renderInlineChatMessages();
  } finally {
    ui.inlineChatSend.disabled = false;
    ui.inlineChatSend.textContent = "Send";
  }
}

function getCapturePayloadFromActionSource(range) {
  if (range) {
    return selectionCapture.captureFromRange(range);
  }
  return state.pendingActionCapture || state.latestSelectionContext || null;
}

function openAiChatFromPayload(payload, anchorRect = null) {
  if (!payload) {
    ui.aiResponse.textContent = "無法從目前選取範圍建立 AI Chat。";
    return;
  }
  state.latestSelectionContext = payload;
  state.pendingActionCapture = payload;
  renderSelectionPreview();
  state.inlineChatContext = state.latestSelectionContext;
  state.inlineChatMessages = [];
  state.inlineChatAnnotationId = null;
  renderInlineChatMessages();
  if (anchorRect) {
    openInlineChatPopover(anchorRect);
  }
}

function openAiChatFromAnnotation(annotation, anchorRect = null) {
  state.inlineChatContext = {
    pageNum: annotation.pageNum,
    coordsPdf: annotation.coordsPdf,
    selectionRectsPdf: annotation.selectionRectsPdf || [],
    selectedText: annotation?.meta?.selectedText || ""
  };
  state.inlineChatMessages = Array.isArray(annotation?.meta?.chatMessages)
    ? annotation.meta.chatMessages.map((m) => ({ role: m.role, content: m.content }))
    : [];
  state.inlineChatAnnotationId = annotation.id;
  renderInlineChatMessages();
  if (anchorRect) {
    openInlineChatPopover(anchorRect);
  }
}

async function handleSelectionAction(action, range) {
  const capturePayload = getCapturePayloadFromActionSource(range);
  if (!capturePayload) {
    ui.aiResponse.textContent = "無法取得目前選取區域。";
    return;
  }

  if (range) {
    const selectedText = window.getSelection()?.toString().trim() || "";
    if (selectedText) {
      capturePayload.selectedText = selectedText;
    }
  }

  state.latestSelectionContext = capturePayload;
  state.pendingActionCapture = capturePayload;
  renderSelectionPreview();

  if (action === "note") {
    notesEditor.openCreate({
      pdfId: state.pdfId,
      pageNum: capturePayload.pageNum,
      coordsPdf: capturePayload.coordsPdf,
      selectionRectsPdf: capturePayload.selectionRectsPdf,
      sourceImage: capturePayload.sourceImage
    });
    return;
  }

  if (action === "ai_chat") {
    const anchorRect = range?.getBoundingClientRect?.() || state.pendingActionAnchorRect || null;
    openAiChatFromPayload(capturePayload, anchorRect);
    return;
  }

  await runAiWithPayload(action, capturePayload);
}

function getAllHighlightNodes() {
  return Array.from(
    ui.pagesRoot.querySelectorAll(".annotation-highlight[data-annotation-id]")
  );
}

function findHighlightNodeAtPoint(clientX, clientY) {
  const nodes = getAllHighlightNodes();
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const rect = node.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return node;
    }
  }
  return null;
}

function setHoveredAnnotation(annotationId) {
  if (state.hoveredAnnotationId === annotationId) {
    return;
  }
  if (state.hoveredAnnotationId) {
    const oldNodes = ui.pagesRoot.querySelectorAll(
      `.annotation-highlight[data-annotation-id="${state.hoveredAnnotationId}"]`
    );
    for (const node of oldNodes) {
      node.classList.remove("group-hover");
    }
  }
  state.hoveredAnnotationId = annotationId || null;
  if (state.hoveredAnnotationId) {
    const newNodes = ui.pagesRoot.querySelectorAll(
      `.annotation-highlight[data-annotation-id="${state.hoveredAnnotationId}"]`
    );
    for (const node of newNodes) {
      node.classList.add("group-hover");
    }
  }
}

async function getSelectedAnnotation() {
  if (!state.selectedAnnotationId) {
    return null;
  }
  const all = await listAnnotationsByPdf(state.pdfId);
  return all.find((item) => item.id === state.selectedAnnotationId) || null;
}

async function refreshAnnotationList() {
  const all = await listAnnotationsByPdf(state.pdfId);
  const sorted = sortAnnotations(all, state.annotationSort);
  if (sorted.length === 0) {
    ui.annotationList.innerHTML = '<p class="small-muted">目前沒有註解。</p>';
    return;
  }

  ui.annotationList.innerHTML = sorted
    .map(
      (item) => `<article class="annotation-item" data-id="${item.id}">
        <header>
          <span>${item.type.toUpperCase()} | p.${item.pageNum}</span>
          <span>${formatTime(item.updatedAt)}</span>
        </header>
        <p>${summarizeContent(item.content)}</p>
        <div class="annotation-actions">
          <button type="button" data-action="open" data-id="${item.id}">Open</button>
          <button type="button" data-action="edit" data-id="${item.id}">Edit</button>
          <button type="button" data-action="delete" data-id="${item.id}">Delete</button>
        </div>
      </article>`
    )
    .join("");
}

async function openAnnotationById(annotationId, options = {}) {
  const all = await listAnnotationsByPdf(state.pdfId);
  const annotation = all.find((item) => item.id === annotationId);
  if (!annotation) {
    return;
  }
  setSelectedAnnotation(annotation);
  const shouldOpenInline = options.openInline !== false;
  if (shouldOpenInline) {
    openInlinePopover(annotation, options.anchorRect || null);
  }
  if (options.scroll !== false) {
    scrollToPage(annotation.pageNum);
  }
  if (options.edit) {
    notesEditor.openEdit(annotation);
  }
}

async function deleteAnnotationById(annotationId) {
  const all = await listAnnotationsByPdf(state.pdfId);
  const target = all.find((item) => item.id === annotationId);
  if (!target) {
    return;
  }
  await deleteAnnotation(annotationId);
  await hydratePage(target.pageNum);
  if (state.selectedAnnotationId === annotationId) {
    setSelectedAnnotation(null);
  }
  if (ui.inlineNotePopover.dataset.annotationId === annotationId) {
    closeInlinePopover();
  }
  await refreshAnnotationList();
}

function initChat() {
  state.inlineChatMessages = [];
  state.inlineChatContext = null;
  state.inlineChatAnnotationId = null;
  closeInlineChatPopover();
}

async function computeSha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchPdfArrayBuffer(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Direct fetch failed (${response.status})`);
    }
    const bytes = await response.arrayBuffer();
    return { bytes, finalUrl: response.url || url };
  } catch (_directError) {
    const fallback = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.FETCH_PDF_BYTES,
      payload: { url }
    });
    if (!fallback?.ok) {
      throw new Error(fallback?.error || "Background fetch failed");
    }
    return {
      bytes: fallback.data.bytes,
      finalUrl: fallback.data.finalUrl || url
    };
  }
}

async function loadPdfJs() {
  try {
    const module = await import("../vendor/pdf.mjs");
    module.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("src/vendor/pdf.worker.mjs");
    return module;
  } catch (error) {
    console.error("Cannot load PDF.js module:", error);
    throw new Error(
      "PDF.js module is missing. Place pdf.mjs under src/vendor/ before running the viewer."
    );
  }
}

async function openPdfFromBytes(arrayBuffer, sourceLabel = "") {
  clearCurrentSelectionContext();
  setLoading("Computing file fingerprint...");
  state.pdfId = await computeSha256Hex(arrayBuffer);
  updatePdfIdLabel(state.pdfId);
  await initChat();
  await refreshAnnotationList();
  setSelectedAnnotation(null);

  setLoading("Opening document...");
  const loadingTask = state.pdfjsLib.getDocument({ data: arrayBuffer });
  state.pdfDoc = await loadingTask.promise;
  state.pageCount = state.pdfDoc.numPages;
  state.currentPage = 1;
  updatePageIndicator();
  rebuildPageShells();
  showLocalOpenPanel(false);
  setLoading(sourceLabel ? `Loaded: ${sourceLabel}` : "");
}

function createPageShell(pageNumber) {
  const shell = document.createElement("article");
  shell.className = "page-shell";
  shell.dataset.pageNumber = String(pageNumber);

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";

  const textLayer = document.createElement("div");
  textLayer.className = "text-layer";
  textLayer.setAttribute("aria-hidden", "true");

  shell.appendChild(canvas);
  shell.appendChild(textLayer);
  return shell;
}

async function renderTextLayer(page, viewport, textLayerContainer) {
  textLayerContainer.innerHTML = "";
  const textContent = await page.getTextContent();
  if (typeof state.pdfjsLib.TextLayer !== "function") {
    return;
  }
  try {
    const textLayer = new state.pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerContainer,
      viewport
    });
    await textLayer.render();
  } catch (error) {
    console.error("Text layer render failed:", error);
  }
}

async function hydratePage(pageNum) {
  if (!state.pdfId) {
    return;
  }
  const annotations = await getAnnotationsByPdfPage(state.pdfId, pageNum);
  annotationOverlay.renderPageAnnotations(pageNum, annotations);
}

async function renderPage(pageNumber) {
  if (!state.pdfDoc || state.renderedPages.has(pageNumber)) {
    return;
  }

  const pageShell = ui.pagesRoot.querySelector(`[data-page-number="${pageNumber}"]`);
  if (!pageShell) {
    return;
  }

  const page = await state.pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: state.scale });
  const canvas = pageShell.querySelector("canvas");
  const textLayer = pageShell.querySelector(".text-layer");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  pageShell.style.width = `${viewport.width}px`;
  pageShell.style.height = `${viewport.height}px`;

  // PDF.js TextLayer in v4 relies on CSS custom property --scale-factor.
  pageShell.style.setProperty("--scale-factor", String(viewport.scale));
  textLayer.style.setProperty("--scale-factor", String(viewport.scale));
  textLayer.style.width = `${viewport.width}px`;
  textLayer.style.height = `${viewport.height}px`;

  await page.render({ canvasContext: context, viewport }).promise;
  await renderTextLayer(page, viewport, textLayer);

  state.pageRenderStates.set(pageNumber, {
    pageNumber,
    pageShell,
    canvas,
    textLayer,
    viewport
  });

  state.renderedPages.add(pageNumber);
  await hydratePage(pageNumber);
  renderSelectionPreview();
}

function initLazyRender() {
  if (state.renderObserver) {
    state.renderObserver.disconnect();
  }

  state.renderObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const pageNumber = Number(entry.target.dataset.pageNumber);
        if (Number.isFinite(pageNumber) && pageNumber > 0) {
          renderPage(pageNumber).catch((error) => {
            console.error(`Failed to render page ${pageNumber}:`, error);
          });
        }
      }
    },
    {
      root: ui.viewerContainer,
      rootMargin: "400px 0px",
      threshold: 0.01
    }
  );

  const shells = ui.pagesRoot.querySelectorAll(".page-shell");
  for (const shell of shells) {
    state.renderObserver.observe(shell);
  }
}

function rebuildPageShells() {
  ui.pagesRoot.innerHTML = "";
  state.renderedPages.clear();
  state.pageRenderStates.clear();

  for (let pageNumber = 1; pageNumber <= state.pageCount; pageNumber += 1) {
    ui.pagesRoot.appendChild(createPageShell(pageNumber));
  }

  initLazyRender();
}

function scrollToPage(pageNumber) {
  const target = ui.pagesRoot.querySelector(`[data-page-number="${pageNumber}"]`);
  if (!target) {
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runAiWithPayload(action, capturePayload) {
  ui.aiResponse.textContent = "AI 分析中...";
  const content = await streamCompletion({
    mode: "vision",
    payload: {
      action,
      prompt: ACTION_PROMPTS[action] || ACTION_PROMPTS.explain,
      imageBase64: capturePayload.imageDataUrl
    },
    onAccumulated: (accumulated) => {
      ui.aiResponse.innerHTML = renderRichText(accumulated);
    }
  });

  const saved = await upsertAnnotation({
    pdfId: state.pdfId,
    pageNum: capturePayload.pageNum,
    coordsPdf: capturePayload.coordsPdf,
    selectionRectsPdf: capturePayload.selectionRectsPdf,
    type: "ai",
    action,
    content,
    sourceImage: capturePayload.sourceImage
  });
  await hydratePage(saved.pageNum);
  setSelectedAnnotation(saved);
  await refreshAnnotationList();
}

function streamCompletion({ mode, payload, onAccumulated }) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: PORT_NAMES.AI_STREAM });
    let finished = false;
    let accumulated = "";

    function close(ok, value) {
      if (finished) {
        return;
      }
      finished = true;
      try {
        port.disconnect();
      } catch (_error) {
        // ignore
      }
      if (ok) {
        resolve(value);
      } else {
        reject(value);
      }
    }

    port.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "chunk") {
        const chunk = String(message.chunk || "");
        accumulated += chunk;
        if (onAccumulated) {
          onAccumulated(accumulated, chunk);
        }
        return;
      }
      if (message.type === "done") {
        const finalText = String(message.content || accumulated);
        if (onAccumulated) {
          onAccumulated(finalText, "");
        }
        close(true, finalText);
        return;
      }
      if (message.type === "error") {
        close(false, new Error(message.error || "stream failed"));
      }
    });

    port.onDisconnect.addListener(() => {
      if (!finished) {
        close(false, new Error("stream disconnected unexpectedly"));
      }
    });

    port.postMessage({
      type: "START_STREAM",
      mode,
      payload
    });
  });
}

function handleTextSelectionMouseUp() {
  if (state.manualCapture) {
    tooltipMenu.hide();
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    if (!tooltipMenu.isPersistent()) {
      tooltipMenu.forceHide();
    }
    return;
  }

  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (!text) {
    if (!tooltipMenu.isPersistent()) {
      tooltipMenu.forceHide();
    }
    return;
  }

  const capturePayload = selectionCapture.captureFromRange(range);
  if (capturePayload) {
    state.latestSelectionContext = {
      ...capturePayload,
      selectedText: text
    };
    state.pendingActionCapture = state.latestSelectionContext;
    state.pendingActionAnchorRect = range.getBoundingClientRect();
    renderSelectionPreview();
  }

  const rect = range.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    if (!tooltipMenu.isPersistent()) {
      tooltipMenu.forceHide();
    }
    return;
  }
  tooltipMenu.showNearRect(rect, range, { persistent: false });
}

function bindUiEvents() {
  ui.prevPage.addEventListener("click", () => {
    state.currentPage = Math.max(1, state.currentPage - 1);
    updatePageIndicator();
    scrollToPage(state.currentPage);
  });

  ui.nextPage.addEventListener("click", () => {
    state.currentPage = Math.min(state.pageCount, state.currentPage + 1);
    updatePageIndicator();
    scrollToPage(state.currentPage);
  });

  ui.zoomOut.addEventListener("click", () => {
    state.scale = Math.max(0.5, Number((state.scale - 0.1).toFixed(2)));
    updateZoomIndicator();
    rebuildPageShells();
  });

  ui.zoomIn.addEventListener("click", () => {
    state.scale = Math.min(3.0, Number((state.scale + 0.1).toFixed(2)));
    updateZoomIndicator();
    rebuildPageShells();
  });

  ui.toggleManualCapture.addEventListener("click", () => {
    state.manualCapture = !state.manualCapture;
    selectionCapture.setManualEnabled(state.manualCapture);
    ui.toggleManualCapture.textContent = state.manualCapture ? "Exit Box Select" : "Box Select";
  });

  ui.saveSettings.addEventListener("click", async () => {
    const payload = {
      model: ui.settingModel.value.trim(),
      chatModel: ui.settingChatModel.value.trim(),
      apiKey: ui.settingApiKey.value.trim(),
      useMock: ui.settingUseMock.checked
    };
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_SET,
      payload
    });
    if (!response?.ok) {
      ui.aiResponse.textContent = `設定儲存失敗: ${response?.error || "unknown error"}`;
      return;
    }
    ui.aiResponse.textContent = "設定已儲存。";
  });

  ui.annotationSort.addEventListener("change", async () => {
    state.annotationSort = ui.annotationSort.value;
    await refreshAnnotationList();
  });

  ui.annotationList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action][data-id]");
    if (!button) {
      return;
    }
    const annotationId = button.dataset.id;
    const action = button.dataset.action;
    if (action === "open") {
      await openAnnotationById(annotationId, { scroll: true, edit: false });
      return;
    }
    if (action === "edit") {
      await openAnnotationById(annotationId, { scroll: true, edit: true });
      return;
    }
    if (action === "delete") {
      await deleteAnnotationById(annotationId);
    }
  });

  ui.editCurrentAnnotation.addEventListener("click", async () => {
    const selected = await getSelectedAnnotation();
    if (!selected) {
      return;
    }
    notesEditor.openEdit(selected);
  });

  ui.deleteCurrentAnnotation.addEventListener("click", async () => {
    const selected = await getSelectedAnnotation();
    if (!selected) {
      return;
    }
    await deleteAnnotationById(selected.id);
  });

  ui.localPdfInput.addEventListener("change", async () => {
    const file = ui.localPdfInput.files?.[0];
    if (!file) {
      return;
    }
    const buffer = await file.arrayBuffer();
    await openPdfFromBytes(buffer, file.name);
  });

  ui.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("drag-over");
  });

  ui.dropZone.addEventListener("dragleave", () => {
    ui.dropZone.classList.remove("drag-over");
  });

  ui.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    ui.dropZone.classList.remove("drag-over");
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      ui.aiResponse.textContent = "僅支援 PDF 檔案。";
      return;
    }
    const buffer = await file.arrayBuffer();
    await openPdfFromBytes(buffer, file.name);
  });

  ui.inlineNoteClose.addEventListener("click", () => {
    closeInlinePopover();
  });

  ui.inlineNoteEdit.addEventListener("click", () => {
    enableInlineNoteEditing(true);
  });

  ui.inlineNoteInput.addEventListener("input", () => {
    ui.inlineNotePreview.innerHTML = renderRichText(ui.inlineNoteInput.value);
  });

  ui.inlineNoteSave.addEventListener("click", async () => {
    const annotationId = ui.inlineNotePopover.dataset.annotationId;
    if (!annotationId) {
      return;
    }
    const all = await listAnnotationsByPdf(state.pdfId);
    const target = all.find((item) => item.id === annotationId);
    if (!target) {
      return;
    }
    const saved = await upsertAnnotation({
      ...target,
      content: ui.inlineNoteInput.value
    });
    await hydratePage(saved.pageNum);
    setSelectedAnnotation(saved);
    await refreshAnnotationList();
    ui.inlineNotePreview.innerHTML = renderRichText(saved.content || "");
    enableInlineNoteEditing(false);
    closeInlinePopover();
  });

  ui.inlineNoteDelete.addEventListener("click", async () => {
    const annotationId = ui.inlineNotePopover.dataset.annotationId;
    if (!annotationId) {
      return;
    }
    await deleteAnnotationById(annotationId);
    closeInlinePopover();
  });

  ui.inlineChatClose.addEventListener("click", () => {
    closeInlineChatPopover();
  });

  ui.inlineChatSend.addEventListener("click", async () => {
    await sendInlineChatMessage();
  });

  ui.inlineChatInput.addEventListener("keydown", async (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      await sendInlineChatMessage();
    }
  });

  makePopoverDraggable(ui.inlineChatPopover, ui.inlineChatHeader);

  document.addEventListener("mousedown", (event) => {
    const inSidebar = ui.sidebarRoot.contains(event.target);
    const inNotePopover = ui.inlineNotePopover.contains(event.target);
    const inChatPopover = ui.inlineChatPopover.contains(event.target);
    const inTooltip = Boolean(event.target.closest(".selection-tooltip"));

    if (!inSidebar && !inNotePopover && !inChatPopover && !inTooltip) {
      clearCurrentSelectionContext();
      if (tooltipMenu.isVisible()) {
        tooltipMenu.forceHide();
      }
    }

    if (!ui.inlineNotePopover.classList.contains("hidden") && !inNotePopover) {
      closeInlinePopover();
    }
    if (!ui.inlineChatPopover.classList.contains("hidden") && !inChatPopover) {
      closeInlineChatPopover();
    }
  });

  document.addEventListener("mouseup", () => {
    window.setTimeout(handleTextSelectionMouseUp, 0);
  });

  ui.viewerContainer.addEventListener("mousemove", (event) => {
    const hit = findHighlightNodeAtPoint(event.clientX, event.clientY);
    const annotationId = hit?.dataset?.annotationId || null;
    setHoveredAnnotation(annotationId);
  });

  ui.viewerContainer.addEventListener("mouseleave", () => {
    setHoveredAnnotation(null);
  });

  ui.viewerContainer.addEventListener("click", async (event) => {
    const selectionText = window.getSelection()?.toString().trim();
    if (selectionText) {
      return;
    }
    const hit = findHighlightNodeAtPoint(event.clientX, event.clientY);
    const annotationId = hit?.dataset?.annotationId;
    if (!annotationId) {
      return;
    }
    await openAnnotationById(annotationId, {
      scroll: false,
      openInline: true,
      anchorRect: hit.getBoundingClientRect()
    });
  });

  ui.viewerContainer.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      state.scale = Math.min(3.0, Math.max(0.5, Number((state.scale + direction * 0.1).toFixed(2))));
      updateZoomIndicator();
      rebuildPageShells();
    },
    { passive: false }
  );

  ui.viewerContainer.addEventListener("scroll", () => {
    const shells = Array.from(ui.pagesRoot.querySelectorAll(".page-shell"));
    const containerTop = ui.viewerContainer.getBoundingClientRect().top;
    let closestPage = state.currentPage;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const shell of shells) {
      const rect = shell.getBoundingClientRect();
      const distance = Math.abs(rect.top - containerTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        closestPage = Number(shell.dataset.pageNumber);
      }
    }

    state.currentPage = Math.min(Math.max(closestPage, 1), state.pageCount || 1);
    updatePageIndicator();
  });
}

async function pingBackground() {
  const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PING });
  if (!response?.ok) {
    throw new Error("Failed to connect to background service worker.");
  }
}

async function initSettingsPanel() {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.SETTINGS_GET
  });
  if (!response?.ok) {
    return;
  }
  const settings = response.data || {};
  ui.settingModel.value = settings.model || "";
  ui.settingChatModel.value = settings.chatModel || "";
  ui.settingApiKey.value = settings.apiKey || "";
  ui.settingUseMock.checked = Boolean(settings.useMock);
}

async function init() {
  if (isDebugTextLayerEnabled()) {
    document.body.classList.add("debug-text-layer");
  }

  bindUiEvents();
  updateZoomIndicator();
  updatePageIndicator();
  await openDb();

  state.fileUrl = getFileUrlFromQuery();

  setLoading("Connecting background worker...");
  await pingBackground();
  await initSettingsPanel();

  setLoading("Loading PDF.js...");
  const pdfjsModule = await loadPdfJs();
  state.pdfjsLib = pdfjsModule;

  if (!state.fileUrl) {
    showLocalOpenPanel(true);
    setLoading("請選擇本機 PDF，或從 .pdf 連結導入。");
    return;
  }

  setLoading("Downloading PDF...");
  const fetched = await fetchPdfArrayBuffer(state.fileUrl);
  await openPdfFromBytes(fetched.bytes, fetched.finalUrl || state.fileUrl);
}

init().catch((error) => {
  console.error(error);
  ui.loading.textContent = `Viewer init failed: ${error.message}`;
});
