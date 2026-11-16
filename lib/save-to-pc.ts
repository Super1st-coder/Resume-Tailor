/**
 * Save generated files on the user's own PC (never on the server).
 *
 * In Chrome/Edge the user picks a folder once (e.g. D:\Resume); files are then
 * written to <folder>\<Person>\<Company_Role>\ automatically. The folder choice
 * is remembered in IndexedDB. Other browsers fall back to a normal download.
 *
 * The folder picker only exists on secure pages (https:// or localhost).
 */

/** Names Windows reserves for devices; a folder with one of these names can't be opened. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Make a string safe to use as one Windows folder/file name. */
export function sanitizeSegment(input: string): string {
  let cleaned = input
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, " ")
    // control chars, soft hyphen, zero-width/direction marks, BOM, line separators, private-use
    .replace(
      /[\x00-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\ue000-\uf8ff]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 80).replace(/[.\s]+$/g, "");
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned || "untitled";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any;

const DB_NAME = "resume-tailor";
const STORE = "handles";
const KEY = "save-dir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/** True when this browser/page can write into a chosen folder. */
export function canPickFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window && window.isSecureContext;
}

export async function getSavedFolder(): Promise<DirHandle | null> {
  if (!canPickFolder()) return null;
  try {
    return (await idb<DirHandle>("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Ask the user to choose the save folder (must run from a click). */
export async function pickFolder(): Promise<DirHandle | null> {
  if (!canPickFolder()) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ id: "resume-save", mode: "readwrite" });
    await idb("readwrite", (s) => s.put(handle, KEY)).catch(() => {});
    return handle;
  } catch {
    return null; // user cancelled
  }
}

export async function forgetFolder(): Promise<void> {
  await idb("readwrite", (s) => s.delete(KEY)).catch(() => {});
}

/**
 * Make sure we may write to the folder. Call this right at the click
 * (before long awaits): the browser only shows the permission prompt
 * during a user gesture.
 */
export async function ensureWriteAccess(handle: DirHandle): Promise<boolean> {
  try {
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return (await handle.requestPermission(opts)) === "granted";
  } catch {
    return false;
  }
}

async function writeFile(dir: DirHandle, name: string, data: Blob | string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

/** Write files into <root>\<person>\<folder>\. Returns the relative path shown to the user. */
export async function saveIntoFolder(
  root: DirHandle,
  person: string,
  folder: string,
  files: { name: string; data: Blob | string }[]
): Promise<string> {
  const p = await root.getDirectoryHandle(sanitizeSegment(person), { create: true });
  const f = await p.getDirectoryHandle(sanitizeSegment(folder), { create: true });
  for (const file of files) await writeFile(f, sanitizeSegment(file.name), file.data);
  return `${root.name}\\${sanitizeSegment(person)}\\${sanitizeSegment(folder)}\\${sanitizeSegment(files[0].name)}`;
}

/** Plain browser download (goes to the browser's Downloads folder). */
export function downloadFile(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeSegment(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
