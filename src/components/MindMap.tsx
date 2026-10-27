"use client";

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
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
  Circle,
  Diamond,
  Download,
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
  Square,
  Trash2,
  Wand2,
  Workflow,
} from "lucide-react";
import { descendantsOf, useStore } from "@/lib/store";
import { STATUS_LABEL } from "@/lib/types";
import type { ItemNode, ProcessShape } from "@/lib/types";
import {
  MIN_GAP_Y,
  LEVEL_GAP_X,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  estimateNodeSize,
  layoutTree,
  type NodeDimensions,
} from "@/lib/layout";
import { formatWhen, typeIcon } from "@/lib/format";
import { downloadMindMapJson } from "@/lib/exporters/mindmap";
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
  isDragging?: boolean;
};
type MindNode = Node<MindData, "mind">;

type ProcessData = {
  item: ItemNode;
  color: string;
  shape: ProcessShape;
  editing: boolean;
  width: number;
  height: number;
};
type ProcessNode = Node<ProcessData, "process">;

interface DropIndicator {
  x: number;
  y: number;
  width: number;
  targetIndex: number;
}

interface Ctx {
  rename(id: string, title: string): void;
  stopEditing(): void;
  startEditing(id: string): void;
  open(id: string): void;
  toggleCollapse(id: string): void;
  convertToPage(id: string): void;
  createChildPage(id: string): void;
  deleteNode(id: string): void;
  reportDimensions(id: string, dim: NodeDimensions): void;
  updateDimensions(id: string, width: number, height: number): void;
  quickAddConnected(
    sourceId: string,
    shape: ProcessShape,
    direction: "right" | "bottom" | "left" | "top",
  ): void;
}
const MindCtx = createContext<Ctx | null>(null);

/* ------------------------------------------------------------------ */
/* Node: Mind Map Branch                                              */
/* ------------------------------------------------------------------ */

const MindNodeView = memo(function MindNodeView({ data, selected }: NodeProps<MindNode>) {
  const ctx = useContext(MindCtx)!;
  const { item, color, isRoot, editing, childCount, collapsed, side, isDragging } = data;
  const [draft, setDraft] = useState(item.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, []);

  /* ---- Modo Edição Imediato com Auto-foco, Seleção Completa e Auto-resize ---- */
  useEffect(() => {
    if (editing) {
      setDraft(item.title);
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.select();
          adjustTextareaHeight();
        }
      }, 25);
      return () => clearTimeout(timer);
    }
  }, [editing, item.title, adjustTextareaHeight]);

  useEffect(() => {
    if (editing) {
      adjustTextareaHeight();
    }
  }, [editing, draft, adjustTextareaHeight]);

  /* ---- Medição de Dimensões Reais via ResizeObserver ---- */
  useEffect(() => {
    if (!nodeRef.current) return;
    const el = nodeRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.borderBoxSize?.[0]?.inlineSize || el.offsetWidth);
        const height = Math.round(entry.borderBoxSize?.[0]?.blockSize || el.offsetHeight);
        if (width > 0 && height > 0) {
          ctx.reportDimensions(item.id, { width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.id, ctx]);

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
    ctx.rename(item.id, draft.trim() || (isRoot ? "Mapa Mental" : "Sem título"));
    ctx.stopEditing();
  };

  const firstAttachment = item.attachments[0];

  return (
    <div
      ref={nodeRef}
      className={`mind-node ${isRoot ? "is-root" : ""} ${selected ? "is-selected" : ""} ${item.status === "DONE" ? "is-done" : ""} ${isDragging ? "is-dragging" : ""}`}
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
          <textarea
            ref={textareaRef}
            className="mind-input nodrag"
            autoFocus
            rows={1}
            value={draft}
            placeholder="Digite um título…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Shift + Enter ou Alt + Enter: permite quebra de linha normal (\n)
              if (e.key === "Enter" && (e.shiftKey || e.altKey)) {
                return;
              }
              // Enter isolado: confirma e fecha edição
              if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                commit();
                return;
              }
              // Escape: cancela edição
              if (e.key === "Escape") {
                e.preventDefault();
                ctx.stopEditing();
                return;
              }
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
            <span>Renomear (F2)</span>
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

/* ------------------------------------------------------------------ */
/* Node: Process Flowchart Node (Módulo de Fluxograma)                */
/* ------------------------------------------------------------------ */

const ProcessNodeView = memo(function ProcessNodeView({ data, selected }: NodeProps<ProcessNode>) {
  const ctx = useContext(MindCtx)!;
  const { item, color, shape, editing, width, height } = data;
  const [draft, setDraft] = useState(item.title);
  const [popoverAnchor, setPopoverAnchor] = useState<"right" | "bottom" | "left" | "top" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const defaultPlaceholder =
    shape === "diamond" ? "Decisão?" : shape === "circle" ? "Início / Fim" : "Etapa do Processo";

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    if (editing) {
      setDraft(item.title);
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.select();
          adjustTextareaHeight();
        }
      }, 25);
      return () => clearTimeout(timer);
    }
  }, [editing, item.title, adjustTextareaHeight]);

  useEffect(() => {
    if (editing) {
      adjustTextareaHeight();
    }
  }, [editing, draft, adjustTextareaHeight]);

  /* ---- Fecha popover de quick-add ao clicar fora ou desselecionar ---- */
  useEffect(() => {
    if (!popoverAnchor) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as unknown as HTMLElement)) {
        setPopoverAnchor(null);
      }
    };
    window.addEventListener("pointerdown", handleOutside);
    return () => window.removeEventListener("pointerdown", handleOutside);
  }, [popoverAnchor]);

  useEffect(() => {
    if (!selected && popoverAnchor) {
      setPopoverAnchor(null);
    }
  }, [selected, popoverAnchor]);

  const commit = () => {
    ctx.rename(item.id, draft.trim() || defaultPlaceholder);
    ctx.stopEditing();
  };

  const handleResizeEnd = (_: unknown, params: { width: number; height: number }) => {
    ctx.updateDimensions(item.id, Math.round(params.width), Math.round(params.height));
  };

  const toggleAnchor = (dir: "right" | "bottom" | "left" | "top") => {
    setPopoverAnchor((cur) => (cur === dir ? null : dir));
  };

  return (
    <div
      ref={nodeRef}
      className={`process-node shape-${shape} ${selected ? "is-selected" : ""}`}
      style={{
        ["--node" as string]: color,
        width: width || (shape === "diamond" ? 140 : shape === "circle" ? 130 : 160),
        minHeight: height || (shape === "diamond" ? 100 : shape === "circle" ? 70 : 80),
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        ctx.startEditing(item.id);
      }}
    >
      <NodeResizer
        minWidth={80}
        minHeight={40}
        isVisible={selected}
        color={color}
        onResizeEnd={handleResizeEnd}
      />

      {/* 4 Pontos de Ancoragem (Norte, Sul, Leste, Oeste) para roteamento e Quick-Add */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-t"
        className={`process-handle ${popoverAnchor === "top" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("top");
        }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-s"
        className={`process-handle ${popoverAnchor === "top" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("top");
        }}
      />

      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-t"
        className={`process-handle ${popoverAnchor === "bottom" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("bottom");
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-s"
        className={`process-handle ${popoverAnchor === "bottom" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("bottom");
        }}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="left-t"
        className={`process-handle ${popoverAnchor === "left" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("left");
        }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left-s"
        className={`process-handle ${popoverAnchor === "left" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("left");
        }}
      />

      <Handle
        type="target"
        position={Position.Right}
        id="right-t"
        className={`process-handle ${popoverAnchor === "right" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("right");
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-s"
        className={`process-handle ${popoverAnchor === "right" ? "is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnchor("right");
        }}
      />

      {/* Menu Flutuante Quick-Add ao clicar nos pontos de conexão */}
      {popoverAnchor && (
        <div
          ref={popoverRef}
          className={`process-quick-add-popover popover-${popoverAnchor} nodrag nopan`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="quick-add-btn"
            title="Retângulo (Ação / Processo)"
            onClick={(e) => {
              e.stopPropagation();
              const dir = popoverAnchor;
              setPopoverAnchor(null);
              ctx.quickAddConnected(item.id, "rectangle", dir);
            }}
          >
            <Square size={13} />
          </button>
          <button
            className="quick-add-btn"
            title="Losango (Decisão)"
            onClick={(e) => {
              e.stopPropagation();
              const dir = popoverAnchor;
              setPopoverAnchor(null);
              ctx.quickAddConnected(item.id, "diamond", dir);
            }}
          >
            <Diamond size={13} />
          </button>
          <button
            className="quick-add-btn"
            title="Círculo / Pílula (Início / Fim)"
            onClick={(e) => {
              e.stopPropagation();
              const dir = popoverAnchor;
              setPopoverAnchor(null);
              ctx.quickAddConnected(item.id, "circle", dir);
            }}
          >
            <Circle size={13} />
          </button>
        </div>
      )}

      {/* Losango com background SVG para preservar texto plano */}
      {shape === "diamond" && (
        <svg className="process-diamond-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="50,2 98,50 50,98 2,50" className="process-diamond-polygon" />
        </svg>
      )}

      {/* Botão de abrir detalhes na gaveta lateral */}
      <button
        className="process-open-btn nodrag"
        title="Abrir detalhes do nó (Gaveta)"
        onClick={(e) => {
          e.stopPropagation();
          ctx.open(item.id);
        }}
      >
        <Maximize2 size={11} />
      </button>

      <div className="process-content">
        {editing ? (
          <textarea
            ref={textareaRef}
            className="process-input nodrag"
            autoFocus
            rows={1}
            value={draft}
            placeholder={defaultPlaceholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.shiftKey || e.altKey)) return;
              if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                commit();
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                ctx.stopEditing();
                return;
              }
            }}
          />
        ) : (
          <span className="process-title">{item.title || <em className="muted">{defaultPlaceholder}</em>}</span>
        )}

        {(item.status || item.schedule?.start_time || (item.attachments?.length ?? 0) > 0) && (
          <div className="mind-badges" style={{ marginTop: 4, justifyContent: "center" }}>
            {item.status && <span className={`status-pill status-${item.status}`}>{STATUS_LABEL[item.status]}</span>}
            {item.schedule?.start_time && (
              <span className="meta-chip"><CalendarClock size={9} /> {formatWhen(item.schedule.start_time)}</span>
            )}
            {(item.attachments?.length ?? 0) > 0 && (
              <span className="meta-chip"><Paperclip size={9} /> {item.attachments.length}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const nodeTypes = { mind: MindNodeView, process: ProcessNodeView };

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
  const [nodes, setNodes] = useState<(MindNode | ProcessNode)[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [processMenuOpen, setProcessMenuOpen] = useState(false);

  /* ---- Cache de Dimensões Reais dos Nós ---- */
  const dimensionsRef = useRef<Map<string, NodeDimensions>>(new Map());
  const relayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- Drag to reorder state ---- */
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dragRef = useRef<{
    nodeId: string;
    parentId: string | null;
    side: 1 | -1;
    fixedX: number;
    siblings: ItemNode[];
    initialIndex: number;
    isProcessNode?: boolean;
  } | null>(null);

  const exportJson = useCallback(() => {
    try {
      const n = downloadMindMapJson(useStore.getState().items, rootId);
      setExportMsg(`${n} nós exportados`);
    } catch (err) {
      console.warn("[export] falha ao exportar mapa:", err);
      setExportMsg("Falha ao exportar");
    }
    setTimeout(() => setExportMsg(null), 2500);
  }, [rootId]);

  const root = items[rootId];

  /* ---- scope: nós da árvore hierárquica (exclui formas de processo) ---- */
  const mindScope = useMemo(
    () => (root ? [root, ...descendantsOf(items, rootId).filter((i) => !i.canvas?.shape)] : []),
    [items, root, rootId],
  );

  /* ---- formas de processo independentes vinculadas ao canvas ---- */
  const processScope = useMemo(() => {
    return Object.values(items).filter((i) => {
      if (!i.canvas?.shape) return false;
      return i.parent_id === rootId || (root?.project_id && i.project_id === root.project_id);
    });
  }, [items, rootId, root?.project_id]);

  const visibleMind = useMemo(() => {
    const ids = new Set(mindScope.map((s) => s.id));
    const hidden = new Set<string>();
    for (const it of mindScope) {
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
    return mindScope.filter((s) => !hidden.has(s.id));
  }, [mindScope, collapsed, items, rootId]);

  /* ---- first open: lay out mind tree nodes with deterministic auto-layout ---- */
  useEffect(() => {
    if (!root) return;
    const unplaced = mindScope.filter((s) => !s.canvas);
    if (!unplaced.length) return;
    const pos = layoutTree(mindScope, rootId, collapsed, dimensionsRef.current);
    updateItems(
      mindScope.map((s) => ({
        id: s.id,
        patch: { canvas: { color: s.canvas?.color ?? null, ...pos[s.id] } },
      })),
    );
  }, [mindScope, root, rootId, collapsed, updateItems]);

  /* ---- Relayout dinâmico quando dimensões mudam (ex: texto multilinhas) ---- */
  const scheduleRelayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      const currentItems = useStore.getState().items;
      const currentScope = currentItems[rootId]
        ? [currentItems[rootId], ...descendantsOf(currentItems, rootId).filter((i) => !i.canvas?.shape)]
        : [];
      if (!currentScope.length) return;

      const pos = layoutTree(currentScope, rootId, collapsed, dimensionsRef.current);
      const patches: { id: string; patch: Partial<ItemNode> }[] = [];
      for (const [id, p] of Object.entries(pos)) {
        const cur = currentItems[id];
        if (cur?.canvas && (Math.abs(cur.canvas.x - p.x) > 1 || Math.abs(cur.canvas.y - p.y) > 1)) {
          patches.push({ id, patch: { canvas: { ...cur.canvas, x: p.x, y: p.y } } });
        }
      }
      if (patches.length > 0) {
        updateItems(patches);
      }
    }, 60);
  }, [rootId, collapsed, updateItems]);

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
    for (const it of mindScope) if (it.parent_id) c[it.parent_id] = (c[it.parent_id] ?? 0) + 1;
    return c;
  }, [mindScope]);

  /* ---- sync store → React Flow nodes (Mind Nodes + Process Flow Nodes) ---- */
  useEffect(() => {
    setNodes((prev) => {
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      const rootX = root?.canvas?.x ?? 0;

      const treeNodes = visibleMind
        .filter((it) => it.canvas)
        .map<MindNode>((it) => ({
          id: it.id,
          type: "mind",
          position: { x: it.canvas!.x, y: it.canvas!.y },
          selected: sel.has(it.id),
          className: `react-flow__node-mind ${activeDragId === it.id ? "is-dragging" : ""}`,
          data: {
            item: it,
            color: colorOf(it),
            isRoot: it.id === rootId,
            editing: editingId === it.id,
            childCount: childCounts[it.id] ?? 0,
            collapsed: collapsed.has(it.id),
            side: it.canvas!.x < rootX ? -1 : 1,
            isDragging: activeDragId === it.id,
          },
        }));

      const flowNodes = processScope
        .filter((it) => it.canvas)
        .map<ProcessNode>((it) => ({
          id: it.id,
          type: "process",
          position: { x: it.canvas!.x, y: it.canvas!.y },
          selected: sel.has(it.id),
          data: {
            item: it,
            color: colorOf(it),
            shape: it.canvas!.shape || "rectangle",
            editing: editingId === it.id,
            width: it.canvas!.width || (it.canvas!.shape === "diamond" ? 140 : it.canvas!.shape === "circle" ? 130 : 160),
            height: it.canvas!.height || (it.canvas!.shape === "diamond" ? 100 : it.canvas!.shape === "circle" ? 70 : 80),
          },
        }));

      return [...treeNodes, ...flowNodes];
    });
  }, [visibleMind, processScope, colorOf, rootId, editingId, childCounts, collapsed, root?.canvas?.x, activeDragId]);

  /* ---- Edges (Curvas de Árvore + Conectores Direcionais de Processo) ---- */
  const edges = useMemo<Edge[]>(() => {
    const allVis = new Set([...visibleMind.map((v) => v.id), ...processScope.map((p) => p.id)]);
    const pos = new Map([...visibleMind, ...processScope].map((v) => [v.id, v.canvas]));
    const out: Edge[] = [];

    // Árvore do mapa mental (curvas Bezier)
    for (const it of visibleMind) {
      if (it.id !== rootId && it.parent_id && allVis.has(it.parent_id)) {
        const left = (pos.get(it.id)?.x ?? 0) < (pos.get(it.parent_id)?.x ?? 0);
        const isRootChild = it.parent_id === rootId;
        out.push({
          id: `t-${it.id}`,
          source: it.parent_id,
          target: it.id,
          sourceHandle: left ? "l-s" : "r-s",
          targetHandle: left ? "r-t" : "l-t",
          type: "default",
          deletable: false,
          style: {
            stroke: isRootChild ? colorOf(it) : `color-mix(in srgb, ${colorOf(it)} 55%, transparent)`,
            strokeWidth: isRootChild ? 3 : 2,
          },
        });
      }
    }

    // Links manuais e conexões de fluxo entre nós
    for (const it of [...visibleMind, ...processScope]) {
      for (const l of it.links) {
        if (!allVis.has(l)) continue;
        const targetItem = items[l];
        const isProcess = !!it.canvas?.shape || !!targetItem?.canvas?.shape;

        let sourceHandle: string | undefined = undefined;
        let targetHandle: string | undefined = undefined;

        if (isProcess) {
          const sC = it.canvas ?? { x: 0, y: 0 };
          const tC = targetItem?.canvas ?? { x: 0, y: 0 };
          const sW = sC.width || (sC.shape === "diamond" ? 140 : sC.shape === "circle" ? 130 : 160);
          const sH = sC.height || (sC.shape === "diamond" ? 100 : sC.shape === "circle" ? 70 : 80);
          const tW = tC.width || (tC.shape === "diamond" ? 140 : tC.shape === "circle" ? 130 : 160);
          const tH = tC.height || (tC.shape === "diamond" ? 100 : tC.shape === "circle" ? 70 : 80);

          const sCenterX = sC.x + sW / 2;
          const sCenterY = sC.y + sH / 2;
          const tCenterX = tC.x + tW / 2;
          const tCenterY = tC.y + tH / 2;

          const dx = tCenterX - sCenterX;
          const dy = tCenterY - sCenterY;

          if (Math.abs(dx) >= Math.abs(dy)) {
            sourceHandle = dx >= 0 ? "right-s" : "left-s";
            targetHandle = dx >= 0 ? "left-t" : "right-t";
          } else {
            sourceHandle = dy >= 0 ? "bottom-s" : "top-s";
            targetHandle = dy >= 0 ? "top-t" : "bottom-t";
          }

          if (!it.canvas?.shape) {
            sourceHandle = dx >= 0 ? "r-s" : "l-s";
          }
          if (!targetItem?.canvas?.shape) {
            targetHandle = dx >= 0 ? "l-t" : "r-t";
          }
        }

        out.push({
          id: `l-${it.id}-${l}`,
          source: it.id,
          target: l,
          sourceHandle,
          targetHandle,
          type: isProcess ? "smoothstep" : "default",
          animated: !isProcess,
          markerEnd: isProcess
            ? {
                type: MarkerType.ArrowClosed,
                width: 15,
                height: 15,
                color: colorOf(targetItem || it),
              }
            : undefined,
          style: {
            stroke: colorOf(targetItem || it),
            strokeWidth: 2,
          },
          data: { link: true },
        });
      }
    }

    return out;
  }, [visibleMind, processScope, items, rootId, colorOf]);

  /* ---- Interactions: Trava X apenas em nós filhos do mapa; libera formas de processo ---- */
  const onNodesChange = useCallback((changes: NodeChange<MindNode | ProcessNode>[]) => {
    const currentDrag = dragRef.current;
    if (currentDrag && !currentDrag.isProcessNode) {
      for (const change of changes) {
        if (change.type === "position" && change.id === currentDrag.nodeId && change.position) {
          change.position.x = currentDrag.fixedX;
        }
      }
    }
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  /* ---- Drag Start: Setup sibling list para mapa ou modo livre para processo ---- */
  const onNodeDragStart = useCallback(
    (_: unknown, node: MindNode | ProcessNode) => {
      const item = items[node.id];
      if (!item) return;

      // Forma de processo: posicionamento livre no canvas
      if (item.canvas?.shape) {
        dragRef.current = {
          nodeId: node.id,
          parentId: null,
          side: 1,
          fixedX: node.position.x,
          siblings: [],
          initialIndex: 0,
          isProcessNode: true,
        };
        setActiveDragId(node.id);
        return;
      }

      if (node.id === rootId) {
        dragRef.current = null;
        setActiveDragId(rootId);
        return;
      }

      if (!item.parent_id) return;

      const rootX = root?.canvas?.x ?? 0;
      const side: 1 | -1 = node.position.x < rootX ? -1 : 1;

      let siblings: ItemNode[];
      if (item.parent_id === rootId) {
        const rootKids = Object.values(items).filter((i) => i.parent_id === rootId && i.canvas && !i.canvas.shape);
        siblings = rootKids.filter((k) => (side === -1 ? k.canvas!.x < rootX : k.canvas!.x >= rootX));
      } else {
        siblings = Object.values(items).filter((i) => i.parent_id === item.parent_id && i.canvas && !i.canvas.shape);
      }
      siblings.sort((a, b) => a.sort_order - b.sort_order);

      const initialIndex = siblings.findIndex((s) => s.id === node.id);

      dragRef.current = {
        nodeId: node.id,
        parentId: item.parent_id,
        side,
        fixedX: node.position.x,
        siblings,
        initialIndex: initialIndex >= 0 ? initialIndex : 0,
        isProcessNode: false,
      };

      setActiveDragId(node.id);
    },
    [items, rootId, root?.canvas?.x],
  );

  /* ---- Drag Move: Linha guia em irmãos do mapa mental ---- */
  const onNodeDrag = useCallback(
    (_: unknown, node: MindNode | ProcessNode) => {
      const drag = dragRef.current;
      if (!drag || drag.isProcessNode || node.id === rootId) return;

      const others = drag.siblings.filter((s) => s.id !== node.id);
      if (others.length === 0) {
        setDropIndicator(null);
        return;
      }

      const otherNodes = others
        .map((s) => {
          const y = s.canvas?.y ?? 0;
          const dim = dimensionsRef.current.get(s.id) || estimateNodeSize(s, false);
          return {
            id: s.id,
            y,
            height: dim.height,
            width: dim.width,
            centerY: y + dim.height / 2,
          };
        })
        .sort((a, b) => a.y - b.y);

      const currentY = node.position.y;
      const k = otherNodes.length;
      let targetIndex = 0;
      let indicatorY = otherNodes[0].y - MIN_GAP_Y / 2;

      if (currentY < otherNodes[0].centerY) {
        targetIndex = 0;
        indicatorY = otherNodes[0].y - MIN_GAP_Y / 2;
      } else if (currentY >= otherNodes[k - 1].centerY) {
        targetIndex = k;
        indicatorY = otherNodes[k - 1].y + otherNodes[k - 1].height + MIN_GAP_Y / 2;
      } else {
        for (let i = 0; i < k - 1; i++) {
          if (currentY >= otherNodes[i].centerY && currentY < otherNodes[i + 1].centerY) {
            targetIndex = i + 1;
            indicatorY = otherNodes[i].y + otherNodes[i].height + MIN_GAP_Y / 2;
            break;
          }
        }
      }

      setDropIndicator({
        x: drag.fixedX,
        y: indicatorY,
        width: otherNodes[0]?.width || DEFAULT_NODE_WIDTH,
        targetIndex,
      });
    },
    [rootId],
  );

  /* ---- Drag Stop: Salva nova posição ---- */
  const onNodeDragStop = useCallback(
    (_: unknown, node: MindNode | ProcessNode) => {
      setActiveDragId(null);
      const indicator = dropIndicator;
      setDropIndicator(null);
      const drag = dragRef.current;
      dragRef.current = null;

      // Forma de processo: salva coordenadas livres no canvas
      if (items[node.id]?.canvas?.shape) {
        updateItem(node.id, {
          canvas: {
            ...(items[node.id]?.canvas ?? { x: 0, y: 0 }),
            x: node.position.x,
            y: node.position.y,
          },
        });
        return;
      }

      if (node.id === rootId) {
        const dx = node.position.x - (root?.canvas?.x ?? 0);
        const dy = node.position.y - (root?.canvas?.y ?? 0);
        if (dx === 0 && dy === 0) return;

        const newRootCanvas = { ...(root?.canvas ?? { color: null }), x: node.position.x, y: node.position.y };
        const updatedItems = { ...items, [rootId]: { ...root, canvas: newRootCanvas } };

        const newPositions = layoutTree(updatedItems, rootId, collapsed, dimensionsRef.current);
        updateItems(
          Object.entries(newPositions).map(([id, p]) => ({
            id,
            patch: { canvas: { ...(items[id]?.canvas ?? {}), ...p } },
          })),
        );
        return;
      }

      if (!drag || drag.isProcessNode) return;

      const others = drag.siblings.filter((s) => s.id !== node.id);
      const targetIdx = indicator ? indicator.targetIndex : drag.initialIndex;

      const draggedItem = items[node.id];
      if (!draggedItem) return;

      const reordered = [
        ...others.slice(0, targetIdx),
        draggedItem,
        ...others.slice(targetIdx),
      ];

      const updatedItems = { ...items };
      reordered.forEach((s, idx) => {
        updatedItems[s.id] = { ...updatedItems[s.id], sort_order: idx * 10 };
      });

      const newPositions = layoutTree(updatedItems, rootId, collapsed, dimensionsRef.current);

      const patches: { id: string; patch: Partial<ItemNode> }[] = [];
      const reorderedIds = new Set(reordered.map((s) => s.id));

      reordered.forEach((s, idx) => {
        const p = newPositions[s.id];
        patches.push({
          id: s.id,
          patch: {
            sort_order: idx * 10,
            canvas: { ...(s.canvas ?? {}), ...(p ?? { x: s.canvas?.x ?? 0, y: s.canvas?.y ?? 0 }) },
          },
        });
      });

      for (const [id, p] of Object.entries(newPositions)) {
        if (reorderedIds.has(id)) continue;
        const cur = items[id];
        if (!cur || !cur.canvas || cur.canvas.x !== p.x || cur.canvas.y !== p.y) {
          patches.push({
            id,
            patch: { canvas: { ...(cur?.canvas ?? {}), ...p } },
          });
        }
      }

      if (patches.length > 0) {
        updateItems(patches);
      }
    },
    [dropIndicator, rootId, root, items, collapsed, updateItems],
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

  /* ---- addChild (Ramo do Mapa): Auto-layout e modo edição imediato ---- */
  const addChild = useCallback(
    (parentId: string) => {
      const parent = items[parentId];
      if (!parent) return;
      const rootX = root?.canvas?.x ?? 0;
      const kids = Object.values(items).filter((i) => i.parent_id === parentId && !i.canvas?.shape);

      let dir: 1 | -1 = (parent.canvas?.x ?? 0) < rootX ? -1 : 1;
      if (parentId === rootId) {
        const right = kids.filter((k) => (k.canvas?.x ?? rootX) >= rootX).length;
        dir = right <= kids.length - right ? 1 : -1;
      }

      const maxOrder = kids.reduce((m, s) => Math.max(m, s.sort_order), -1);

      const n = createItem({
        parent_id: parentId,
        type: "MINDMAP_NODE",
        title: "Novo ramo",
        project_id: parent.project_id,
        sort_order: maxOrder + 10,
        canvas: { x: (parent.canvas?.x ?? 0) + (DEFAULT_NODE_WIDTH + LEVEL_GAP_X) * dir, y: parent.canvas?.y ?? 0, color: null },
      });

      const nextCollapsed = new Set(collapsed);
      if (nextCollapsed.has(parentId)) {
        nextCollapsed.delete(parentId);
        setCollapsed(nextCollapsed);
      }

      const updatedItems = { ...items, [n.id]: n };
      const newPositions = layoutTree(updatedItems, rootId, nextCollapsed, dimensionsRef.current);

      updateItems(
        Object.entries(newPositions).map(([id, p]) => ({
          id,
          patch: { canvas: { ...(updatedItems[id]?.canvas ?? {}), ...p } },
        })),
      );

      setEditingId(n.id);
      setTimeout(() => selectOnly(n.id), 0);
    },
    [items, root, rootId, createItem, collapsed, updateItems, selectOnly],
  );

  /* ---- addSibling (Irmão do Mapa): Insert sibling e run layoutTree ---- */
  const addSibling = useCallback(
    (id: string) => {
      const it = items[id];
      if (!it || !it.parent_id || id === rootId) return;

      const parent = items[it.parent_id];
      if (!parent) return;

      const siblings = Object.values(items)
        .filter((i) => i.parent_id === it.parent_id && !i.canvas?.shape)
        .sort((a, b) => a.sort_order - b.sort_order);

      const itIndex = siblings.findIndex((s) => s.id === id);
      const insertIndex = itIndex >= 0 ? itIndex + 1 : siblings.length;

      const n = createItem({
        parent_id: it.parent_id,
        type: "MINDMAP_NODE",
        title: "Novo ramo",
        project_id: it.project_id,
        sort_order: it.sort_order + 5,
        canvas: { x: it.canvas?.x ?? 0, y: (it.canvas?.y ?? 0) + DEFAULT_NODE_HEIGHT + MIN_GAP_Y, color: null },
      });

      const reordered = [...siblings.slice(0, insertIndex), n, ...siblings.slice(insertIndex)];
      const updatedItems = { ...items, [n.id]: n };
      reordered.forEach((s, idx) => {
        updatedItems[s.id] = { ...updatedItems[s.id], sort_order: idx * 10 };
      });

      const newPositions = layoutTree(updatedItems, rootId, collapsed, dimensionsRef.current);

      const patches: { id: string; patch: Partial<ItemNode> }[] = [];
      reordered.forEach((s, idx) => {
        patches.push({
          id: s.id,
          patch: {
            sort_order: idx * 10,
            canvas: { ...(s.canvas ?? {}), ...(newPositions[s.id] ?? {}) },
          },
        });
      });
      for (const [otherId, p] of Object.entries(newPositions)) {
        if (!reordered.some((s) => s.id === otherId)) {
          patches.push({
            id: otherId,
            patch: { canvas: { ...(items[otherId]?.canvas ?? {}), ...p } },
          });
        }
      }

      updateItems(patches);
      setEditingId(n.id);
      setTimeout(() => selectOnly(n.id), 0);
    },
    [items, rootId, createItem, collapsed, updateItems, selectOnly],
  );

  /* ---- Adicionar Forma de Processo / Fluxograma ---- */
  const addProcessNode = useCallback(
    (shape: ProcessShape) => {
      setProcessMenuOpen(false);
      const vp = rf.getViewport();
      const wrapEl = wrapRef.current;
      const w = wrapEl?.offsetWidth || 800;
      const h = wrapEl?.offsetHeight || 600;

      // Ponto central da visualização atual na escala do canvas
      const spawnX = Math.round((-vp.x + w / 2) / vp.zoom - 80 + (Math.random() * 40 - 20));
      const spawnY = Math.round((-vp.y + h / 2) / vp.zoom - 40 + (Math.random() * 40 - 20));

      const title =
        shape === "diamond" ? "Decisão?" : shape === "circle" ? "Início / Fim" : "Etapa do Processo";

      const defaultW = shape === "diamond" ? 140 : shape === "circle" ? 130 : 160;
      const defaultH = shape === "diamond" ? 100 : shape === "circle" ? 70 : 80;

      const n = createItem({
        parent_id: rootId,
        project_id: root?.project_id,
        type: "MINDMAP_NODE",
        title,
        canvas: {
          x: spawnX,
          y: spawnY,
          shape,
          width: defaultW,
          height: defaultH,
          color: PALETTE[shape === "diamond" ? 4 : shape === "circle" ? 3 : 0],
        },
      });

      setEditingId(n.id);
      setTimeout(() => selectOnly(n.id), 0);
    },
    [rf, rootId, root?.project_id, createItem, selectOnly],
  );

  /* ---- Quick-Add: Instanciação e Conexão Automática a partir de Pontos de Ancoragem ---- */
  const quickAddConnected = useCallback(
    (sourceId: string, shape: ProcessShape, direction: "right" | "bottom" | "left" | "top" = "right") => {
      const source = items[sourceId];
      if (!source) return;

      const sourceCanvas = source.canvas ?? { x: 0, y: 0 };
      const sourceW = sourceCanvas.width || (sourceCanvas.shape === "diamond" ? 140 : sourceCanvas.shape === "circle" ? 130 : 160);
      const sourceH = sourceCanvas.height || (sourceCanvas.shape === "diamond" ? 100 : sourceCanvas.shape === "circle" ? 70 : 80);

      const targetW = shape === "diamond" ? 140 : shape === "circle" ? 130 : 160;
      const targetH = shape === "diamond" ? 100 : shape === "circle" ? 70 : 80;

      const gap = 80;
      let spawnX = sourceCanvas.x + sourceW + gap;
      let spawnY = Math.round(sourceCanvas.y + (sourceH - targetH) / 2);

      if (direction === "bottom") {
        spawnX = Math.round(sourceCanvas.x + (sourceW - targetW) / 2);
        spawnY = sourceCanvas.y + sourceH + gap;
      } else if (direction === "left") {
        spawnX = sourceCanvas.x - targetW - gap;
        spawnY = Math.round(sourceCanvas.y + (sourceH - targetH) / 2);
      } else if (direction === "top") {
        spawnX = Math.round(sourceCanvas.x + (sourceW - targetW) / 2);
        spawnY = sourceCanvas.y - targetH - gap;
      }

      const title =
        shape === "diamond" ? "Decisão?" : shape === "circle" ? "Início / Fim" : "Etapa do Processo";

      const newNode = createItem({
        parent_id: rootId,
        project_id: root?.project_id,
        type: "MINDMAP_NODE",
        title,
        canvas: {
          x: spawnX,
          y: spawnY,
          shape,
          width: targetW,
          height: targetH,
          color: PALETTE[shape === "diamond" ? 4 : shape === "circle" ? 3 : 0],
        },
      });

      // Cria automaticamente a seta direcional conectando origem ao novo nó
      const currentLinks = source.links || [];
      if (!currentLinks.includes(newNode.id)) {
        updateItem(sourceId, {
          links: [...currentLinks, newNode.id],
        });
      }

      // Foca imediatamente a nova forma no modo de edição com cursor ativo
      setEditingId(newNode.id);
      setTimeout(() => selectOnly(newNode.id), 0);
    },
    [items, rootId, root?.project_id, createItem, updateItem, selectOnly],
  );

  const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);

  const removeSelected = useCallback(() => {
    const ids = selectedIds.filter((id) => id !== rootId);
    if (!ids.length) return;
    const withKids = ids.some((id) => (childCounts[id] ?? 0) > 0);
    if (withKids && !confirm("Alguns nós possuem ramos filhos. Excluir tudo?")) return;

    ids.forEach((id) => deleteItem(id));

    setTimeout(() => {
      const remainingItems = { ...useStore.getState().items };
      ids.forEach((id) => delete remainingItems[id]);
      const pos = layoutTree(remainingItems, rootId, collapsed, dimensionsRef.current);
      useStore.getState().updateItems(
        Object.entries(pos).map(([nodeId, p]) => ({
          id: nodeId,
          patch: { canvas: { ...(remainingItems[nodeId]?.canvas ?? {}), ...p } },
        })),
      );
    }, 0);
  }, [selectedIds, rootId, childCounts, deleteItem, collapsed]);

  const autoLayout = useCallback(() => {
    const pos = layoutTree(mindScope, rootId, collapsed, dimensionsRef.current);
    updateItems(
      Object.entries(pos).map(([id, p]) => ({ id, patch: { canvas: { ...(items[id]?.canvas ?? {}), ...p } } })),
    );
    setTimeout(() => rf.fitView({ duration: 400, padding: 0.2 }), 50);
  }, [mindScope, rootId, collapsed, items, updateItems, rf]);

  const setColor = (c: string) =>
    updateItems(selectedIds.map((id) => ({ id, patch: { canvas: { ...(items[id]?.canvas ?? { x: 0, y: 0 }), color: c } } })));

  const toTask = () =>
    updateItems(
      selectedIds.map((id) => ({ id, patch: { status: items[id]?.status ?? "TODO", project_id: items[id]?.project_id ?? root?.project_id ?? null } })),
    );

  /* ---- keyboard shortcuts ---- */
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
      } else if (e.key === "F2" && sel) {
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
      reportDimensions: (id, dim) => {
        const prev = dimensionsRef.current.get(id);
        if (!prev || Math.abs(prev.height - dim.height) > 2 || Math.abs(prev.width - dim.width) > 2) {
          dimensionsRef.current.set(id, dim);
          scheduleRelayout();
        }
      },
      updateDimensions: (id, width, height) => {
        updateItem(id, {
          canvas: {
            ...(items[id]?.canvas ?? { x: 0, y: 0 }),
            width,
            height,
          },
        });
        dimensionsRef.current.set(id, { width, height });
      },
      toggleCollapse: (id) =>
        setCollapsed((s) => {
          const c = new Set(s);
          if (c.has(id)) c.delete(id);
          else c.add(id);

          setTimeout(() => {
            const currentItems = useStore.getState().items;
            const pos = layoutTree(currentItems, rootId, c, dimensionsRef.current);
            useStore.getState().updateItems(
              Object.entries(pos).map(([nodeId, p]) => ({
                id: nodeId,
                patch: { canvas: { ...(currentItems[nodeId]?.canvas ?? {}), ...p } },
              })),
            );
          }, 0);

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
      deleteNode: (id) => {
        deleteItem(id);
        setTimeout(() => {
          const remainingItems = { ...useStore.getState().items };
          delete remainingItems[id];
          const pos = layoutTree(remainingItems, rootId, collapsed, dimensionsRef.current);
          useStore.getState().updateItems(
            Object.entries(pos).map(([nodeId, p]) => ({
              id: nodeId,
              patch: { canvas: { ...(remainingItems[nodeId]?.canvas ?? {}), ...p } },
            })),
          );
        }, 0);
      },
      quickAddConnected: (sourceId, shape, direction) =>
        quickAddConnected(sourceId, shape, direction),
    }),
    [updateItem, openDrawer, createItem, deleteItem, rootId, collapsed, scheduleRelayout, items, quickAddConnected],
  );

  if (!root) return <div className="empty-state"><h1>Mapa não encontrado</h1></div>;

  return (
    <MindCtx.Provider value={ctx}>
      <div className="canvas-wrap" ref={wrapRef}>
        <ReactFlow<MindNode | ProcessNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onPaneClick={() => {
            setEditingId(null);
            setProcessMenuOpen(false);
          }}
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
            nodeColor={(n) => (n as MindNode | ProcessNode).data?.color ?? "#888"}
            maskColor="var(--minimap-mask)"
          />
          <Controls showInteractive={false} className="canvas-controls" />

          {/* Insertion guide line rendered dynamically inside the viewport */}
          <ViewportPortal>
            {dropIndicator && (
              <div
                className="mind-drop-indicator"
                style={{
                  transform: `translate(${dropIndicator.x}px, ${dropIndicator.y}px)`,
                  width: dropIndicator.width,
                }}
              />
            )}
          </ViewportPortal>

          <Panel position="top-left" className="canvas-panel glass">
            <span className="canvas-root-title">{typeIcon(root)} {root.title || "Sem título"}</span>
            <ViewSwitcher id={root.id} />
          </Panel>

          <Panel position="top-right" className="canvas-panel glass" style={{ overflow: "visible" }}>
            <button id="canvas-add-child" className="btn btn-ghost btn-xs" onClick={() => addChild(selectedIds[0] ?? rootId)} title="Novo ramo (Tab)">
              <Plus size={14} /> Ramo
            </button>

            {/* Menu Dropdown de Formas de Processo */}
            <div style={{ position: "relative" }}>
              <button
                id="canvas-add-process"
                className={`btn btn-ghost btn-xs ${processMenuOpen ? "is-active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setProcessMenuOpen(!processMenuOpen);
                }}
                title="Adicionar forma de processo / fluxograma"
              >
                <Workflow size={14} /> Processo
              </button>

              {processMenuOpen && (
                <div className="process-dropdown-menu nodrag" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="process-dropdown-item"
                    onClick={() => addProcessNode("rectangle")}
                  >
                    <span className="process-dropdown-icon"><Square size={16} /></span>
                    <div>
                      <div>Retângulo</div>
                      <div className="process-dropdown-desc">Ação / Etapa do Processo</div>
                    </div>
                  </button>
                  <button
                    className="process-dropdown-item"
                    onClick={() => addProcessNode("diamond")}
                  >
                    <span className="process-dropdown-icon"><Diamond size={16} /></span>
                    <div>
                      <div>Losango</div>
                      <div className="process-dropdown-desc">Decisão / Condicional</div>
                    </div>
                  </button>
                  <button
                    className="process-dropdown-item"
                    onClick={() => addProcessNode("circle")}
                  >
                    <span className="process-dropdown-icon"><Circle size={16} /></span>
                    <div>
                      <div>Círculo</div>
                      <div className="process-dropdown-desc">Início / Fim / Conector</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <button id="canvas-auto-layout" className="btn btn-ghost btn-xs" onClick={autoLayout} title="Auto-organizar mapa mental">
              <Wand2 size={14} /> Organizar
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => rf.fitView({ duration: 400, padding: 0.2 })} title="Enquadrar tudo">
              <Maximize size={14} />
            </button>
            <button
              id="canvas-export-json"
              className="btn btn-ghost btn-xs"
              onClick={exportJson}
              title="Exportar mapa como JSON (pode ser reimportado sem perdas)"
            >
              <Download size={14} /> {exportMsg ?? "Exportar JSON"}
            </button>
          </Panel>

          {selectedIds.length > 0 && (
            <Panel position="bottom-center" className="canvas-panel canvas-selbar glass">
              <span className="muted small">{selectedIds.length} selecionado(s)</span>
              <div className="swatches">
                {PALETTE.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} onClick={() => setColor(c)} title="Cor da forma/ramo" />
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
            <kbd>+ Processo</kbd> fluxograma livre · <kbd>Arrastar âncora</kbd> conectar setas · <kbd>Tab</kbd> filho · <kbd>Enter</kbd> irmão · <kbd>F2</kbd> renomear · <kbd>Del</kbd> excluir
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
