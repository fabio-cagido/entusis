"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronRight,
  Cloud,
  Copy,
  ExternalLink,
  FileText,
  HardDrive,
  KanbanSquare,
  Link2,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Star,
  Sun,
  Sunrise,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { childrenOf, useStore, viewHref } from "@/lib/store";
import type { ItemNode, Project } from "@/lib/types";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import ShareMindMapModal from "./ShareMindMapModal";

const DRAG_MIME = "application/x-nodes-flows-id";

interface ActionMenuTarget {
  id: string;
  type: "project" | "page";
  title: string;
  rect: DOMRect;
}

interface NotionActionMenuProps {
  target: ActionMenuTarget;
  isFavorite: boolean;
  onClose: () => void;
  onRename: () => void;
  onShowToast: (msg: string) => void;
}

function NotionActionMenu({
  target,
  isFavorite,
  onClose,
  onRename,
  onShowToast,
}: NotionActionMenuProps) {
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const duplicateProject = useStore((s) => s.duplicateProject);
  const duplicateItem = useStore((s) => s.duplicateItem);
  const deleteProject = useStore((s) => s.deleteProject);
  const deleteItem = useStore((s) => s.deleteItem);
  const projects = useStore((s) => s.projects);
  const createItem = useStore((s) => s.createItem);
  const updateProject = useStore((s) => s.updateProject);
  const openShareModal = useStore((s) => s.openShareModal);
  const items = useStore((s) => s.items);

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const menuRef = useRef<HTMLDivElement>(null);

  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    const menuWidth = 220;
    const menuHeight = 250;
    let left = target.rect.right + 6;
    let top = target.rect.top;

    if (left + menuWidth > window.innerWidth) {
      left = Math.max(8, target.rect.left - menuWidth - 6);
    }
    if (top + menuHeight > window.innerHeight) {
      top = Math.max(8, window.innerHeight - menuHeight - 12);
    }
    setCoords({ top, left });
  }, [target]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleToggleFav = () => {
    toggleFavorite(target.id);
    onShowToast(isFavorite ? "Removido dos favoritos" : "Adicionado aos favoritos");
    onClose();
  };

  const handleCopyLink = () => {
    const item = items[target.id];
    const url =
      target.type === "project"
        ? `${window.location.origin}/board?project=${target.id}`
        : `${window.location.origin}${item ? viewHref(item) : `/page/${target.id}`}`;
    navigator.clipboard.writeText(url);
    onShowToast("Link copiado para a área de transferência!");
    onClose();
  };

  const handleDuplicate = () => {
    if (target.type === "project") {
      const clone = duplicateProject(target.id);
      if (clone) onShowToast(`Projeto duplicado: ${clone.name}`);
    } else {
      const clone = duplicateItem(target.id);
      if (clone) onShowToast(`Página duplicada: ${clone.title || "Sem título"}`);
    }
    onClose();
  };

  const handleRename = () => {
    onClose();
    onRename();
  };

  const handleMoveToTrash = () => {
    if (target.type === "project") {
      deleteProject(target.id);
      onShowToast("Projeto movido para a lixeira");
      if (pathname === "/board" && params.get("project") === target.id) {
        router.push("/today");
      }
    } else {
      deleteItem(target.id);
      onShowToast("Página movida para a lixeira");
      if (pathname === `/page/${target.id}` || pathname === `/canvas/${target.id}`) {
        router.push("/today");
      }
    }
    onClose();
  };

  const handleOpenNewTab = () => {
    const item = items[target.id];
    const url =
      target.type === "project"
        ? `/board?project=${target.id}`
        : item
        ? viewHref(item)
        : `/page/${target.id}`;
    window.open(url, "_blank");
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="notion-action-menu"
      style={{ top: coords.top, left: coords.left }}
    >
      <div className="notion-menu-header">
        {target.type === "project" ? "Database" : "Page"}
      </div>

      <button className="notion-menu-item" onClick={handleToggleFav}>
        <span className="notion-menu-icon">
          <Star
            size={14}
            style={{
              fill: isFavorite ? "#facc15" : "none",
              color: isFavorite ? "#facc15" : "inherit",
            }}
          />
        </span>
        <span>{isFavorite ? "Remove from Favorites" : "Add to Favorites"}</span>
      </button>

      <button className="notion-menu-item" onClick={handleCopyLink}>
        <span className="notion-menu-icon">
          <Link2 size={14} />
        </span>
        <span>Copy link</span>
      </button>

      {target.type === "page" && (
        <button
          className="notion-menu-item"
          onClick={() => {
            onClose();
            openShareModal(target.id);
          }}
        >
          <span className="notion-menu-icon">
            <UserPlus size={14} />
          </span>
          <span>Compartilhar</span>
        </button>
      )}

      <button className="notion-menu-item" onClick={handleDuplicate}>
        <span className="notion-menu-icon">
          <Copy size={14} />
        </span>
        <span>Duplicate</span>
      </button>

      {target.type === "project" && (
        <button
          className="notion-menu-item"
          onClick={() => {
            const pr = projects[target.id];
            if (!pr) return;
            const existingPage =
              Object.values(items).find((i) => i.project_id === pr.id && i.type === "PAGE" && !i.parent_id) ||
              (pr.page_id ? items[pr.page_id] : null);

            if (existingPage) {
              onClose();
              router.push(`/board?project=${pr.id}&tab=page`);
            } else {
              const page = createItem({
                title: pr.name,
                type: "PAGE",
                icon: pr.icon || "📁",
                project_id: pr.id,
                parent_id: null,
                content: `<h2>${pr.name} — Visão Geral</h2><p>Página central do projeto. Use este espaço para anotações, objetivos estratégicos e anexos.</p>`,
              });
              updateProject(pr.id, { page_id: page.id });
              onShowToast("Página vinculada criada com sucesso!");
              onClose();
              router.push(`/board?project=${pr.id}&tab=page`);
            }
          }}
        >
          <span className="notion-menu-icon">
            <FileText size={14} />
          </span>
          <span>
            {Object.values(items).some((i) => i.project_id === target.id && i.type === "PAGE" && !i.parent_id) ||
            projects[target.id]?.page_id
              ? "Abrir Página do Projeto"
              : "Criar Página Vinculada"}
          </span>
        </button>
      )}

      <button className="notion-menu-item" onClick={handleRename}>
        <span className="notion-menu-icon">
          <PenLine size={14} />
        </span>
        <span>Rename</span>
      </button>

      {target.type === "project" && (
        <button
          className="notion-menu-item"
          onClick={() => {
            const pr = projects[target.id];
            if (!pr) return;
            const nextArchived = !pr.is_archived;
            updateProject(pr.id, { is_archived: nextArchived });
            onShowToast(
              nextArchived
                ? `Projeto "${pr.name}" arquivado`
                : `Projeto "${pr.name}" desarquivado`
            );
            onClose();
          }}
        >
          <span className="notion-menu-icon">
            {projects[target.id]?.is_archived ? (
              <ArchiveRestore size={14} />
            ) : (
              <Archive size={14} />
            )}
          </span>
          <span>
            {projects[target.id]?.is_archived ? "Desarquivar Projeto" : "Arquivar Projeto"}
          </span>
        </button>
      )}

      <div className="notion-menu-divider" />

      <button className="notion-menu-item is-danger" onClick={handleMoveToTrash}>
        <span className="notion-menu-icon">
          <Trash2 size={14} />
        </span>
        <span>Move to Trash</span>
      </button>

      <div className="notion-menu-divider" />

      <button className="notion-menu-item" onClick={handleOpenNewTab}>
        <span className="notion-menu-icon">
          <ExternalLink size={14} />
        </span>
        <span>Open in new tab</span>
      </button>
    </div>
  );
}

function TreeRow({
  item,
  depth,
  editingId,
  setEditingId,
  onOpenMenu,
  menuTargetId,
}: {
  item: ItemNode;
  depth: number;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onOpenMenu: (target: ActionMenuTarget) => void;
  menuTargetId: string | null;
}) {
  const items = useStore((s) => s.items);
  const createItem = useStore((s) => s.createItem);
  const moveItem = useStore((s) => s.moveItem);
  const updateItem = useStore((s) => s.updateItem);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(depth === 0);
  const [over, setOver] = useState(false);

  const kids = useMemo(() => childrenOf(items, item.id).filter((c) => c.type === "PAGE"), [items, item.id]);
  const shares = useStore((s) => s.shares);
  const currentUserId = useStore((s) => s.currentUserId);
  const isSharedWithMe = Boolean(item.user_id && currentUserId && item.user_id !== currentUserId);
  const hasShares = useMemo(
    () => Object.values(shares).some((s) => s.item_id === item.id),
    [shares, item.id]
  );
  const href = viewHref(item);
  const active = pathname === `/page/${item.id}` || pathname === `/canvas/${item.id}`;
  const isEditing = editingId === item.id;

  return (
    <li>
      <div
        className={`tree-row ${active ? "is-active" : ""} ${over ? "is-drop" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, item.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const id = e.dataTransfer.getData(DRAG_MIME);
          if (id && id !== item.id) {
            moveItem(id, item.id);
            setOpen(true);
          }
        }}
      >
        <button
          className={`tree-chevron ${open ? "is-open" : ""} ${kids.length ? "" : "is-empty"}`}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Recolher" : "Expandir"}
        >
          <ChevronRight size={14} />
        </button>

        {isEditing ? (
          <input
            autoFocus
            className="input input-sm"
            defaultValue={item.title}
            onBlur={(e) => {
              updateItem(item.id, { title: e.target.value.trim() || "Sem título" });
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingId(null);
            }}
          />
        ) : (
          <Link
            href={href}
            className="tree-link"
            id={`tree-${item.id}`}
            onDoubleClick={(e) => {
              e.preventDefault();
              setEditingId(item.id);
            }}
          >
            <span className="tree-icon">{item.icon ?? (item.default_view === "CANVAS" ? "🧠" : "📄")}</span>
            <span className="tree-title">{item.title || "Sem título"}</span>
            {(isSharedWithMe || hasShares) && (
              <span
                className="shared-badge"
                title={isSharedWithMe ? "Compartilhado com você" : "Compartilhado"}
              >
                Compartilhado
              </span>
            )}
          </Link>
        )}

        <div className="tree-actions">
          <button
            className="tree-add"
            title="Nova subpágina"
            onClick={() => {
              const n = createItem({ parent_id: item.id, title: "", project_id: item.project_id });
              setOpen(true);
              router.push(`/page/${n.id}`);
            }}
          >
            <Plus size={14} />
          </button>
          <button
            className={`tree-more-btn ${menuTargetId === item.id ? "is-active" : ""}`}
            title="Mais opções"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onOpenMenu({
                id: item.id,
                type: "page",
                title: item.title || "Sem título",
                rect,
              });
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      {open && kids.length > 0 && (
        <ul className="tree">
          {kids.map((k) => (
            <TreeRow
              key={k.id}
              item={k}
              depth={depth + 1}
              editingId={editingId}
              setEditingId={setEditingId}
              onOpenMenu={onOpenMenu}
              menuTargetId={menuTargetId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ProjectList({
  editingId,
  setEditingId,
  onOpenMenu,
  menuTargetId,
}: {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onOpenMenu: (target: ActionMenuTarget) => void;
  menuTargetId: string | null;
}) {
  const projects = useStore((s) => s.projects);
  const items = useStore((s) => s.items);
  const createProject = useStore((s) => s.createProject);
  const updateProject = useStore((s) => s.updateProject);
  const params = useSearchParams();
  const pathname = usePathname();
  const [archivedOpen, setArchivedOpen] = useState(false);

  const list = useMemo(() => Object.values(projects).sort((a, b) => a.sort_order - b.sort_order), [projects]);
  const activeProjects = useMemo(() => list.filter((p) => !p.is_archived), [list]);
  const archivedProjects = useMemo(() => list.filter((p) => p.is_archived), [list]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of Object.values(items)) {
      if (it.project_id && it.status && it.status !== "DONE") c[it.project_id] = (c[it.project_id] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const renderProjectItem = (p: Project, isArchived = false) => {
    const active = pathname === "/board" && params.get("project") === p.id;
    const isEditing = editingId === p.id;
    return (
      <li key={p.id}>
        {isEditing ? (
          <input
            autoFocus
            className="input input-sm"
            defaultValue={p.name}
            onBlur={(e) => {
              updateProject(p.id, { name: e.target.value.trim() || "Sem nome" });
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingId(null);
            }}
          />
        ) : (
          <div className={`tree-row project-row ${active ? "is-active" : ""} ${isArchived ? "is-archived" : ""}`}>
            <Link
              href={`/board?project=${p.id}`}
              className="tree-link"
              onDoubleClick={(e) => {
                e.preventDefault();
                setEditingId(p.id);
              }}
            >
              <span className="project-dot" style={{ background: p.color }} />
              <span className="tree-title">{p.name}</span>
              {counts[p.id] ? <span className="count-pill">{counts[p.id]}</span> : null}
            </Link>
            <div className="tree-actions">
              <button
                className={`tree-more-btn ${menuTargetId === p.id ? "is-active" : ""}`}
                title="Mais opções"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  onOpenMenu({
                    id: p.id,
                    type: "project",
                    title: p.name,
                    rect,
                  });
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="side-section">
      <header className="side-heading">
        <span className="side-heading-label">
          <span>Projetos</span>
          <span className="count-pill">{activeProjects.length}</span>
        </span>
        <button
          id="add-project"
          className="icon-btn"
          title="Novo projeto"
          onClick={() => setEditingId(createProject({}).id)}
        >
          <Plus size={14} />
        </button>
      </header>
      <ul className="tree">
        {activeProjects.map((p) => renderProjectItem(p, false))}
      </ul>

      <div className="side-archived-group">
        <button
          type="button"
          className={`side-archived-toggle ${archivedOpen ? "is-open" : ""}`}
          onClick={() => setArchivedOpen((o) => !o)}
          aria-expanded={archivedOpen}
        >
          <ChevronRight size={13} className={`tree-chevron ${archivedOpen ? "is-open" : ""}`} />
          <Archive size={13} className="side-archived-icon" />
          <span className="side-archived-label">Arquivados</span>
          {archivedProjects.length > 0 && (
            <span className="count-pill">{archivedProjects.length}</span>
          )}
        </button>

        {archivedOpen && (
          <ul className="tree side-archived-list">
            {archivedProjects.length > 0 ? (
              archivedProjects.map((p) => renderProjectItem(p, true))
            ) : (
              <li className="side-archived-empty">Nenhum projeto arquivado</li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function FavoritesList({
  onOpenMenu,
  menuTargetId,
}: {
  onOpenMenu: (target: ActionMenuTarget) => void;
  menuTargetId: string | null;
}) {
  const favorites = useStore((s) => s.favorites);
  const projects = useStore((s) => s.projects);
  const items = useStore((s) => s.items);
  const pathname = usePathname();
  const params = useSearchParams();

  const favoriteEntries = useMemo(() => {
    return favorites
      .map((id) => {
        if (projects[id]) {
          const p = projects[id];
          return {
            id,
            type: "project" as const,
            title: p.name,
            color: p.color,
            icon: null,
            href: `/board?project=${id}`,
            active: pathname === "/board" && params.get("project") === id,
          };
        }
        if (items[id]) {
          const it = items[id];
          return {
            id,
            type: "page" as const,
            title: it.title || "Sem título",
            color: null,
            icon: it.icon ?? (it.default_view === "CANVAS" ? "🧠" : "📄"),
            href: viewHref(it),
            active: pathname === `/page/${id}` || pathname === `/canvas/${id}`,
          };
        }
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [favorites, projects, items, pathname, params]);

  if (favoriteEntries.length === 0) return null;

  return (
    <section className="side-section">
      <header className="side-heading">
        <span>Favoritos</span>
      </header>
      <ul className="tree">
        {favoriteEntries.map((f) => (
          <li key={f.id}>
            <div className={`tree-row project-row ${f.active ? "is-active" : ""}`}>
              <Link href={f.href} className="tree-link">
                {f.type === "project" ? (
                  <span className="project-dot" style={{ background: f.color || "#8b7bff" }} />
                ) : (
                  <span className="tree-icon">{f.icon}</span>
                )}
                <span className="tree-title">{f.title}</span>
              </Link>
              <div className="tree-actions">
                <button
                  className={`tree-more-btn ${menuTargetId === f.id ? "is-active" : ""}`}
                  title="Mais opções"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    onOpenMenu({
                      id: f.id,
                      type: f.type,
                      title: f.title,
                      rect,
                    });
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuickSearch() {
  const items = useStore((s) => s.items);
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return Object.values(items)
      .filter((i) => i.title.toLowerCase().includes(t))
      .slice(0, 8);
  }, [q, items]);

  return (
    <div className="side-search">
      <Search size={14} className="side-search-icon" />
      <input
        id="sidebar-search"
        className="input input-sm"
        placeholder="Buscar nós…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="search-results glass">
          {results.map((r) => (
            <li key={r.id}>
              <Link href={viewHref(r)} onClick={() => setQ("")}>
                <span>
                  {r.icon ??
                    (r.type === "TASK"
                      ? "☑️"
                      : r.type === "EVENT"
                      ? "📅"
                      : r.type === "MINDMAP_NODE"
                      ? "🔹"
                      : "📄")}
                </span>
                {r.title || "Sem título"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const opts = [
    { v: "light" as const, icon: <Sun size={14} />, label: "Claro" },
    { v: "system" as const, icon: <Monitor size={14} />, label: "Sistema" },
    { v: "dark" as const, icon: <Moon size={14} />, label: "Escuro" },
  ];
  return (
    <div className="segmented segmented-sm" role="radiogroup" aria-label="Tema">
      {opts.map((o) => (
        <button
          key={o.v}
          id={`theme-${o.v}`}
          className={theme === o.v ? "is-active" : ""}
          onClick={() => setTheme(o.v)}
          title={o.label}
          aria-checked={theme === o.v}
          role="radio"
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export default function Sidebar() {
  const items = useStore((s) => s.items);
  const favorites = useStore((s) => s.favorites);
  const repo = useStore((s) => s.repo);
  const sync = useStore((s) => s.sync);
  const syncError = useStore((s) => s.syncError);
  const flushNow = useStore((s) => s.flushNow);
  const clearSyncError = useStore((s) => s.clearSyncError);
  const createItem = useStore((s) => s.createItem);
  const moveItem = useStore((s) => s.moveItem);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const pathname = usePathname();
  const router = useRouter();

  const [rootOver, setRootOver] = useState(false);
  const [menuTarget, setMenuTarget] = useState<ActionMenuTarget | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [hoverPeek, setHoverPeek] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.sidebar = sidebarCollapsed ? "collapsed" : "open";
    if (!sidebarCollapsed) {
      setHoverPeek(false);
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const projects = useStore((s) => s.projects);
  const currentUserId = useStore((s) => s.currentUserId);

  const roots = useMemo(
    () => childrenOf(items, null).filter((i) => i.type === "PAGE"),
    [items]
  );

  const sharedWithMeRoots = useMemo(
    () =>
      roots.filter((r) => Boolean(r.user_id && currentUserId && r.user_id !== currentUserId)),
    [roots, currentUserId]
  );

  const mindMapsCount = useMemo(
    () =>
      Object.values(items).filter(
        (i) => i.type === "PAGE" && i.default_view === "CANVAS" && i.parent_id === null
      ).length,
    [items]
  );

  const nav = [
    { href: "/today", label: "Hoje", icon: <Sunrise size={16} />, id: "nav-today" },
    { href: "/board", label: "Kanban", icon: <KanbanSquare size={16} />, id: "nav-board" },
    {
      href: "/canvas",
      label: "Mapas mentais",
      icon: <Network size={16} />,
      id: "nav-canvas",
      count: mindMapsCount,
    },
    { href: "/calendar", label: "Agenda", icon: <CalendarDays size={16} />, id: "nav-calendar" },
  ];

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  return (
    <>
      {sidebarCollapsed && (
        <>
          <button
            type="button"
            id="sidebar-open-btn"
            className="sidebar-open-trigger glass"
            title="Expandir barra lateral (Ctrl+\)"
            aria-label="Expandir barra lateral"
            onClick={() => {
              setHoverPeek(false);
              setSidebarCollapsed(false);
            }}
          >
            <PanelLeftOpen size={16} />
          </button>
          <div
            className="sidebar-edge-hover-zone"
            onMouseEnter={() => setHoverPeek(true)}
            aria-hidden="true"
          />
        </>
      )}

      <div
        className={`sidebar-shell ${sidebarCollapsed ? "is-collapsed" : ""} ${
          sidebarCollapsed && hoverPeek ? "is-hover-peek" : ""
        }`}
        onMouseLeave={() => {
          if (sidebarCollapsed && hoverPeek && !menuTarget) {
            setHoverPeek(false);
          }
        }}
      >
        <aside className="sidebar" aria-hidden={sidebarCollapsed && !hoverPeek}>
          <div className="brand-row">
            <Link href="/today" className="brand">
              <span className="brand-mark" />
              <span className="brand-name">êntusis</span>
            </Link>
            <button
              type="button"
              id="sidebar-collapse-btn"
              className="icon-btn sidebar-toggle-btn"
              title={
                sidebarCollapsed
                  ? "Fixar barra lateral aberta (Ctrl+\\)"
                  : "Recolher barra lateral (Ctrl+\\)"
              }
              aria-label={
                sidebarCollapsed ? "Fixar barra lateral aberta" : "Recolher barra lateral"
              }
              onClick={() => {
                setHoverPeek(false);
                toggleSidebar();
              }}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

      <QuickSearch />

      <nav className="side-nav">
        {nav.map((n) => (
          <Link
            key={n.href}
            id={n.id}
            href={n.href}
            className={`side-nav-item ${pathname === n.href ? "is-active" : ""}`}
          >
            {n.icon}
            <span className="side-nav-label">{n.label}</span>
            {typeof n.count === "number" && (
              <span className="count-pill">{n.count}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="side-scroll">
        <Suspense fallback={null}>
          <FavoritesList
            onOpenMenu={setMenuTarget}
            menuTargetId={menuTarget?.id ?? null}
          />
        </Suspense>

        <Suspense fallback={null}>
          <ProjectList
            editingId={editingId}
            setEditingId={setEditingId}
            onOpenMenu={setMenuTarget}
            menuTargetId={menuTarget?.id ?? null}
          />
        </Suspense>

        <section className="side-section">
          <header
            className={`side-heading ${rootOver ? "is-drop" : ""}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME)) {
                e.preventDefault();
                setRootOver(true);
              }
            }}
            onDragLeave={() => setRootOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setRootOver(false);
              const id = e.dataTransfer.getData(DRAG_MIME);
              if (id) moveItem(id, null);
            }}
          >
            <span className="side-heading-label">
              <span>Páginas</span>
              <span className="count-pill">{roots.length}</span>
            </span>
            <span className="side-heading-actions">
              <button
                id="add-mindmap"
                className="icon-btn"
                title="Novo mapa mental"
                onClick={() => {
                  const n = createItem({
                    title: "Novo mapa mental",
                    icon: "🧠",
                    default_view: "CANVAS",
                    canvas: { x: 0, y: 0, color: "#8b7bff" },
                  });
                  router.push(`/canvas/${n.id}`);
                }}
              >
                <Network size={14} />
              </button>
              <button
                id="add-page"
                className="icon-btn"
                title="Nova página"
                onClick={() => router.push(`/page/${createItem({ title: "" }).id}`)}
              >
                <Plus size={14} />
              </button>
            </span>
          </header>
          <ul className="tree">
            {roots.map((r) => (
              <TreeRow
                key={r.id}
                item={r}
                depth={0}
                editingId={editingId}
                setEditingId={setEditingId}
                onOpenMenu={setMenuTarget}
                menuTargetId={menuTarget?.id ?? null}
              />
            ))}
          </ul>
        </section>

        {sharedWithMeRoots.length > 0 && (
          <section className="side-section">
            <header className="side-heading">
              <span className="side-heading-label">
                <Users size={12} />
                <span>Compartilhados comigo</span>
                <span className="count-pill">{sharedWithMeRoots.length}</span>
              </span>
            </header>
            <ul className="tree">
              {sharedWithMeRoots.map((r) => (
                <TreeRow
                  key={`shared-${r.id}`}
                  item={r}
                  depth={0}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  onOpenMenu={setMenuTarget}
                  menuTargetId={menuTarget?.id ?? null}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="side-footer">
        <span
          className={`sync-badge sync-${sync}`}
          title={repo?.kind === "supabase" ? "Supabase" : "Armazenamento local"}
        >
          {repo?.kind === "supabase" ? <Cloud size={13} /> : <HardDrive size={13} />}
          {sync === "saving"
            ? "Salvando…"
            : sync === "error"
            ? "Erro ao salvar"
            : repo?.kind === "supabase"
            ? "Sincronizado"
            : "Local"}
        </span>
        <div className="side-footer-actions">
          <ThemeToggle />
          {isSupabaseConfigured && (
            <button
              id="btn-logout"
              className="icon-btn icon-btn-danger"
              title="Sair da conta"
              onClick={async () => {
                if (confirm("Deseja sair da sua conta?")) {
                  const sb = getSupabase();
                  if (sb) await sb.auth.signOut();
                }
              }}
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </footer>

      {/* Notion Context Action Menu */}
      {menuTarget && (
        <Suspense fallback={null}>
          <NotionActionMenu
            target={menuTarget}
            isFavorite={favorites.includes(menuTarget.id)}
            onClose={() => setMenuTarget(null)}
            onRename={() => setEditingId(menuTarget.id)}
            onShowToast={showToast}
          />
        </Suspense>
      )}
        </aside>
      </div>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="notion-toast">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Alerta Visível de Erro de Sincronização */}
      {syncError && (
        <div className="sync-error-toast" role="alert">
          <AlertTriangle size={16} className="sync-error-icon" />
          <div className="sync-error-body">
            <strong>Erro de sincronização</strong>
            <span>{syncError}</span>
          </div>
          <button
            type="button"
            className="sync-error-retry"
            onClick={() => void flushNow()}
            title="Tentar salvar novamente agora"
          >
            <RefreshCw size={13} />
            <span>Tentar novamente</span>
          </button>
          <button
            type="button"
            className="sync-error-close"
            onClick={clearSyncError}
            title="Fechar alerta"
            aria-label="Fechar alerta"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Modal de Compartilhamento por E-mail */}
      <ShareMindMapModal />
    </>
  );
}
