# AI PDF Reader Extension (MV3)

AI-powered PDF reader for Chrome that replaces the default PDF experience with:
- visual-region AI analysis (not fragile text extraction only)
- highlight-linked notes
- inline AI chat beside selected content
- persistent annotations per PDF fingerprint

## Current Status

This is **v1** (first working version) focused on local PDF reading + highlight workflows.

## Key Features

- PDF interception to custom viewer (`.pdf` URLs)
- Local PDF open support (file picker + drag/drop)
- Text highlight action menu:
  - `Translate`
  - `Summarize`
  - `Explain`
  - `AI Chat`
  - `Add Note`
- Box select fallback (for broken/no text layer PDFs), then same 5 actions
- Inline note popup (preview + edit + save + delete)
- Inline AI chat popup (streaming response, draggable window)
- Notes bound to PDF regions and restored on reopen
- `Ctrl + Mouse Wheel` zoom support

## Project Structure

```text
manifest.json
src/
  background/service-worker.js
  viewer/
    viewer.html
    viewer.js
    selection-capture.js
    annotation-overlay.js
    tooltip-menu.js
    notes-editor.js
    latex-renderer.js
  storage/
    db.js
    schema.js
    migrations.js
  common/
    messages.js
    prompts.js
    config.js
  styles/
    viewer.css
  vendor/
    pdf.mjs
    pdf.worker.mjs
```

## Install (Chrome, Unpacked)

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project folder
5. In extension details, enable **Allow access to file URLs** (important for local PDFs)

## First-Time Setup

Open any PDF in the extension viewer, then in the right sidebar:

1. Set `Vision Model` (default: `gpt-4o`)
2. Set `Chat Model` (default: `gpt-4o-mini`)
3. Paste `OpenAI API Key`
4. Toggle `Use Mock`:
   - `ON` for local/demo testing
   - `OFF` for real model responses
5. Click `Save Settings`

## How To Use

### A) Open PDFs

- URL PDFs: open a direct `.pdf` URL (interception should route to viewer)
- Local PDFs: open viewer and use file picker or drag/drop PDF

### B) Highlight Text (Normal Mode)

1. Select text on PDF
2. Action bar appears near selection
3. Choose one action:
   - `Translate/Summarize/Explain`: AI response + saved annotation
   - `Add Note`: create manual note
   - `AI Chat`: open inline streaming chat popup beside selection

### C) Box Select (Fallback)

1. Click `Box Select` in top toolbar
2. Draw a region on PDF
3. Box mode auto-exits after one capture
4. Same 5-action bar appears and stays until you click elsewhere

### D) Inline Note Popup

- Click highlighted region to open note popup
- Markdown/LaTeX preview shown by default
- Click `Edit` to edit
- `Save` / `Delete` supported directly in popup

### E) Inline AI Chat Popup

- Trigger via `AI Chat` action
- Streaming responses
- Draggable by popup header
- Conversation can be stored as annotation context and reopened from highlight

## LaTeX Notes

Supports inline/block math input:

- Inline: `$\\alpha + \\beta$`
- Block: `$$\\sum_i x_i$$`

If KaTeX is unavailable, common LaTeX symbols fall back to readable Unicode.

## Troubleshooting

### 1) PDF not intercepted

- Reload extension in `chrome://extensions`
- Test with direct `.pdf` URL
- Click extension icon to force-open current PDF-like page in viewer

### 2) Local PDF cannot open

- Ensure **Allow access to file URLs** is enabled in extension details

### 3) Cannot highlight text

- Some PDFs have fragmented/poor text layers; use `Box Select` fallback
- Reload extension after updates

### 4) AI not responding

- Check API key/model settings
- Turn `Use Mock` ON to verify UI flow independently from API

## Notes

- Data is currently stored locally in IndexedDB.
- This is a fast-moving v1 codebase; expect iterative UX tweaks.
