"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpDown,
  CheckCircle2,
  Circle,
  Clock,
  Filter,
  KanbanSquare,
  LayoutGrid,
  Maximize2,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { isToday, useStore } from "@/lib/store";
import type { ItemNode, Project, Status } from "@/lib/types";
import KanbanBoard, { type Lane } from "./KanbanBoard";
import { WeekAgendaStrip } from "./WeekAgendaStrip";

type FilterStatus = "ALL" | "DOING" | "TODO" | "DONE";

interface ProjectViewCardProps {
  project: Project | null;
  items: ItemNode[];
  onOpenDrawer: (id: string) => void;
  onQuickAdd: (title: string, projectId: string | null, status: Status) => void;
  onUpdateStatus: (id: string, status: Status) => void;
}

function ProjectViewCard({
  project,
  items,
  onOpenDrawer,
  onQuickAdd,
  onUpdateStatus,
}: ProjectViewCardProps) {
  const [filter, setFilter] = useState<FilterStatus>("ALL");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const filteredItems = useMemo(() => {
    let result = items;
    if (filter === "DOING") result = result.filter((i) => i.status === "DOING");
    else if (filter === "TODO") result = result.filter((i) => i.status === "TODO");
    else if (filter === "DONE") result = result.filter((i) => i.status === "DONE");

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.title.toLowerCase().includes(q));
    }
    return result;
  }, [items, filter, search]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setIsCreating(false);
      return;
    }
    const targetStatus: Status = filter === "DOING" ? "DOING" : "TODO";
    onQuickAdd(newTitle.trim(), project ? project.id : null, targetStatus);
    setNewTitle("");
    setIsCreating(false);
  };

  const cycleStatus = (e: React.MouseEvent, item: ItemNode) => {
    e.stopPropagation();
    let next: Status = "TODO";
    if (item.status === "TODO") next = "DOING";
    else if (item.status === "DOING") next = "DONE";
    else if (item.status === "DONE") next = "TODO";
    onUpdateStatus(item.id, next);
  };

  const statusIcon = (status: Status | null) => {
    if (status === "DOING") {
      return (
        <span className="notion-status-icon notion-status-doing" title="Fazendo (clique para concluir)">
          <span className="status-symbol">!</span>
        </span>
      );
    }
    if (status === "DONE") {
      return (
        <span className="notion-status-icon notion-status-done" title="Concluído (clique para reabrir)">
          <CheckCircle2 size={13} />
        </span>
      );
    }
    return (
      <span className="notion-status-icon notion-status-todo" title="A fazer (clique para iniciar)">
        <Circle size={13} />
      </span>
    );
  };

  const filterLabels: Record<FilterStatus, string> = {
    ALL: "Todas",
    DOING: "Fazendo",
    TODO: "A fazer",
    DONE: "Concluídas",
  };

  return (
    <div className="notion-project-card">
      {/* Header do componente com controles estilo Notion */}
      <div className="notion-card-header">
        <div className="notion-card-title">
          <span className="notion-project-icon">{project?.icon || "📁"}</span>
          <span className="notion-project-name">{project?.name || "Sem projeto"}</span>
          <span className="notion-project-count">{filteredItems.length}</span>
        </div>

        <div className="notion-card-tools">
          {/* Botão de Filtro com Menu */}
          <div className="notion-tool-wrapper">
            <button
              className={`notion-tool-btn ${filter !== "ALL" ? "is-active" : ""}`}
              title={`Filtrar (${filterLabels[filter]})`}
              onClick={() => setShowFilterMenu(!showFilterMenu)}
            >
              <Filter size={13} />
              {filter !== "ALL" && <span className="notion-filter-active-pill">{filterLabels[filter]}</span>}
            </button>

            {showFilterMenu && (
              <div className="notion-filter-popover glass">
                <div className="notion-filter-head">Filtrar status</div>
                <button
                  className={`notion-filter-opt ${filter === "ALL" ? "is-selected" : ""}`}
                  onClick={() => { setFilter("ALL"); setShowFilterMenu(false); }}
                >
                  Todas as tarefas
                </button>
                <button
                  className={`notion-filter-opt ${filter === "DOING" ? "is-selected" : ""}`}
                  onClick={() => { setFilter("DOING"); setShowFilterMenu(false); }}
                >
                  <span className="notion-status-icon notion-status-doing"><span className="status-symbol">!</span></span>
                  Apenas Fazendo
                </button>
                <button
                  className={`notion-filter-opt ${filter === "TODO" ? "is-selected" : ""}`}
                  onClick={() => { setFilter("TODO"); setShowFilterMenu(false); }}
                >
                  <Circle size={12} /> Apenas A fazer
                </button>
                <button
                  className={`notion-filter-opt ${filter === "DONE" ? "is-selected" : ""}`}
                  onClick={() => { setFilter("DONE"); setShowFilterMenu(false); }}
                >
                  <CheckCircle2 size={12} /> Apenas Concluídas
                </button>
              </div>
            )}
          </div>

          {/* Busca interna */}
          <button
            className={`notion-tool-btn ${showSearch || search ? "is-active" : ""}`}
            title="Buscar neste projeto"
            onClick={() => setShowSearch(!showSearch)}
          >
            <Search size={13} />
          </button>

          {/* Abrir no Kanban completo */}
          {project && (
            <Link
              href={`/board?project=${project.id}`}
              className="notion-tool-btn"
              title="Abrir página completa do projeto"
            >
              <Maximize2 size={13} />
            </Link>
          )}

          {/* Botão New Azul estilo Notion */}
          <button
            className="notion-btn-new"
            onClick={() => setIsCreating(true)}
            title="Nova tarefa neste projeto"
          >
            New
          </button>
        </div>
      </div>

      {/* Barra de busca se ativada */}
      {showSearch && (
        <div className="notion-search-inline">
          <Search size={12} className="muted" />
          <input
            autoFocus
            className="notion-search-input"
            placeholder="Filtrar tarefas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="icon-btn" onClick={() => setSearch("")}>
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Lista ultra compacta de tarefas */}
      <div className="notion-task-list">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className={`notion-task-row ${item.status === "DONE" ? "is-done" : ""}`}
            onClick={() => onOpenDrawer(item.id)}
          >
            <button
              className="notion-task-check"
              onClick={(e) => cycleStatus(e, item)}
            >
              {statusIcon(item.status)}
            </button>
            <span className="notion-task-title">{item.title || "Sem título"}</span>
            {item.schedule.start_time && (
              <span className="notion-task-time">
                <Clock size={10} />
                {new Date(item.schedule.start_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        ))}

        {filteredItems.length === 0 && !isCreating && (
          <div className="notion-empty-row">
            {filter !== "ALL" ? `Nenhuma tarefa em "${filterLabels[filter]}"` : "Nenhuma tarefa hoje"}
          </div>
        )}

        {/* Input inline para adicionar rapidamente */}
        {isCreating ? (
          <form onSubmit={handleCreateSubmit} className="notion-new-task-form">
            <span className="notion-status-icon notion-status-todo">
              <Circle size={13} />
            </span>
            <input
              autoFocus
              className="notion-new-task-input"
              placeholder="Nome da tarefa (pressione Enter)..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={() => {
                if (!newTitle.trim()) setIsCreating(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsCreating(false);
                  setNewTitle("");
                }
              }}
            />
          </form>
        ) : (
          <button
            className="notion-add-task-btn"
            onClick={() => setIsCreating(true)}
          >
            <Plus size={13} />
            <span>New task</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function TodayView() {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const createItem = useStore((s) => s.createItem);
  const updateItem = useStore((s) => s.updateItem);
  const openDrawer = useStore((s) => s.openDrawer);

  const [layoutMode, setLayoutMode] = useState<"grid" | "kanban">("grid");
  const [globalFilter, setGlobalFilter] = useState<"ALL" | "DOING">("ALL");

  const todays = useMemo(
    () =>
      Object.values(items).filter(
        (i) => i.status && i.status !== "BACKLOG" && (i.is_today || i.status === "DOING" || isToday(i.schedule.start_time)),
      ),
    [items],
  );

  const projectList = useMemo(() => {
    return Object.values(projects).sort((a, b) => a.sort_order - b.sort_order);
  }, [projects]);

  const itemsByProject = useMemo(() => {
    const map = new Map<string, ItemNode[]>();
    for (const it of todays) {
      if (globalFilter === "DOING" && it.status !== "DOING") continue;
      const key = it.project_id || "none";
      const arr = map.get(key) || [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [todays, globalFilter]);

  const handleQuickAdd = (title: string, projectId: string | null, status: Status = "TODO") => {
    createItem({
      title,
      type: "TASK",
      status,
      is_today: true,
      project_id: projectId,
    });
  };

  const lanes: Lane[] = useMemo(() => {
    const ls: Lane[] = projectList.map((p) => ({
      id: p.id,
      title: p.name,
      color: p.color,
      icon: p.icon,
    }));
    if (todays.some((t) => !t.project_id || !projects[t.project_id])) {
      ls.push({ id: "none", title: "Sem projeto", icon: "📥" });
    }
    return ls;
  }, [projectList, todays, projects]);

  const handleCreateEventFromDate = (date: Date) => {
    const start = new Date(date);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);

    const n = createItem({
      title: "Novo compromisso",
      type: "EVENT",
      status: "TODO",
      is_today: isToday(start.toISOString()),
      schedule: {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        google_event_id: null,
      },
    });
    openDrawer(n.id);
  };

  return (
    <div className="notion-today-view">
      {/* Top Header estilo Notion minimalista */}
      <header className="notion-top-bar">
        <h1 className="notion-main-title">To do Today</h1>

        <div className="notion-top-actions">
          {/* Alternador Global Rápido: Todas x Fazendo */}
          <div className="segmented segmented-sm">
            <button
              className={globalFilter === "ALL" ? "is-active" : ""}
              onClick={() => setGlobalFilter("ALL")}
            >
              Todas
            </button>
            <button
              className={globalFilter === "DOING" ? "is-active" : ""}
              onClick={() => setGlobalFilter("DOING")}
            >
              <span className="notion-status-icon notion-status-doing" style={{ width: 12, height: 12 }}>
                <span className="status-symbol">!</span>
              </span>
              Apenas Fazendo
            </button>
          </div>

          {/* Alternador de Visão: Grid Notion x Kanban completo */}
          <div className="segmented segmented-sm">
            <button
              className={layoutMode === "grid" ? "is-active" : ""}
              onClick={() => setLayoutMode("grid")}
              title="Visualização em Painel Notion"
            >
              <LayoutGrid size={14} />
              <span>Painel</span>
            </button>
            <button
              className={layoutMode === "kanban" ? "is-active" : ""}
              onClick={() => setLayoutMode("kanban")}
              title="Visualização em Quadro Kanban"
            >
              <KanbanSquare size={14} />
              <span>Kanban</span>
            </button>
          </div>
        </div>
      </header>

      {/* Agenda Semanal: do dia atual até 7 dias para frente */}
      <WeekAgendaStrip
        onOpenDrawer={openDrawer}
        onCreateEvent={handleCreateEventFromDate}
      />

      {/* Conteúdo Principal */}
      {layoutMode === "grid" ? (
        <div className="notion-projects-grid">
          {projectList.map((p) => (
            <ProjectViewCard
              key={p.id}
              project={p}
              items={itemsByProject.get(p.id) || []}
              onOpenDrawer={openDrawer}
              onQuickAdd={handleQuickAdd}
              onUpdateStatus={(id, status) => updateItem(id, { status })}
            />
          ))}

          {/* Tarefas sem projeto associado */}
          {(itemsByProject.get("none")?.length || 0) > 0 && (
            <ProjectViewCard
              project={null}
              items={itemsByProject.get("none") || []}
              onOpenDrawer={openDrawer}
              onQuickAdd={handleQuickAdd}
              onUpdateStatus={(id, status) => updateItem(id, { status })}
            />
          )}
        </div>
      ) : (
        <div style={{ marginTop: 24 }}>
          <KanbanBoard
            items={todays}
            statuses={["TODO", "DOING", "DONE"]}
            lanes={lanes}
            onMove={(id, status, laneId) =>
              updateItem(id, { status, project_id: laneId, is_today: true })
            }
            onAdd={(status, laneId) => {
              const n = createItem({
                title: "Nova tarefa",
                type: "TASK",
                status,
                project_id: laneId,
                is_today: true,
              });
              openDrawer(n.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
