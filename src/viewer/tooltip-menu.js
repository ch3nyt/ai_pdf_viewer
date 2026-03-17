const ACTIONS = [
  { id: "translate", label: "Translate" },
  { id: "summarize", label: "Summarize" },
  { id: "explain", label: "Explain" },
  { id: "ai_chat", label: "AI Chat" },
  { id: "note", label: "Add Note" }
];

export class TooltipMenu {
  constructor({ onAction }) {
    this.onAction = onAction;
    this.anchor = null;
    this.lastRange = null;
    this.persistent = false;

    this.root = document.createElement("div");
    this.root.className = "selection-tooltip hidden";
    this.root.innerHTML = ACTIONS.map(
      (action) => `<button type="button" data-action="${action.id}">${action.label}</button>`
    ).join("");
    document.body.appendChild(this.root);

    this.root.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    this.root.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-action]");
      if (!target) {
        return;
      }
      const action = target.dataset.action;
      this.onAction(action, this.lastRange || null);
      this.forceHide();
    });

    document.addEventListener("mousedown", (event) => {
      if (!this.root.contains(event.target)) {
        this.hide();
      }
    });
  }

  showNearRect(rect, range = null, options = {}) {
    if (!rect) {
      return;
    }
    this.persistent = Boolean(options.persistent);
    this.lastRange = range ? range.cloneRange() : null;
    this.root.classList.remove("hidden");
    this.root.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    this.root.style.top = `${Math.round(rect.bottom + window.scrollY + 8)}px`;
  }

  hide() {
    if (this.persistent) {
      return;
    }
    this.lastRange = null;
    this.root.classList.add("hidden");
  }

  forceHide() {
    this.persistent = false;
    this.lastRange = null;
    this.root.classList.add("hidden");
  }

  isVisible() {
    return !this.root.classList.contains("hidden");
  }

  isPersistent() {
    return this.persistent;
  }
}
