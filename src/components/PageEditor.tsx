"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  CalendarClock,
  ExternalLink,
  FileBox,
  Globe,
  HardDrive,
  KanbanSquare,
  Link2,
  Plus,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";
import { ancestorsOf, childrenOf, useStore, viewHref } from "@/lib/store";
import { ITEM_TYPES, STATUSES, STATUS_LABEL, TYPE_LABEL } from "@/lib/types";
import type { Attachment, ItemNode, ItemType, Status } from "@/lib/types";
import { detectAttachmentKind, formatWhen, fromLocalInput, toLocalInput, typeIcon } from "@/lib/format";
import RichEditor from "./RichEditor";
import ViewSwitcher from "./ViewSwitcher";

const EMOJIS = ["📄", "🧠", "🎯", "🚀", "💡", "📌", "📚", "🗂️", "🕸️", "🎓", "⚙️", "🔥", "✨", "📈", "🧩", "🌱"];

/* ------------------------------------------------------------------ */

function Properties({ item }: { item: ItemNode }) {
  const projects = useStore((s) => s.projects);
  const updateItem = useStore((s) => s.updateItem);
  const projectList = useMemo(() => Object.values(projects).sort((a, b) => a.sort_order - b.sort_order), [projects]);

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
          onChange={(e) => {
            const start = fromLocalInput(e.target.value);
            let end = item.schedule.end_time;
            if (start && (!end || end < start)) end = new Date(new Date(start).getTime() + 3600_000).toISOString();
            if (!start) end = null;
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

      {item.schedule.start_time && (
        <p className="prop-hint">
          {item.schedule.google_event_id ? "Sincronizado com Google Calendar" : "Será sincronizado com o Google Calendar na Fase 3"}
        </p>
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

function Attachments({ item }: { item: ItemNode }) {
  const updateItem = useStore((s) => s.updateItem);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    const a: Attachment = {
      id: crypto.randomUUID(),
      url: u,
      label: label.trim() || u.replace(/^https?:\/\//, "").slice(0, 60),
      kind: detectAttachmentKind(u),
    };
    updateItem(item.id, { attachments: [...item.attachments, a] });
    setUrl("");
    setLabel("");
  };

  const icon = (k: Attachment["kind"]) =>
    k === "drive" ? <HardDrive size={14} /> : k === "file" ? <FileBox size={14} /> : <Globe size={14} />;

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>Anexos &amp; links externos <span className="muted">{item.attachments.length}</span></h3>
      </header>
      {item.attachments.length > 0 && (
        <ul className="attach-list">
          {item.attachments.map((a) => (
            <li key={a.id} className={`attach attach-${a.kind}`}>
              {icon(a.kind)}
              <a href={a.url} target="_blank" rel="noopener noreferrer">{a.label}</a>
              <ExternalLink size={12} className="muted" />
              <button
                className="icon-btn"
                title="Remover"
                onClick={() => updateItem(item.id, { attachments: item.attachments.filter((x) => x.id !== a.id) })}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form" onSubmit={add}>
        <input id="attach-url" className="input" placeholder="Cole uma URL (Drive, site, arquivo…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input id="attach-label" className="input input-narrow" placeholder="Rótulo (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button id="attach-add" className="btn btn-xs" type="submit"><Plus size={13} /> Anexar</button>
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
              title="Excluir (inclui sub-itens)"
              onClick={() => {
                if (!confirm("Excluir este item e todos os sub-itens?")) return;
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

      <RichEditor key={item.id} value={item.content} compact={compact} onChange={(html) => updateItem(item.id, { content: html })} />

      <div className={compact ? "panels" : "panels panels-grid"}>
        <Children item={item} compact={compact} />
        <Attachments item={item} />
        <Links item={item} />
      </div>
    </article>
  );
}
