"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CalendarClock,
  Check,
  ExternalLink,
  FileBox,
  Globe,
  HardDrive,
  KanbanSquare,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Repeat,
  Sunrise,
  Trash2,
  Unlink,
  Upload,
  Users,
  X,
} from "lucide-react";
import { ancestorsOf, childrenOf, useStore, viewHref } from "@/lib/store";
import { ITEM_TYPES, STATUSES, STATUS_LABEL, TYPE_LABEL, WEEKDAY_LABEL } from "@/lib/types";
import type { Attachment, ItemNode, ItemType, RecurrenceType, Status } from "@/lib/types";
import { detectAttachmentKind, formatWhen, fromLocalInput, toLocalInput, typeIcon } from "@/lib/format";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import RichEditor from "./RichEditor";
import ViewSwitcher from "./ViewSwitcher";
import {
  connectGoogleCalendar,
  createGoogleCalendarEvent,
  fetchGoogleContactSuggestions,
  verifyGoogleCalendarEvent,
  type GoogleContactSuggestion,
} from "@/lib/google/calendar";

const ATTACHMENTS_BUCKET = "attachments";

const EMOJIS = ["📄", "🧠", "🎯", "🚀", "💡", "📌", "📚", "🗂️", "🕸️", "🎓", "⚙️", "🔥", "✨", "📈", "🧩", "🌱"];

/* ------------------------------------------------------------------ */

function Properties({ item }: { item: ItemNode }) {
  const projects = useStore((s) => s.projects);
  const items = useStore((s) => s.items);
  const shares = useStore((s) => s.shares);
  const updateItem = useStore((s) => s.updateItem);
  const projectList = useMemo(() => Object.values(projects).sort((a, b) => a.sort_order - b.sort_order), [projects]);

  const [participantInput, setParticipantInput] = useState("");
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [contactSuggestions, setContactSuggestions] = useState<GoogleContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [pendingScheduleConfirm, setPendingScheduleConfirm] = useState(false);
  const [gcalFeedback, setGcalFeedback] = useState<{
    type: "info" | "success" | "error";
    text: string;
    needsConnect?: boolean;
  } | null>(null);

  const attendees = useMemo(() => item.attendees ?? [], [item.attendees]);

  useEffect(() => {
    let active = true;
    fetchGoogleContactSuggestions().then((list) => {
      if (active) setContactSuggestions(list);
    });
    return () => {
      active = false;
    };
  }, []);

  // Reconciliação automática: ao abrir a tarefa (ou retornar à aba), verifica se o google_event_id ainda existe e não foi cancelado
  useEffect(() => {
    const gId = item.schedule.google_event_id;
    if (!gId) return;

    let cancelled = false;
    const checkEventStillActive = async () => {
      const status = await verifyGoogleCalendarEvent(gId);
      if (!cancelled && status === "deleted") {
        updateItem(item.id, {
          schedule: {
            ...item.schedule,
            google_event_id: null,
            google_event_link: null,
          },
        });
        setGcalFeedback({
          type: "info",
          text: "O evento vinculado foi excluído na Google Agenda. Vínculo desfeito automaticamente.",
        });
      }
    };

    void checkEventStillActive();
    const onFocus = () => {
      void checkEventStillActive();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [item.id, item.schedule.google_event_id, item.schedule, updateItem]);

  const allSuggestions = useMemo(() => {
    const map = new Map<string, GoogleContactSuggestion>();
    for (const c of contactSuggestions) {
      map.set(c.email.toLowerCase(), c);
    }
    for (const sh of Object.values(shares)) {
      const em = sh.invited_email?.trim().toLowerCase();
      if (em && !map.has(em)) map.set(em, { email: em });
    }
    for (const it of Object.values(items)) {
      for (const em of it.attendees ?? []) {
        const clean = em.trim().toLowerCase();
        if (clean && !map.has(clean)) map.set(clean, { email: clean });
      }
    }
    const q = participantInput.trim().toLowerCase();
    return Array.from(map.values())
      .filter((s) => !attendees.includes(s.email))
      .filter(
        (s) =>
          !q ||
          s.email.toLowerCase().includes(q) ||
          (s.name && s.name.toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [contactSuggestions, shares, items, participantInput, attendees]);

  const addParticipantsFromRaw = (raw: string) => {
    const tokens = raw
      .split(/[,;\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validNew: string[] = [];
    let invalidFound = false;

    for (const tk of tokens) {
      if (emailRegex.test(tk)) {
        if (!attendees.includes(tk) && !validNew.includes(tk)) {
          validNew.push(tk);
        }
      } else {
        invalidFound = true;
      }
    }

    if (validNew.length > 0) {
      updateItem(item.id, { attendees: [...attendees, ...validNew] });
      setParticipantInput("");
      setParticipantError(null);
    } else if (invalidFound) {
      setParticipantError("Digite um e-mail válido (ex: nome@empresa.com)");
    } else {
      setParticipantInput("");
      setParticipantError(null);
    }
  };

  const removeParticipant = (emailToRemove: string) => {
    updateItem(item.id, {
      attendees: attendees.filter((e) => e !== emailToRemove),
    });
  };

  const handleSyncToGoogleCalendar = async () => {
    setGcalFeedback(null);

    if (!item.schedule.start_time) {
      const nextHour = new Date();
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      const oneHourLater = new Date(nextHour.getTime() + 3600_000);
      const startIso = nextHour.toISOString();
      const endIso = oneHourLater.toISOString();

      updateItem(item.id, {
        schedule: {
          ...item.schedule,
          start_time: startIso,
          end_time: endIso,
        },
      });
      setPendingScheduleConfirm(true);
      setGcalFeedback({
        type: "info",
        text: `Horário sugerido para hoje às ${nextHour.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}. Ajuste se desejar e clique em "Confirmar Agendamento".`,
      });

      setTimeout(() => {
        const startEl = document.getElementById("prop-start") as HTMLInputElement | null;
        if (startEl) {
          startEl.focus();
          try {
            startEl.showPicker?.();
          } catch {
            // fallback if browser blocks programmatic showPicker
          }
        }
      }, 30);
      return;
    }

    setPendingScheduleConfirm(false);
    setGcalSyncing(true);
    try {
      const res = await createGoogleCalendarEvent({
        id: item.id,
        title: item.title || "Sem título",
        content: item.content,
        attendees,
        schedule: item.schedule,
      });

      if (res.success && res.google_event_id) {
        updateItem(item.id, {
          schedule: {
            ...item.schedule,
            google_event_id: res.google_event_id,
            google_event_link: res.htmlLink ?? item.schedule.google_event_link ?? null,
          },
        });
        setGcalFeedback({
          type: "success",
          text: item.schedule.google_event_id
            ? "Evento atualizado na Google Agenda!"
            : "Evento criado na Google Agenda!",
        });
      } else {
        const errMsg = res.error || "Não foi possível sincronizar com a Google Agenda.";
        const needsConn =
          errMsg.toLowerCase().includes("conect") ||
          errMsg.toLowerCase().includes("expir") ||
          errMsg.includes("401");
        setGcalFeedback({
          type: "error",
          text: errMsg,
          needsConnect: needsConn,
        });
      }
    } finally {
      setGcalSyncing(false);
    }
  };

  return (
    <div className="props">
      <label className="prop">
        <span className="prop-label">Tipo</span>
        <select
          id="prop-type"
          className="select"
          value={item.type}
          onChange={(e) => {
            const type = e.target.value as ItemType;
            // Tasks/events start tracked on the Kanban.
            const status = (type === "TASK" || type === "EVENT") && !item.status ? "TODO" : item.status;
            updateItem(item.id, { type, status });
          }}
        >
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
      </label>

      <label className="prop">
        <span className="prop-label">Status</span>
        <select
          id="prop-status"
          className={`select status-select status-${item.status ?? "none"}`}
          value={item.status ?? ""}
          onChange={(e) => updateItem(item.id, { status: (e.target.value || null) as Status | null })}
        >
          <option value="">— fora do Kanban —</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </label>

      <label className="prop">
        <span className="prop-label">Projeto</span>
        <select
          id="prop-project"
          className="select"
          value={item.project_id ?? ""}
          onChange={(e) => updateItem(item.id, { project_id: e.target.value || null })}
        >
          <option value="">Sem projeto</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className="prop">
        <span className="prop-label"><CalendarClock size={12} /> Início</span>
        <input
          id="prop-start"
          type="datetime-local"
          className="input"
          value={toLocalInput(item.schedule.start_time)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              // ignore if already open or unsupported
            }
          }}
          onChange={(e) => {
            const start = fromLocalInput(e.target.value);
            let end = item.schedule.end_time;
            if (start && (!end || end < start)) end = new Date(new Date(start).getTime() + 3600_000).toISOString();
            if (!start) {
              end = null;
              setPendingScheduleConfirm(false);
            }
            updateItem(item.id, { schedule: { ...item.schedule, start_time: start, end_time: end } });
          }}
        />
      </label>

      <label className="prop">
        <span className="prop-label">Fim</span>
        <input
          id="prop-end"
          type="datetime-local"
          className="input"
          disabled={!item.schedule.start_time}
          value={toLocalInput(item.schedule.end_time)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              // ignore if already open or unsupported
            }
          }}
          onChange={(e) => updateItem(item.id, { schedule: { ...item.schedule, end_time: fromLocalInput(e.target.value) } })}
        />
      </label>

      <div className="prop">
        <span className="prop-label">Hoje</span>
        <button
          id="prop-today"
          className={`chip-toggle ${item.is_today ? "is-on" : ""}`}
          onClick={() =>
            updateItem(item.id, { is_today: !item.is_today, status: !item.is_today && !item.status ? "TODO" : item.status })
          }
        >
          <Sunrise size={13} /> {item.is_today ? "No dashboard" : "Adicionar"}
        </button>
      </div>

      <div className="prop">
        <span className="prop-label">Recorrência</span>
        <button
          id="prop-recurring-toggle"
          type="button"
          className={`chip-toggle ${item.is_recurring ? "is-on" : ""}`}
          onClick={() => {
            const nextRecurring = !item.is_recurring;
            if (nextRecurring) {
              const now = new Date();
              const recType: RecurrenceType = item.recurrence_type ?? "monthly";
              updateItem(item.id, {
                is_recurring: true,
                recurrence_type: recType,
                recurrence_day_of_month:
                  recType === "monthly" ? (item.recurrence_day_of_month ?? now.getDate()) : null,
                recurrence_day_of_week:
                  recType === "weekly" ? (item.recurrence_day_of_week ?? now.getDay()) : null,
                status: item.status ?? "TODO",
              });
            } else {
              updateItem(item.id, {
                is_recurring: false,
                recurrence_type: null,
                recurrence_day_of_month: null,
                recurrence_day_of_week: null,
              });
            }
          }}
        >
          <Repeat size={13} /> {item.is_recurring ? "Tarefa recorrente" : "Ativar recorrência"}
        </button>
      </div>

      {item.is_recurring && (
        <>
          <label className="prop">
            <span className="prop-label">Frequência</span>
            <select
              id="prop-recurrence-type"
              className="select"
              value={item.recurrence_type ?? "monthly"}
              onChange={(e) => {
                const nextType = e.target.value as RecurrenceType;
                const now = new Date();
                if (nextType === "monthly") {
                  updateItem(item.id, {
                    recurrence_type: "monthly",
                    recurrence_day_of_month: item.recurrence_day_of_month ?? now.getDate(),
                    recurrence_day_of_week: null,
                  });
                } else {
                  updateItem(item.id, {
                    recurrence_type: "weekly",
                    recurrence_day_of_week: item.recurrence_day_of_week ?? now.getDay(),
                    recurrence_day_of_month: null,
                  });
                }
              }}
            >
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
            </select>
          </label>

          {(item.recurrence_type ?? "monthly") === "monthly" ? (
            <label className="prop">
              <span className="prop-label">Dia do mês</span>
              <select
                id="prop-recurrence-dom"
                className="select"
                value={item.recurrence_day_of_month ?? 1}
                onChange={(e) =>
                  updateItem(item.id, {
                    recurrence_day_of_month: Number(e.target.value),
                    last_recurred_at: null,
                  })
                }
              >
                {Array.from({ length: 31 }, (_, idx) => idx + 1).map((day) => (
                  <option key={day} value={day}>
                    Todo dia {day}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="prop">
              <span className="prop-label">Dia da semana</span>
              <select
                id="prop-recurrence-dow"
                className="select"
                value={typeof item.recurrence_day_of_week === "number" ? item.recurrence_day_of_week : 1}
                onChange={(e) =>
                  updateItem(item.id, {
                    recurrence_day_of_week: Number(e.target.value),
                    last_recurred_at: null,
                  })
                }
              >
                {Object.entries(WEEKDAY_LABEL).map(([val, label]) => (
                  <option key={val} value={Number(val)}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {/* Botão de Ação: Criar / Gerenciar Evento na Google Agenda */}
      <div className="prop prop-gcal-action">
        <span className="prop-label">
          <Calendar size={12} /> Google Agenda
        </span>
        {item.schedule.google_event_id ? (
          <div className="gcal-event-actions-group">
            <a
              href={
                item.schedule.google_event_link ||
                "https://calendar.google.com/calendar/r"
              }
              target="_blank"
              rel="noreferrer"
              className="gcal-event-synced-btn"
              title="Abrir evento na Google Agenda em nova aba"
            >
              <Check size={13} />
              <span>Na Google Agenda</span>
              <ExternalLink size={11} />
            </a>
            <button
              type="button"
              className="icon-btn gcal-mini-action"
              onClick={handleSyncToGoogleCalendar}
              disabled={gcalSyncing}
              title="Atualizar dados e participantes deste evento na Google Agenda"
            >
              <RefreshCw size={12} className={gcalSyncing ? "spin" : ""} />
            </button>
            <button
              type="button"
              className="icon-btn gcal-mini-action"
              onClick={() => {
                updateItem(item.id, {
                  schedule: {
                    ...item.schedule,
                    google_event_id: null,
                    google_event_link: null,
                  },
                });
                setGcalFeedback({
                  type: "info",
                  text: "Vínculo com o evento removido localmente.",
                });
              }}
              title="Desvincular evento da Google Agenda"
            >
              <Unlink size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            id="prop-create-gcal-event"
            className={`gcal-create-event-btn ${
              pendingScheduleConfirm && item.schedule.start_time ? "is-confirm-ready" : ""
            }`}
            disabled={gcalSyncing}
            onClick={handleSyncToGoogleCalendar}
          >
            {gcalSyncing ? (
              <>
                <Loader2 size={13} className="spin" />
                <span>Criando evento…</span>
              </>
            ) : pendingScheduleConfirm && item.schedule.start_time ? (
              <>
                <Check size={13} />
                <span>Confirmar Agendamento</span>
              </>
            ) : (
              <>
                <Calendar size={13} />
                <span>Criar Evento na Google Agenda</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Campo de Participantes (Attendees / Convidados) */}
      <div className="prop prop-full-width">
        <span className="prop-label">
          <Users size={12} /> Participantes
        </span>
        <div className="participants-field-wrapper">
          <div
            className="participants-chips-box"
            onClick={() => {
              const el = document.getElementById(`participant-input-${item.id}`);
              el?.focus();
            }}
          >
            {attendees.map((email) => (
              <span key={email} className="participant-chip">
                <span className="participant-chip-avatar">
                  {email.charAt(0).toUpperCase()}
                </span>
                <span className="participant-chip-email">{email}</span>
                <button
                  type="button"
                  className="participant-chip-remove"
                  title={`Remover ${email}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeParticipant(email);
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}

            <input
              id={`participant-input-${item.id}`}
              type="email"
              className="participant-inline-input"
              placeholder={
                attendees.length === 0
                  ? "Digite e-mails dos convidados e pressione Enter ou vírgula…"
                  : "Adicionar outro e-mail…"
              }
              value={participantInput}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                setTimeout(() => setShowSuggestions(false), 160);
                if (participantInput.trim()) {
                  addParticipantsFromRaw(participantInput);
                }
              }}
              onChange={(e) => {
                const val = e.target.value;
                setParticipantError(null);
                if (val.endsWith(",") || val.endsWith(";")) {
                  addParticipantsFromRaw(val.slice(0, -1));
                } else {
                  setParticipantInput(val);
                  setShowSuggestions(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  if (participantInput.trim()) {
                    addParticipantsFromRaw(participantInput);
                  }
                } else if (
                  e.key === "Backspace" &&
                  !participantInput &&
                  attendees.length > 0
                ) {
                  removeParticipant(attendees[attendees.length - 1]);
                }
              }}
            />
          </div>

          {showSuggestions && allSuggestions.length > 0 && (
            <div className="participants-suggestions-popover glass">
              <div className="participants-suggestions-head">
                Sugestões de contatos
              </div>
              {allSuggestions.map((s) => (
                <button
                  key={s.email}
                  type="button"
                  className="participants-suggestion-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addParticipantsFromRaw(s.email);
                    setShowSuggestions(false);
                  }}
                >
                  <span className="participant-chip-avatar">
                    {(s.name || s.email).charAt(0).toUpperCase()}
                  </span>
                  <span className="participants-suggestion-info">
                    {s.name && (
                      <span className="participants-suggestion-name">{s.name}</span>
                    )}
                    <span className="participants-suggestion-email">{s.email}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {participantError && (
            <p className="participants-feedback is-error">{participantError}</p>
          )}
        </div>
      </div>

      {gcalFeedback && (
        <div className={`gcal-inline-feedback is-${gcalFeedback.type}`}>
          <span>{gcalFeedback.text}</span>
          {gcalFeedback.needsConnect && (
            <button
              type="button"
              className="gcal-inline-connect-btn"
              onClick={() => connectGoogleCalendar(window.location.pathname + window.location.search)}
            >
              Conectar Google Agenda
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Children({ item, compact }: { item: ItemNode; compact?: boolean }) {
  const items = useStore((s) => s.items);
  const createItem = useStore((s) => s.createItem);
  const openDrawer = useStore((s) => s.openDrawer);
  const router = useRouter();
  const kids = useMemo(() => childrenOf(items, item.id), [items, item.id]);

  const add = (type: ItemType) => {
    const n = createItem({
      parent_id: item.id,
      project_id: item.project_id,
      type,
      status: type === "TASK" ? "TODO" : null,
      title: type === "TASK" ? "Nova tarefa" : type === "MINDMAP_NODE" ? "Novo nó" : "",
    });
    if (type === "PAGE" && !compact) router.push(`/page/${n.id}`);
    else openDrawer(n.id);
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>Sub-itens <span className="muted">{kids.length}</span></h3>
        <div className="panel-actions">
          <button className="btn btn-ghost btn-xs" id="add-child-page" onClick={() => add("PAGE")}><Plus size={13} /> Página</button>
          <button className="btn btn-ghost btn-xs" id="add-child-task" onClick={() => add("TASK")}><Plus size={13} /> Tarefa</button>
        </div>
      </header>
      {kids.length === 0 ? (
        <p className="empty-hint">Nenhum sub-item ainda.</p>
      ) : (
        <ul className="child-list">
          {kids.map((k) => (
            <li key={k.id}>
              <Link href={viewHref(k)} className="child-row">
                <span>{typeIcon(k)}</span>
                <span className={`child-title ${k.status === "DONE" ? "is-done" : ""}`}>{k.title || "Sem título"}</span>
                {k.status && <span className={`status-pill status-${k.status}`}>{STATUS_LABEL[k.status]}</span>}
                {k.schedule.start_time && <span className="meta-chip">{formatWhen(k.schedule.start_time)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function formatFileSize(bytes?: number): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Attachments({ item }: { item: ItemNode }) {
  const updateItem = useStore((s) => s.updateItem);
  const flushNow = useStore((s) => s.flushNow);
  const currentUserId = useStore((s) => s.currentUserId);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const triggerFilePicker = () => {
    if (uploading) return;
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setUploading(true);
    setUploadError(null);

    try {
      const sb = getSupabase();
      const uploadedAttachments: Attachment[] = [];

      for (const file of files) {
        const safeFileName =
          file.name
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9._-]+/g, "_")
            .replace(/^_+|_+$/g, "") || "arquivo";

        if (isSupabaseConfigured && sb) {
          let userId = currentUserId;
          if (!userId) {
            const { data: authData, error: authErr } = await sb.auth.getUser();
            if (authErr) {
              console.error("[ayolia] Erro ao obter usuário autenticado antes do upload:", authErr);
            }
            userId = authData.user?.id ?? null;
          }

          if (!userId) {
            throw new Error("Sessão não autenticada. Faça login novamente para enviar arquivos.");
          }

          const storagePath = `${userId}/${item.id}/${Date.now()}-${safeFileName}`;

          const { data: uploadData, error: storageErr } = await sb.storage
            .from(ATTACHMENTS_BUCKET)
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: file.type || "application/octet-stream",
            });

          if (storageErr) {
            console.error("[ayolia] Falha no upload para Supabase Storage:", {
              bucket: ATTACHMENTS_BUCKET,
              storagePath,
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type,
              error: storageErr,
            });
            const msg = storageErr.message || String(storageErr);
            if (msg.toLowerCase().includes("bucket not found")) {
              throw new Error(
                `O bucket "${ATTACHMENTS_BUCKET}" não existe no Supabase Storage. Execute a migration 0004_storage_attachments.sql no SQL Editor do Supabase.`
              );
            }
            if (msg.toLowerCase().includes("row-level security") || msg.toLowerCase().includes("unauthorized")) {
              throw new Error(
                `Permissão negada pelo RLS do Supabase Storage (${msg}). Execute a migration 0004_storage_attachments.sql no SQL Editor do Supabase.`
              );
            }
            throw new Error(`Falha ao enviar "${file.name}": ${msg}`);
          }

          const finalPath = uploadData?.path || storagePath;
          const { data: publicUrlData } = sb.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(finalPath);

          if (!publicUrlData?.publicUrl) {
            console.error("[ayolia] Não foi possível gerar a URL pública para o arquivo:", finalPath);
            throw new Error("Não foi possível obter a URL pública do arquivo enviado.");
          }

          uploadedAttachments.push({
            id: crypto.randomUUID(),
            url: publicUrlData.publicUrl,
            label: files.length === 1 && label.trim() ? label.trim() : file.name,
            kind: "file",
            storage_path: finalPath,
            size: file.size,
            mime_type: file.type || "application/octet-stream",
          });
        } else {
          // Modo local-first (sem Supabase configurado)
          const objectUrl = URL.createObjectURL(file);
          uploadedAttachments.push({
            id: crypto.randomUUID(),
            url: objectUrl,
            label: files.length === 1 && label.trim() ? label.trim() : file.name,
            kind: "file",
            size: file.size,
            mime_type: file.type || "application/octet-stream",
          });
        }
      }

      const currentList = useStore.getState().items[item.id]?.attachments ?? item.attachments ?? [];
      updateItem(item.id, { attachments: [...currentList, ...uploadedAttachments] });
      setLabel("");

      try {
        await flushNow();
      } catch (persistErr) {
        console.error("[ayolia] Erro ao persistir metadados do anexo em item_nodes:", persistErr);
        throw new Error(
          persistErr instanceof Error
            ? `Arquivo enviado, mas houve falha ao salvar na página: ${persistErr.message}`
            : "Arquivo enviado, mas houve falha ao salvar na página."
        );
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[ayolia] Erro no fluxo de anexo de arquivo:", err);
      setUploadError(errMsg);
    } finally {
      setUploading(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) {
      // Se o usuário clicar em "+ Anexar" sem URL preenchida, abre o seletor de arquivos locais
      triggerFilePicker();
      return;
    }
    setUploadError(null);
    const normalizedUrl = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const a: Attachment = {
      id: crypto.randomUUID(),
      url: normalizedUrl,
      label: label.trim() || u.replace(/^https?:\/\//, "").slice(0, 60),
      kind: detectAttachmentKind(normalizedUrl),
    };
    updateItem(item.id, { attachments: [...item.attachments, a] });
    setUrl("");
    setLabel("");
  };

  const handleRemoveAttachment = async (a: Attachment) => {
    updateItem(item.id, { attachments: item.attachments.filter((x) => x.id !== a.id) });
    if (a.storage_path && isSupabaseConfigured) {
      const sb = getSupabase();
      if (sb) {
        const { error } = await sb.storage.from(ATTACHMENTS_BUCKET).remove([a.storage_path]);
        if (error) {
          console.error("[ayolia] Erro ao remover arquivo do Supabase Storage:", {
            bucket: ATTACHMENTS_BUCKET,
            storagePath: a.storage_path,
            error,
          });
        }
      }
    }
  };

  const icon = (k: Attachment["kind"]) =>
    k === "drive" ? <HardDrive size={14} /> : k === "file" ? <FileBox size={14} /> : <Globe size={14} />;

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <Paperclip size={14} /> Anexos &amp; links externos{" "}
          <span className="muted">{item.attachments.length}</span>
        </h3>
        <div className="panel-actions">
          <button
            id="attach-file-btn"
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={triggerFilePicker}
            disabled={uploading}
            title="Selecionar arquivo do computador para anexar"
          >
            {uploading ? (
              <>
                <Loader2 size={13} className="spin" /> Enviando…
              </>
            ) : (
              <>
                <Upload size={13} /> Enviar arquivo
              </>
            )}
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        id="attach-file-input"
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {uploadError && (
        <div
          className="attach-error-banner"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 10px",
            marginBottom: 10,
            borderRadius: "var(--radius-sm)",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            color: "#ef4444",
            fontSize: "0.78rem",
            lineHeight: 1.4,
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ flex: 1 }}>{uploadError}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setUploadError(null)}
            title="Fechar aviso"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {item.attachments.length > 0 && (
        <ul className="attach-list">
          {item.attachments.map((a) => {
            const sizeLabel = formatFileSize(a.size);
            return (
              <li key={a.id} className={`attach attach-${a.kind}`}>
                {icon(a.kind)}
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.label}
                </a>
                {sizeLabel && (
                  <span className="muted" style={{ fontSize: "0.7rem", marginLeft: 4 }}>
                    ({sizeLabel})
                  </span>
                )}
                <ExternalLink size={12} className="muted" />
                <button
                  type="button"
                  className="icon-btn"
                  title="Remover anexo"
                  onClick={() => void handleRemoveAttachment(a)}
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form className="inline-form" onSubmit={add}>
        <input
          id="attach-url"
          className="input"
          placeholder="Cole uma URL (Drive, site…) ou clique em Enviar arquivo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          id="attach-label"
          className="input input-narrow"
          placeholder="Rótulo (opcional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button id="attach-add" className="btn btn-xs" type="submit" disabled={uploading}>
          {uploading ? (
            <>
              <Loader2 size={13} className="spin" /> Enviando…
            </>
          ) : url.trim() ? (
            <>
              <Plus size={13} /> Anexar link
            </>
          ) : (
            <>
              <Upload size={13} /> Anexar arquivo
            </>
          )}
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Links({ item }: { item: ItemNode }) {
  const items = useStore((s) => s.items);
  const toggleLink = useStore((s) => s.toggleLink);
  const [q, setQ] = useState("");

  const linked = item.links.map((id) => items[id]).filter(Boolean);
  const backlinks = useMemo(() => Object.values(items).filter((i) => i.links.includes(item.id)), [items, item.id]);
  const candidates = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return Object.values(items)
      .filter((i) => i.id !== item.id && !item.links.includes(i.id) && i.title.toLowerCase().includes(t))
      .slice(0, 6);
  }, [q, items, item.id, item.links]);

  return (
    <section className="panel">
      <header className="panel-head">
        <h3><Link2 size={14} /> Vínculos internos <span className="muted">{linked.length}</span></h3>
      </header>
      <div className="link-search">
        <input id="link-search" className="input" placeholder="Vincular a página, tarefa, evento ou nó…" value={q} onChange={(e) => setQ(e.target.value)} />
        {candidates.length > 0 && (
          <ul className="search-results glass">
            {candidates.map((c) => (
              <li key={c.id}>
                <button onClick={() => { toggleLink(item.id, c.id); setQ(""); }}>
                  <span>{typeIcon(c)}</span>{c.title || "Sem título"}<span className="muted"> · {TYPE_LABEL[c.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {linked.length > 0 && (
        <ul className="chip-list">
          {linked.map((l) => (
            <li key={l.id} className="link-chip">
              <Link href={viewHref(l)}>{typeIcon(l)} {l.title || "Sem título"}</Link>
              <button className="icon-btn" title="Desvincular" onClick={() => toggleLink(item.id, l.id)}><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      {backlinks.length > 0 && (
        <>
          <p className="prop-label backlink-label">Referenciado por</p>
          <ul className="chip-list">
            {backlinks.map((b) => (
              <li key={b.id} className="link-chip link-chip-back">
                <Link href={viewHref(b)}>{typeIcon(b)} {b.title || "Sem título"}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

export default function PageEditor({ id, compact = false }: { id: string; compact?: boolean }) {
  const item = useStore((s) => s.items[id]);
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const updateItem = useStore((s) => s.updateItem);
  const deleteItem = useStore((s) => s.deleteItem);
  const router = useRouter();
  const [pickIcon, setPickIcon] = useState(false);

  const crumbs = useMemo(() => (item ? ancestorsOf(items, item.id) : []), [items, item]);

  if (!item) {
    return (
      <div className="empty-state">
        <h1>Nó não encontrado</h1>
        <p className="muted">Ele pode ter sido removido.</p>
        <Link className="btn" href="/today">Voltar para Hoje</Link>
      </div>
    );
  }

  const project = item.project_id ? projects[item.project_id] : null;

  return (
    <article className={`page-editor ${compact ? "is-compact" : ""}`}>
      {!compact && (
        <div className="page-topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c) => (
              <span key={c.id}>
                <Link href={viewHref(c)}>{typeIcon(c)} {c.title || "Sem título"}</Link>
                <span className="crumb-sep">/</span>
              </span>
            ))}
            <span className="crumb-current">{item.title || "Sem título"}</span>
          </nav>
          <div className="page-topbar-actions">
            {item.project_id && (
              <Link
                href={`/board?project=${item.project_id}&tab=kanban`}
                className="btn btn-ghost btn-xs"
                title="Abrir quadro Kanban do projeto"
              >
                <KanbanSquare size={13} />
                <span>Quadro Kanban</span>
              </Link>
            )}
            <ViewSwitcher id={item.id} />
            <button
              id="delete-item"
              className="icon-btn icon-btn-danger"
              title="Mover para a lixeira (inclui sub-itens)"
              onClick={() => {
                if (!confirm("Mover este item e todos os sub-itens para a lixeira (retidos por 7 dias)?")) return;
                const parent = item.parent_id;
                deleteItem(item.id);
                router.push(parent ? `/page/${parent}` : "/today");
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}

      {project && !compact && <div className="page-cover" style={{ ["--cover" as string]: project.color }} />}

      <header className="page-head">
        <div className="icon-pick">
          <button id="page-icon" className="page-icon" onClick={() => setPickIcon((v) => !v)} title="Alterar ícone">
            {typeIcon(item)}
          </button>
          {pickIcon && (
            <div className="emoji-grid glass">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => { updateItem(item.id, { icon: e }); setPickIcon(false); }}>{e}</button>
              ))}
              <button className="emoji-clear" onClick={() => { updateItem(item.id, { icon: null }); setPickIcon(false); }}>Padrão</button>
            </div>
          )}
        </div>
        <textarea
          id="page-title"
          className="page-title"
          rows={1}
          placeholder="Sem título"
          value={item.title}
          autoFocus={!item.title && !compact}
          onChange={(e) => updateItem(item.id, { title: e.target.value.replace(/\n/g, "") })}
        />
      </header>

      <Properties item={item} />

      <RichEditor
        key={item.id}
        itemId={item.id}
        title={item.title}
        value={item.content}
        compact={compact}
        onChange={(html) => updateItem(item.id, { content: html })}
      />

      <div className={compact ? "panels" : "panels panels-grid"}>
        <Children item={item} compact={compact} />
        <Attachments item={item} />
        <Links item={item} />
      </div>
    </article>
  );
}
