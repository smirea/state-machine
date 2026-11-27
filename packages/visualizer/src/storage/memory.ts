import { createId, type MachineDocument, type StoredMachineRecord } from "../core/types.ts";
import type { MachineStorage } from "./types.ts";

export class MemoryMachineStorage implements MachineStorage {
  private store = new Map<string, StoredMachineRecord>();

  constructor(initialDocuments: MachineDocument[] = []) {
    const now = Date.now();
    initialDocuments.forEach((doc, idx) => {
      this.store.set(doc.id, {
        id: doc.id,
        name: doc.name,
        description: doc.description,
        document: structuredClone(doc),
        createdAt: now - (initialDocuments.length - idx) * 1000,
        updatedAt: now - (initialDocuments.length - idx) * 1000,
      });
    });
  }

  async list(): Promise<StoredMachineRecord[]> {
    return [...this.store.values()]
      .map((r) => structuredClone(r))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StoredMachineRecord | null> {
    const found = this.store.get(id);
    return found ? structuredClone(found) : null;
  }

  async save(document: MachineDocument): Promise<StoredMachineRecord> {
    const now = Date.now();
    const existing = this.store.get(document.id);
    const record: StoredMachineRecord = {
      id: document.id,
      name: document.name,
      description: document.description,
      document: structuredClone(document),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return structuredClone(record);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async duplicate(id: string, newName?: string): Promise<StoredMachineRecord | null> {
    const existing = this.store.get(id);
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
