import { runMigrations } from "./migrations.js";
import { DB_NAME, DB_VERSION, STORES } from "./schema.js";

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDonePromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("Transaction failed"));
  });
}

export function openDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      runMigrations(db, event.oldVersion, event.newVersion || DB_VERSION);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return Date.now();
}

export async function upsertAnnotation(input) {
  const db = await openDb();
  const tx = db.transaction(STORES.ANNOTATIONS, "readwrite");
  const store = tx.objectStore(STORES.ANNOTATIONS);

  const record = {
    id: input.id || createId("ann"),
    pdfId: input.pdfId,
    pageNum: input.pageNum,
    coordsPdf: input.coordsPdf || null,
    selectionRectsPdf: input.selectionRectsPdf || [],
    type: input.type || "note",
    action: input.action || null,
    content: input.content || "",
    sourceImage: input.sourceImage || null,
    meta: input.meta || null,
    threadId: input.threadId || null,
    createdAt: input.createdAt || now(),
    updatedAt: now()
  };

  store.put(record);
  await txDonePromise(tx);
  return record;
}

export async function getAnnotationsByPdfPage(pdfId, pageNum) {
  const db = await openDb();
  const tx = db.transaction(STORES.ANNOTATIONS, "readonly");
  const index = tx.objectStore(STORES.ANNOTATIONS).index("byPdfPage");
  const result = await requestToPromise(index.getAll([pdfId, pageNum]));
  await txDonePromise(tx);
  return result.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function listAnnotationsByPdf(pdfId) {
  const db = await openDb();
  const tx = db.transaction(STORES.ANNOTATIONS, "readonly");
  const store = tx.objectStore(STORES.ANNOTATIONS);
  const all = await requestToPromise(store.getAll());
  await txDonePromise(tx);
  return all.filter((item) => item.pdfId === pdfId);
}

export async function getAnnotationById(annotationId) {
  const db = await openDb();
  const tx = db.transaction(STORES.ANNOTATIONS, "readonly");
  const store = tx.objectStore(STORES.ANNOTATIONS);
  const item = await requestToPromise(store.get(annotationId));
  await txDonePromise(tx);
  return item || null;
}

export async function deleteAnnotation(annotationId) {
  const db = await openDb();
  const tx = db.transaction(STORES.ANNOTATIONS, "readwrite");
  const store = tx.objectStore(STORES.ANNOTATIONS);
  store.delete(annotationId);
  await txDonePromise(tx);
}

export async function upsertThread(input) {
  const db = await openDb();
  const tx = db.transaction(STORES.THREADS, "readwrite");
  const store = tx.objectStore(STORES.THREADS);
  const record = {
    id: input.id || createId("thread"),
    pdfId: input.pdfId,
    title: input.title || "New chat",
    createdAt: input.createdAt || now(),
    updatedAt: now()
  };
  store.put(record);
  await txDonePromise(tx);
  return record;
}

export async function renameThread(threadId, title) {
  const db = await openDb();
  const tx = db.transaction(STORES.THREADS, "readwrite");
  const store = tx.objectStore(STORES.THREADS);
  const thread = await requestToPromise(store.get(threadId));
  if (!thread) {
    await txDonePromise(tx);
    return null;
  }
  thread.title = title || thread.title;
  thread.updatedAt = now();
  store.put(thread);
  await txDonePromise(tx);
  return thread;
}

export async function listThreadsByPdf(pdfId) {
  const db = await openDb();
  const tx = db.transaction(STORES.THREADS, "readonly");
  const index = tx.objectStore(STORES.THREADS).index("byPdfId");
  const items = await requestToPromise(index.getAll(pdfId));
  await txDonePromise(tx);
  return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function ensureDefaultThread(pdfId) {
  const existing = await listThreadsByPdf(pdfId);
  if (existing.length > 0) {
    return existing[0];
  }
  return upsertThread({
    pdfId,
    title: "Main thread"
  });
}

export async function addMessage(input) {
  const db = await openDb();
  const tx = db.transaction([STORES.MESSAGES, STORES.THREADS], "readwrite");
  const msgStore = tx.objectStore(STORES.MESSAGES);
  const threadStore = tx.objectStore(STORES.THREADS);

  const message = {
    id: createId("msg"),
    threadId: input.threadId,
    role: input.role,
    content: input.content || "",
    attachmentAnnotationId: input.attachmentAnnotationId || null,
    createdAt: now()
  };
  msgStore.put(message);

  const thread = await requestToPromise(threadStore.get(input.threadId));
  if (thread) {
    thread.updatedAt = now();
    threadStore.put(thread);
  }

  await txDonePromise(tx);
  return message;
}

export async function listMessagesByThread(threadId) {
  const db = await openDb();
  const tx = db.transaction(STORES.MESSAGES, "readonly");
  const index = tx.objectStore(STORES.MESSAGES).index("byThreadId");
  const items = await requestToPromise(index.getAll(threadId));
  await txDonePromise(tx);
  return items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
