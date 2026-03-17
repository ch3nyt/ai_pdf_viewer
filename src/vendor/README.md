# Vendor Notes

Place PDF.js ESM build files in this folder for local extension loading.

Minimum expected file for current skeleton:
- `pdf.mjs`
- `pdf.worker.mjs`

If your PDF.js build requires a worker file, also add it here and wire it in `src/viewer/viewer.js`.
