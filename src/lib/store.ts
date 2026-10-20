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
  favorites: string[];
  drawerId: string | null;
  theme: Theme;
  sync: SyncState;

  init(repo?: Repository): Promise<void>;
  createItem(p: Partial<ItemNode>): ItemNode;
  updateItem(id: string, patch: Partial<ItemNode>): void;
  updateItems(patches: { id: string; patch: Partial<ItemNode> }[]): void;
  deleteItem(id: string): void;
  duplicateItem(id: string): ItemNode | null;
  moveItem(id: string, parentId: string | null): void;
  toggleLink(a: string, b: string): void;

  createProject(p: Partial<Project>): Project;
  updateProject(id: string, patch: Partial<Project>): void;
  deleteProject(id: string): void;
  duplicateProject(id: string): Project | null;

  toggleFavorite(id: string): void;
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
    favorites: [],

    async init(repo) {
      const r = repo ?? new LocalRepository();
      let snap = await r.loadAll();
      if (snap.items.length === 0 && snap.projects.length === 0) {
        snap = buildSeed();
        await r.upsertProjects(snap.projects);
        await r.upsertItems(snap.items);
      }
      const theme = (typeof window !== "undefined" && (localStorage.getItem("nf-theme") as Theme)) || "system";
      let favs: string[] = [];
      try {
        const rawFavs = typeof window !== "undefined" ? localStorage.getItem("nf-favorites") : null;
        if (rawFavs) favs = JSON.parse(rawFavs);
      } catch {
        favs = [];
      }
      // Garante que todo projeto tem uma página raiz vinculada
      const itemsMap = Object.fromEntries(snap.items.map((i) => [i.id, i]));
      const projectsMap = Object.fromEntries(snap.projects.map((p) => [p.id, p]));
      const touchedItems: string[] = [];
      const touchedProjects: string[] = [];

      for (const pr of Object.values(projectsMap)) {
        if (!pr.page_id || !itemsMap[pr.page_id]) {
          const match = Object.values(itemsMap).find(
            (it) => it.type === "PAGE" && (it.project_id === pr.id || it.title.toLowerCase().trim() === pr.name.toLowerCase().trim())
          );
          if (match) {
            pr.page_id = match.id;
            match.project_id = pr.id;
            if (match.title !== pr.name && (match.title.toLowerCase() === "novo projeto" || match.title.toLowerCase() === "sem título")) {
              match.title = pr.name;
              if (match.content && match.content.includes("<h2>Novo projeto — Visão Geral</h2>")) {
                match.content = match.content.replace("<h2>Novo projeto — Visão Geral</h2>", `<h2>${pr.name} — Visão Geral</h2>`);
              }
            }
            touchedItems.push(match.id);
            touchedProjects.push(pr.id);
          } else {
            const page = newItem({
              title: pr.name,
              type: "PAGE",
              icon: pr.icon || "📁",
              project_id: pr.id,
              parent_id: null,
              content: `<h2>${pr.name} — Visão Geral</h2><p>Página central do projeto. Aqui você encontra objetivos estratégicos, notas, arquivos e o quadro de tarefas.</p>`,
            });
            itemsMap[page.id] = page;
            pr.page_id = page.id;
            touchedItems.push(page.id);
            touchedProjects.push(pr.id);
          }
        }
      }

      set({
        repo: r,
        ready: true,
        theme,
        favorites: favs,
        items: itemsMap,
        projects: projectsMap,
      });

      if (touchedItems.length > 0) touchItems(touchedItems);
      if (touchedProjects.length > 0) {
        touchedProjects.forEach((id) => pendingProjects.add(id));
        schedule();
      }
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
      const { projects } = get();
      const projectUpdates: { id: string; name: string }[] = [];

      set((s) => {
        const items = { ...s.items };
        for (const { id, patch } of patches) {
          if (!items[id]) continue;
          items[id] = { ...items[id], ...patch, updated_at: t };
          if (patch.title) {
            const it = items[id];
            const proj = Object.values(projects).find(
              (p) => p.page_id === id || (it && it.project_id === p.id && it.type === "PAGE" && !it.parent_id)
            );
            if (proj && proj.name !== patch.title) {
              projectUpdates.push({ id: proj.id, name: patch.title });
            }
          }
        }
        return { items };
      });
      for (const pu of projectUpdates) {
        get().updateProject(pu.id, { name: pu.name });
      }
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

    duplicateItem(id) {
      const { items } = get();
      const orig = items[id];
      if (!orig) return null;
      const clone = get().createItem({
        ...orig,
        title: `${orig.title || "Sem título"} (cópia)`,
        sort_order: orig.sort_order + 0.5,
      });
      return clone;
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
      const id = crypto.randomUUID();
      const color = p.color || ["#8b7bff", "#2dd4bf", "#f472b6", "#facc15", "#38bdf8", "#fb923c"][n % 6];
      const name = p.name || "Novo projeto";
      const icon = p.icon ?? null;

      // Cria a Página Central do Projeto automaticamente
      const page = get().createItem({
        title: name,
        type: "PAGE",
        icon: icon || "📁",
        project_id: id,
        parent_id: null,
        content: `<h2>${name} — Visão Geral</h2><p>Página central do projeto. Use este espaço para anotações, objetivos estratégicos, anexos e o quadro de tarefas.</p>`,
      });

      const pr: Project = {
        id,
        name,
        color,
        icon,
        sort_order: n,
        created_at: new Date().toISOString(),
        page_id: page.id,
        ...p,
      };
      set((s) => ({ projects: { ...s.projects, [pr.id]: pr } }));
      pendingProjects.add(pr.id);
      schedule();
      return pr;
    },

    updateProject(id, patch) {
      const cur = get().projects[id];
      if (!cur) return;
      set((s) => ({ projects: { ...s.projects, [id]: { ...s.projects[id], ...patch } } }));
      if (patch.name) {
        const { items } = get();
        const page =
          (cur.page_id ? items[cur.page_id] : null) ||
          Object.values(items).find(
            (i) => i.project_id === id && i.type === "PAGE" && !i.parent_id
          );
        if (page && page.title !== patch.name) {
          let content = page.content;
          if (cur.name && content && content.includes(`<h2>${cur.name} — Visão Geral</h2>`)) {
            content = content.replace(`<h2>${cur.name} — Visão Geral</h2>`, `<h2>${patch.name} — Visão Geral</h2>`);
          } else if (content && content.includes("<h2>Novo projeto — Visão Geral</h2>")) {
            content = content.replace("<h2>Novo projeto — Visão Geral</h2>", `<h2>${patch.name} — Visão Geral</h2>`);
          }
          get().updateItem(page.id, { title: patch.name, content });
        }
      }
      pendingProjects.add(id);
      schedule();
    },

    deleteProject(id) {
      const { projects, items, favorites } = get();
      const next = { ...projects };
      delete next[id];
      const nextFavs = favorites.filter((f) => f !== id);
      set({
        projects: next,
        favorites: nextFavs,
      });
      if (typeof window !== "undefined") {
        localStorage.setItem("nf-favorites", JSON.stringify(nextFavs));
      }
      // Remove todos os itens vinculados ao projeto ao movê-lo para a lixeira
      const affected = Object.values(items).filter((i) => i.project_id === id);
      for (const it of affected) {
        get().deleteItem(it.id);
      }
      pendingProjects.delete(id);
      pendingProjectDeletes.add(id);
      schedule();
    },

    duplicateProject(id) {
      const { projects, items } = get();
      const orig = projects[id];
      if (!orig) return null;
      const clone = get().createProject({
        name: `${orig.name} (cópia)`,
        color: orig.color,
        icon: orig.icon,
      });

      // Duplica os itens pertencentes ao projeto
      const projectItems = Object.values(items).filter((i) => i.project_id === id);
      for (const it of projectItems) {
        get().createItem({
          ...it,
          project_id: clone.id,
        });
      }
      return clone;
    },

    toggleFavorite(id) {
      const { favorites } = get();
      const next = favorites.includes(id)
        ? favorites.filter((f) => f !== id)
        : [...favorites, id];
      set({ favorites: next });
      if (typeof window !== "undefined") {
        localStorage.setItem("nf-favorites", JSON.stringify(next));
      }
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
          set((s) => {
            const existing = s.projects[r.id];
            return {
              projects: {
                ...s.projects,
                [r.id]: {
                  ...existing,
                  ...r,
                  page_id: existing?.page_id ?? r.page_id,
                },
              },
            };
          });
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
