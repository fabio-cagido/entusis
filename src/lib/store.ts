"use client";

import { create } from "zustand";
import type { ItemNode, ItemShare, Project } from "./types";
import type { Repository, RemoteChange } from "./repository/types";
import { LocalRepository } from "./repository/local";
import { buildSeed, newItem } from "./seed";

type Theme = "system" | "light" | "dark";
type SyncState = "idle" | "saving" | "error";

interface State {
  ready: boolean;
  repo: Repository | null;
  currentUserId: string | null;
  items: Record<string, ItemNode>;
  projects: Record<string, Project>;
  shares: Record<string, ItemShare>;
  favorites: string[];
  drawerId: string | null;
  shareModalItemId: string | null;
  theme: Theme;
  sync: SyncState;
  syncError: string | null;
  sidebarCollapsed: boolean;

  init(repo?: Repository): Promise<void>;
  createItem(p: Partial<ItemNode>): ItemNode;
  addItems(newItems: ItemNode[]): Promise<void>;
  flushNow(): Promise<void>;
  clearSyncError(): void;
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
  openShareModal(id: string | null): void;
  upsertShareLocal(share: ItemShare): void;
  removeShareLocal(shareId: string): void;
  setTheme(t: Theme): void;
  toggleSidebar(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  applyRemote(c: RemoteChange): void;
}

/* ---------- debounced write queue ---------- */
const pendingItems = new Set<string>();
const pendingItemDeletes = new Set<string>();
const pendingProjects = new Set<string>();
const pendingProjectDeletes = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => {
  const schedule = () => {
    if (flushTimer) clearTimeout(flushTimer);
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    set({ sync: "saving" });
    flushTimer = setTimeout(() => {
      void flush(false);
    }, 450);
  };

  const flush = async (throwOnError = false) => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const { repo, items, projects } = get();
    if (!repo) return;

    const itemIds = [...pendingItems];
    const del = [...pendingItemDeletes];
    const projIds = [...pendingProjects];
    const pDel = [...pendingProjectDeletes];

    if (itemIds.length === 0 && del.length === 0 && projIds.length === 0 && pDel.length === 0) {
      set({ sync: "idle", syncError: null });
      return;
    }

    const up = itemIds.map((id) => items[id]).filter(Boolean);
    const pUp = projIds.map((id) => projects[id]).filter(Boolean);

    set({ sync: "saving" });

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

      if (pUp.length > 0) {
        await repo.upsertProjects(pUp);
        projIds.forEach((id) => pendingProjects.delete(id));
      } else {
        projIds.forEach((id) => pendingProjects.delete(id));
      }

      if (up.length > 0) {
        await repo.upsertItems(up);
        itemIds.forEach((id) => pendingItems.delete(id));
      } else {
        itemIds.forEach((id) => pendingItems.delete(id));
      }

      if (del.length > 0) {
        await repo.deleteItems(del);
        del.forEach((id) => pendingItemDeletes.delete(id));
      }

      if (pDel.length > 0) {
        await repo.deleteProjects(pDel);
        pDel.forEach((id) => pendingProjectDeletes.delete(id));
      }

      set({ sync: "idle", syncError: null });
    } catch (e: unknown) {
      const errMsg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
      console.error("[êntusis] sync failed", e);
      set({
        sync: "error",
        syncError: `Falha ao sincronizar com o banco: ${errMsg}`,
      });
      // Agendar nova tentativa automática mantendo os itens na fila pendingItems
      retryTimer = setTimeout(() => {
        void flush(false);
      }, 5000);
      if (throwOnError) {
        throw new Error(errMsg);
      }
    }
  };

  const touchItems = (ids: string[]) => {
    ids.forEach((id) => pendingItems.add(id));
    schedule();
  };

  let initPromise: Promise<void> | null = null;

  return {
    ready: false,
    repo: null,
    currentUserId: null,
    items: {},
    projects: {},
    shares: {},
    drawerId: null,
    shareModalItemId: null,
    theme: "system",
    sync: "idle",
    syncError: null,
    favorites: [],
    sidebarCollapsed: false,

    async init(repo) {
      if (initPromise) {
        return initPromise;
      }

      initPromise = (async () => {
        try {
          const r = repo ?? new LocalRepository();
          let snap = await r.loadAll();

          if (snap.items.length === 0 && snap.projects.length === 0) {
            snap = buildSeed();
            await r.upsertProjects(snap.projects);
            await r.upsertItems(snap.items);
          }
          const theme = (typeof window !== "undefined" && (localStorage.getItem("nf-theme") as Theme)) || "system";
          const sidebarCollapsed =
            typeof window !== "undefined" && localStorage.getItem("entusis_sidebar_collapsed") === "true";
          let favs: string[] = [];
          try {
            const rawFavs = typeof window !== "undefined" ? localStorage.getItem("nf-favorites") : null;
            if (rawFavs) favs = JSON.parse(rawFavs);
          } catch {
            favs = [];
          }

          let archivedSet: Set<string> | null = null;
          try {
            const rawArchived = typeof window !== "undefined" ? localStorage.getItem("nf-archived-projects") : null;
            if (rawArchived) archivedSet = new Set(JSON.parse(rawArchived));
          } catch {
            archivedSet = null;
          }

          // Limpar localStorage legado para não re-duplicar quando usando Supabase
          if (typeof window !== "undefined" && r.kind === "supabase") {
            window.localStorage.removeItem("nodes-flows:v1");
          }

          // Garante que todo projeto tem uma única página raiz vinculada (idempotente) e limpa duplicatas geradas anteriormente
          const itemsMap = Object.fromEntries(snap.items.map((i) => [i.id, i]));
          const projectsMap = Object.fromEntries(
            snap.projects.map((p) => [
              p.id,
              {
                ...p,
                is_archived: archivedSet !== null ? archivedSet.has(p.id) : Boolean(p.is_archived),
              },
            ])
          );
          const touchedItems: string[] = [];
          const duplicateProjectPageIdsToDelete: string[] = [];

          const parentIdsWithChildren = new Set<string>();
          for (const it of Object.values(itemsMap)) {
            if (it.parent_id) {
              parentIdsWithChildren.add(it.parent_id);
            }
          }

          const isAutoGeneratedProjectPage = (it: ItemNode) => {
            if (parentIdsWithChildren.has(it.id)) return false;
            if (Array.isArray(it.attachments) && it.attachments.length > 0) return false;
            if (Array.isArray(it.links) && it.links.length > 0) return false;
            const c = (it.content || "").trim();
            return (
              c === "" ||
              c.includes("— Visão Geral</h2><p>Página central do projeto.")
            );
          };

          for (const pr of Object.values(projectsMap)) {
            const prNameNorm = pr.name.toLowerCase().trim();
            const candidates = Object.values(itemsMap).filter(
              (it) =>
                it.type === "PAGE" &&
                !it.parent_id &&
                it.default_view !== "CANVAS" &&
                (it.project_id === pr.id ||
                  (!it.project_id && it.title.toLowerCase().trim() === prNameNorm))
            );

            if (candidates.length > 0) {
              candidates.sort((a, b) => {
                const aAuto = isAutoGeneratedProjectPage(a);
                const bAuto = isAutoGeneratedProjectPage(b);
                if (aAuto !== bAuto) return aAuto ? 1 : -1;
                return (a.created_at || "").localeCompare(b.created_at || "");
              });

              const canonical = candidates[0];
              pr.page_id = canonical.id;

              let mutated = false;
              if (canonical.project_id !== pr.id) {
                canonical.project_id = pr.id;
                mutated = true;
              }
              if (
                canonical.title !== pr.name &&
                (canonical.title.toLowerCase() === "novo projeto" ||
                  canonical.title.toLowerCase() === "sem título")
              ) {
                canonical.title = pr.name;
                if (canonical.content && canonical.content.includes("<h2>Novo projeto — Visão Geral</h2>")) {
                  canonical.content = canonical.content.replace(
                    "<h2>Novo projeto — Visão Geral</h2>",
                    `<h2>${pr.name} — Visão Geral</h2>`
                  );
                }
                mutated = true;
              }
              if (mutated) {
                touchedItems.push(canonical.id);
              }

              for (let i = 1; i < candidates.length; i++) {
                const dup = candidates[i];
                if (isAutoGeneratedProjectPage(dup)) {
                  delete itemsMap[dup.id];
                  duplicateProjectPageIdsToDelete.push(dup.id);
                }
              }
            } else if (!pr.page_id || !itemsMap[pr.page_id]) {
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
            }
          }

          if (duplicateProjectPageIdsToDelete.length > 0) {
            console.info(
              `[êntusis] Removendo ${duplicateProjectPageIdsToDelete.length} páginas raízes de projetos duplicadas...`
            );
            try {
              await r.deleteItems(duplicateProjectPageIdsToDelete);
            } catch (cleanupErr) {
              console.error("[êntusis] Erro ao limpar páginas duplicadas:", cleanupErr);
            }
          }

          const sharesMap = Object.fromEntries((snap.shares ?? []).map((sh) => [sh.id, sh]));

          set({
            repo: r,
            currentUserId: snap.currentUserId ?? null,
            ready: true,
            theme,
            sidebarCollapsed,
            favorites: favs,
            items: itemsMap,
            projects: projectsMap,
            shares: sharesMap,
          });

          if (touchedItems.length > 0) touchItems(touchedItems);
        } finally {
          initPromise = null;
        }
      })();

      return initPromise;
    },

    createItem(p) {
      const state = get();
      const siblings = Object.values(state.items).filter((i) => i.parent_id === (p.parent_id ?? null));
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const inheritedUserId =
        (p.parent_id && state.items[p.parent_id]?.user_id) || state.currentUserId || undefined;
      const it = newItem({
        sort_order: maxOrder + 1,
        ...(inheritedUserId ? { user_id: inheritedUserId } : {}),
        ...p,
      });
      set((s) => ({ items: { ...s.items, [it.id]: it } }));
      touchItems([it.id]);
      return it;
    },

    async addItems(newItems) {
      if (!newItems || newItems.length === 0) return;
      const next = { ...get().items };
      for (const it of newItems) {
        next[it.id] = it;
        pendingItems.add(it.id);
      }
      set({ items: next });
      await flush(true);
    },

    async flushNow() {
      await flush(false);
    },

    clearSyncError() {
      set({ syncError: null });
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
        is_archived: false,
        ...p,
      };
      set((s) => {
        const nextProjects = { ...s.projects, [pr.id]: pr };
        if (typeof window !== "undefined") {
          const archivedIds = Object.values(nextProjects)
            .filter((proj) => proj.is_archived)
            .map((proj) => proj.id);
          localStorage.setItem("nf-archived-projects", JSON.stringify(archivedIds));
        }
        return { projects: nextProjects };
      });
      pendingProjects.add(pr.id);
      schedule();
      return pr;
    },

    updateProject(id, patch) {
      const cur = get().projects[id];
      if (!cur) return;
      set((s) => {
        const nextProjects = { ...s.projects, [id]: { ...s.projects[id], ...patch } };
        if (typeof window !== "undefined" && patch.is_archived !== undefined) {
          const archivedIds = Object.values(nextProjects)
            .filter((proj) => proj.is_archived)
            .map((proj) => proj.id);
          localStorage.setItem("nf-archived-projects", JSON.stringify(archivedIds));
        }
        return { projects: nextProjects };
      });
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
        const archivedIds = Object.values(next)
          .filter((proj) => proj.is_archived)
          .map((proj) => proj.id);
        localStorage.setItem("nf-archived-projects", JSON.stringify(archivedIds));
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

    openShareModal(id) {
      set({ shareModalItemId: id });
    },

    upsertShareLocal(share) {
      set((s) => ({
        shares: { ...s.shares, [share.id]: share },
      }));
    },

    removeShareLocal(shareId) {
      set((s) => {
        const next = { ...s.shares };
        delete next[shareId];
        return { shares: next };
      });
    },

    setTheme(t) {
      localStorage.setItem("nf-theme", t);
      document.documentElement.dataset.theme = t;
      set({ theme: t });
    },

    toggleSidebar() {
      const next = !get().sidebarCollapsed;
      if (typeof window !== "undefined") {
        localStorage.setItem("entusis_sidebar_collapsed", String(next));
      }
      set({ sidebarCollapsed: next });
    },

    setSidebarCollapsed(collapsed) {
      if (typeof window !== "undefined") {
        localStorage.setItem("entusis_sidebar_collapsed", String(collapsed));
      }
      set({ sidebarCollapsed: collapsed });
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
      } else if (c.table === "shares") {
        if (c.kind === "delete" && c.id) {
          set((s) => {
            const shares = { ...s.shares };
            delete shares[c.id!];
            return { shares };
          });
        } else if (c.record) {
          const sh = c.record as ItemShare;
          set((s) => ({ shares: { ...s.shares, [sh.id]: sh } }));
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
                  is_archived: typeof r.is_archived === "boolean" ? r.is_archived : existing?.is_archived ?? false,
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
