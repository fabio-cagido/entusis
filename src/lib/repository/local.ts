import type { ItemNode, Project } from "../types";
import type { Repository, Snapshot } from "./types";

const KEY = "nodes-flows:v1";

interface Stored {
  items: Record<string, ItemNode>;
  projects: Record<string, Project>;
}

function read(): Stored {
  if (typeof window === "undefined") return { items: {}, projects: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { items: {}, projects: {} };
    return JSON.parse(raw) as Stored;
  } catch {
    return { items: {}, projects: {} };
  }
}

function write(data: Stored) {
  window.localStorage.setItem(KEY, JSON.stringify(data));
}

export class LocalRepository implements Repository {
  readonly kind = "local" as const;

  async loadAll(): Promise<Snapshot> {
    const d = read();
    return { items: Object.values(d.items), projects: Object.values(d.projects) };
  }

  async upsertItems(items: ItemNode[]) {
    const d = read();
    for (const it of items) d.items[it.id] = it;
    write(d);
  }

  async deleteItems(ids: string[]) {
    const d = read();
    for (const id of ids) delete d.items[id];
    write(d);
  }

  async upsertProjects(projects: Project[]) {
    const d = read();
    for (const p of projects) d.projects[p.id] = p;
    write(d);
  }

  async deleteProjects(ids: string[]) {
    const d = read();
    for (const id of ids) delete d.projects[id];
    write(d);
  }
}
