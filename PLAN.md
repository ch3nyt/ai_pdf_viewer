it# AI PDF Reader Extension - PLAN

## 1) 目標與範圍

### 1.1 專案目標
- 以 Chrome Extension Manifest V3 取代瀏覽器原生 PDF 閱讀器。
- 以「視覺截圖 + 多模態模型」處理複雜排版、公式、矩陣等內容，避免純文字抽取錯亂。
- 建立可持久化、可重現的 PDF 內嵌註解系統（AI 回覆與手寫筆記）。

### 1.2 MVP 範圍（本階段必做）
- PDF 攔截並導向自訂 viewer。
- PDF.js 基礎渲染（分頁、縮放、Lazy rendering）。
- 反白後 Invisible Cropping（含 padding 與多行 rect）。
- AI 動作（Translate / Summarize / Explain）與側欄回覆。
- IndexedDB 永久儲存與 hydration（座標可隨縮放重算）。
- 新增自由對話 Chatbox（不限預設 prompt）。
- 新增反白後純筆記模式（支援 LaTeX 輸入與顯示）。

### 1.3 非目標（先不做）
- 多人協作、雲端同步。
- OCR 管線（僅保留手動框選 fallback）。
- 跨瀏覽器完整相容（先以 Chrome 為主）。

## 2) 模組與里程碑

### Module 1: Extension Core
- 完成 `manifest.json` 權限與入口設定。
- 實作 background 攔截 `.pdf` 並重導至 `viewer.html?file=...`。
- 建立 runtime message 路由骨架。

完成定義：
- 直接開啟任一 PDF URL 時可進入擴充功能 viewer。

### Module 2: PDF.js Viewer + Fingerprint
- viewer 可載入 PDF 並顯示頁面。
- 計算 SHA-256 作為 `pdfId`。

完成定義：
- 同一檔案重開可得到一致 `pdfId`。

### Module 3: Invisible Cropping
- 監聽反白與 tooltip 動作。
- 以 `range.getClientRects()` 取得多行區塊。
- Y 軸上下 padding（預設 15px，可調）。
- 映射至 canvas，裁切為 Base64。
- 提供手動畫框 fallback。

完成定義：
- 公式上/下緣不被裁掉；無 text layer 時仍能手動截圖。

### Module 4: AI & Prompt Engineering
- background 代理 OpenAI/Gemini Vision API。
- 根據 action 套用 prompt 模板。
- 側欄呈現串流（或分段）回覆。

完成定義：
- 使用者可從反白直接拿到 AI 解讀結果。

### Module 5: Persistence & Hydration
- IndexedDB 儲存註解、座標與內容。
- 僅儲存 PDF 點座標，不存螢幕絕對像素。
- page render 後回補高亮層與 icon。

完成定義：
- 重新整理 / 縮放 / 翻頁後，註解仍準確對位。

### Module 6: Free Chatbox（新增）
- 側欄加入多輪對話，不限預設 prompt。
- 對話可選擇是否附帶當前高亮截圖上下文。
- thread 與 `pdfId` 關聯。

完成定義：
- 使用者可持續追問，且回覆可引用目前 PDF 脈絡。

### Module 7: Note Mode + LaTeX（新增）
- 反白選單新增 `Add Note`。
- 筆記支援 Markdown + LaTeX（`$...$`, `$$...$$`）。
- 點擊既有註解可編輯，顯示模式可渲染數學公式。

完成定義：
- 非 AI 的個人筆記可與 PDF 區域永久綁定且可重編。

## 3) 檔案清單與用途

### Root
- `manifest.json`: MV3 設定、權限、background、web_accessible_resources。
- `PLAN.md`: 本執行計畫與模組完成定義。
- `.env.example`（可選）: API 相關設定鍵名（不放真實金鑰）。

### Background / Core
- `src/background/service-worker.js`: PDF 攔截、API 代理、訊息路由、錯誤處理。
- `src/common/messages.js`: message type、request/response schema 常數。
- `src/common/prompts.js`: 預設 AI prompt 模板與 action 映射。
- `src/common/config.js`（可選）: feature flags、模型名稱、預設參數。

### Viewer
- `src/viewer/viewer.html`: 閱讀器 DOM 結構（toolbar、canvas layer、text layer、sidebar）。
- `src/viewer/viewer.js`: PDF 載入、分頁渲染、縮放、事件協調。
- `src/viewer/selection-capture.js`: 反白偵測、rect 計算、cropping、fallback 框選。
- `src/viewer/tooltip-menu.js`: 反白後浮動選單（AI 動作 + Add Note）。
- `src/viewer/sidebar-chat.js`: Chatbox UI、thread 管理、訊息串流顯示。
- `src/viewer/notes-editor.js`: 筆記輸入、LaTeX 預覽、編輯流程。
- `src/viewer/annotation-overlay.js`: hydration 後高亮與 icon 疊層、點擊回放。
- `src/viewer/latex-renderer.js`: KaTeX/MathJax 包裝（輸入渲染隔離）。

### Storage
- `src/storage/db.js`: IndexedDB 初始化、transaction、CRUD。
- `src/storage/schema.js`: store 名稱、索引、版本號定義。
- `src/storage/migrations.js`: schema version 升級流程。

### Styles
- `src/styles/viewer.css`: viewer 基礎排版、tooltip、sidebar、annotation 樣式。
- `src/styles/chat.css`（可選）: chatbox 專屬樣式。
- `src/styles/notes.css`（可選）: note editor 與 LaTeX 區塊樣式。

## 4) 資料模型（IndexedDB）

### `annotations`
- `id` (string, pk)
- `pdfId` (string, index)
- `pageNum` (number, index)
- `coordsPdf` (object): `{x1, y1, x2, y2}` 或多區塊陣列
- `selectionRectsPdf` (array, optional): 多行選取時更準確重建
- `type` (string): `ai` | `note`
- `action` (string, optional): `translate` | `summarize` | `explain` | `chat_context`
- `content` (string): AI 回覆或筆記原文（Markdown + LaTeX）
- `sourceImage` (string, optional): Base64 或 Blob key
- `threadId` (string, optional): 關聯 chat thread
- `createdAt` (number)
- `updatedAt` (number)

索引建議：
- `[pdfId, pageNum]`
- `[pdfId, updatedAt]`
- `threadId`

### `threads`
- `id` (string, pk)
- `pdfId` (string, index)
- `title` (string)
- `createdAt` (number)
- `updatedAt` (number)

### `messages`
- `id` (string, pk)
- `threadId` (string, index)
- `role` (string): `user` | `assistant` | `system`
- `content` (string)
- `attachmentAnnotationId` (string, optional)
- `createdAt` (number)

## 5) 核心事件流程（文字版）

1. 使用者反白文字。
2. 顯示 tooltip：`Translate` / `Summarize` / `Explain` / `Add Note`。
3. 若為 AI 動作：計算 rect -> 裁圖 -> 傳給 background -> 呼叫模型 -> 側欄顯示回覆。
4. 若為 Note：開啟 note editor，輸入 Markdown/LaTeX 並儲存。
5. 寫入 IndexedDB（以 PDF 點座標儲存）。
6. 頁面重渲染時，讀取同頁註解並轉回 viewport 座標顯示 overlay。
7. 點擊 overlay icon，可回放 AI 回覆或開啟筆記編輯器。
8. 側欄 chat 可持續追問，必要時附帶目前選區/註解作為上下文。

## 6) 實作順序（建議）

1. 先完成 Module 1-2，確保攔截 + viewer 基礎可用。
2. 實作 Module 3（截圖）並先用 mock API 回傳驗證。
3. 接 Module 4 串真實 API。
4. 完成 Module 5 後再導入 Module 6/7（避免資料模型反覆改動）。
5. 最後統一收斂 UI/UX 與錯誤處理。

## 7) 測試清單（最低驗收）

- 開啟 PDF URL 是否穩定重導到 extension viewer。
- 相同 PDF 檔案 `pdfId` 是否一致。
- 多行反白時是否逐行裁切而非大框誤裁。
- 公式符號上/下緣是否因 padding 得到保留。
- 無 text layer 時手動框選能否成功。
- AI 回覆是否可成功落庫並重開後回放。
- 縮放 50%/100%/200% 後註解位置是否對齊。
- `Add Note` 輸入 LaTeX 後能否正確渲染與再編輯。
- Chatbox 多輪對話是否能維持 thread，且可選擇是否附帶上下文。

## 8) 風險與對策

- 風險：text layer 與 canvas 座標偏移。
  對策：統一使用 PDF.js viewport 轉換 API；建立偏移校正測試頁。

- 風險：長文對話導致 token 成本暴增。
  對策：thread 摘要化、訊息裁剪與模型分層（快模型 / 慢模型）。

- 風險：LaTeX 渲染錯誤影響整體 UI。
  對策：渲染錯誤隔離（失敗時 fallback 顯示原始文本）。

## 9) Definition of Done（MVP）

- Module 1-7 均達成完成定義。
- 至少 3 份含複雜公式 PDF 通過端到端測試。
- 使用者可在同一份 PDF 中同時使用：
  - 反白 -> AI 解釋
  - 反白 -> 手寫 LaTeX 筆記
  - 側欄自由追問並保留對話歷史
