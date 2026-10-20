"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  Plus,
} from "lucide-react";
import { useStore } from "@/lib/store";
import type { ItemNode } from "@/lib/types";
import { typeIcon } from "@/lib/format";

interface WeekAgendaStripProps {
  onOpenDrawer: (id: string) => void;
  onCreateEvent: (date: Date) => void;
}

export function WeekAgendaStrip({ onOpenDrawer, onCreateEvent }: WeekAgendaStripProps) {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const [collapsed, setCollapsed] = useState(false);
  const [dayOffset, setDayOffset] = useState(0); // 0 = a partir de hoje

  // 7 dias consecutivos começando do dia atual + offset
  const days = useMemo(() => {
    const list: Date[] = [];
    const base = new Date();
    base.setDate(base.getDate() + dayOffset);
    base.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      list.push(d);
    }
    return list;
  }, [dayOffset]);

  // Mapeia os itens agendados para os 7 dias
  const eventsByDay = useMemo(() => {
    const map = new Map<string, ItemNode[]>();

    const toKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Inicializa as chaves
    days.forEach((d) => map.set(toKey(d), []));

    for (const it of Object.values(items)) {
      if (!it.schedule?.start_time) continue;
      const itDate = new Date(it.schedule.start_time);
      const k = toKey(itDate);
      if (map.has(k)) {
        map.get(k)!.push(it);
      }
    }

    // Ordena por horário
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.schedule.start_time! < b.schedule.start_time! ? -1 : 1));
    }

    return map;
  }, [days, items]);

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const today = new Date();

  const weekdayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const monthNames = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
    "Jul", "Ago", "Set", "Out", "Nov", "Dez",
  ];

  const formatPeriodLabel = () => {
    const first = days[0];
    const last = days[6];
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()} a ${last.getDate()} de ${monthNames[first.getMonth()]}`;
    }
    return `${first.getDate()} ${monthNames[first.getMonth()]} - ${last.getDate()} ${monthNames[last.getMonth()]}`;
  };

  return (
    <section className="week-agenda-section glass">
      {/* Top Header da Agenda Semanal */}
      <div className="week-agenda-header">
        <div className="week-agenda-title-group">
          <CalendarDays size={16} className="week-agenda-icon" />
          <h2 className="week-agenda-title">Agenda dos Próximos 7 Dias</h2>
          <span className="week-agenda-period">{formatPeriodLabel()}</span>
          <span className="gcal-ready-badge" title="Módulo preparado para sincronização bidirecional com Google Calendar">
            <span className="gcal-dot" />
            Google Calendar Ready
          </span>
        </div>

        <div className="week-agenda-nav">
          <div className="segmented segmented-sm">
            <button
              onClick={() => setDayOffset((prev) => prev - 7)}
              title="7 dias anteriores"
              aria-label="Anterior"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              className={dayOffset === 0 ? "is-active" : ""}
              onClick={() => setDayOffset(0)}
              title="Voltar para hoje"
            >
              Hoje
            </button>
            <button
              onClick={() => setDayOffset((prev) => prev + 7)}
              title="Próximos 7 dias"
              aria-label="Próximo"
            >
              <ChevronRight size={13} />
            </button>
          </div>

          <button
            className="icon-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expandir agenda" : "Recolher agenda"}
          >
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {/* Grid Semanal de 7 Colunas */}
      {!collapsed && (
        <div className="week-agenda-grid">
          {days.map((day, idx) => {
            const isTodayDay = isSameDay(day, today);
            const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
            const dayEvents = eventsByDay.get(dateKey) || [];

            return (
              <div
                key={dateKey}
                className={`week-day-col ${isTodayDay ? "is-today" : ""}`}
              >
                {/* Header da Coluna do Dia */}
                <div className="week-day-header">
                  <div className="week-day-meta">
                    <span className="week-day-name">
                      {isTodayDay ? "Hoje" : weekdayNames[day.getDay()]}
                    </span>
                    <span className={`week-day-number ${isTodayDay ? "is-today-badge" : ""}`}>
                      {day.getDate()}
                    </span>
                  </div>
                  <button
                    className="week-day-add-btn"
                    title={`Agendar evento para ${day.getDate()} de ${monthNames[day.getMonth()]}`}
                    onClick={() => onCreateEvent(day)}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                {/* Lista de Eventos do Dia */}
                <div className="week-day-events">
                  {dayEvents.map((evt) => {
                    const project = evt.project_id ? projects[evt.project_id] : null;
                    const startTime = new Date(evt.schedule.start_time!);
                    const timeStr = startTime.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });

                    return (
                      <div
                        key={evt.id}
                        className={`week-event-card ${evt.status === "DONE" ? "is-done" : ""}`}
                        style={{
                          ["--accent" as string]: project?.color || "var(--primary)",
                        }}
                        onClick={() => onOpenDrawer(evt.id)}
                        title={`${evt.title || "Sem título"} (${timeStr})${project ? ` · ${project.name}` : ""}`}
                      >
                        <div className="week-event-time">
                          <Clock size={10} />
                          <span>{timeStr}</span>
                          {evt.schedule.google_event_id && (
                            <span className="gcal-event-icon" title="Sincronizado com Google Calendar">G</span>
                          )}
                        </div>
                        <div className="week-event-title">
                          <span className="week-event-icon">{typeIcon(evt)}</span>
                          <span className="week-event-text">{evt.title || "Sem título"}</span>
                        </div>
                        {project && (
                          <div className="week-event-project">
                            <span
                              className="project-dot"
                              style={{ background: project.color }}
                            />
                            <span>{project.name}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {dayEvents.length === 0 && (
                    <button
                      className="week-day-empty"
                      onClick={() => onCreateEvent(day)}
                    >
                      <Plus size={11} />
                      <span>Agendar</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
