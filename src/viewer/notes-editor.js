import { renderRichText } from "./latex-renderer.js";

export class NotesEditor {
  constructor({ root, onSave }) {
    this.root = root;
    this.onSave = onSave;
    this.mode = "new";
    this.currentDraft = null;
    this.currentAnnotationId = null;
    this.bind();
  }

  bind() {
    this.titleEl = this.root.querySelector('[data-role="note-title"]');
    this.inputEl = this.root.querySelector('[data-role="note-input"]');
    this.previewEl = this.root.querySelector('[data-role="note-preview"]');
    this.saveBtn = this.root.querySelector('[data-role="note-save"]');
    this.cancelBtn = this.root.querySelector('[data-role="note-cancel"]');

    this.inputEl.addEventListener("input", () => {
      this.renderPreview();
    });

    this.saveBtn.addEventListener("click", () => {
      if (!this.currentDraft) {
        return;
      }
      const content = this.inputEl.value.trim();
      if (!content) {
        return;
      }
      this.onSave({
        mode: this.mode,
        annotationId: this.currentAnnotationId,
        ...this.currentDraft,
        content
      });
      this.hide();
    });

    this.cancelBtn.addEventListener("click", () => {
      this.hide();
    });
  }

  openCreate(draft) {
    this.mode = "new";
    this.currentAnnotationId = null;
    this.currentDraft = draft;
    this.titleEl.textContent = "New Note";
    this.inputEl.value = "";
    this.show();
    this.renderPreview();
  }

  openEdit(annotation) {
    this.mode = "edit";
    this.currentAnnotationId = annotation.id;
    this.currentDraft = annotation;
    this.titleEl.textContent = annotation.type === "ai" ? "Edit AI Response" : "Edit Note";
    this.inputEl.value = annotation.content || "";
    this.show();
    this.renderPreview();
  }

  renderPreview() {
    this.previewEl.innerHTML = renderRichText(this.inputEl.value);
  }

  show() {
    this.root.classList.remove("hidden");
    this.inputEl.focus();
  }

  hide() {
    this.currentDraft = null;
    this.currentAnnotationId = null;
    this.root.classList.add("hidden");
  }
}
