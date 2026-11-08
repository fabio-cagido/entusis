"use client";

import { create } from "zustand";
import type { ItemNode, ItemShare, Project, Status } from "./types";
import { WEEKDAY_LABEL } from "./types";
import type { Repository, RemoteChange } from "./repository/types";
import { LocalRepository } from "./repository/local";
import { buildSeed, newItem } from "./seed";

type Theme = "system" | "light" | "dark";
type SyncState = "idle" | "saving" | "error";
export type TodayTaskFilter = "all" | "doing";

export const TRASH_RETENTION_DAYS = 7;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const KANBAN_STATUS_NODES: {
  status: Status;
  title: string;
  icon: string;
  color: string;
  sort_order: number;
}[] = [
  { status: "BACKLOG", title: "Brainstorming", icon: "💡", color: "#94a3b8", sort_order: 0 },
  { status: "TODO", title: "A Fazer", icon: "📝", color: "#38bdf8", sort_order: 10 },
  { status: "DOING", title: "Fazendo", icon: "⚡", color: "#facc15", sort_order: 20 },
  { status: "DONE", title: "Concluído", icon: "✅", color: "#2dd4bf", sort_order: 30 },
];

export function isKanbanRootTitle(title: string | null | undefined): boolean {
  const norm = (title || "")
    .replace(/^📋\s*/, "")
    .trim()
    .toLowerCase();
  return norm === "kanban";
}

export function statusFromKanbanNodeTitle(title: string | null | undefined): Status | null {
  const norm = (title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim()
    .toLowerCase();
  if (norm === "brainstorming" || norm === "brainstorm" || norm === "backlog") return "BACKLOG";
  if (norm === "a fazer" || norm === "todo") return "TODO";
  if (norm === "fazendo" || norm === "doing" || norm === "em andamento") return "DOING";
  if (norm === "concluido" || norm === "concluidas" || norm === "done") return "DONE";
  return null;
}

export function getKanbanStatusForNode(
  items: Record<string, ItemNode>,
  nodeId: string | null | undefined
): Status | null {
  if (!nodeId || !items[nodeId]) return null;
  const node = items[nodeId];
  return statusFromKanbanNodeTitle(node.title);
}

export function isChildOfKanbanStatusNode(
  items: Record<string, ItemNode>,
  item: ItemNode | null | undefined
): boolean {
  if (!item?.parent_id) return false;
  const parent = items[item.parent_id];
  if (!parent) return false;
  const parentStatus = statusFromKanbanNodeTitle(parent.title);
  if (!parentStatus) return false;
  if (parent.parent_id && items[parent.parent_id]) {
    return isKanbanRootTitle(items[parent.parent_id].title);
  }
  return parent.status === null;
}

export function findProjectKanbanStatusNode(
  items: Record<string, ItemNode>,
  projectId: string | null | undefined,
  status: Status,
  projectRootId?: string | null
): ItemNode | null {
  if (!projectId && !projectRootId) return null;
  const all = Object.values(items);
  const kanbanRoot = all.find(
    (it) =>
      isKanbanRootTitle(it.title) &&
      ((projectRootId && it.parent_id === projectRootId) ||
        (projectId && it.project_id === projectId))
  );
  if (!kanbanRoot) return null;
  return (
    all.find(
      (it) =>
        it.parent_id === kanbanRoot.id && statusFromKanbanNodeTitle(it.title) === status
    ) ?? null
  );
}

function injectKanbanBranchIntoMap(
  itemsMap: Record<string, ItemNode>,
  pr: Project,
  rootPage: ItemNode,
  userId?: string | null
): string[] {
  const touched: string[] = [];

  if (!rootPage.canvas) {
    rootPage.canvas = { x: 0, y: 0, color: pr.color || "#8b7bff" };
    touched.push(rootPage.id);
  }

  const rootX = rootPage.canvas?.x ?? 0;
  const rootY = rootPage.canvas?.y ?? 0;

  // Coleta todos os descendentes já existentes do mapa do projeto para calcular área livre sem sobreposição
  const existingDescendants = descendantsOf(itemsMap, rootPage.id);
  const existingPlaced = existingDescendants.filter((n) => n.canvas && !isKanbanRootTitle(n.title));

  let kanbanNode = Object.values(itemsMap).find(
    (it) => it.parent_id === rootPage.id && isKanbanRootTitle(it.title)
  );

  // Calcula Y livre abaixo de todos os nós existentes (ou alinhado à raiz se não houver nós posicionados)
  let kanbanCenterY = rootY;
  if (existingPlaced.length > 0) {
    const maxBottomY = Math.max(
      rootY + 60,
      ...existingPlaced.map((n) => (n.canvas?.y ?? 0) + (n.canvas?.height ?? 60))
    );
    kanbanCenterY = maxBottomY + 180;
  }

  const kanbanX = rootX + 280;

  if (!kanbanNode) {
    kanbanNode = newItem({
      title: "📋 Kanban",
      icon: "📋",
      type: "MINDMAP_NODE",
      parent_id: rootPage.id,
      project_id: pr.id,
      status: null,
      sort_order: 900,
      ...(userId ? { user_id: userId } : {}),
      canvas: {
        x: kanbanX,
        y: kanbanCenterY,
        color: pr.color || "#8b7bff",
      },
    });
    itemsMap[kanbanNode.id] = kanbanNode;
    touched.push(kanbanNode.id);
  } else if (!kanbanNode.canvas) {
    kanbanNode.canvas = {
      x: kanbanX,
      y: kanbanCenterY,
      color: pr.color || "#8b7bff",
    };
    touched.push(kanbanNode.id);
  }

  const baseKanbanX = kanbanNode.canvas?.x ?? kanbanX;
  const baseKanbanY = kanbanNode.canvas?.y ?? kanbanCenterY;
  const statusX = baseKanbanX + 260;

  for (let idx = 0; idx < KANBAN_STATUS_NODES.length; idx++) {
    const def = KANBAN_STATUS_NODES[idx];
    const existingStatusNode = Object.values(itemsMap).find(
      (it) =>
        it.parent_id === kanbanNode!.id &&
        statusFromKanbanNodeTitle(it.title) === def.status
    );
    const statusY = Math.round(baseKanbanY + (idx - 1.5) * 86);
    if (!existingStatusNode) {
      const statusNode = newItem({
        title: def.title,
        icon: def.icon,
        type: "MINDMAP_NODE",
        parent_id: kanbanNode.id,
        project_id: pr.id,
        status: null,
        sort_order: def.sort_order,
        ...(userId ? { user_id: userId } : {}),
        canvas: {
          x: statusX,
          y: statusY,
          color: def.color,
        },
      });
      itemsMap[statusNode.id] = statusNode;
      touched.push(statusNode.id);
    } else {
      let updatedExisting = false;
      if (!existingStatusNode.canvas) {
        existingStatusNode.canvas = {
          x: statusX,
          y: statusY,
          color: def.color,
        };
        updatedExisting = true;
      }
      // Atualiza retroativamente o nó antigo "Backlog" para "Brainstorming" (💡)
      if (
        def.status === "BACKLOG" &&
        existingStatusNode.title.trim().toLowerCase().includes("backlog")
      ) {
        existingStatusNode.title = def.title;
        existingStatusNode.icon = def.icon;
        updatedExisting = true;
      }
      if (updatedExisting) {
        touched.push(existingStatusNode.id);
      }
    }
  }

  return touched;
}

interface State {
  ready: boolean;
  repo: Repository | null;
  currentUserId: string | null;
  items: Record<string, ItemNode>;
  trashedItems: Record<string, ItemNode>;
  projects: Record<string, Project>;
  shares: Record<string, ItemShare>;
  favorites: string[];
  drawerId: string | null;
  shareModalItemId: string | null;
  trashModalOpen: boolean;
  theme: Theme;
  sync: SyncState;
  syncError: string | null;
  sidebarCollapsed: boolean;
  todayTaskFilter: TodayTaskFilter;
  focusedTaskIds: string[];

  init(repo?: Repository): Promise<void>;
  ensureProjectKanbanBranch(projectId: string): void;
  checkRecurringTasks(): number;
  purgeExpiredTrash(): number;
  createItem(p: Partial<ItemNode>): ItemNode;
  addItems(newItems: ItemNode[]): Promise<void>;
  flushNow(): Promise<void>;
  clearSyncError(): void;
  updateItem(id: string, patch: Partial<ItemNode>): void;
  updateItems(patches: { id: string; patch: Partial<ItemNode> }[]): void;
  deleteItem(id: string): void;
  restoreItem(id: string): void;
  permanentlyDeleteItem(id: string): void;
  emptyTrash(): void;
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
  openTrashModal(open: boolean): void;
  upsertShareLocal(share: ItemShare): void;
  removeShareLocal(shareId: string): void;
  setTheme(t: Theme): void;
  toggleSidebar(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setTodayTaskFilter(filter: TodayTaskFilter): void;
  toggleTaskFocus(id: string): void;
  clearFocusedTasks(): void;
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
    const { repo, items, trashedItems, projects } = get();
    if (!repo) return;

    const itemIds = [...pendingItems];
    const del = [...pendingItemDeletes];
    const projIds = [...pendingProjects];
    const pDel = [...pendingProjectDeletes];

    if (itemIds.length === 0 && del.length === 0 && projIds.length === 0 && pDel.length === 0) {
      set({ sync: "idle", syncError: null });
      return;
    }

    const up = itemIds.map((id) => items[id] ?? trashedItems[id]).filter(Boolean);
    const pUp = projIds.map((id) => projects[id]).filter(Boolean);

    set({ sync: "saving" });

    try {
      // Parents must exist before children (FK) — sort by depth.
      const lookupItem = (id: string) => items[id] ?? trashedItems[id];
      const depth = (n: ItemNode) => {
        let d = 0;
        let p = n.parent_id;
        while (p && lookupItem(p) && d < 100) {
          d++;
          p = lookupItem(p)!.parent_id;
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
      console.error("[ayolia] sync failed", e);
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
    trashedItems: {},
    projects: {},
    shares: {},
    drawerId: null,
    shareModalItemId: null,
    trashModalOpen: false,
    theme: "system",
    sync: "idle",
    syncError: null,
    favorites: [],
    sidebarCollapsed: false,
    todayTaskFilter: "doing",
    focusedTaskIds: [],

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
            typeof window !== "undefined" &&
            (localStorage.getItem("ayolia_sidebar_collapsed") ?? localStorage.getItem("entusis_sidebar_collapsed")) ===
              "true";
          const rawTodayFilter =
            typeof window !== "undefined"
              ? (
                  localStorage.getItem("ayolia_today_task_filter") ??
                  localStorage.getItem("entusis_today_task_filter")
                )?.toLowerCase()
              : null;
          const todayTaskFilter: TodayTaskFilter =
            rawTodayFilter === "all" || rawTodayFilter === "doing" ? rawTodayFilter : "doing";
          let favs: string[] = [];
          try {
            const rawFavs = typeof window !== "undefined" ? localStorage.getItem("nf-favorites") : null;
            if (rawFavs) favs = JSON.parse(rawFavs);
          } catch {
            favs = [];
          }

          let focusedIds: string[] = [];
          try {
            const rawFocused = typeof window !== "undefined" ? localStorage.getItem("ayolia_focused_task_ids") : null;
            if (rawFocused) {
              const parsed = JSON.parse(rawFocused);
              if (Array.isArray(parsed)) {
                focusedIds = parsed.filter((x): x is string => typeof x === "string");
              }
            }
          } catch {
            focusedIds = [];
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

          // Separa itens ativos dos itens na lixeira (Soft Delete)
          const itemsMap: Record<string, ItemNode> = {};
          const trashedMap: Record<string, ItemNode> = {};
          for (const i of snap.items) {
            if (i.deleted_at) {
              trashedMap[i.id] = i;
            } else {
              itemsMap[i.id] = i;
            }
          }
          // Se um item ativo tiver parent_id apontando para um item na lixeira, move-o para a lixeira também
          let trashPropagated = true;
          while (trashPropagated) {
            trashPropagated = false;
            for (const it of Object.values(itemsMap)) {
              if (it.parent_id && trashedMap[it.parent_id]) {
                const parentTrashTime = trashedMap[it.parent_id].deleted_at;
                trashedMap[it.id] = { ...it, deleted_at: parentTrashTime };
                delete itemsMap[it.id];
                trashPropagated = true;
              }
            }
          }
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

              // Migração Não-Destrutiva: garante que o projeto existente possua o ramo "📋 Kanban" e os 4 sub-nós de status sem mover nem apagar nós preexistentes
              const kanbanTouched = injectKanbanBranchIntoMap(
                itemsMap,
                pr,
                canonical,
                snap.currentUserId
              );
              touchedItems.push(...kanbanTouched);
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

              const kanbanTouched = injectKanbanBranchIntoMap(
                itemsMap,
                pr,
                page,
                snap.currentUserId
              );
              touchedItems.push(...kanbanTouched);
            }
          }

          if (duplicateProjectPageIdsToDelete.length > 0) {
            console.info(
              `[ayolia] Removendo ${duplicateProjectPageIdsToDelete.length} páginas raízes de projetos duplicadas...`
            );
            try {
              await r.deleteItems(duplicateProjectPageIdsToDelete);
            } catch (cleanupErr) {
              console.error("[ayolia] Erro ao limpar páginas duplicadas:", cleanupErr);
            }
          }

          const sharesMap = Object.fromEntries((snap.shares ?? []).map((sh) => [sh.id, sh]));

          set({
            repo: r,
            currentUserId: snap.currentUserId ?? null,
            ready: true,
            theme,
            sidebarCollapsed,
            todayTaskFilter,
            focusedTaskIds: focusedIds.filter((id) => Boolean(itemsMap[id])),
            favorites: favs,
            items: itemsMap,
            trashedItems: trashedMap,
            projects: projectsMap,
            shares: sharesMap,
          });

          if (touchedItems.length > 0) touchItems(touchedItems);

          // Expurga itens da lixeira que já ultrapassaram 7 dias de retenção
          get().purgeExpiredTrash();

          // Executa verificação automática de tarefas recorrentes na hidratação inicial
          get().checkRecurringTasks();
        } finally {
          initPromise = null;
        }
      })();

      return initPromise;
    },

    ensureProjectKanbanBranch(projectId) {
      const { items, projects, currentUserId } = get();
      const pr = projects[projectId];
      if (!pr) return;
      const rootPage =
        (pr.page_id && items[pr.page_id]) ||
        Object.values(items).find(
          (i) => i.project_id === projectId && i.type === "PAGE" && !i.parent_id
        );
      if (!rootPage) return;
      const nextItems = { ...items };
      const touched = injectKanbanBranchIntoMap(nextItems, pr, { ...rootPage }, currentUserId);
      if (touched.length > 0) {
        set({ items: nextItems });
        touchItems(touched);
      }
    },

    checkRecurringTasks() {
      const { items, projects } = get();
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const dayOfMonth = now.getDate();
      const dayOfWeek = now.getDay();
      const todayKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
      const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
      const nowIso = now.toISOString();

      const patches: { id: string; patch: Partial<ItemNode> }[] = [];

      for (const it of Object.values(items)) {
        if (!it.is_recurring || !it.recurrence_type) continue;
        // Ignorar tarefas cujo projeto esteja arquivado
        if (it.project_id && projects[it.project_id]?.is_archived) continue;

        let matchesToday = false;
        if (it.recurrence_type === "monthly" && typeof it.recurrence_day_of_month === "number") {
          const targetDay = Math.min(Math.max(1, it.recurrence_day_of_month), daysInCurrentMonth);
          matchesToday = dayOfMonth === targetDay;
        } else if (it.recurrence_type === "weekly" && typeof it.recurrence_day_of_week === "number") {
          matchesToday = dayOfWeek === it.recurrence_day_of_week;
        }

        if (!matchesToday) continue;

        // Verifica se last_recurred_at já corresponde à data local de hoje (YYYY-MM-DD)
        if (it.last_recurred_at) {
          const lastDate = new Date(it.last_recurred_at);
          if (!Number.isNaN(lastDate.getTime())) {
            const lastKey = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, "0")}-${String(lastDate.getDate()).padStart(2, "0")}`;
            if (lastKey === todayKey) continue;
          } else if (it.last_recurred_at.slice(0, 10) === todayKey) {
            continue;
          }
        }

        if (it.status !== "DOING") {
          patches.push({
            id: it.id,
            patch: {
              status: "DOING",
              is_today: true,
              last_recurred_at: nowIso,
            },
          });
        } else {
          // Mesmo já estando em DOING, registra last_recurred_at hoje para evitar re-disparo se for concluída mais tarde no mesmo dia
          patches.push({
            id: it.id,
            patch: {
              last_recurred_at: nowIso,
            },
          });
        }
      }

      if (patches.length > 0) {
        get().updateItems(patches);
      }
      return patches.length;
    },

    createItem(p) {
      const state = get();
      let resolvedParentId = p.parent_id ?? null;
      let resolvedStatus = p.status ?? null;
      let resolvedProjectId = p.project_id ?? null;
      let resolvedCanvas = p.canvas ?? null;

      // Se o pai for um dos nós de status do Kanban (ex: criado direto no mapa mental em "A Fazer"), herda o status automaticamente
      if (resolvedParentId && state.items[resolvedParentId]) {
        const parentNode = state.items[resolvedParentId];
        const statusFromParent = getKanbanStatusForNode(state.items, resolvedParentId);
        if (statusFromParent && !resolvedStatus) {
          resolvedStatus = statusFromParent;
        }
        if (!resolvedProjectId && parentNode.project_id) {
          resolvedProjectId = parentNode.project_id;
        }
      }

      // Se foi criada pelo Kanban com um status e um projeto (e sem pai específico de outro ramo), vincula como filha do nó de status correspondente em "📋 Kanban"
      if (resolvedStatus && resolvedProjectId) {
        const proj = state.projects[resolvedProjectId];
        const projRootId =
          proj?.page_id ??
          Object.values(state.items).find(
            (i) => i.project_id === resolvedProjectId && i.type === "PAGE" && !i.parent_id
          )?.id ??
          null;

        if (!resolvedParentId || resolvedParentId === projRootId) {
          let statusNode = findProjectKanbanStatusNode(
            state.items,
            resolvedProjectId,
            resolvedStatus,
            projRootId
          );
          if (!statusNode) {
            get().ensureProjectKanbanBranch(resolvedProjectId);
            statusNode = findProjectKanbanStatusNode(
              get().items,
              resolvedProjectId,
              resolvedStatus,
              projRootId
            );
          }
          if (statusNode) {
            resolvedParentId = statusNode.id;
            if (!resolvedCanvas && statusNode.canvas) {
              const statusChildren = Object.values(state.items).filter(
                (i) => i.parent_id === statusNode.id && i.canvas
              );
              const baseX = (statusNode.canvas.x ?? 540) + 260;
              const baseY =
                statusChildren.length > 0
                  ? Math.max(...statusChildren.map((c) => c.canvas?.y ?? 0)) + 68
                  : statusNode.canvas.y ?? 0;
              resolvedCanvas = {
                x: baseX,
                y: baseY,
                color: statusNode.canvas.color ?? proj?.color ?? "#38bdf8",
              };
            }
          }
        }
      }

      const siblings = Object.values(state.items).filter((i) => i.parent_id === resolvedParentId);
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const inheritedUserId =
        (resolvedParentId && state.items[resolvedParentId]?.user_id) ||
        state.currentUserId ||
        undefined;
      const it = newItem({
        sort_order: maxOrder + 1,
        ...(inheritedUserId ? { user_id: inheritedUserId } : {}),
        ...p,
        parent_id: resolvedParentId,
        status: resolvedStatus,
        project_id: resolvedProjectId,
        canvas: resolvedCanvas,
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
          const cur = items[id];
          if (!cur) continue;
          const nextPatch: Partial<ItemNode> = { ...patch };

          // Sincronização Bidirecional Kanban -> Mapa Mental:
          // Se a tarefa é filha de um dos nós de status do Kanban ("Backlog", "A Fazer", "Fazendo", "Concluído")
          // e seu status foi alterado no quadro Kanban (e parent_id não foi explicitamente passado no patch),
          // move o parent_id automaticamente para o nó do novo status correspondente.
          // Se pertencer a outro ramo do mapa (ideia/processo), mantém seu pai e posição intactos.
          if (
            nextPatch.status !== undefined &&
            nextPatch.status !== null &&
            nextPatch.status !== cur.status &&
            nextPatch.parent_id === undefined &&
            isChildOfKanbanStatusNode(items, cur)
          ) {
            const currentStatusParent = cur.parent_id ? items[cur.parent_id] : null;
            const kanbanBranchId = currentStatusParent?.parent_id ?? null;
            const targetProjectId =
              nextPatch.project_id !== undefined ? nextPatch.project_id : cur.project_id;

            let targetStatusNode: ItemNode | null = null;
            // Se continuou no mesmo projeto e mesmo ramo Kanban, busca o irmão correspondente ao novo status
            if (
              kanbanBranchId &&
              (nextPatch.project_id === undefined || nextPatch.project_id === cur.project_id)
            ) {
              targetStatusNode =
                Object.values(items).find(
                  (it) =>
                    it.parent_id === kanbanBranchId &&
                    statusFromKanbanNodeTitle(it.title) === nextPatch.status
                ) ?? null;
            }
            // Fallback ou mudança de raia de projeto: busca pelo projeto de destino
            if (!targetStatusNode && targetProjectId) {
              const targetProj = s.projects[targetProjectId];
              targetStatusNode = findProjectKanbanStatusNode(
                items,
                targetProjectId,
                nextPatch.status,
                targetProj?.page_id
              );
            }

            if (targetStatusNode && targetStatusNode.id !== cur.parent_id) {
              const targetSiblings = Object.values(items).filter(
                (i) => i.parent_id === targetStatusNode!.id && i.id !== id
              );
              const maxOrder = targetSiblings.reduce((m, sib) => Math.max(m, sib.sort_order), -10);
              nextPatch.parent_id = targetStatusNode.id;
              nextPatch.sort_order = maxOrder + 10;

              if (targetStatusNode.canvas) {
                const placedSiblings = targetSiblings.filter((sib) => sib.canvas);
                const nextX = (targetStatusNode.canvas.x ?? 540) + 260;
                const nextY =
                  placedSiblings.length > 0
                    ? Math.max(...placedSiblings.map((sib) => sib.canvas?.y ?? 0)) + 68
                    : targetStatusNode.canvas.y ?? 0;
                nextPatch.canvas = {
                  ...(cur.canvas ?? {}),
                  x: nextX,
                  y: nextY,
                  color: targetStatusNode.canvas.color ?? cur.canvas?.color ?? null,
                };
              }
            }
          }

          items[id] = { ...cur, ...nextPatch, updated_at: t };
          if (nextPatch.title) {
            const it = items[id];
            const proj = Object.values(projects).find(
              (p) => p.page_id === id || (it && it.project_id === p.id && it.type === "PAGE" && !it.parent_id)
            );
            if (proj && proj.name !== nextPatch.title) {
              projectUpdates.push({ id: proj.id, name: nextPatch.title });
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
      const { items, trashedItems } = get();
      if (!items[id]) return;
      const nowIso = new Date().toISOString();
      const toTrash = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of Object.values(items)) {
          if (it.parent_id && toTrash.has(it.parent_id) && !toTrash.has(it.id)) {
            toTrash.add(it.id);
            grew = true;
          }
        }
      }
      const nextItems = { ...items };
      const nextTrashed = { ...trashedItems };
      toTrash.forEach((d) => {
        const target = nextItems[d];
        if (target) {
          nextTrashed[d] = {
            ...target,
            deleted_at: nowIso,
            updated_at: nowIso,
            canvas: target.canvas
              ? { ...target.canvas, deleted_at: nowIso }
              : { x: 0, y: 0, deleted_at: nowIso },
          };
          delete nextItems[d];
        }
      });

      set((s) => ({
        items: nextItems,
        trashedItems: nextTrashed,
        drawerId: s.drawerId && toTrash.has(s.drawerId) ? null : s.drawerId,
      }));
      touchItems([...toTrash]);
    },

    restoreItem(id) {
      const { items, trashedItems } = get();
      const rootTarget = trashedItems[id];
      if (!rootTarget) return;
      const nowIso = new Date().toISOString();

      const toRestore = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of Object.values(trashedItems)) {
          if (it.parent_id && toRestore.has(it.parent_id) && !toRestore.has(it.id)) {
            toRestore.add(it.id);
            grew = true;
          }
        }
      }

      const nextItems = { ...items };
      const nextTrashed = { ...trashedItems };

      toRestore.forEach((rId) => {
        const target = nextTrashed[rId];
        if (!target) return;
        // Se o pai deste nó raiz restaurado ainda estiver na lixeira ou não existir mais, restaura na raiz (parent_id = null)
        const parentStillMissing =
          rId === id && target.parent_id && !nextItems[target.parent_id] && !toRestore.has(target.parent_id);
        let cleanedCanvas = target.canvas ? { ...target.canvas } : null;
        if (cleanedCanvas && "deleted_at" in cleanedCanvas) {
          delete cleanedCanvas.deleted_at;
        }
        nextItems[rId] = {
          ...target,
          parent_id: parentStillMissing ? null : target.parent_id,
          deleted_at: null,
          updated_at: nowIso,
          canvas: cleanedCanvas,
        };
        delete nextTrashed[rId];
      });

      set({ items: nextItems, trashedItems: nextTrashed });
      touchItems([...toRestore]);
    },

    permanentlyDeleteItem(id) {
      const { items, trashedItems } = get();
      const allKnown = { ...items, ...trashedItems };
      if (!allKnown[id]) return;

      const toDelete = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of Object.values(allKnown)) {
          if (it.parent_id && toDelete.has(it.parent_id) && !toDelete.has(it.id)) {
            toDelete.add(it.id);
            grew = true;
          }
        }
      }

      const nextItems = { ...items };
      const nextTrashed = { ...trashedItems };
      const relinked: string[] = [];

      toDelete.forEach((d) => {
        delete nextItems[d];
        delete nextTrashed[d];
      });

      for (const it of Object.values(nextItems)) {
        if (it.links.some((l) => toDelete.has(l))) {
          nextItems[it.id] = { ...it, links: it.links.filter((l) => !toDelete.has(l)) };
          relinked.push(it.id);
        }
      }

      set((s) => ({
        items: nextItems,
        trashedItems: nextTrashed,
        drawerId: s.drawerId && toDelete.has(s.drawerId) ? null : s.drawerId,
      }));

      toDelete.forEach((d) => {
        pendingItems.delete(d);
        pendingItemDeletes.add(d);
      });
      if (relinked.length > 0) touchItems(relinked);
      else schedule();
    },

    emptyTrash() {
      const { trashedItems } = get();
      const ids = Object.keys(trashedItems);
      if (ids.length === 0) return;
      for (const id of ids) {
        pendingItems.delete(id);
        pendingItemDeletes.add(id);
      }
      set({ trashedItems: {} });
      schedule();
    },

    purgeExpiredTrash() {
      const { trashedItems } = get();
      const nowMs = Date.now();
      const expiredIds: string[] = [];

      for (const it of Object.values(trashedItems)) {
        if (!it.deleted_at) continue;
        const deletedMs = new Date(it.deleted_at).getTime();
        if (!Number.isNaN(deletedMs) && nowMs - deletedMs > TRASH_RETENTION_MS) {
          expiredIds.push(it.id);
        }
      }

      if (expiredIds.length === 0) return 0;

      const nextTrashed = { ...trashedItems };
      for (const id of expiredIds) {
        delete nextTrashed[id];
        pendingItems.delete(id);
        pendingItemDeletes.add(id);
      }
      set({ trashedItems: nextTrashed });
      schedule();
      return expiredIds.length;
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
      const matchedStatus = getKanbanStatusForNode(items, parentId);
      const targetParent = parentId ? items[parentId] : null;
      get().updateItem(id, {
        parent_id: parentId,
        sort_order: maxOrder + 1,
        ...(matchedStatus ? { status: matchedStatus } : {}),
        ...(matchedStatus && targetParent?.project_id ? { project_id: targetParent.project_id } : {}),
      });
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
      // Cria automaticamente o ramo "📋 Kanban" e os 4 sub-nós de status para o novo projeto
      get().ensureProjectKanbanBranch(pr.id);
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

    openTrashModal(open) {
      if (open) {
        get().purgeExpiredTrash();
      }
      set({ trashModalOpen: open });
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
        localStorage.setItem("ayolia_sidebar_collapsed", String(next));
        localStorage.setItem("entusis_sidebar_collapsed", String(next));
      }
      set({ sidebarCollapsed: next });
    },

    setSidebarCollapsed(collapsed) {
      if (typeof window !== "undefined") {
        localStorage.setItem("ayolia_sidebar_collapsed", String(collapsed));
        localStorage.setItem("entusis_sidebar_collapsed", String(collapsed));
      }
      set({ sidebarCollapsed: collapsed });
    },

    setTodayTaskFilter(filter) {
      const normalized: TodayTaskFilter = filter === "all" ? "all" : "doing";
      if (typeof window !== "undefined") {
        localStorage.setItem("ayolia_today_task_filter", normalized);
        localStorage.setItem("entusis_today_task_filter", normalized);
      }
      set({ todayTaskFilter: normalized });
    },

    toggleTaskFocus(id) {
      const cur = get().focusedTaskIds;
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("ayolia_focused_task_ids", JSON.stringify(next));
        } catch {
          // ignore storage errors
        }
      }
      set({ focusedTaskIds: next });
    },

    clearFocusedTasks() {
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("ayolia_focused_task_ids");
        } catch {
          // ignore storage errors
        }
      }
      set({ focusedTaskIds: [] });
    },

    applyRemote(c) {
      // Ignore echoes of records we are about to write ourselves.
      if (c.table === "items") {
        if (c.kind === "delete" && c.id) {
          set((s) => {
            const items = { ...s.items };
            const trashedItems = { ...s.trashedItems };
            delete items[c.id!];
            delete trashedItems[c.id!];
            return { items, trashedItems };
          });
        } else if (c.record && !pendingItems.has(c.record.id)) {
          const r = c.record as ItemNode;
          const cur = get().items[r.id] ?? get().trashedItems[r.id];
          if (!cur || cur.updated_at < r.updated_at) {
            set((s) => {
              const items = { ...s.items };
              const trashedItems = { ...s.trashedItems };
              if (r.deleted_at) {
                delete items[r.id];
                trashedItems[r.id] = r;
              } else {
                delete trashedItems[r.id];
                items[r.id] = r;
              }
              return { items, trashedItems };
            });
          }
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

export function formatRecurrenceSummary(
  it: Pick<ItemNode, "is_recurring" | "recurrence_type" | "recurrence_day_of_month" | "recurrence_day_of_week">,
): string | null {
  if (!it.is_recurring) return null;
  if (it.recurrence_type === "monthly") {
    const day = it.recurrence_day_of_month ?? 1;
    return `Tarefa recorrente: Mensal (todo dia ${day})`;
  }
  if (it.recurrence_type === "weekly") {
    const dow = typeof it.recurrence_day_of_week === "number" ? it.recurrence_day_of_week : 1;
    return `Tarefa recorrente: Semanal (${WEEKDAY_LABEL[dow] ?? "Segunda-feira"})`;
  }
  return "Tarefa recorrente";
}
