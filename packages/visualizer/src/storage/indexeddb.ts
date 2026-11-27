import { createId, type MachineDocument, type StoredMachineRecord } from "../core/types.ts";
import { MemoryMachineStorage } from "./memory.ts";
import type { MachineStorage } from "./types.ts";

const STORE_NAME = "machines";
const DB_VERSION = 1;

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = executor(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB transaction failed."));
  });
}

export class IndexedDBMachineStorage implements MachineStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;

  constructor(dbName = "state-machine-visualizer") {
    this.dbName = dbName;
  }

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb(this.dbName);
    }
    return this.dbPromise;
  }

  async list(): Promise<StoredMachineRecord[]> {
    const db = await this.getDb();
    const all = await runTx<StoredMachineRecord[]>(db, "readonly", (store) => store.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StoredMachineRecord | null> {
    const db = await this.getDb();
    const found = await runTx<StoredMachineRecord | undefined>(db, "readonly", (store) =>
      store.get(id),
    );
    return found ?? null;
  }

  async save(document: MachineDocument): Promise<StoredMachineRecord> {
    const db = await this.getDb();
    const existing = await this.get(document.id);
    const now = Date.now();
    const record: StoredMachineRecord = {
      id: document.id,
      name: document.name,
      description: document.description,
      document: structuredClone(document),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await runTx(db, "readwrite", (store) => store.put(record));
    return record;
  }

  async delete(id: string): Promise<void> {
    const db = await this.getDb();
    await runTx(db, "readwrite", (store) => store.delete(id));
  }

  async duplicate(id: string, newName?: string): Promise<StoredMachineRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const copy = structuredClone(existing.document);
    copy.id = createId(copy.id);
    copy.name = newName ?? `${copy.name} (Copy)`;
    return this.save(copy);
  }

  async exportAll(): Promise<StoredMachineRecord[]> {
    return this.list();
  }

  async importAll(records: StoredMachineRecord[]): Promise<StoredMachineRecord[]> {
    const saved: StoredMachineRecord[] = [];
    for (const rec of records) {
      if (rec?.document) {
        saved.push(await this.save(rec.document));
      }
    }
    return saved;
  }
}

export function createBrowserStorage(dbName = "state-machine-visualizer"): MachineStorage {
  if (typeof indexedDB !== "undefined") {
    return new IndexedDBMachineStorage(dbName);
  }
  return new MemoryMachineStorage();
}
