專案規格書：AI-Powered PDF Reader Extension (Vision-Driven)
1. 專案目標與核心理念 (Project Goals & Philosophy)
開發一款基於 Manifest V3 (MV3) 的 Chrome 擴充功能，完全取代瀏覽器預設的 PDF 閱讀器。
本專案的核心痛點是：傳統 PDF 的文字擷取（Text Layer）在面對複雜的排版（如：計量經濟學推導、矩陣、跨行公式）時會產生嚴重亂碼，導致 AI 語言模型產生幻覺。

核心解決方案 (The Vision-Driven Approach)：
放棄純文字擷取，改用「視覺截圖與多模態大模型 (VLM)」降維打擊。
透過前端的「暗中截圖（Invisible Cropping）」技術，將使用者的「反白文字 (Highlight)」動作，在背景無縫轉換為對 PDF 畫布 (Canvas) 的精準截圖，並結合提示詞直接送交 OpenAI Vision API (gpt-4o) 處理。最終將 AI 的解釋與原檔案進行持久化的靈魂綁定。

2. 技術棧 (Tech Stack)
核心框架： Chrome Extension Manifest V3 (MV3)

PDF 渲染引擎： PDF.js (由 Mozilla 開發)

本地資料庫： IndexedDB (建議搭配 localforage 函式庫簡化非同步操作)

AI 模型串接： OpenAI API (具備 Vision 能力的模型，如 gpt-4o) 或 Google Gemini API

前端 UI： 原生 HTML/CSS/JS 或輕量級框架（如 Preact/Tailwind，視開發者偏好）

3. 系統模組與開發指令 (Module Instructions)
請 AI 開發助手依照以下模組順序，逐步實作此專案：

Module 1: 背景攔截與架構初始化 (Extension Core)
任務： 建立 MV3 基礎架構，並攔截原生 PDF 請求。

設定 manifest.json： 申請 declarativeNetRequest, storage, activeTab 等權限。

PDF 攔截器 (Interceptor)： 在 Background Service Worker 中，設定網路規則。當偵測到網址結尾為 .pdf 時，將請求重導向至擴充功能內部的 viewer.html?file=<encoded_pdf_url>。

通訊機制： 建立 Background 與 Content Script / Viewer 之間的 chrome.runtime.sendMessage 通訊橋樑，用於安全地呼叫 AI API。

Module 2: 客製化閱讀器與指紋識別 (PDF.js Viewer & Hashing)
任務： 成功渲染 PDF 並賦予檔案唯一身分證。

整合 PDF.js： 在 viewer.html 中實作標準的 PDF 渲染邏輯，包含 Canvas 層（視覺）與 Text Layer 層（用於反白）。需實作基礎的縮放 (Zoom) 與分頁渲染 (Lazy Rendering)。

檔案指紋 (File Fingerprint)： 當 PDF 載入為 ArrayBuffer 時，使用 Web Crypto API (crypto.subtle.digest) 計算其 SHA-256 Hash。此 Hash 值將作為後續資料庫儲存的 Primary Key (pdfId)。

Module 3: 互動與暗中截圖層 (The "Magic" Capture Layer) - ⚠️ 最關鍵模組
任務： 將使用者的反白動作轉化為 Canvas 截圖，並處理邊界陷阱。

游標選單 (Tooltip)： 監聽 Text Layer 的 mouseup 事件。當 window.getSelection() 有值時，在游標旁彈出浮動選單 (Translate, Summarize, Explain)。

暗中截圖演算法 (Invisible Cropping)：

當使用者點擊選單選項，透過 range.getClientRects() 取得所有選取行的精準矩形座標（避免使用 getBoundingClientRect 產生跨行巨型方塊）。

Padding 魔法： 為防止高聳的數學符號（如積分或極限）被文字層的固定高度「斬首」，必須將擷取矩形的 Y 軸上下方各加上約 15px 的 Padding 緩衝區。

將計算好的螢幕座標，映射到 PDF.js 的底層 <canvas> 上。

使用 canvas.getContext('2d').drawImage() 裁切該區域，並呼叫 .toDataURL() 轉為 Base64 圖片。

手動框選 (Fallback)： 實作一個備用工具。當使用者遇到破圖或無文字層的 PDF 時，允許游標變成十字，手動在 Canvas 上拉出一個 Bounding Box 進行截圖。

Module 4: 提示詞工程與 VLM 串接 (AI & Prompt Engineering)
任務： 組裝圖片與系統提示詞，向後端發送請求。

API 封裝： 在 Background Script 實作發送至 OpenAI/Gemini Vision API 的邏輯。

動態 Prompt 注入： 根據使用者選擇的動作，組合 Prompt。例如，針對計量經濟學或因果推斷論文中常見的複雜數學模型，設定如下 System Prompt：

"You are an expert academic research assistant. Analyze the provided image snippet from a research paper. If it contains mathematical formulas or statistical equations, perfectly translate them into LaTeX format and clearly explain the underlying intuition of the variables. Output your response in Traditional Chinese."

側邊欄 UI： 在 viewer.html 右側建立一個伸縮側邊欄，用於顯示 AI 的 Streaming 回覆。

Module 5: 狀態水合與永久錨定 (Persistence & Hydration)
任務： 讓 AI 筆記與 PDF 檔案的特定座標永久綁定。

儲存 (Save)： 當 AI 回覆完成，將資料存入 IndexedDB。

資料結構應包含：pdfId (SHA-256 Hash), pageNum, 轉換為相對於 PDF 原始尺寸比例的 coordinates，以及 aiResponse。

座標轉換重點： 嚴禁儲存螢幕像素座標 (Absolute Pixels)。必須使用 PDF.js 提供的 viewport.convertToPdfPoint(x, y) 轉換為 PDF 內部點座標。

水合渲染 (Hydration)： 監聽 PDF.js 的 pageRendered 或 textlayerrendered 事件。

當某頁面渲染完畢，向 IndexedDB 查詢該頁面是否有歷史筆記。

若有，將儲存的點座標透過 viewport.convertToViewportPoint(x, y) 轉回當前縮放比例下的螢幕像素。

在 Text Layer 上方覆蓋帶有透明度顏色 (Lighter highlight) 的 <div>，並在其邊緣絕對定位一個小圖示 (Icon)。點擊該圖示即可在側邊欄重現 AI 筆記。

4. 預期開發流程與測試 (Next Steps for AI Assistant)
收到此規格書後，請 AI 助手優先確認理解了 Module 3 的暗中截圖演算法 與 Module 5 的座標轉換邏輯。
如果理解無誤，請先輸出 Module 1 & 2 的基礎環境建置程式碼（包含 manifest.json, Background Script 的攔截邏輯，以及基礎的 PDF.js Viewer HTML/JS 骨架）。