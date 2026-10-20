"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Columns2, FileText, KanbanSquare, Layers, X } from "lucide-react";
import { descendantsOf, useStore } from "@/lib/store";
import { STATUSES } from "@/lib/types";
import KanbanBoard, { type Lane } from "./KanbanBoard";
import PageEditor from "./PageEditor";
import ViewSwitcher from "./ViewSwitcher";
import { typeIcon } from "@/lib/format";

export default function BoardView() {
  const params = useSearchParams();
  const router = useRouter();
  const rootId = params.get("root");
  const projectId = params.get("project");
  const grouped = params.get("group") !== "flat";
  const initialTab = (params.get("tab") as "page" | "kanban" | "split") || "page";

  const [projectTab, setProjectTab] = useState<"page" | "kanban" | "split">(initialTab);
  const [editingTitle, setEditingTitle] = useState(false);

  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const createItem = useStore((s) => s.createItem);
  const updateItem = useStore((s) => s.updateItem);
  const updateProject = useStore((s) => s.updateProject);
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

  const handleTabChange = (t: "page" | "kanban" | "split") => {
    setProjectTab(t);
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", t);
    router.replace(`/board?${sp.toString()}`);
  };

  const projectPage = useMemo(() => {
    if (!project) return null;
    return (
      Object.values(items).find(
        (i) => i.project_id === project.id && i.type === "PAGE" && !i.parent_id
      ) || (project.page_id ? items[project.page_id] : null)
    );
  }, [project, items]);

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">{project ? "Projeto" : "Kanban"}</p>
          <h1 className="view-title">
            {root ? (
              <>
                {typeIcon(root)} {root.title || "Sem título"}
              </>
            ) : project ? (
              editingTitle ? (
                <input
                  autoFocus
                  className="input input-sm"
                  style={{ fontSize: "1.25rem", fontWeight: 700, padding: "2px 8px", width: "auto" }}
                  defaultValue={project.name}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val && val !== project.name) {
                      updateProject(project.id, { name: val });
                    }
                    setEditingTitle(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                />
              ) : (
                <span
                  title="Clique duas vezes para renomear o projeto"
                  onDoubleClick={() => setEditingTitle(true)}
                  style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px" }}
                >
                  <span className="project-dot project-dot-lg" style={{ background: project.color }} />{" "}
                  {project.name}
                </span>
              )
            ) : (
              "Todas as tarefas"
            )}
          </h1>
        </div>

        <div className="view-head-actions">
          {/* Alternador de Visões do Projeto: Página x Kanban x Ambos */}
          {project && projectPage && (
            <div className="segmented segmented-sm">
              <button
                className={projectTab === "page" ? "is-active" : ""}
                onClick={() => handleTabChange("page")}
                title="Página do Projeto (Texto rico, Anexos, Documentos)"
              >
                <FileText size={13} />
                <span>Página</span>
              </button>
              <button
                className={projectTab === "kanban" ? "is-active" : ""}
                onClick={() => handleTabChange("kanban")}
                title="Quadro Kanban de Tarefas"
              >
                <KanbanSquare size={13} />
                <span>Kanban</span>
              </button>
              <button
                className={projectTab === "split" ? "is-active" : ""}
                onClick={() => handleTabChange("split")}
                title="Visualização Integrada (Página + Kanban)"
              >
                <Columns2 size={13} />
                <span>Ambos</span>
              </button>
            </div>
          )}

          {/* Botão opcional para criar página se o projeto ainda não tiver */}
          {project && !projectPage && (
            <button
              className="btn btn-ghost btn-xs"
              title="Criar página própria vinculada a este projeto"
              onClick={() => {
                const page = createItem({
                  title: project.name,
                  type: "PAGE",
                  icon: project.icon || "📁",
                  project_id: project.id,
                  parent_id: null,
                  content: `<h2>${project.name} — Visão Geral</h2><p>Página central do projeto. Use este espaço para anotações, objetivos estratégicos e anexos.</p>`,
                });
                updateProject(project.id, { page_id: page.id });
                handleTabChange("page");
              }}
            >
              <FileText size={13} />
              <span>+ Criar Página do Projeto</span>
            </button>
          )}

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

      {/* Barra de Filtros de Projetos quando visualizando quadro geral */}
      {!projectId && (
        <div className="filter-bar">
          <button
            className={`filter-chip ${!projectId ? "is-active" : ""}`}
            onClick={() => setParam("project", null)}
          >
            Todos
          </button>
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
      )}

      {/* Visualização de Projeto */}
      {project && projectPage ? (
        projectTab === "page" ? (
          <PageEditor id={projectPage.id} />
        ) : projectTab === "split" ? (
          <div className="project-hub-split">
            <div className="project-hub-page-pane">
              <PageEditor id={projectPage.id} />
            </div>
            <div className="project-hub-board-pane">
              <KanbanBoard
                items={scoped}
                statuses={STATUSES}
                lanes={lanes}
                onMove={(id, status, laneId) =>
                  updateItem(id, lanes ? { status, project_id: laneId } : { status })
                }
                onAdd={(status, laneId) => {
                  const n = createItem({
                    title: "Nova tarefa",
                    type: "TASK",
                    status,
                    parent_id: projectPage.id,
                    project_id: laneId ?? projectId,
                  });
                  openDrawer(n.id);
                }}
              />
            </div>
          </div>
        ) : (
          <KanbanBoard
            items={scoped}
            statuses={STATUSES}
            lanes={lanes}
            onMove={(id, status, laneId) =>
              updateItem(id, lanes ? { status, project_id: laneId } : { status })
            }
            onAdd={(status, laneId) => {
              const n = createItem({
                title: "Nova tarefa",
                type: "TASK",
                status,
                parent_id: projectPage ? projectPage.id : null,
                project_id: laneId ?? projectId,
              });
              openDrawer(n.id);
            }}
          />
        )
      ) : (
        /* Visualização Geral do Kanban */
        <KanbanBoard
          items={scoped}
          statuses={STATUSES}
          lanes={lanes}
          onMove={(id, status, laneId) =>
            updateItem(id, lanes ? { status, project_id: laneId } : { status })
          }
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
      )}
    </div>
  );
}
