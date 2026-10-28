"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, FileText, ListChecks, Paperclip, Link2, Plus, Repeat, Sunrise } from "lucide-react";
import { checklistProgress, formatRecurrenceSummary, useStore } from "@/lib/store";
import { STATUS_LABEL } from "@/lib/types";
import type { ItemNode, Status } from "@/lib/types";
import { formatWhen, typeIcon } from "@/lib/format";

/* ---------------- Card ---------------- */

export function ItemCard({ item, overlay }: { item: ItemNode; overlay?: boolean }) {
  const project = useStore((s) => (item.project_id ? s.projects[item.project_id] : null));
  const parent = useStore((s) => (item.parent_id ? s.items[item.parent_id] : null));
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const updateItem = useStore((s) => s.updateItem);
  const openDrawer = useStore((s) => s.openDrawer);
  const prog = checklistProgress(item.content);

  const handlePageAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.type !== "PAGE") {
      // Se tiver projeto, vincula como subpágina da página raiz do projeto
      if (item.project_id) {
        const prPage =
          Object.values(items).find(
            (i) => i.project_id === item.project_id && i.type === "PAGE" && !i.parent_id
          ) || (projects[item.project_id]?.page_id ? items[projects[item.project_id].page_id!] : null);

        updateItem(item.id, {
          type: "PAGE",
          parent_id: prPage ? prPage.id : item.parent_id,
          icon: item.icon || "📄",
        });
      } else {
        updateItem(item.id, { type: "PAGE", icon: item.icon || "📄" });
      }
    }
    openDrawer(item.id);
  };

  return (
    <div
      className={`card ${overlay ? "is-overlay" : ""} ${item.status === "DONE" ? "is-done" : ""}`}
      style={{ ["--accent" as string]: project?.color ?? "var(--muted)" }}
      onClick={() => !overlay && openDrawer(item.id)}
      id={`card-${item.id}`}
    >
      <div className="card-top">
        <span className="card-icon">{typeIcon(item)}</span>
        <span className="card-title">
          {item.title || "Sem título"}
          {item.is_recurring && (
            <span
              className="recurring-indicator"
              title={formatRecurrenceSummary(item) ?? "Tarefa recorrente"}
            >
              <Repeat size={11} />
            </span>
          )}
        </span>
        <button
          className="card-page-btn"
          title={item.type === "PAGE" ? "Abrir página" : "Criar subpágina vinculada ao projeto"}
          onClick={handlePageAction}
        >
          <FileText size={12} />
        </button>
      </div>
      {parent && <div className="card-parent">↳ {parent.title || "Sem título"}</div>}
      <div className="card-meta">
        {project && (
          <span className="meta-chip">
            <span className="project-dot" style={{ background: project.color }} /> {project.name}
          </span>
        )}
        {item.type === "PAGE" && (
          <span className="meta-chip is-page">
            <FileText size={10} /> Página
          </span>
        )}
        {item.schedule.start_time && (
          <span className="meta-chip meta-chip-time"><CalendarClock size={11} /> {formatWhen(item.schedule.start_time)}</span>
        )}
        {prog.total > 0 && (
          <span className={`meta-chip ${prog.done === prog.total ? "is-complete" : ""}`}>
            <ListChecks size={11} /> {prog.done}/{prog.total}
          </span>
        )}
        {item.attachments.length > 0 && <span className="meta-chip"><Paperclip size={11} /> {item.attachments.length}</span>}
        {item.links.length > 0 && <span className="meta-chip"><Link2 size={11} /> {item.links.length}</span>}
        {item.is_today && <span className="meta-chip meta-chip-today"><Sunrise size={11} /></span>}
      </div>
    </div>
  );
}

function DraggableCard({ item }: { item: ItemNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={`card-wrap ${isDragging ? "is-dragging" : ""}`}>
      <ItemCard item={item} />
    </div>
  );
}

function Column({
  dropId,
  status,
  items,
  onAdd,
  showHeader,
}: {
  dropId: string;
  status: Status;
  items: ItemNode[];
  onAdd?: () => void;
  showHeader: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <div ref={setNodeRef} className={`column status-col-${status} ${isOver ? "is-over" : ""}`}>
      {showHeader && (
        <header className="column-head">
          <span className={`status-dot status-${status}`} />
          <span>{STATUS_LABEL[status]}</span>
          <span className="muted">{items.length}</span>
          {onAdd && (
            <button className="icon-btn column-add" title="Adicionar" onClick={onAdd}>
              <Plus size={14} />
            </button>
          )}
        </header>
      )}
      <div className="column-body">
        {items.map((it) => (
          <DraggableCard key={it.id} item={it} />
        ))}
        {items.length === 0 && <div className="column-empty">Solte aqui</div>}
      </div>
    </div>
  );
}

/* ---------------- Board ---------------- */

export interface Lane {
  id: string; // project id or "none"
  title: string;
  color?: string;
  icon?: string | null;
}

interface BoardProps {
  items: ItemNode[];
  statuses: Status[];
  lanes?: Lane[]; // swimlanes (grouped by project)
  onMove: (id: string, status: Status, laneId: string | null) => void;
  onAdd?: (status: Status, laneId: string | null) => void;
}

const SEP = "::";

export default function KanbanBoard({ items, statuses, lanes, onMove, onAdd }: BoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? items.find((i) => i.id === activeId) : null;

  const grouped = useMemo(() => {
    const g = new Map<string, ItemNode[]>();
    for (const it of items) {
      const lane = lanes ? it.project_id ?? "none" : "all";
      const key = `${lane}${SEP}${it.status}`;
      const arr = g.get(key) ?? [];
      arr.push(it);
      g.set(key, arr);
    }
    for (const arr of g.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return g;
  }, [items, lanes]);

  const onStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const [lane, status] = String(e.over.id).split(SEP);
    onMove(String(e.active.id), status as Status, lanes ? (lane === "none" ? null : lane) : null);
  };

  const renderRow = (laneId: string, header: boolean) => (
    <div className="board-row" style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(240px, 1fr))` }}>
      {statuses.map((s) => (
        <Column
          key={s}
          dropId={`${laneId}${SEP}${s}`}
          status={s}
          showHeader={header}
          items={grouped.get(`${laneId}${SEP}${s}`) ?? []}
          onAdd={onAdd ? () => onAdd(s, lanes ? (laneId === "none" ? null : laneId) : null) : undefined}
        />
      ))}
    </div>
  );

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActiveId(null)}>
      {lanes ? (
        <div className="lanes">
          {lanes.map((l) => {
            const count = statuses.reduce((n, s) => n + (grouped.get(`${l.id}${SEP}${s}`)?.length ?? 0), 0);
            return (
              <section key={l.id} className="lane" style={{ ["--accent" as string]: l.color ?? "var(--muted)" }}>
                <header className="lane-head">
                  <span className="lane-bar" />
                  <span className="lane-icon">{l.icon}</span>
                  <h2>{l.title}</h2>
                  <span className="count-pill">{count}</span>
                </header>
                {renderRow(l.id, true)}
              </section>
            );
          })}
        </div>
      ) : (
        renderRow("all", true)
      )}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {active ? <ItemCard item={active} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
