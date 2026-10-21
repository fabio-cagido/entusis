"use client";

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  KanbanSquare,
  Link2,
  Maximize,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { descendantsOf, useStore } from "@/lib/store";
import { STATUS_LABEL } from "@/lib/types";
import type { ItemNode } from "@/lib/types";
import { COL_W, ROW_H, layoutTree } from "@/lib/layout";
import { formatWhen, typeIcon } from "@/lib/format";
import ViewSwitcher from "./ViewSwitcher";

const PALETTE = ["#8b7bff", "#f472b6", "#38bdf8", "#2dd4bf", "#facc15", "#fb923c", "#a3e635", "#94a3b8"];

type MindData = {
  item: ItemNode;
  color: string;
  isRoot: boolean;
  editing: boolean;
  childCount: number;
  collapsed: boolean;
  side: 1 | -1;
};
type MindNode = Node<MindData, "mind">;

interface Ctx {
  rename(id: string, title: string): void;
  stopEditing(): void;
  startEditing(id: string): void;
  open(id: string): void;
  toggleCollapse(id: string): void;
  convertToPage(id: string): void;
  createChildPage(id: string): void;
  deleteNode(id: string): void;
}
const MindCtx = createContext<Ctx | null>(null);

/* ------------------------------------------------------------------ */
/* Node                                                                */
/* ------------------------------------------------------------------ */

const MindNodeView = memo(function MindNodeView({ data, selected }: NodeProps<MindNode>) {
  const ctx = useContext(MindCtx)!;
  const { item, color, isRoot, editing, childCount, collapsed, side } = data;
  const [draft, setDraft] = useState(item.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) setDraft(item.title);
  }, [editing, item.title]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as unknown as HTMLElement)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handleOutside);
    return () => window.removeEventListener("pointerdown", handleOutside);
  }, [menuOpen]);

  const commit = () => {
    ctx.rename(item.id, draft.trim());
    ctx.stopEditing();
  };

  const firstAttachment = item.attachments[0];

  return (
    <div
      className={`mind-node ${isRoot ? "is-root" : ""} ${selected ? "is-selected" : ""} ${item.status === "DONE" ? "is-done" : ""}`}
      style={{ ["--node" as string]: color }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        ctx.startEditing(item.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen((v) => !v);
      }}
    >
      <Handle type="target" position={Position.Left} id="l-t" className="mind-handle" />
      <Handle type="source" position={Position.Left} id="l-s" className="mind-handle" />
      <Handle type="target" position={Position.Right} id="r-t" className="mind-handle" />
      <Handle type="source" position={Position.Right} id="r-s" className="mind-handle" />

      <div className="mind-main">
        <span className="mind-icon">{item.type === "PAGE" ? "📄" : typeIcon(item)}</span>
        {editing ? (
          <input
            className="mind-input nodrag"
            autoFocus
            value={draft}
            placeholder="Digite um título…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit();
              if (e.key === "Escape") ctx.stopEditing();
            }}
          />
        ) : (
          <span className="mind-title">{item.title || <em className="muted">Sem título</em>}</span>
        )}

        <div className="mind-actions">
          <button
            className="mind-action-btn nodrag"
            title={item.type === "PAGE" ? "Abrir página" : "Abrir detalhes"}
            onClick={(e) => {
              e.stopPropagation();
              ctx.open(item.id);
            }}
          >
            <Maximize2 size={12} />
          </button>

          <button
            className={`mind-action-btn nodrag ${menuOpen ? "is-active" : ""}`}
            title="Opções do nó (3 pontinhos)"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
      </div>

      {/* Menu Contextual do Nó Estilo Notion */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="notion-action-menu nodrag"
          style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 200, zIndex: 100 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="notion-menu-header">Ramo do Mapa</div>

          {item.type !== "PAGE" ? (
            <button
              className="notion-menu-item"
              onClick={() => {
                setMenuOpen(false);
                ctx.convertToPage(item.id);
              }}
            >
              <span className="notion-menu-icon">
                <FileText size={14} />
              </span>
              <span>Converter em Página</span>
            </button>
          ) : (
            <button
              className="notion-menu-item"
              onClick={() => {
                setMenuOpen(false);
                ctx.open(item.id);
              }}
            >
              <span className="notion-menu-icon">
                <ExternalLink size={14} />
              </span>
              <span>Abrir Página Completa</span>
            </button>
          )}

          <button
            className="notion-menu-item"
            onClick={() => {
              setMenuOpen(false);
              ctx.createChildPage(item.id);
            }}
          >
            <span className="notion-menu-icon">
              <Plus size={14} />
            </span>
            <span>Criar Subpágina Vinculada</span>
          </button>

          <button
            className="notion-menu-item"
            onClick={() => {
              setMenuOpen(false);
              ctx.startEditing(item.id);
            }}
          >
            <span className="notion-menu-icon">
              <PenLine size={14} />
            </span>
            <span>Renomear</span>
          </button>

          <div className="notion-menu-divider" />

          <button
            className="notion-menu-item is-danger"
            onClick={() => {
              setMenuOpen(false);
              ctx.deleteNode(item.id);
            }}
          >
            <span className="notion-menu-icon">
              <Trash2 size={14} />
            </span>
            <span>Excluir Ramo</span>
          </button>
        </div>
      )}

      {(item.type === "PAGE" || item.status || item.schedule.start_time || item.attachments.length > 0 || item.links.length > 0) && (
        <div className="mind-badges">
          {item.type === "PAGE" && (
            <span className="mind-page-badge" title="Este nó é uma página completa">
              <FileText size={10} /> Página
            </span>
          )}
          {item.status && <span className={`status-pill status-${item.status}`}>{STATUS_LABEL[item.status]}</span>}
          {item.schedule.start_time && (
            <span className="meta-chip"><CalendarClock size={10} /> {formatWhen(item.schedule.start_time)}</span>
          )}
          {firstAttachment && (
            <a
              className="meta-chip nodrag"
              href={firstAttachment.url}
              target="_blank"
              rel="noopener noreferrer"
              title={firstAttachment.label}
              onClick={(e) => e.stopPropagation()}
            >
              <Paperclip size={10} /> {item.attachments.length}
            </a>
          )}
          {item.links.length > 0 && <span className="meta-chip"><Link2 size={10} /> {item.links.length}</span>}
        </div>
      )}

      {childCount > 0 && !isRoot && (
        <button
          className={`mind-collapse nodrag ${side === -1 ? "is-left" : ""}`}
          title={collapsed ? "Expandir" : "Recolher"}
          onClick={(e) => {
            e.stopPropagation();
            ctx.toggleCollapse(item.id);
          }}
        >
          {collapsed ? childCount : side === -1 ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
      )}
    </div>
  );
});

const nodeTypes = { mind: MindNodeView };

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

function MindMapInner({ rootId }: { rootId: string }) {
  const items = useStore((s) => s.items);
  const createItem = useStore((s) => s.createItem);
  const updateItem = useStore((s) => s.updateItem);
  const updateItems = useStore((s) => s.updateItems);
  const deleteItem = useStore((s) => s.deleteItem);
  const toggleLink = useStore((s) => s.toggleLink);
  const openDrawer = useStore((s) => s.openDrawer);
  const rf = useReactFlow();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<MindNode[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  const root = items[rootId];

  /* ---- scope: root + visible descendants ---- */
  const scope = useMemo(() => (root ? [root, ...descendantsOf(items, rootId)] : []), [items, root, rootId]);

  const visible = useMemo(() => {
    const ids = new Set(scope.map((s) => s.id));
    const hidden = new Set<string>();
    for (const it of scope) {
      let p = it.parent_id;
      while (p && ids.has(p)) {
        if (collapsed.has(p)) {
          hidden.add(it.id);
          break;
        }
        if (p === rootId) break;
        p = items[p]?.parent_id ?? null;
      }
    }
    return scope.filter((s) => !hidden.has(s.id));
  }, [scope, collapsed, items, rootId]);

  /* ---- first open: lay out nodes that were never placed ---- */
  useEffect(() => {
    if (!root) return;
    const unplaced = scope.filter((s) => !s.canvas);
    if (!unplaced.length) return;
    if (!root.canvas || unplaced.length > 3) {
      const pos = layoutTree(scope, rootId);
      updateItems(
        scope.map((s) => ({ id: s.id, patch: { canvas: { color: s.canvas?.color ?? null, ...pos[s.id] } } })),
      );
    } else {
      updateItems(
        unplaced.map((s) => {
          const parent = s.parent_id ? items[s.parent_id] : null;
          const px = parent?.canvas?.x ?? 0;
          const py = parent?.canvas?.y ?? 0;
          return { id: s.id, patch: { canvas: { x: px + COL_W, y: py + ROW_H, color: null } } };
        }),
      );
    }
  }, [scope, root, rootId, items, updateItems]);

  /* ---- derived colors and child counts ---- */
  const colorOf = useCallback(
    (it: ItemNode): string => {
      let cur: ItemNode | undefined = it;
      let guard = 0;
      while (cur && guard++ < 100) {
        if (cur.canvas?.color) return cur.canvas.color;
        if (cur.id === rootId) break;
        cur = cur.parent_id ? items[cur.parent_id] : undefined;
      }
      return PALETTE[0];
    },
    [items, rootId],
  );

  const childCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of scope) if (it.parent_id) c[it.parent_id] = (c[it.parent_id] ?? 0) + 1;
    return c;
  }, [scope]);

  /* ---- sync store → React Flow nodes (preserving selection) ---- */
  useEffect(() => {
    setNodes((prev) => {
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      const rootX = root?.canvas?.x ?? 0;
      return visible
        .filter((it) => it.canvas)
        .map<MindNode>((it) => ({
          id: it.id,
          type: "mind",
          position: { x: it.canvas!.x, y: it.canvas!.y },
          selected: sel.has(it.id),
          data: {
            item: it,
            color: colorOf(it),
            isRoot: it.id === rootId,
            editing: editingId === it.id,
            childCount: childCounts[it.id] ?? 0,
            collapsed: collapsed.has(it.id),
            side: it.canvas!.x < rootX ? -1 : 1,
          },
        }));
    });
  }, [visible, colorOf, rootId, editingId, childCounts, collapsed, root?.canvas?.x]);

  const edges = useMemo<Edge[]>(() => {
    const vis = new Set(visible.map((v) => v.id));
    const pos = new Map(visible.map((v) => [v.id, v.canvas]));
    const out: Edge[] = [];
    for (const it of visible) {
      if (it.id !== rootId && it.parent_id && vis.has(it.parent_id)) {
        const left = (pos.get(it.id)?.x ?? 0) < (pos.get(it.parent_id)?.x ?? 0);
        out.push({
          id: `t-${it.id}`,
          source: it.parent_id,
          target: it.id,
          sourceHandle: left ? "l-s" : "r-s",
          targetHandle: left ? "r-t" : "l-t",
          type: "default",
          deletable: false,
          style: { stroke: colorOf(it), strokeWidth: it.parent_id === rootId ? 3 : 2 },
        });
      }
      for (const l of it.links) {
        if (!vis.has(l)) continue;
        out.push({
          id: `l-${it.id}-${l}`,
          source: it.id,
          target: l,
          sourceHandle: "r-s",
          targetHandle: "l-t",
          type: "default",
          animated: true,
          className: "link-edge",
          data: { link: true },
        });
      }
    }
    return out;
  }, [visible, rootId, colorOf]);

  /* ---- interactions ---- */
  const onNodesChange = useCallback((changes: NodeChange<MindNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: MindNode, dragged: MindNode[]) => {
      const targets = dragged && dragged.length > 0 ? dragged : [node];
      updateItems(
        targets.map((n) => ({
          id: n.id,
          patch: { canvas: { ...(items[n.id]?.canvas ?? { x: 0, y: 0 }), x: n.position.x, y: n.position.y } },
        })),
      );
    },
    [items, updateItems],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) toggleLink(c.source, c.target);
    },
    [toggleLink],
  );

  const onEdgesDelete = useCallback(
    (es: Edge[]) => es.forEach((e) => e.data?.link && toggleLink(e.source, e.target)),
    [toggleLink],
  );

  const selectOnly = useCallback((id: string) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  }, []);

  const addChild = useCallback(
    (parentId: string) => {
      const parent = items[parentId];
      if (!parent) return;
      const rootX = root?.canvas?.x ?? 0;
      const kids = Object.values(items).filter((i) => i.parent_id === parentId && i.canvas);
      let dir = (parent.canvas?.x ?? 0) < rootX ? -1 : 1;
      if (parentId === rootId) {
        const right = kids.filter((k) => k.canvas!.x >= rootX).length;
        dir = right <= kids.length - right ? 1 : -1;
      }
      const sideKids = kids.filter((k) => (k.canvas!.x < (parent.canvas?.x ?? 0) ? -1 : 1) === dir);
      const y = sideKids.length ? Math.max(...sideKids.map((k) => k.canvas!.y)) + ROW_H : parent.canvas?.y ?? 0;
      const n = createItem({
        parent_id: parentId,
        type: "MINDMAP_NODE",
        title: "",
        project_id: parent.project_id,
        canvas: { x: (parent.canvas?.x ?? 0) + COL_W * dir, y, color: null },
      });
      if (collapsed.has(parentId)) setCollapsed((s) => { const c = new Set(s); c.delete(parentId); return c; });
      setEditingId(n.id);
      setTimeout(() => selectOnly(n.id), 0);
    },
    [items, root, rootId, createItem, collapsed, selectOnly],
  );

  const addSibling = useCallback(
    (id: string) => {
      const it = items[id];
      if (!it || !it.parent_id || id === rootId) return;
      const n = createItem({
        parent_id: it.parent_id,
        type: "MINDMAP_NODE",
        title: "",
        project_id: it.project_id,
        sort_order: it.sort_order + 0.5,
        canvas: { x: it.canvas?.x ?? 0, y: (it.canvas?.y ?? 0) + ROW_H, color: null },
      });
      setEditingId(n.id);
      setTimeout(() => selectOnly(n.id), 0);
    },
    [items, rootId, createItem, selectOnly],
  );

  const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);

  const removeSelected = useCallback(() => {
    const ids = selectedIds.filter((id) => id !== rootId);
    if (!ids.length) return;
    const withKids = ids.some((id) => (childCounts[id] ?? 0) > 0);
    if (withKids && !confirm("Alguns nós possuem ramos filhos. Excluir tudo?")) return;
    ids.forEach((id) => deleteItem(id));
  }, [selectedIds, rootId, childCounts, deleteItem]);

  const autoLayout = useCallback(() => {
    const pos = layoutTree(scope, rootId, collapsed);
    updateItems(
      Object.entries(pos).map(([id, p]) => ({ id, patch: { canvas: { ...(items[id]?.canvas ?? {}), ...p } } })),
    );
    setTimeout(() => rf.fitView({ duration: 400, padding: 0.2 }), 50);
  }, [scope, rootId, collapsed, items, updateItems, rf]);

  const setColor = (c: string) =>
    updateItems(selectedIds.map((id) => ({ id, patch: { canvas: { ...(items[id]?.canvas ?? { x: 0, y: 0 }), color: c } } })));

  const toTask = () =>
    updateItems(
      selectedIds.map((id) => ({ id, patch: { status: items[id]?.status ?? "TODO", project_id: items[id]?.project_id ?? root?.project_id ?? null } })),
    );

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true], select") || useStore.getState().drawerId) return;
      if (!wrapRef.current) return;
      const sel = selectedIds[0];
      if (e.key === "Tab" && sel) {
        e.preventDefault();
        addChild(sel);
      } else if (e.key === "Enter" && sel) {
        e.preventDefault();
        if (sel === rootId) addChild(sel);
        else addSibling(sel);
      } else if ((e.key === "F2" || e.key === " ") && sel) {
        e.preventDefault();
        setEditingId(sel);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, addChild, addSibling, removeSelected, rootId]);

  const ctx = useMemo<Ctx>(
    () => ({
      rename: (id, title) => updateItem(id, { title }),
      stopEditing: () => setEditingId(null),
      startEditing: (id) => setEditingId(id),
      open: (id) => openDrawer(id),
      toggleCollapse: (id) =>
        setCollapsed((s) => {
          const c = new Set(s);
          if (c.has(id)) c.delete(id);
          else c.add(id);
          return c;
        }),
      convertToPage: (id) => {
        updateItem(id, { type: "PAGE", icon: "📄" });
        openDrawer(id);
      },
      createChildPage: (parentId) => {
        const n = createItem({
          parent_id: parentId,
          title: "Nova subpágina vinculada",
          type: "PAGE",
          icon: "📄",
          content: "<p>Subpágina criada a partir do mapa mental...</p>",
        });
        openDrawer(n.id);
      },
      deleteNode: (id) => deleteItem(id),
    }),
    [updateItem, openDrawer, createItem, deleteItem],
  );

  if (!root) return <div className="empty-state"><h1>Mapa não encontrado</h1></div>;

  return (
    <MindCtx.Provider value={ctx}>
      <div className="canvas-wrap" ref={wrapRef}>
        <ReactFlow<MindNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onPaneClick={() => setEditingId(null)}
          onPaneContextMenu={(e) => e.preventDefault()}
          panOnDrag={[1, 2]}
          selectionOnDrag={true}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode={null}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
          minZoom={0.1}
          maxZoom={2.5}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} className="canvas-bg" />
          <MiniMap
            pannable
            zoomable
            className="canvas-minimap"
            nodeColor={(n) => (n as MindNode).data?.color ?? "#888"}
            maskColor="var(--minimap-mask)"
          />
          <Controls showInteractive={false} className="canvas-controls" />

          <Panel position="top-left" className="canvas-panel glass">
            <span className="canvas-root-title">{typeIcon(root)} {root.title || "Sem título"}</span>
            <ViewSwitcher id={root.id} />
          </Panel>

          <Panel position="top-right" className="canvas-panel glass">
            <button id="canvas-add-child" className="btn btn-ghost btn-xs" onClick={() => addChild(selectedIds[0] ?? rootId)} title="Novo ramo (Tab)">
              <Plus size={14} /> Ramo
            </button>
            <button id="canvas-auto-layout" className="btn btn-ghost btn-xs" onClick={autoLayout} title="Auto-organizar">
              <Wand2 size={14} /> Organizar
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => rf.fitView({ duration: 400, padding: 0.2 })} title="Enquadrar tudo">
              <Maximize size={14} />
            </button>
          </Panel>

          {selectedIds.length > 0 && (
            <Panel position="bottom-center" className="canvas-panel canvas-selbar glass">
              <span className="muted small">{selectedIds.length} selecionado(s)</span>
              <div className="swatches">
                {PALETTE.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} onClick={() => setColor(c)} title="Cor do ramo" />
                ))}
              </div>
              <button id="canvas-to-task" className="btn btn-ghost btn-xs" onClick={toTask} title="Enviar para o Kanban">
                <KanbanSquare size={14} /> Virar tarefa
              </button>
              {selectedIds.length === 1 && (
                <button className="btn btn-ghost btn-xs" onClick={() => openDrawer(selectedIds[0])}>
                  <Maximize2 size={14} /> Abrir
                </button>
              )}
              <button className="icon-btn icon-btn-danger" onClick={removeSelected} title="Excluir (Del)">
                <Trash2 size={14} />
              </button>
            </Panel>
          )}

          <Panel position="bottom-left" className="canvas-hints">
            <kbd>Botão direito</kbd> arrastar canvas · <kbd>Botão esquerdo</kbd> selecionar vários nós · <kbd>Tab</kbd> filho · <kbd>Enter</kbd> irmão · <kbd>F2</kbd> renomear · <kbd>Del</kbd> excluir · scroll = zoom
          </Panel>
        </ReactFlow>
      </div>
    </MindCtx.Provider>
  );
}

export default function MindMap({ rootId }: { rootId: string }) {
  return (
    <ReactFlowProvider>
      <MindMapInner rootId={rootId} />
    </ReactFlowProvider>
  );
}
