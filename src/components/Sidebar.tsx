"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  Cloud,
  HardDrive,
  KanbanSquare,
  Moon,
  Monitor,
  Network,
  Plus,
  Search,
  Sun,
  Sunrise,
} from "lucide-react";
import { childrenOf, useStore, viewHref } from "@/lib/store";
import type { ItemNode } from "@/lib/types";

const DRAG_MIME = "application/x-nodes-flows-id";

function TreeRow({ item, depth }: { item: ItemNode; depth: number }) {
  const items = useStore((s) => s.items);
  const createItem = useStore((s) => s.createItem);
  const moveItem = useStore((s) => s.moveItem);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(depth === 0);
  const [over, setOver] = useState(false);

  const kids = useMemo(() => childrenOf(items, item.id).filter((c) => c.type === "PAGE"), [items, item.id]);
  const href = viewHref(item);
  const active = pathname === `/page/${item.id}` || pathname === `/canvas/${item.id}`;

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
        <Link href={href} className="tree-link" id={`tree-${item.id}`}>
          <span className="tree-icon">{item.icon ?? (item.default_view === "CANVAS" ? "🧠" : "📄")}</span>
          <span className="tree-title">{item.title || "Sem título"}</span>
        </Link>
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
      </div>
      {open && kids.length > 0 && (
        <ul className="tree">
          {kids.map((k) => (
            <TreeRow key={k.id} item={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ProjectList() {
  const projects = useStore((s) => s.projects);
  const items = useStore((s) => s.items);
  const createProject = useStore((s) => s.createProject);
  const updateProject = useStore((s) => s.updateProject);
  const params = useSearchParams();
  const pathname = usePathname();
  const [editing, setEditing] = useState<string | null>(null);

  const list = useMemo(() => Object.values(projects).sort((a, b) => a.sort_order - b.sort_order), [projects]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of Object.values(items)) {
      if (it.project_id && it.status && it.status !== "DONE") c[it.project_id] = (c[it.project_id] ?? 0) + 1;
    }
    return c;
  }, [items]);

  return (
    <section className="side-section">
      <header className="side-heading">
        <span>Projetos</span>
        <button
          id="add-project"
          className="icon-btn"
          title="Novo projeto"
          onClick={() => setEditing(createProject({}).id)}
        >
          <Plus size={14} />
        </button>
      </header>
      <ul className="tree">
        {list.map((p) => {
          const active = pathname === "/board" && params.get("project") === p.id;
          return (
            <li key={p.id}>
              {editing === p.id ? (
                <input
                  autoFocus
                  className="input input-sm"
                  defaultValue={p.name}
                  onBlur={(e) => {
                    updateProject(p.id, { name: e.target.value.trim() || "Sem nome" });
                    setEditing(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <Link
                  href={`/board?project=${p.id}`}
                  className={`tree-row tree-link project-row ${active ? "is-active" : ""}`}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setEditing(p.id);
                  }}
                >
                  <span className="project-dot" style={{ background: p.color }} />
                  <span className="tree-title">{p.name}</span>
                  {counts[p.id] ? <span className="count-pill">{counts[p.id]}</span> : null}
                </Link>
              )}
            </li>
          );
        })}
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
                <span>{r.icon ?? (r.type === "TASK" ? "☑️" : r.type === "EVENT" ? "📅" : r.type === "MINDMAP_NODE" ? "🔹" : "📄")}</span>
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
  const repo = useStore((s) => s.repo);
  const sync = useStore((s) => s.sync);
  const createItem = useStore((s) => s.createItem);
  const moveItem = useStore((s) => s.moveItem);
  const pathname = usePathname();
  const router = useRouter();
  const [rootOver, setRootOver] = useState(false);

  const roots = useMemo(() => childrenOf(items, null).filter((i) => i.type === "PAGE"), [items]);

  const nav = [
    { href: "/today", label: "Hoje", icon: <Sunrise size={16} />, id: "nav-today" },
    { href: "/board", label: "Kanban", icon: <KanbanSquare size={16} />, id: "nav-board" },
    { href: "/canvas", label: "Mapas mentais", icon: <Network size={16} />, id: "nav-canvas" },
    { href: "/calendar", label: "Agenda", icon: <CalendarDays size={16} />, id: "nav-calendar" },
  ];

  return (
    <aside className="sidebar">
      <Link href="/today" className="brand">
        <span className="brand-mark" />
        <span className="brand-name">entusis</span>
      </Link>

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
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>

      <div className="side-scroll">
        <Suspense fallback={null}>
          <ProjectList />
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
            <span>Páginas</span>
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
              <TreeRow key={r.id} item={r} depth={0} />
            ))}
          </ul>
        </section>
      </div>

      <footer className="side-footer">
        <span className={`sync-badge sync-${sync}`} title={repo?.kind === "supabase" ? "Supabase" : "Armazenamento local"}>
          {repo?.kind === "supabase" ? <Cloud size={13} /> : <HardDrive size={13} />}
          {sync === "saving" ? "Salvando…" : sync === "error" ? "Erro ao salvar" : repo?.kind === "supabase" ? "Sincronizado" : "Local"}
        </span>
        <ThemeToggle />
      </footer>
    </aside>
  );
}
