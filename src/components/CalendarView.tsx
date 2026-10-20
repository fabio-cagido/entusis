"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useStore } from "@/lib/store";
import type { ItemNode } from "@/lib/types";
import { typeIcon } from "@/lib/format";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Local month view of scheduled nodes. Google Calendar sync arrives in Phase 3. */
export default function CalendarView() {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const openDrawer = useStore((s) => s.openDrawer);
  const createItem = useStore((s) => s.createItem);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const byDay = useMemo(() => {
    const m = new Map<string, ItemNode[]>();
    for (const it of Object.values(items)) {
      if (!it.schedule.start_time) continue;
      const k = dayKey(new Date(it.schedule.start_time));
      const arr = m.get(k) ?? [];
      arr.push(it);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.schedule.start_time! < b.schedule.start_time! ? -1 : 1));
    return m;
  }, [items]);

  const days = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const todayKey = dayKey(new Date());
  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Agenda</p>
          <h1 className="view-title" style={{ textTransform: "capitalize" }}>
            {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </h1>
        </div>
        <div className="view-head-actions">
          <button className="btn btn-ghost btn-xs" disabled title="Disponível na Fase 3">
            <Lock size={13} /> Conectar Google Calendar
          </button>
          <div className="segmented">
            <button id="cal-prev" onClick={() => shift(-1)} aria-label="Mês anterior"><ChevronLeft size={15} /></button>
            <button id="cal-today" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Hoje</button>
            <button id="cal-next" onClick={() => shift(1)} aria-label="Próximo mês"><ChevronRight size={15} /></button>
          </div>
        </div>
      </header>

      <div className="calendar glass">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">{w}</div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const list = byDay.get(k) ?? [];
          const out = d.getMonth() !== cursor.getMonth();
          return (
            <div
              key={k}
              className={`cal-day ${out ? "is-out" : ""} ${k === todayKey ? "is-today" : ""}`}
              onDoubleClick={() => {
                const start = new Date(d);
                start.setHours(9, 0, 0, 0);
                const end = new Date(start);
                end.setHours(10);
                const n = createItem({
                  title: "Novo evento",
                  type: "EVENT",
                  schedule: { start_time: start.toISOString(), end_time: end.toISOString(), google_event_id: null },
                });
                openDrawer(n.id);
              }}
            >
              <span className="cal-num">{d.getDate()}</span>
              <div className="cal-events">
                {list.slice(0, 4).map((it) => {
                  const p = it.project_id ? projects[it.project_id] : null;
                  return (
                    <button
                      key={it.id}
                      className={`cal-event ${it.status === "DONE" ? "is-done" : ""}`}
                      style={{ ["--accent" as string]: p?.color ?? "var(--primary)" }}
                      onClick={() => openDrawer(it.id)}
                    >
                      <span className="cal-time">
                        {new Date(it.schedule.start_time!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {typeIcon(it)} {it.title || "Sem título"}
                    </button>
                  );
                })}
                {list.length > 4 && <span className="cal-more">+{list.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small">Dica: clique duas vezes em um dia para criar um evento.</p>
    </div>
  );
}
