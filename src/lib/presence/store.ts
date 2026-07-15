// The presence cache abstraction — the in-memory index the service reads/
// writes so hot presence lookups never hit the database.
//
// Today this is an in-process Map (correct and fast for the current single
// Render instance). The INTERFACE is deliberately async and shaped like a
// key/value + set index so a Redis-backed implementation drops in unchanged:
// a Redis hash per user, a per-company set for listByCompany, and Redis
// pub/sub to fan a write on one app server out to the others. That is the one
// piece needed to make presence correct across horizontally-scaled instances;
// the service and all its callers stay exactly the same when it lands.
import type { PresenceEntry } from "./types";

export interface PresenceStore {
  get(userId: string): Promise<PresenceEntry | null>;
  set(entry: PresenceEntry): Promise<void>;
  delete(userId: string): Promise<void>;
  listByCompany(companyId: string): Promise<PresenceEntry[]>;
  all(): Promise<PresenceEntry[]>;
}

class InMemoryPresenceStore implements PresenceStore {
  private byUser = new Map<string, PresenceEntry>();
  // companyId -> set of userIds, for O(1) company snapshots without scanning
  // every agent on the platform.
  private byCompany = new Map<string, Set<string>>();

  async get(userId: string): Promise<PresenceEntry | null> {
    return this.byUser.get(userId) ?? null;
  }

  async set(entry: PresenceEntry): Promise<void> {
    const prev = this.byUser.get(entry.userId);
    // Keep the company index consistent if an agent's company ever changes.
    if (prev && prev.companyId && prev.companyId !== entry.companyId) {
      this.byCompany.get(prev.companyId)?.delete(entry.userId);
    }
    this.byUser.set(entry.userId, entry);
    if (entry.companyId) {
      let set = this.byCompany.get(entry.companyId);
      if (!set) {
        set = new Set();
        this.byCompany.set(entry.companyId, set);
      }
      set.add(entry.userId);
    }
  }

  async delete(userId: string): Promise<void> {
    const prev = this.byUser.get(userId);
    if (prev?.companyId) this.byCompany.get(prev.companyId)?.delete(userId);
    this.byUser.delete(userId);
  }

  async listByCompany(companyId: string): Promise<PresenceEntry[]> {
    const ids = this.byCompany.get(companyId);
    if (!ids) return [];
    const out: PresenceEntry[] = [];
    for (const id of ids) {
      const e = this.byUser.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  async all(): Promise<PresenceEntry[]> {
    return [...this.byUser.values()];
  }
}

export const presenceStore: PresenceStore = new InMemoryPresenceStore();
