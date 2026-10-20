"use client";

import { create } from "zustand";
import type { ItemNode, Project } from "./types";
import type { Repository, RemoteChange } from "./repository/types";
import { LocalRepository } from "./repository/local";
import { buildSeed, newItem } from "./seed";

type Theme = "system" | "light" | "dark";
type SyncState = "idle" | "saving" | "error";

interface State {
  ready: boolean;
  repo: Repository | null;
  items: Record<string, ItemNode>;
  projects: Record<string, Project>;
  drawerId: string | null;
  theme: Theme;
  sync: SyncState;

  init(repo?: Repository): Promise<void>;
  createItem(p: Partial<ItemNode>): ItemNode;
  updateItem(id: string, patch: Partial<ItemNode>): void;
  updateItems(patches: { id: string; patch: Partial<ItemNode> }[]): void;
  deleteItem(id: string): void;
  moveItem(id: string, parentId: string | null): void;
  toggleLink(a: string, b: string): void;

  createProject(p: Partial<Project>): Project;
  updateProject(id: string, patch: Partial<Project>): void;
  deleteProject(id: string): void;

  openDrawer(id: string | null): void;
  setTheme(t: Theme): void;
  applyRemote(c: RemoteChange): void;
}

/* ---------- debounced write queue ---------- */
const pendingItems = new Set<string>();
const pendingItemDeletes = new Set<string>();
const pendingProjects = new Set<string>();
const pendingProjectDeletes = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => {
  const schedule = () => {
    if (flushTimer) clearTimeout(flushTimer);
    set({ sync: "saving" });
    flushTimer = setTimeout(flush, 450);
  };

  const flush = async () => {
    const { repo, items, projects } = get();
    if (!repo) return;
    const up = [...pendingItems].map((id) => items[id]).filter(Boolean);
    const del = [...pendingItemDeletes];
    const pUp = [...pendingProjects].map((id) => projects[id]).filter(Boolean);
    const pDel = [...pendingProjectDeletes];
    pendingItems.clear();
    pendingItemDeletes.clear();
    pendingProjects.clear();
    pendingProjectDeletes.clear();
    try {
      // Parents must exist before children (FK) — sort by depth.
      const depth = (n: ItemNode) => {
        let d = 0;
        let p = n.parent_id;
        while (p && items[p] && d < 100) {
          d++;
          p = items[p].parent_id;
        }
        return d;
      };
      up.sort((a, b) => depth(a) - depth(b));
      await repo.upsertProjects(pUp);
      await repo.upsertItems(up);
      await repo.deleteItems(del);
      await repo.deleteProjects(pDel);
      set({ sync: "idle" });
    } catch (e) {
      console.error("[êntusis] sync failed", e);
      set({ sync: "error" });
    }
  };

  const touchItems = (ids: string[]) => {
    ids.forEach((id) => pendingItems.add(id));
    schedule();
  };

  return {
    ready: false,
    repo: null,
    items: {},
    projects: {},
    drawerId: null,
    theme: "system",
    sync: "idle",

    async init(repo) {
      const r = repo ?? new LocalRepository();
      let snap = await r.loadAll();
      if (snap.items.length === 0 && snap.projects.length === 0) {
        snap = buildSeed();
        await r.upsertProjects(snap.projects);
        await r.upsertItems(snap.items);
      }
      const theme = (typeof window !== "undefined" && (localStorage.getItem("nf-theme") as Theme)) || "system";
      set({
        repo: r,
        ready: true,
        theme,
        items: Object.fromEntries(snap.items.map((i) => [i.id, i])),
        projects: Object.fromEntries(snap.projects.map((p) => [p.id, p])),
      });
    },

    createItem(p) {
      const siblings = Object.values(get().items).filter((i) => i.parent_id === (p.parent_id ?? null));
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const it = newItem({ sort_order: maxOrder + 1, ...p });
      set((s) => ({ items: { ...s.items, [it.id]: it } }));
      touchItems([it.id]);
      return it;
    },

    updateItem(id, patch) {
      get().updateItems([{ id, patch }]);
    },

    updateItems(patches) {
      const t = new Date().toISOString();
      set((s) => {
        const items = { ...s.items };
        for (const { id, patch } of patches) {
          if (!items[id]) continue;
          items[id] = { ...items[id], ...patch, updated_at: t };
        }
        return { items };
      });
      touchItems(patches.map((p) => p.id));
    },

    deleteItem(id) {
      const { items } = get();
      const toDelete = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of Object.values(items)) {
          if (it.parent_id && toDelete.has(it.parent_id) && !toDelete.has(it.id)) {
            toDelete.add(it.id);
            grew = true;
          }
        }
      }
      const next = { ...items };
      const relinked: string[] = [];
      toDelete.forEach((d) => delete next[d]);
      for (const it of Object.values(next)) {
        if (it.links.some((l) => toDelete.has(l))) {
          next[it.id] = { ...it, links: it.links.filter((l) => !toDelete.has(l)) };
          relinked.push(it.id);
        }
      }
      set((s) => ({ items: next, drawerId: s.drawerId && toDelete.has(s.drawerId) ? null : s.drawerId }));
      toDelete.forEach((d) => {
        pendingItems.delete(d);
        pendingItemDeletes.add(d);
      });
      touchItems(relinked);
    },

    moveItem(id, parentId) {
      const { items } = get();
      // Prevent cycles: target cannot be a descendant of id.
      let p = parentId;
      while (p) {
        if (p === id) return;
        p = items[p]?.parent_id ?? null;
      }
      const siblings = Object.values(items).filter((i) => i.parent_id === parentId);
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.sort_order), -1);
      get().updateItem(id, { parent_id: parentId, sort_order: maxOrder + 1 });
    },

    toggleLink(a, b) {
      if (a === b) return;
      const { items } = get();
      const A = items[a];
      if (!A) return;
      const has = A.links.includes(b);
      get().updateItem(a, { links: has ? A.links.filter((l) => l !== b) : [...A.links, b] });
    },

    createProject(p) {
      const n = Object.keys(get().projects).length;
      const pr: Project = {
        id: crypto.randomUUID(),
        name: "Novo projeto",
        color: ["#8b7bff", "#2dd4bf", "#f472b6", "#facc15", "#38bdf8", "#fb923c"][n % 6],
        icon: null,
        sort_order: n,
        created_at: new Date().toISOString(),
        ...p,
      };
      set((s) => ({ projects: { ...s.projects, [pr.id]: pr } }));
      pendingProjects.add(pr.id);
      schedule();
      return pr;
    },

    updateProject(id, patch) {
      set((s) => ({ projects: { ...s.projects, [id]: { ...s.projects[id], ...patch } } }));
      pendingProjects.add(id);
      schedule();
    },

    deleteProject(id) {
      const { projects, items } = get();
      const next = { ...projects };
      delete next[id];
      set({ projects: next });
      const affected = Object.values(items).filter((i) => i.project_id === id);
      get().updateItems(affected.map((i) => ({ id: i.id, patch: { project_id: null } })));
      pendingProjects.delete(id);
      pendingProjectDeletes.add(id);
      schedule();
    },

    openDrawer(id) {
      set({ drawerId: id });
    },

    setTheme(t) {
      localStorage.setItem("nf-theme", t);
      document.documentElement.dataset.theme = t;
      set({ theme: t });
    },

    applyRemote(c) {
      // Ignore echoes of records we are about to write ourselves.
      if (c.table === "items") {
        if (c.kind === "delete" && c.id) {
          set((s) => {
            const items = { ...s.items };
            delete items[c.id!];
            return { items };
          });
        } else if (c.record && !pendingItems.has(c.record.id)) {
          const r = c.record as ItemNode;
          const cur = get().items[r.id];
          if (!cur || cur.updated_at < r.updated_at) set((s) => ({ items: { ...s.items, [r.id]: r } }));
        }
      } else {
        if (c.kind === "delete" && c.id) {
          set((s) => {
            const projects = { ...s.projects };
            delete projects[c.id!];
            return { projects };
          });
        } else if (c.record && !pendingProjects.has(c.record.id)) {
          const r = c.record as Project;
          set((s) => ({ projects: { ...s.projects, [r.id]: r } }));
        }
      }
    },
  };
});

/* ---------- pure helpers (use with useMemo over `items`) ---------- */

export function childrenOf(items: Record<string, ItemNode>, parentId: string | null): ItemNode[] {
  return Object.values(items)
    .filter((i) => i.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function descendantsOf(items: Record<string, ItemNode>, rootId: string): ItemNode[] {
  const byParent = new Map<string, ItemNode[]>();
  for (const it of Object.values(items)) {
    if (!it.parent_id) continue;
    const arr = byParent.get(it.parent_id) ?? [];
    arr.push(it);
    byParent.set(it.parent_id, arr);
  }
  const out: ItemNode[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of byParent.get(id) ?? []) {
      out.push(c);
      stack.push(c.id);
    }
  }
  return out;
}

export function ancestorsOf(items: Record<string, ItemNode>, id: string): ItemNode[] {
  const out: ItemNode[] = [];
  let p = items[id]?.parent_id ?? null;
  let guard = 0;
  while (p && items[p] && guard++ < 100) {
    out.unshift(items[p]);
    p = items[p].parent_id;
  }
  return out;
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export function checklistProgress(html: string): { done: number; total: number } {
  const total = (html.match(/data-type="taskItem"/g) ?? []).length;
  const done = (html.match(/data-checked="true"/g) ?? []).length;
  return { done, total };
}

export function viewHref(it: Pick<ItemNode, "id" | "default_view">): string {
  if (it.default_view === "CANVAS") return `/canvas/${it.id}`;
  if (it.default_view === "BOARD") return `/board?root=${it.id}`;
  return `/page/${it.id}`;
}
