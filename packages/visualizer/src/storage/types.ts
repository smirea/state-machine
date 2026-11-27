import type { MachineDocument, StoredMachineRecord } from "../core/types.ts";

export interface MachineStorage {
  list(): Promise<StoredMachineRecord[]>;
  get(id: string): Promise<StoredMachineRecord | null>;
  save(document: MachineDocument): Promise<StoredMachineRecord>;
  delete(id: string): Promise<void>;
  duplicate(id: string, newName?: string): Promise<StoredMachineRecord | null>;
  exportAll(): Promise<StoredMachineRecord[]>;
  importAll(records: StoredMachineRecord[]): Promise<StoredMachineRecord[]>;
}
