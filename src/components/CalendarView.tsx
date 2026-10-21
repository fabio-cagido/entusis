"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, RefreshCw, Unlink } from "lucide-react";
import { useStore } from "@/lib/store";
import type { ItemNode } from "@/lib/types";
import { typeIcon } from "@/lib/format";
import {
  connectGoogleCalendar,
  disconnectGcal,
  fetchGoogleCalendarEvents,
  getCachedGcalEvents,
  getGcalAccessToken,
  isGcalConnected,
  type GoogleCalendarEvent,
} from "@/lib/google/calendar";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function CalendarView() {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const openDrawer = useStore((s) => s.openDrawer);
  const createItem = useStore((s) => s.createItem);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [isConnected, setIsConnected] = useState(() => isGcalConnected());
  const [isGcalLoading, setIsGcalLoading] = useState(false);
  const [gcalEvents, setGcalEvents] = useState<GoogleCalendarEvent[]>(() => getCachedGcalEvents());

  const days = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const loadGcal = useCallback(async () => {
    const conn = isGcalConnected();
    setIsConnected(conn);
    if (!conn || days.length === 0) return;

    setIsGcalLoading(true);
    try {
      const start = new Date(days[0]);
      start.setHours(0, 0, 0, 0);
      const end = new Date(days[days.length - 1]);
      end.setHours(23, 59, 59, 999);
      const res = await fetchGoogleCalendarEvents(start, end);
      setGcalEvents(res);
    } catch (e) {
      console.warn("[CalendarView] gcal fetch error:", e);
    } finally {
      setIsGcalLoading(false);
      setIsConnected(isGcalConnected());
    }
  }, [days]);

  useEffect(() => {
    setIsConnected(isGcalConnected());
    loadGcal();

    const handleStatus = () => {
      setIsConnected(isGcalConnected());
      loadGcal();
    };

    const handleFocus = () => {
      if (isGcalConnected()) loadGcal();
    };

    const timer = setInterval(() => {
      if (isGcalConnected()) loadGcal();
    }, 45000);

    window.addEventListener("gcal-status-change", handleStatus);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("gcal-status-change", handleStatus);
      window.removeEventListener("focus", handleFocus);
      clearInterval(timer);
    };
  }, [loadGcal]);

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

  const gcalByDay = useMemo(() => {
    const m = new Map<string, GoogleCalendarEvent[]>();
    for (const ge of gcalEvents) {
      if (!ge.start?.dateTime && !ge.start?.date) continue;
      const d = new Date(ge.start.dateTime || `${ge.start.date}T00:00:00`);
      const k = dayKey(d);
      const arr = m.get(k) ?? [];
      arr.push(ge);
      m.set(k, arr);
    }
    return m;
  }, [gcalEvents]);

  const shift = (n: number) => {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  };

  const todayKey = dayKey(new Date());

  const handleDisconnect = () => {
    if (confirm("Deseja desconectar a sincronização com o Google Calendar?")) {
      disconnectGcal();
      setIsConnected(false);
      setGcalEvents([]);
    }
  };

  const handleConnect = async () => {
    try {
      setIsGcalLoading(true);
      const connected = await connectGoogleCalendar("/calendar");
      if (connected) {
        setIsConnected(true);
        loadGcal();
      }
    } catch (e: any) {
      console.warn("[CalendarView] connection error:", e);
      alert(e?.message || "Erro ao conectar Google Agenda");
    } finally {
      setIsGcalLoading(false);
    }
  };

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
          {isConnected ? (
            (() => {
              const hasToken = Boolean(getGcalAccessToken());
              return (
                <div
                  className="gcal-connected-badge"
                  title={hasToken ? "Google Calendar Conectado" : "Sessão expirada. Clique para reconectar"}
                >
                  <span className={`gcal-dot ${hasToken ? "is-online" : "is-warning"}`} />
                  <span>{hasToken ? "Google Agenda Conectada" : "Sessão Expirada"}</span>
                  <button
                    className="icon-btn-xs"
                    onClick={() => {
                      if (!hasToken) {
                        handleConnect();
                      } else {
                        loadGcal();
                      }
                    }}
                    disabled={isGcalLoading}
                    title={hasToken ? "Sincronizar eventos do Google Calendar agora" : "Reconectar ao Google Calendar"}
                  >
                    <RefreshCw size={11} className={isGcalLoading ? "spin" : ""} />
                  </button>
                  <button
                    className="icon-btn-xs"
                    onClick={handleDisconnect}
                    title="Desconectar Google Agenda"
                  >
                    <Unlink size={11} />
                  </button>
                </div>
              );
            })()
          ) : (
            <button
              className="gcal-connect-btn"
              onClick={handleConnect}
              disabled={isGcalLoading}
              title="Conectar com sua conta Google para sincronizar a agenda"
            >
              <Calendar size={13} />
              <span>{isGcalLoading ? "Conectando..." : "Conectar Google Calendar"}</span>
            </button>
          )}

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
          const gList = gcalByDay.get(k) ?? [];
          const out = d.getMonth() !== cursor.getMonth();
          const totalCount = list.length + gList.length;

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
                      title={`${it.title || "Sem título"}`}
                    >
                      <span className="cal-time">
                        {new Date(it.schedule.start_time!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="cal-icon">{typeIcon(it)}</span>
                      <span className="cal-text">{it.title || "Sem título"}</span>
                    </button>
                  );
                })}

                {gList.slice(0, 4).map((ge) => {
                  let timeStr = "Dia todo";
                  if (ge.start?.dateTime) {
                    timeStr = new Date(ge.start.dateTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  }
                  return (
                    <button
                      key={`gcal-${ge.id}`}
                      className="cal-event is-gcal"
                      onClick={() => {
                        if (ge.htmlLink) window.open(ge.htmlLink, "_blank");
                      }}
                      title={`Google Calendar: ${ge.summary} (${timeStr})`}
                    >
                      <span className="cal-time">{timeStr}</span>
                      <span className="gcal-event-icon" title="Evento do Google Calendar">G</span>
                      <span className="cal-text">{ge.summary}</span>
                    </button>
                  );
                })}

                {totalCount > 4 && <span className="cal-more">+{totalCount - 4} mais</span>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small">Dica: clique duas vezes em um dia para criar um evento.</p>
    </div>
  );
}
