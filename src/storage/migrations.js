import { STORES } from "./schema.js";

export function runMigrations(db, oldVersion, _newVersion) {
  if (oldVersion < 1) {
    const annotationStore = db.createObjectStore(STORES.ANNOTATIONS, { keyPath: "id" });
    annotationStore.createIndex("byPdfPage", ["pdfId", "pageNum"], { unique: false });
    annotationStore.createIndex("byPdfUpdatedAt", ["pdfId", "updatedAt"], { unique: false });
    annotationStore.createIndex("byThreadId", "threadId", { unique: false });

    const threadStore = db.createObjectStore(STORES.THREADS, { keyPath: "id" });
    threadStore.createIndex("byPdfId", "pdfId", { unique: false });
    threadStore.createIndex("byUpdatedAt", "updatedAt", { unique: false });

    const messageStore = db.createObjectStore(STORES.MESSAGES, { keyPath: "id" });
    messageStore.createIndex("byThreadId", "threadId", { unique: false });
    messageStore.createIndex("byCreatedAt", "createdAt", { unique: false });
  }
}
