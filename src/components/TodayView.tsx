"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Plus, Sparkles } from "lucide-react";
import { isToday, useStore } from "@/lib/store";
import type { Status } from "@/lib/types";
import KanbanBoard, { type Lane } from "./KanbanBoard";
import { typeIcon } from "@/lib/format";

const COLS: Status[] = ["TODO", "DOING", "DONE"];

export default function TodayView() {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const createItem = useStore((s) => s.createItem);
  const updateItem = useStore((s) => s.updateItem);
  const openDrawer = useStore((s) => s.openDrawer);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>("");

  const todays = useMemo(
    () =>
      Object.values(items).filter(
        (i) => i.status && i.status !== "BACKLOG" && (i.is_today || i.status === "DOING" || isToday(i.schedule.start_time)),
      ),
    [items],
  );

  const agenda = useMemo(
    () =>
      Object.values(items)
        .filter((i) => isToday(i.schedule.start_time))
        .sort((a, b) => (a.schedule.start_time! < b.schedule.start_time! ? -1 : 1)),
    [items],
  );

  const lanes: Lane[] = useMemo(() => {
    const ls: Lane[] = Object.values(projects)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({ id: p.id, title: p.name, color: p.color, icon: p.icon }));
    if (todays.some((t) => !t.project_id || !projects[t.project_id]))
      ls.push({ id: "none", title: "Sem projeto", icon: "📥" });
    return ls;
  }, [projects, todays]);

  const done = todays.filter((t) => t.status === "DONE").length;
  const pct = todays.length ? Math.round((done / todays.length) * 100) : 0;

  const now = new Date();
  const dateLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const hour = now.getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const quickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createItem({ title: title.trim(), type: "TASK", status: "TODO", is_today: true, project_id: projectId || null });
    setTitle("");
  };

  return (
    <div className="view">
      <header className="hero">
        <div>
          <p className="eyebrow">{dateLabel}</p>
          <h1 className="hero-title">
            {greet}. <span className="gradient-text">To Do Today</span>
          </h1>
          <p className="muted">
            {todays.length - done} pendentes · {todays.filter((t) => t.status === "DOING").length} em andamento · {done} concluídas
          </p>
        </div>
        <div className="progress-ring" style={{ ["--pct" as string]: pct }} aria-label={`${pct}% concluído`}>
          <span>{pct}%</span>
        </div>
      </header>

      <form className="quick-add glass" onSubmit={quickAdd}>
        <Sparkles size={16} className="quick-add-icon" />
        <input
          id="quick-add-title"
          className="quick-add-input"
          placeholder="O que precisa ser feito hoje?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select id="quick-add-project" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Sem projeto</option>
          {Object.values(projects).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button id="quick-add-submit" className="btn btn-primary" type="submit"><Plus size={15} /> Adicionar</button>
      </form>

      {agenda.length > 0 && (
        <section className="agenda-strip">
          <h2 className="section-title"><CalendarClock size={15} /> Agenda de hoje</h2>
          <div className="agenda-items">
            {agenda.map((a) => {
              const p = a.project_id ? projects[a.project_id] : null;
              return (
                <button key={a.id} className="agenda-item" style={{ ["--accent" as string]: p?.color ?? "var(--primary)" }} onClick={() => openDrawer(a.id)}>
                  <span className="agenda-time">
                    {new Date(a.schedule.start_time!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="agenda-title">{typeIcon(a)} {a.title || "Sem título"}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <KanbanBoard
        items={todays}
        statuses={COLS}
        lanes={lanes}
        onMove={(id, status, laneId) => updateItem(id, { status, project_id: laneId, is_today: true })}
        onAdd={(status, laneId) => {
          const n = createItem({ title: "Nova tarefa", type: "TASK", status, project_id: laneId, is_today: true });
          openDrawer(n.id);
        }}
      />
    </div>
  );
}
