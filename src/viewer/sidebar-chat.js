import { renderRichText } from "./latex-renderer.js";

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export class SidebarChat {
  constructor({ root, onSend, onError }) {
    this.root = root;
    this.onSend = onSend;
    this.onError = onError;
    this.messages = [];
    this.threadId = null;
    this.pending = false;
    this.bind();
  }

  bind() {
    this.listEl = this.root.querySelector('[data-role="chat-messages"]');
    this.inputEl = this.root.querySelector('[data-role="chat-input"]');
    this.sendBtn = this.root.querySelector('[data-role="chat-send"]');
    this.contextToggle = this.root.querySelector('[data-role="chat-context"]');
    this.threadLabel = this.root.querySelector('[data-role="chat-thread-label"]');

    this.sendBtn.addEventListener("click", () => this.submit());
    this.inputEl.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        this.submit();
      }
    });
  }

  setThread(thread) {
    this.threadId = thread?.id || null;
    if (this.threadLabel) {
      this.threadLabel.textContent = thread?.title || "No thread";
    }
  }

  setMessages(messages) {
    this.messages = messages.slice();
    this.render();
  }

  appendMessage(message) {
    this.messages.push(message);
    this.render();
    this.scrollToBottom();
  }

  replaceLastAssistant(content) {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].role === "assistant") {
        this.messages[i].content = content;
        break;
      }
    }
    this.render();
  }

  setPending(value) {
    this.pending = value;
    this.sendBtn.disabled = value;
    this.sendBtn.textContent = value ? "Sending..." : "Send";
  }

  async submit() {
    if (this.pending) {
      return;
    }
    const content = this.inputEl.value.trim();
    if (!content) {
      return;
    }
    const includeContext = this.contextToggle.checked;
    this.inputEl.value = "";
    try {
      await this.onSend({ content, includeContext });
    } catch (error) {
      if (this.onError) {
        this.onError(error);
      }
    }
  }

  render() {
    this.listEl.innerHTML = this.messages
      .map(
        (msg) => `<article class="chat-msg chat-${escapeHtml(msg.role)}">
          <header>${escapeHtml(msg.role)}</header>
          <div class="chat-content">${renderRichText(msg.content || "")}</div>
        </article>`
      )
      .join("");
  }

  scrollToBottom() {
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}
