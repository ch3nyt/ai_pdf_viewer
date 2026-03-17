import { DEFAULT_SETTINGS } from "../common/config.js";
import { MESSAGE_TYPES, PORT_NAMES } from "../common/messages.js";
import { ACTION_PROMPTS, SYSTEM_PROMPT_DEFAULT } from "../common/prompts.js";

const PDF_REDIRECT_RULE_ID = 1001;
const SETTINGS_KEY = "appSettings";

function buildViewerRedirectUrl() {
  return chrome.runtime.getURL("src/viewer/viewer.html?file=\\0");
}

async function ensurePdfRedirectRule() {
  const rule = {
    id: PDF_REDIRECT_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: buildViewerRedirectUrl()
      }
    },
    condition: {
      regexFilter: "^(https?|file)://.*\\.[Pp][Dd][Ff]([?#].*)?$",
      resourceTypes: ["main_frame"]
    }
  };

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PDF_REDIRECT_RULE_ID],
    addRules: [rule]
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensurePdfRedirectRule().catch((error) => {
    console.error("Failed to install PDF redirect rule:", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensurePdfRedirectRule().catch((error) => {
    console.error("Failed to re-apply PDF redirect rule:", error);
  });
});

// Also enforce the rule whenever the service worker starts, so reloads do not
// depend on install/startup timing.
ensurePdfRedirectRule().catch((error) => {
  console.error("Failed to apply PDF redirect rule on worker boot:", error);
});

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab?.id;
  const rawUrl = tab?.url || "";
  if (!tabId || !rawUrl) {
    return;
  }
  const isPdfLike = /\.(pdf)([?#].*)?$/i.test(rawUrl) || /\/pdf\/.+/i.test(rawUrl);
  if (!isPdfLike) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/viewer/viewer.html") });
    return;
  }
  const viewerUrl = chrome.runtime.getURL(
    `src/viewer/viewer.html?file=${encodeURIComponent(rawUrl)}`
  );
  await chrome.tabs.update(tabId, { url: viewerUrl });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "Invalid message payload." });
    return false;
  }

  if (message.type === MESSAGE_TYPES.PING) {
    sendResponse({ ok: true, data: { from: "service-worker" } });
    return false;
  }

  if (message.type === MESSAGE_TYPES.SETTINGS_GET) {
    getSettings()
      .then((settings) => sendResponse({ ok: true, data: settings }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.SETTINGS_SET) {
    saveSettings(message.payload || {})
      .then((settings) => sendResponse({ ok: true, data: settings }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.VISION_ANALYZE) {
    runVisionAnalyze(message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.CHAT_COMPLETE) {
    runChatComplete(message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.FETCH_PDF_BYTES) {
    fetchPdfBytes(message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  sendResponse({ ok: false, error: `Unknown message type: ${String(message.type)}` });
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAMES.AI_STREAM) {
    return;
  }

  port.onMessage.addListener(async (message) => {
    if (!message || message.type !== "START_STREAM") {
      return;
    }
    try {
      const settings = await getSettings();
      const mode = message.mode;
      const payload = message.payload || {};
      await runStreamingFlow({ port, settings, mode, payload });
    } catch (error) {
      port.postMessage({ type: "error", error: String(error.message || error) });
    }
  });
});

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

async function saveSettings(incoming) {
  const current = await getSettings();
  const next = { ...current, ...incoming };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

function toDataUrlImage(imageBase64) {
  if (imageBase64.startsWith("data:image/")) {
    return imageBase64;
  }
  return `data:image/png;base64,${imageBase64}`;
}

async function runVisionAnalyze(payload) {
  const settings = await getSettings();
  const action = payload.action || "explain";
  const prompt = payload.prompt || ACTION_PROMPTS[action] || ACTION_PROMPTS.explain;

  if (settings.useMock || !settings.apiKey) {
    return {
      content: `[MOCK:${action}] 已收到影像片段。之後會回傳真正模型結果。\n\nPrompt: ${prompt.slice(0, 80)}...`,
      provider: settings.provider,
      model: settings.model,
      mocked: true
    };
  }

  const body = {
    model: settings.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_DEFAULT },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: toDataUrlImage(payload.imageBase64 || "") }
          }
        ]
      }
    ],
    temperature: 0.2
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    content: data?.choices?.[0]?.message?.content || "",
    provider: settings.provider,
    model: settings.model,
    mocked: false
  };
}

async function runChatComplete(payload) {
  const settings = await getSettings();
  const history = Array.isArray(payload.history) ? payload.history : [];
  const contextNote = payload.contextNote || "";

  if (settings.useMock || !settings.apiKey) {
    const last = history[history.length - 1]?.content || "";
    return {
      content: `[MOCK:chat] 你剛剛說的是：${last.slice(0, 120)}${contextNote ? `\n\nContext: ${contextNote.slice(0, 80)}...` : ""}`,
      provider: settings.provider,
      model: settings.chatModel,
      mocked: true
    };
  }

  const userMessages = history.map((item) => ({
    role: item.role,
    content: item.content
  }));

  const messages = [{ role: "system", content: SYSTEM_PROMPT_DEFAULT }, ...userMessages];

  if (contextNote) {
    messages.push({
      role: "system",
      content: `Context from current PDF selection:\n${contextNote}`
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.chatModel,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    content: data?.choices?.[0]?.message?.content || "",
    provider: settings.provider,
    model: settings.chatModel,
    mocked: false
  };
}

async function runStreamingFlow({ port, settings, mode, payload }) {
  if (settings.useMock || !settings.apiKey) {
    const mockText = buildMockStreamingText(mode, payload);
    await streamMockChunks(port, mockText);
    port.postMessage({
      type: "done",
      content: mockText,
      model: mode === "chat" ? settings.chatModel : settings.model,
      provider: settings.provider,
      mocked: true
    });
    return;
  }

  const requestBody = buildStreamingRequestBody({ settings, mode, payload });
  let accumulated = "";
  for await (const chunk of openAiStream(settings.apiKey, requestBody)) {
    accumulated += chunk;
    port.postMessage({ type: "chunk", chunk, accumulated });
  }
  port.postMessage({
    type: "done",
    content: accumulated,
    model: requestBody.model,
    provider: settings.provider,
    mocked: false
  });
}

function buildMockStreamingText(mode, payload) {
  if (mode === "chat") {
    const history = Array.isArray(payload.history) ? payload.history : [];
    const last = history[history.length - 1]?.content || "";
    return `【Mock 串流 Chat】已收到訊息：${last.slice(0, 120)}。這裡是分段輸出示範。`;
  }
  const action = payload.action || "explain";
  const prompt = payload.prompt || ACTION_PROMPTS[action] || ACTION_PROMPTS.explain;
  return `【Mock 串流 Vision】動作=${action}。Prompt 摘要：${prompt.slice(0, 80)}。`;
}

async function streamMockChunks(port, text) {
  const tokens = text.match(/.{1,12}/g) || [];
  let accumulated = "";
  for (const token of tokens) {
    accumulated += token;
    port.postMessage({ type: "chunk", chunk: token, accumulated });
    // Keep an async boundary to simulate real streaming.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function buildStreamingRequestBody({ settings, mode, payload }) {
  if (mode === "chat") {
    const history = Array.isArray(payload.history) ? payload.history : [];
    const contextNote = payload.contextNote || "";
    const messages = [{ role: "system", content: SYSTEM_PROMPT_DEFAULT }];
    for (const item of history) {
      if (!item || !item.role || typeof item.content !== "string") {
        continue;
      }
      messages.push({ role: item.role, content: item.content });
    }
    if (contextNote) {
      messages.push({
        role: "system",
        content: `Context from current PDF selection:\n${contextNote}`
      });
    }
    return {
      model: settings.chatModel,
      messages,
      temperature: 0.2,
      stream: true
    };
  }

  const action = payload.action || "explain";
  const prompt = payload.prompt || ACTION_PROMPTS[action] || ACTION_PROMPTS.explain;
  return {
    model: settings.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_DEFAULT },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: toDataUrlImage(payload.imageBase64 || "") }
          }
        ]
      }
    ],
    temperature: 0.2,
    stream: true
  };
}

async function* openAiStream(apiKey, body) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI stream error (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error("OpenAI stream has no response body.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      let json;
      try {
        json = JSON.parse(data);
      } catch (_error) {
        continue;
      }
      const delta = json?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        yield delta;
      }
    }
  }
}

async function fetchPdfBytes(payload) {
  const url = String(payload.url || "");
  if (!url) {
    throw new Error("Missing PDF URL.");
  }
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Fetch PDF failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  const buf = await response.arrayBuffer();
  return {
    bytes: buf,
    contentType,
    finalUrl: response.url || url
  };
}
