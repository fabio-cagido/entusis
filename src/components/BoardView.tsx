"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Layers, X } from "lucide-react";
import { descendantsOf, useStore } from "@/lib/store";
import { STATUSES } from "@/lib/types";
import KanbanBoard, { type Lane } from "./KanbanBoard";
import ViewSwitcher from "./ViewSwitcher";
import { typeIcon } from "@/lib/format";

export default function BoardView() {
  const params = useSearchParams();
  const router = useRouter();
  const rootId = params.get("root");
  const projectId = params.get("project");
  const grouped = params.get("group") !== "flat";

  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const createItem = useStore((s) => s.createItem);
  const updateItem = useStore((s) => s.updateItem);
  const openDrawer = useStore((s) => s.openDrawer);

  const root = rootId ? items[rootId] : null;
  const project = projectId ? projects[projectId] : null;

  const scoped = useMemo(() => {
    let pool = root ? descendantsOf(items, root.id) : Object.values(items);
    pool = pool.filter((i) => i.status);
    if (projectId) pool = pool.filter((i) => i.project_id === projectId);
    return pool;
  }, [items, root, projectId]);

  const lanes: Lane[] | undefined = useMemo(() => {
    if (!grouped || projectId) return undefined;
    const ids = new Set(scoped.map((i) => i.project_id ?? "none"));
    const ls: Lane[] = Object.values(projects)
      .filter((p) => ids.has(p.id))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({ id: p.id, title: p.name, color: p.color, icon: p.icon }));
    if (ids.has("none")) ls.push({ id: "none", title: "Sem projeto", icon: "📥" });
    return ls;
  }, [grouped, projectId, scoped, projects]);

  const setParam = (k: string, v: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (v) sp.set(k, v);
    else sp.delete(k);
    router.replace(`/board${sp.toString() ? `?${sp}` : ""}`);
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Kanban</p>
          <h1 className="view-title">
            {root ? (
              <>{typeIcon(root)} {root.title || "Sem título"}</>
            ) : project ? (
              <><span className="project-dot project-dot-lg" style={{ background: project.color }} /> {project.name}</>
            ) : (
              "Todas as tarefas"
            )}
          </h1>
        </div>
        <div className="view-head-actions">
          {!projectId && (
            <button
              id="toggle-group"
              className={`btn btn-ghost btn-xs ${grouped ? "is-active" : ""}`}
              onClick={() => setParam("group", grouped ? "flat" : null)}
            >
              <Layers size={13} /> Agrupar por projeto
            </button>
          )}
          {root && <ViewSwitcher id={root.id} />}
        </div>
      </header>

      <div className="filter-bar">
        <button className={`filter-chip ${!projectId ? "is-active" : ""}`} onClick={() => setParam("project", null)}>Todos</button>
        {Object.values(projects)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((p) => (
            <button
              key={p.id}
              className={`filter-chip ${projectId === p.id ? "is-active" : ""}`}
              style={{ ["--accent" as string]: p.color }}
              onClick={() => setParam("project", projectId === p.id ? null : p.id)}
            >
              <span className="project-dot" style={{ background: p.color }} /> {p.name}
            </button>
          ))}
        {root && (
          <button className="filter-chip is-active" onClick={() => setParam("root", null)}>
            Dentro de: {root.title || "Sem título"} <X size={12} />
          </button>
        )}
      </div>

      <KanbanBoard
        items={scoped}
        statuses={STATUSES}
        lanes={lanes}
        onMove={(id, status, laneId) => updateItem(id, lanes ? { status, project_id: laneId } : { status })}
        onAdd={(status, laneId) => {
          const n = createItem({
            title: "Nova tarefa",
            type: "TASK",
            status,
            parent_id: root?.id ?? null,
            project_id: laneId ?? projectId ?? root?.project_id ?? null,
          });
          openDrawer(n.id);
        }}
      />
    </div>
  );
}
