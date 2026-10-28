import type { ItemNode, ItemShare, Project } from "../types";

export interface Snapshot {
  items: ItemNode[];
  projects: Project[];
  shares?: ItemShare[];
  currentUserId?: string | null;
}

export interface RemoteChange {
  table: "items" | "projects" | "shares";
  kind: "upsert" | "delete";
  record?: ItemNode | Project | ItemShare;
  id?: string;
}

/** Storage-agnostic persistence layer (Supabase or local fallback). */
export interface Repository {
  readonly kind: "local" | "supabase";
  loadAll(): Promise<Snapshot>;
  upsertItems(items: ItemNode[]): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;
  upsertProjects(projects: Project[]): Promise<void>;
  deleteProjects(ids: string[]): Promise<void>;
  /** Optional realtime subscription. Returns an unsubscribe function. */
  subscribe?(onChange: (change: RemoteChange) => void): () => void;
}
