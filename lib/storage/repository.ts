import { randomUUID } from 'node:crypto';
import { medicalRecordSchema, type MedicalRecord } from '../schema';
import { ApiError } from '../server/errors';

export const SESSION_TTL_SECONDS = 60 * 60;
const MAX_RECORDS = 160;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
type Entry = { owner: string; record: MedicalRecord; expires: number; bytes: number };

export interface RecordRepository {
  create(owner: string, record: MedicalRecord): MedicalRecord;
  get(owner: string, id: string): MedicalRecord;
  update(owner: string, record: MedicalRecord): MedicalRecord;
  list(owner: string): MedicalRecord[];
  delete(owner: string, id: string): void;
  mutate(owner: string, id: string, fn: (record: MedicalRecord) => Promise<MedicalRecord> | MedicalRecord): Promise<MedicalRecord>;
}

export class InMemoryRecordRepository implements RecordRepository {
  private entries = new Map<string, Entry>();
  private locks = new Set<string>();
  private prune() {
    const now = Date.now();
    for (const [id, entry] of this.entries) if (entry.expires <= now && !this.locks.has(id)) this.entries.delete(id);
  }
  private store(owner: string, record: MedicalRecord): MedicalRecord {
    this.prune();
    const safe = medicalRecordSchema.parse(record);
    const bytes = Buffer.byteLength(JSON.stringify(safe));
    const oldBytes = this.entries.get(safe.id)?.bytes ?? 0;
    const total = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    if (bytes > MAX_RECORD_BYTES || total - oldBytes + bytes > MAX_TOTAL_BYTES) throw new ApiError('STORAGE_FULL');
    this.entries.set(safe.id, { owner, record: structuredClone(safe), expires: Date.now() + SESSION_TTL_SECONDS * 1000, bytes });
    return structuredClone(safe);
  }
  create(owner: string, record: MedicalRecord) {
    this.prune();
    if (this.entries.size >= MAX_RECORDS || this.list(owner).length >= 8) throw new ApiError('STORAGE_FULL');
    if (this.entries.has(record.id)) throw new ApiError('VALIDATION_FAILED');
    return this.store(owner, record);
  }
  get(owner: string, id: string) {
    this.prune();
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner) throw new ApiError('RECORD_NOT_FOUND');
    return structuredClone(entry.record);
  }
  update(owner: string, record: MedicalRecord) { this.get(owner, record.id); return this.store(owner, record); }
  list(owner: string) { this.prune(); return [...this.entries.values()].filter(entry => entry.owner === owner).map(entry => structuredClone(entry.record)); }
  delete(owner: string, id: string) {
    this.get(owner, id);
    if (this.locks.has(id)) throw new ApiError('RECORD_BUSY');
    this.entries.delete(id);
  }
  async mutate(owner: string, id: string, fn: (record: MedicalRecord) => Promise<MedicalRecord> | MedicalRecord) {
    const record = this.get(owner, id);
    if (this.locks.has(id)) throw new ApiError('RECORD_BUSY');
    this.locks.add(id);
    try { return this.update(owner, await fn(record)); } finally { this.locks.delete(id); }
  }
}

const globalStore = globalThis as typeof globalThis & { medlensRepository?: InMemoryRecordRepository };
export const repository = globalStore.medlensRepository ??= new InMemoryRecordRepository();
export const newId = () => randomUUID();
