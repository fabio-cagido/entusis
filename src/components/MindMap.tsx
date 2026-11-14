"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
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
  getSmoothStepPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
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
  Share2,
  Square,
  Trash2,
  UserPlus,
  Users,
  Wand2,
  Workflow,
} from "lucide-react";
import { descendantsOf, getKanbanStatusForNode, useStore } from "@/lib/store";
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
  submapCount?: number;
  collapsed: boolean;
  side: 1 | -1;
  isDragging?: boolean;
  isDropTarget?: boolean;
  isReturnHighlight?: boolean;
  customConnectionsCount?: number;
};
type MindNode = Node<MindData, "mind">;

type ProcessData = {
  item: ItemNode;
  color: string;
  shape: ProcessShape;
  editing: boolean;
  width: number;
  height: number;
  submapCount?: number;
  isReturnHighlight?: boolean;
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
  deleteLinkEdge(sourceId: string, targetId: string): void;
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
  const { item, color, isRoot, editing, childCount, submapCount = 0, collapsed, side, isDragging, isDropTarget, isReturnHighlight, customConnectionsCount = 0 } = data;
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
      className={`mind-node ${isRoot ? "is-root" : ""} ${selected ? "is-selected" : ""} ${item.status === "DONE" ? "is-done" : ""} ${isDragging ? "is-dragging" : ""} ${isDropTarget ? "is-drop-target" : ""} ${isReturnHighlight ? "is-return-highlight" : ""}`}
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
      {/* Handles separados verticalmente: alças de conexão livre (target) no terço superior, saída estrutural da árvore (source) no terço inferior */}
      <Handle type="target" position={Position.Left} id="l-t" className="mind-handle" style={{ top: "32%" }} />
      <Handle type="source" position={Position.Left} id="l-s" className="mind-handle" style={{ top: "68%" }} />
      <Handle type="target" position={Position.Right} id="r-t" className="mind-handle" style={{ top: "32%" }} />
      <Handle type="source" position={Position.Right} id="r-s" className="mind-handle" style={{ top: "68%" }} />

      <div className="mind-main">
        {!(item.icon && item.title?.startsWith(item.icon)) && (
          <span className="mind-icon">{item.type === "PAGE" ? "📄" : typeIcon(item)}</span>
        )}
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

          {!isRoot && (
            <Link
              href={`/canvas/${item.id}`}
              className="notion-menu-item"
              style={{ textDecoration: "none", color: "inherit" }}
              onClick={() => setMenuOpen(false)}
            >
              <span className="notion-menu-icon">
                <Workflow size={14} />
              </span>
              <span>Abrir Submapa (Como mapa)</span>
            </Link>
          )}

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

      {(item.type === "PAGE" ||
        item.status ||
        item.schedule.start_time ||
        item.attachments.length > 0 ||
        item.links.length > 0 ||
        customConnectionsCount > 0 ||
        submapCount > 0) && (
        <div className="mind-badges">
          {item.type === "PAGE" && (
            <span className="mind-page-badge" title="Este nó é uma página completa">
              <FileText size={10} /> Página
            </span>
          )}
          {submapCount > 0 && (
            <Link
              href={`/canvas/${item.id}`}
              className="meta-chip nodrag"
              style={{
                textDecoration: "none",
                background: "rgba(124, 92, 255, 0.14)",
                color: "#a78bfa",
                borderColor: "rgba(124, 92, 255, 0.3)",
              }}
              title={`Submapa interno (${submapCount} item(ns)) — clique para abrir`}
              onClick={(e) => e.stopPropagation()}
            >
              <Workflow size={10} /> {submapCount}
            </Link>
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
          {customConnectionsCount > 0 && (
            <span
              className="meta-chip custom-conn-chip"
              title={`${customConnectionsCount} conexão(ões) livre(s) (linhas tracejadas)`}
            >
              <Share2 size={10} /> {customConnectionsCount}
            </span>
          )}
        </div>
      )}

      {childCount > 0 && (!isRoot || collapsed) && (
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
  const { item, color, shape, editing, width, height, submapCount = 0, isReturnHighlight } = data;
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
      className={`process-node shape-${shape} ${selected ? "is-selected" : ""} ${isReturnHighlight ? "is-return-highlight" : ""}`}
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

        {(item.status || item.schedule?.start_time || (item.attachments?.length ?? 0) > 0 || submapCount > 0) && (
          <div className="mind-badges" style={{ marginTop: 4, justifyContent: "center" }}>
            {submapCount > 0 && (
              <Link
                href={`/canvas/${item.id}`}
                className="meta-chip nodrag"
                style={{
                  textDecoration: "none",
                  background: "rgba(124, 92, 255, 0.14)",
                  color: "#a78bfa",
                  borderColor: "rgba(124, 92, 255, 0.3)",
                }}
                title={`Submapa interno (${submapCount} item(ns)) — clique para abrir`}
                onClick={(e) => e.stopPropagation()}
              >
                <Workflow size={9} /> {submapCount}
              </Link>
            )}
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
/* Edge: Custom Link Edge (Tracejada / Selecionável / Botão Excluir)  */
/* ------------------------------------------------------------------ */

const CustomLinkEdge = memo(function CustomLinkEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  data,
}: EdgeProps<Edge>) {
  const ctx = useContext(MindCtx);
  const connectionIndex =
    typeof data?.connectionIndex === "number" ? data.connectionIndex : 0;
  const sourceFanOffset =
    typeof data?.sourceFanOffset === "number" ? data.sourceFanOffset : 0;
  const targetFanOffset =
    typeof data?.targetFanOffset === "number" ? data.targetFanOffset : 0;

  // Escalonamento dinâmico de trilhos para evitar sobreposição de linhas tracejadas paralelas
  const stepOffset = 24 + (connectionIndex % 8) * 10;
  const stepBorderRadius = 14 + (connectionIndex % 4) * 3;
  const stepPosition = 0.32 + (connectionIndex % 7) * 0.06;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY: sourceY + sourceFanOffset,
    sourcePosition,
    targetX,
    targetY: targetY + targetFanOffset,
    targetPosition,
    borderRadius: stepBorderRadius,
    offset: stepOffset,
    stepPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={20}
        style={{
          ...style,
          stroke: selected ? "#fde047" : style?.stroke,
          strokeWidth: selected ? 3.2 : (style?.strokeWidth ?? 2),
          filter: selected ? "drop-shadow(0 0 6px rgba(253, 224, 71, 0.8))" : undefined,
        }}
      />
      {selected && ctx && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              zIndex: 1000,
            }}
            className="nodrag nopan"
          >
            <button
              type="button"
              className="custom-edge-delete-btn"
              title="Excluir conexão (Delete / Backspace)"
              onClick={(e) => {
                e.stopPropagation();
                ctx.deleteLinkEdge(source, target);
              }}
            >
              ✕
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const edgeTypes = { customLink: CustomLinkEdge };

interface SavedMapState {
  collapsedIds?: string[];
  viewport?: { x: number; y: number; zoom: number };
}

function getMapStateStorageKey(mapId: string): string {
  return `ayolia_map_state_${mapId}`;
}

function loadSavedMapState(mapId: string): SavedMapState | null {
  if (typeof window === "undefined" || !mapId) return null;
  try {
    const raw = localStorage.getItem(getMapStateStorageKey(mapId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedMapState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveMapStatePatch(mapId: string, patch: Partial<SavedMapState>): void {
  if (typeof window === "undefined" || !mapId) return;
  try {
    const prev = loadSavedMapState(mapId) ?? {};
    const next: SavedMapState = { ...prev, ...patch };
    localStorage.setItem(getMapStateStorageKey(mapId), JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

function MindMapInner({ rootId }: { rootId: string }) {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const createItem = useStore((s) => s.createItem);
  const updateItem = useStore((s) => s.updateItem);
  const updateItems = useStore((s) => s.updateItems);
  const deleteItem = useStore((s) => s.deleteItem);
  const openDrawer = useStore((s) => s.openDrawer);
  const ensureProjectKanbanBranch = useStore((s) => s.ensureProjectKanbanBranch);
  const rf = useReactFlow();
  const searchParams = useSearchParams();
  const focusNodeId = searchParams.get("focusNode");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const saved = loadSavedMapState(rootId);
    return new Set(Array.isArray(saved?.collapsedIds) ? saved!.collapsedIds : []);
  });
  const [nodes, setNodes] = useState<(MindNode | ProcessNode)[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [processMenuOpen, setProcessMenuOpen] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const handledFocusRef = useRef<string | null>(null);
  const restoredViewportForMapRef = useRef<string | null>(null);
  const latestViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;

  /* ---- Cache de Dimensões Reais dos Nós ---- */
  const dimensionsRef = useRef<Map<string, NodeDimensions>>(new Map());
  const relayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- Estado de Arraste Estrutural (Reordenar entre irmãos / Reaninhar sobre nó alvo) ---- */
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const dragRef = useRef<{
    nodeId: string;
    parentId: string | null;
    side: 1 | -1;
    fixedX: number;
    siblings: ItemNode[];
    initialIndex: number;
    forbiddenIds: Set<string>;
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
  const openShareModal = useStore((s) => s.openShareModal);
  const shares = useStore((s) => s.shares);
  const currentUserId = useStore((s) => s.currentUserId);

  /* ---- Isolamento de Escopo Recursivo (scope_node_id) ---- */
  const isSubmap = Boolean(root && (root.parent_id !== null || root.scope_node_id != null));
  const activeScopeId: string | null = isSubmap ? rootId : null;

  const scopedItems = useMemo(() => {
    if (!root) return {} as Record<string, ItemNode>;
    const out: Record<string, ItemNode> = {
      [rootId]: root,
    };
    for (const it of Object.values(items)) {
      if (it.id === rootId) continue;
      const itemScope = it.scope_node_id ?? null;
      if (itemScope === activeScopeId) {
        out[it.id] = it;
      }
    }
    return out;
  }, [items, root, rootId, activeScopeId]);

  /* ---- contagem de conexões livres (tracejadas) por nó, como origem ou destino ---- */
  const customConnCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of Object.values(scopedItems)) {
      if (it.canvas?.shape) continue;
      for (const l of it.links ?? []) {
        const target = scopedItems[l];
        if (!target || target.canvas?.shape || l === it.id) continue;
        counts[it.id] = (counts[it.id] ?? 0) + 1;
        counts[l] = (counts[l] ?? 0) + 1;
      }
    }
    return counts;
  }, [scopedItems]);

  const submapNodeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of Object.values(items)) {
      if (it.scope_node_id) {
        counts[it.scope_node_id] = (counts[it.scope_node_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [items]);

  /* ---- Trilha de Navegação (Breadcrumb) para Submapas Recursivos ---- */
  const breadcrumbTrail = useMemo(() => {
    if (!root || !isSubmap) return [] as { mapItem: ItemNode; label: string; focusNodeId: string }[];
    const steps: { mapItem: ItemNode; label: string; focusNodeId: string }[] = [];
    const visited = new Set<string>();
    let curr: ItemNode | undefined = root;

    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      if (curr.scope_node_id && items[curr.scope_node_id]) {
        const parentScopeMap: ItemNode = items[curr.scope_node_id];
        const projName =
          !parentScopeMap.parent_id && !parentScopeMap.scope_node_id && parentScopeMap.project_id
            ? projects[parentScopeMap.project_id]?.name
            : null;
        steps.unshift({
          mapItem: parentScopeMap,
          label: projName || parentScopeMap.title || "Mapa",
          focusNodeId: curr.id,
        });
        curr = parentScopeMap;
      } else if (curr.parent_id) {
        let p: ItemNode | undefined = items[curr.parent_id];
        const subGuard = new Set<string>();
        while (p && p.parent_id && !p.scope_node_id && !subGuard.has(p.id)) {
          subGuard.add(p.id);
          p = items[p.parent_id];
        }
        if (p) {
          const projName = p.project_id ? projects[p.project_id]?.name : null;
          steps.unshift({
            mapItem: p,
            label: projName || p.title || "Mapa Principal",
            focusNodeId: curr.id,
          });
        }
        break;
      } else {
        break;
      }
    }
    return steps;
  }, [root, isSubmap, items, projects]);

  const rootShareCount = useMemo(
    () => Object.values(shares).filter((s) => s.item_id === rootId).length,
    [shares, rootId]
  );
  const isSharedWithMe = Boolean(
    root?.user_id && currentUserId && root.user_id !== currentUserId
  );

  /* ---- scope: nós da árvore hierárquica (exclui formas de processo, exceto a raiz do submapa) ---- */
  const mindScope = useMemo(
    () => (root ? [root, ...descendantsOf(scopedItems, rootId).filter((i) => !i.canvas?.shape)] : []),
    [scopedItems, root, rootId],
  );

  /* ---- formas de processo independentes vinculadas ao escopo atual do canvas ---- */
  const processScope = useMemo(() => {
    return Object.values(scopedItems).filter((i) => {
      if (!i.canvas?.shape || i.id === rootId) return false;
      if (isSubmap) return (i.scope_node_id ?? null) === rootId;
      return i.parent_id === rootId || (root?.project_id && i.project_id === root.project_id);
    });
  }, [scopedItems, rootId, root?.project_id, isSubmap]);

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

  /* ---- garante ramo "📋 Kanban" em mapas de projetos existentes (não-destrutivo) ---- */
  useEffect(() => {
    if (root?.project_id && !root.parent_id && !root.scope_node_id) {
      ensureProjectKanbanBranch(root.project_id);
    }
  }, [root?.id, root?.project_id, root?.parent_id, root?.scope_node_id, ensureProjectKanbanBranch]);

  /* ---- Restaura estado de nós recolhidos (collapsed) e câmera (viewport) ao abrir/trocar de mapa ---- */
  useEffect(() => {
    const saved = loadSavedMapState(rootId);
    setCollapsed(new Set(Array.isArray(saved?.collapsedIds) ? saved!.collapsedIds : []));
  }, [rootId]);

  useEffect(() => {
    if (!root || focusNodeId) return;
    if (restoredViewportForMapRef.current === rootId) return;
    if (nodes.length === 0) return;

    restoredViewportForMapRef.current = rootId;
    const saved = loadSavedMapState(rootId);
    if (
      saved?.viewport &&
      typeof saved.viewport.x === "number" &&
      typeof saved.viewport.y === "number" &&
      typeof saved.viewport.zoom === "number"
    ) {
      latestViewportRef.current = saved.viewport;
      rf.setViewport(saved.viewport, { duration: 0 });
    } else if (root.canvas) {
      const dim =
        dimensionsRef.current.get(rootId) || estimateNodeSize(root, true);
      const centerX = root.canvas.x + dim.width / 2;
      const centerY = root.canvas.y + dim.height / 2;
      rf.setCenter(centerX, centerY, { zoom: 0.95, duration: 0 });
    }
  }, [root, rootId, focusNodeId, nodes.length, rf]);

  /* ---- Salva a câmera (viewport) no localStorage ao desmontar/sair do mapa ---- */
  useEffect(() => {
    return () => {
      if (latestViewportRef.current) {
        saveMapStatePatch(rootId, { viewport: latestViewportRef.current });
      }
    };
  }, [rootId]);

  /* ---- Motor de Auto-Layout Bilateral Determinístico: recalcula e alinha todos os nós visíveis ---- */
  useEffect(() => {
    if (!root || !mindScope.length) return;
    const pos = layoutTree(mindScope, rootId, collapsed, dimensionsRef.current);
    const patches: { id: string; patch: Partial<ItemNode> }[] = [];
    for (const [id, p] of Object.entries(pos)) {
      if (isSubmap && id === rootId) continue;
      const cur = items[id];
      if (!cur) continue;
      if (
        !cur.canvas ||
        Math.abs(cur.canvas.x - p.x) > 1 ||
        Math.abs(cur.canvas.y - p.y) > 1 ||
        cur.canvas.custom_pos
      ) {
        patches.push({
          id,
          patch: {
            canvas: {
              ...(cur.canvas ?? { color: null }),
              x: p.x,
              y: p.y,
              custom_pos: false,
            },
          },
        });
      }
    }
    if (patches.length > 0) {
      updateItems(patches);
    }
  }, [mindScope, root, rootId, isSubmap, collapsed, items, updateItems]);

  /* ---- Centralização suave (setCenter) e destaque âmbar ao retornar de um submapa (?focusNode=...) ---- */
  useEffect(() => {
    if (!focusNodeId || !root) return;
    const focusKey = `${rootId}:${focusNodeId}`;
    if (handledFocusRef.current === focusKey) return;

    const targetItem = scopedItems[focusNodeId] ?? items[focusNodeId];
    if (!targetItem?.canvas) return;
    if (!nodes.some((n) => n.id === focusNodeId)) return;

    handledFocusRef.current = focusKey;

    // Garante que nenhum ancestral do nó focado esteja recolhido
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = false;
      let p = targetItem.parent_id;
      let guard = 0;
      while (p && guard++ < 100) {
        if (next.has(p)) {
          next.delete(p);
          changed = true;
        }
        if (p === rootId) break;
        p = items[p]?.parent_id ?? null;
      }
      if (changed) {
        saveMapStatePatch(rootId, { collapsedIds: Array.from(next) });
      }
      return changed ? next : prev;
    });

    const dim =
      dimensionsRef.current.get(focusNodeId) ||
      estimateNodeSize(targetItem, focusNodeId === rootId);
    const centerX = targetItem.canvas.x + dim.width / 2;
    const centerY = targetItem.canvas.y + dim.height / 2;

    const centerTimer = setTimeout(() => {
      rf.setCenter(centerX, centerY, { zoom: 1, duration: 600 });
    }, 40);

    setHighlightedNodeId(focusNodeId);
    const clearHighlightTimer = setTimeout(() => {
      setHighlightedNodeId((cur) => (cur === focusNodeId ? null : cur));
    }, 2000);

    return () => {
      clearTimeout(centerTimer);
      clearTimeout(clearHighlightTimer);
    };
  }, [focusNodeId, root, rootId, scopedItems, items, nodes, rf]);

  /* ---- Relayout dinâmico quando dimensões reais do DOM mudam (ex: texto multilinhas ou badges) ---- */
  const scheduleRelayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      const currentItems = useStore.getState().items;
      const rootNode = currentItems[rootId];
      if (!rootNode) return;
      const currentScoped: Record<string, ItemNode> = { [rootId]: rootNode };
      for (const it of Object.values(currentItems)) {
        if (it.id === rootId) continue;
        if ((it.scope_node_id ?? null) === activeScopeId) {
          currentScoped[it.id] = it;
        }
      }
      const currentScope = [
        rootNode,
        ...descendantsOf(currentScoped, rootId).filter((i) => !i.canvas?.shape),
      ];
      if (!currentScope.length) return;

      const pos = layoutTree(currentScope, rootId, collapsed, dimensionsRef.current);
      const patches: { id: string; patch: Partial<ItemNode> }[] = [];
      for (const [id, p] of Object.entries(pos)) {
        if (isSubmap && id === rootId) continue;
        const cur = currentItems[id];
        if (cur?.canvas && (Math.abs(cur.canvas.x - p.x) > 1 || Math.abs(cur.canvas.y - p.y) > 1)) {
          patches.push({
            id,
            patch: { canvas: { ...cur.canvas, x: p.x, y: p.y, custom_pos: false } },
          });
        }
      }
      if (patches.length > 0) {
        updateItems(patches);
      }
    }, 60);
  }, [rootId, activeScopeId, isSubmap, collapsed, updateItems]);

  /* ---- Determina o lado (direito = 1, esquerdo = -1) de qualquer nó subindo até o filho direto da raiz ---- */
  const getBranchSide = useCallback(
    (nodeId: string, scopeMap: Record<string, ItemNode>): 1 | -1 => {
      const rootX = root?.canvas?.x ?? 0;
      let cur: ItemNode | undefined = scopeMap[nodeId] ?? items[nodeId];
      let guard = 0;
      while (cur && cur.parent_id && cur.parent_id !== rootId && guard++ < 100) {
        cur = scopeMap[cur.parent_id] ?? items[cur.parent_id];
      }
      if (!cur || cur.id === rootId) return 1;
      if (
        (cur.canvas?.x ?? rootX + 1) < rootX ||
        cur.title?.trim().toLowerCase() === "contexto"
      ) {
        return -1;
      }
      return 1;
    },
    [items, root?.canvas?.x, rootId],
  );

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
      const prevPosMap = new Map(prev.map((n) => [n.id, n.position]));
      const rootX = root?.canvas?.x ?? 0;

      const treeNodes = visibleMind
        .filter((it) => it.canvas)
        .map<MindNode>((it) => ({
          id: it.id,
          type: "mind",
          draggable: it.id !== rootId,
          position:
            activeDragId === it.id && prevPosMap.has(it.id)
              ? prevPosMap.get(it.id)!
              : { x: it.canvas!.x, y: it.canvas!.y },
          selected: sel.has(it.id),
          className: `react-flow__node-mind ${activeDragId === it.id ? "is-dragging" : ""} ${dropTargetId === it.id ? "is-drop-target" : ""}`,
          data: {
            item: it,
            color: colorOf(it),
            isRoot: it.id === rootId,
            editing: editingId === it.id,
            childCount: childCounts[it.id] ?? 0,
            submapCount: (submapNodeCounts[it.id] ?? 0) + (it.submap_canvas_data?.nodes?.length ?? 0),
            collapsed: collapsed.has(it.id),
            side: it.canvas!.x < rootX ? -1 : 1,
            isDragging: activeDragId === it.id,
            isDropTarget: dropTargetId === it.id,
            isReturnHighlight: highlightedNodeId === it.id,
            customConnectionsCount: customConnCounts[it.id] ?? 0,
          },
        }));

      const flowNodes = processScope
        .filter((it) => it.canvas)
        .map<ProcessNode>((it) => ({
          id: it.id,
          type: "process",
          draggable: true,
          position:
            activeDragId === it.id && prevPosMap.has(it.id)
              ? prevPosMap.get(it.id)!
              : { x: it.canvas!.x, y: it.canvas!.y },
          selected: sel.has(it.id),
          data: {
            item: it,
            color: colorOf(it),
            shape: it.canvas!.shape || "rectangle",
            editing: editingId === it.id,
            width: it.canvas!.width || (it.canvas!.shape === "diamond" ? 140 : it.canvas!.shape === "circle" ? 130 : 160),
            height: it.canvas!.height || (it.canvas!.shape === "diamond" ? 100 : it.canvas!.shape === "circle" ? 70 : 80),
            submapCount: (submapNodeCounts[it.id] ?? 0) + (it.submap_canvas_data?.nodes?.length ?? 0),
            isReturnHighlight: highlightedNodeId === it.id,
          },
        }));

      return [...treeNodes, ...flowNodes];
    });
  }, [visibleMind, processScope, colorOf, rootId, editingId, childCounts, submapNodeCounts, customConnCounts, collapsed, root?.canvas?.x, activeDragId, dropTargetId, highlightedNodeId]);

  /* ---- Edges (Curvas de Árvore + Conectores Direcionais de Processo) ---- */
  const edges = useMemo<Edge[]>(() => {
    const allVis = new Set([...visibleMind.map((v) => v.id), ...processScope.map((p) => p.id)]);
    const pos = new Map([...visibleMind, ...processScope].map((v) => [v.id, v.canvas]));
    const out: Edge[] = [];

    // Árvore do mapa mental (curvas Bezier) — blindada contra seleção, exclusão e reconexão
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
          selectable: false,
          deletable: false,
          reconnectable: false,
          focusable: false,
          style: {
            stroke: isRootChild ? colorOf(it) : `color-mix(in srgb, ${colorOf(it)} 55%, transparent)`,
            strokeWidth: isRootChild ? 3 : 2,
          },
        });
      }
    }

    // Links manuais e conexões de fluxo entre nós (selecionáveis, excluíveis e reconectáveis)
    const rootX = root?.canvas?.x ?? 0;
    const rawCustomEdges: {
      edgeId: string;
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
      isProcess: boolean;
      isSelected: boolean;
      targetItem?: ItemNode;
      sourceItem: ItemNode;
    }[] = [];

    for (const it of [...visibleMind, ...processScope]) {
      for (const l of it.links) {
        if (!allVis.has(l)) continue;
        const targetItem = items[l];
        const isProcess = !!it.canvas?.shape || !!targetItem?.canvas?.shape;

        let sourceHandle: string | undefined = undefined;
        let targetHandle: string | undefined = undefined;

        const sC = it.canvas ?? { x: 0, y: 0 };
        const tC = targetItem?.canvas ?? { x: 0, y: 0 };
        const sDim = dimensionsRef.current.get(it.id) || estimateNodeSize(it, it.id === rootId);
        const tDim =
          (targetItem && (dimensionsRef.current.get(targetItem.id) || estimateNodeSize(targetItem, targetItem.id === rootId))) ||
          { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };

        const sW = sC.width || (sC.shape === "diamond" ? 140 : sC.shape === "circle" ? 130 : sC.shape ? 160 : sDim.width);
        const sH = sC.height || (sC.shape === "diamond" ? 100 : sC.shape === "circle" ? 70 : sC.shape ? 80 : sDim.height);
        const tW = tC.width || (tC.shape === "diamond" ? 140 : tC.shape === "circle" ? 130 : tC.shape ? 160 : tDim.width);
        const tH = tC.height || (tC.shape === "diamond" ? 100 : tC.shape === "circle" ? 70 : tC.shape ? 80 : tDim.height);

        const sCenterX = sC.x + sW / 2;
        const sCenterY = sC.y + sH / 2;
        const tCenterX = tC.x + tW / 2;
        const tCenterY = tC.y + tH / 2;

        const dx = tCenterX - sCenterX;
        const dy = tCenterY - sCenterY;

        if (isProcess) {
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
        } else {
          // Conexão livre (tracejada) entre nós da árvore:
          // Se os nós estiverem alinhados quase na mesma coluna X (ex: irmãos na mesma coluna),
          // conecta pelos handles externos do ramo (evitando colar a linha tracejada sobre os handles de entrada da árvore).
          if (Math.abs(dx) < 120) {
            const outerRight = sC.x >= rootX && tC.x >= rootX;
            sourceHandle = outerRight ? "r-s" : "l-s";
            targetHandle = outerRight ? "r-t" : "l-t";
          } else {
            sourceHandle = dx >= 0 ? "r-s" : "l-s";
            targetHandle = dx >= 0 ? "l-t" : "r-t";
          }
        }

        // Se o usuário escolheu/reconectou manualmente os pontos de ancoragem (handles), respeitar a escolha salva:
        const savedHandles = it.canvas?.link_handles?.[l];
        if (savedHandles?.sourceHandle) {
          sourceHandle = savedHandles.sourceHandle;
        }
        if (savedHandles?.targetHandle) {
          targetHandle = savedHandles.targetHandle;
        }

        const edgeId = `l-${it.id}-${l}`;
        const isSelected = selectedEdgeIds.has(edgeId);

        rawCustomEdges.push({
          edgeId,
          source: it.id,
          target: l,
          sourceHandle,
          targetHandle,
          isProcess,
          isSelected,
          targetItem,
          sourceItem: it,
        });
      }
    }

    // Calcula fan-out por handle para evitar que múltiplas conexões no mesmo nó colem horizontalmente
    const sourceHandleGroups = new Map<string, string[]>();
    const targetHandleGroups = new Map<string, string[]>();
    for (const ce of rawCustomEdges) {
      const sKey = `${ce.source}:${ce.sourceHandle ?? ""}`;
      const tKey = `${ce.target}:${ce.targetHandle ?? ""}`;
      sourceHandleGroups.set(sKey, [...(sourceHandleGroups.get(sKey) ?? []), ce.edgeId]);
      targetHandleGroups.set(tKey, [...(targetHandleGroups.get(tKey) ?? []), ce.edgeId]);
    }

    rawCustomEdges.forEach((ce, connectionIndex) => {
      const sKey = `${ce.source}:${ce.sourceHandle ?? ""}`;
      const tKey = `${ce.target}:${ce.targetHandle ?? ""}`;
      const sGroup = sourceHandleGroups.get(sKey) ?? [ce.edgeId];
      const tGroup = targetHandleGroups.get(tKey) ?? [ce.edgeId];
      const sIdx = sGroup.indexOf(ce.edgeId);
      const tIdx = tGroup.indexOf(ce.edgeId);
      const sourceFanOffset = sGroup.length > 1 ? Math.round((sIdx - (sGroup.length - 1) / 2) * 5) : 0;
      const targetFanOffset = tGroup.length > 1 ? Math.round((tIdx - (tGroup.length - 1) / 2) * 5) : 0;

      out.push({
        id: ce.edgeId,
        source: ce.source,
        target: ce.target,
        sourceHandle: ce.sourceHandle,
        targetHandle: ce.targetHandle,
        type: "customLink",
        selectable: true,
        deletable: true,
        reconnectable: true,
        focusable: true,
        selected: ce.isSelected,
        interactionWidth: 20,
        animated: !ce.isProcess,
        markerEnd: ce.isProcess
          ? {
              type: MarkerType.ArrowClosed,
              width: 15,
              height: 15,
              color: ce.isSelected ? "#fbbf24" : colorOf(ce.targetItem || ce.sourceItem),
            }
          : undefined,
        style: {
          stroke: ce.isSelected ? "#fde047" : ce.isProcess ? colorOf(ce.targetItem || ce.sourceItem) : "#f59e0b",
          strokeWidth: ce.isSelected ? 3.2 : 2,
        },
        data: {
          link: true,
          connectionIndex,
          sourceFanOffset,
          targetFanOffset,
        },
      });
    });

    return out;
  }, [visibleMind, processScope, items, rootId, root?.canvas?.x, colorOf, selectedEdgeIds]);

  const onNodesChange = useCallback((changes: NodeChange<MindNode | ProcessNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  /* ---- Arraste Estrutural (XMind / Lucidchart): Reordenar entre irmãos ou Reaninhar sobre nó alvo ---- */
  const onNodeDragStart = useCallback(
    (_: unknown, node: MindNode | ProcessNode) => {
      const item = items[node.id];
      if (!item || node.id === rootId) return;

      dropTargetRef.current = null;
      setDropTargetId(null);
      setDropIndicator(null);

      // Forma de processo independente
      if (item.canvas?.shape) {
        dragRef.current = {
          nodeId: node.id,
          parentId: null,
          side: 1,
          fixedX: node.position.x,
          siblings: [],
          initialIndex: 0,
          forbiddenIds: new Set([node.id]),
          isProcessNode: true,
        };
        setActiveDragId(node.id);
        return;
      }

      if (!item.parent_id) return;

      // Trava anticiclo: o nó arrastado + toda sua subárvore de descendentes
      const descendantIds = descendantsOf(scopedItems, node.id).map((d) => d.id);
      const forbiddenIds = new Set<string>([node.id, ...descendantIds]);

      const side: 1 | -1 = getBranchSide(node.id, scopedItems);

      let siblings: ItemNode[];
      if (item.parent_id === rootId) {
        siblings = Object.values(scopedItems).filter(
          (i) => i.parent_id === rootId && !i.canvas?.shape && getBranchSide(i.id, scopedItems) === side,
        );
      } else {
        siblings = Object.values(scopedItems).filter(
          (i) => i.parent_id === item.parent_id && !i.canvas?.shape,
        );
      }
      siblings.sort((a, b) => a.sort_order - b.sort_order || (a.canvas?.y ?? 0) - (b.canvas?.y ?? 0));

      const initialIndex = siblings.findIndex((s) => s.id === node.id);

      dragRef.current = {
        nodeId: node.id,
        parentId: item.parent_id,
        side,
        fixedX: item.canvas?.x ?? node.position.x,
        siblings,
        initialIndex: initialIndex >= 0 ? initialIndex : 0,
        forbiddenIds,
        isProcessNode: false,
      };

      setActiveDragId(node.id);
    },
    [items, scopedItems, rootId, getBranchSide],
  );

  const onNodeDrag = useCallback(
    (_: unknown, node: MindNode | ProcessNode) => {
      const drag = dragRef.current;
      if (!drag || drag.isProcessNode || node.id === rootId) return;

      const draggedItem = items[node.id];
      const dragDim =
        dimensionsRef.current.get(node.id) ||
        estimateNodeSize(draggedItem || ({ title: "" } as ItemNode), false);
      const dragRect = {
        x: node.position.x,
        y: node.position.y,
        width: dragDim.width,
        height: dragDim.height,
        cx: node.position.x + dragDim.width / 2,
        cy: node.position.y + dragDim.height / 2,
      };

      // 1. Verificar se o nó está sobre o centro de um card alvo para reaninhamento (reparenting)
      let bestTargetId: string | null = null;
      let bestOverlapArea = 0;

      for (const cand of visibleMind) {
        if (!cand.canvas) continue;
        if (drag.forbiddenIds.has(cand.id)) continue;
        if (cand.id === drag.parentId && cand.id !== rootId) continue;

        const candDim =
          dimensionsRef.current.get(cand.id) ||
          estimateNodeSize(cand, cand.id === rootId);
        const candRect = {
          x: cand.canvas.x,
          y: cand.canvas.y,
          width: candDim.width,
          height: candDim.height,
        };

        const overlapX = Math.max(
          0,
          Math.min(dragRect.x + dragRect.width, candRect.x + candRect.width) -
            Math.max(dragRect.x, candRect.x),
        );
        const overlapY = Math.max(
          0,
          Math.min(dragRect.y + dragRect.height, candRect.y + candRect.height) -
            Math.max(dragRect.y, candRect.y),
        );

        const isSibling =
          cand.parent_id === drag.parentId &&
          (cand.parent_id !== rootId || getBranchSide(cand.id, scopedItems) === drag.side);

        if (isSibling) {
          // Para um nó irmão: a faixa central (30%..70% da altura) reaninha dentro dele;
          // as faixas superior/inferior (0..30% e 70..100%) acionam a linha guia de reordenação entre irmãos!
          const inCenterBand =
            dragRect.cy >= candRect.y + candRect.height * 0.3 &&
            dragRect.cy <= candRect.y + candRect.height * 0.7;
          if (inCenterBand && overlapX > candRect.width * 0.4 && overlapY > 12) {
            const area = overlapX * overlapY;
            if (area > bestOverlapArea) {
              bestOverlapArea = area;
              bestTargetId = cand.id;
            }
          }
        } else if (overlapX > 20 && overlapY > 12) {
          // Se for a raiz e o nó já é filho da raiz no mesmo lado, ignora
          if (cand.id === rootId && drag.parentId === rootId) continue;
          const area = overlapX * overlapY;
          if (area > bestOverlapArea) {
            bestOverlapArea = area;
            bestTargetId = cand.id;
          }
        }
      }

      if (bestTargetId) {
        if (dropTargetRef.current !== bestTargetId) {
          dropTargetRef.current = bestTargetId;
          setDropTargetId(bestTargetId);
        }
        setDropIndicator(null);
        return;
      }

      if (dropTargetRef.current !== null) {
        dropTargetRef.current = null;
        setDropTargetId(null);
      }

      // 2. Exibir linha guia horizontal para reordenamento entre irmãos
      const others = drag.siblings.filter((s) => s.id !== node.id);
      if (others.length === 0 || Math.abs(node.position.x - drag.fixedX) > 110) {
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

      const currentCenterY = dragRect.cy;
      const k = otherNodes.length;
      let targetIndex = 0;
      let indicatorY = otherNodes[0].y - MIN_GAP_Y / 2;

      if (currentCenterY < otherNodes[0].centerY) {
        targetIndex = 0;
        indicatorY = otherNodes[0].y - MIN_GAP_Y / 2;
      } else if (currentCenterY >= otherNodes[k - 1].centerY) {
        targetIndex = k;
        indicatorY = otherNodes[k - 1].y + otherNodes[k - 1].height + MIN_GAP_Y / 2;
      } else {
        for (let i = 0; i < k - 1; i++) {
          if (currentCenterY >= otherNodes[i].centerY && currentCenterY < otherNodes[i + 1].centerY) {
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
    [rootId, items, visibleMind, scopedItems, getBranchSide],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: MindNode | ProcessNode) => {
      setActiveDragId(null);
      const indicator = dropIndicator;
      setDropIndicator(null);
      const targetParentId = dropTargetRef.current;
      dropTargetRef.current = null;
      setDropTargetId(null);
      const drag = dragRef.current;
      dragRef.current = null;

      // Forma de processo independente: salva posição no canvas
      if (items[node.id]?.canvas?.shape && node.id !== rootId) {
        updateItem(node.id, {
          canvas: {
            ...(items[node.id]?.canvas ?? { x: 0, y: 0 }),
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          },
        });
        return;
      }

      const draggedItem = items[node.id];
      if (!draggedItem || !drag || drag.isProcessNode) {
        // Garante que qualquer nó da árvore volte imediatamente para sua coordenada determinística da grade
        setNodes((prev) =>
          prev.map((n) => {
            const it = items[n.id];
            return it?.canvas ? { ...n, position: { x: it.canvas.x, y: it.canvas.y } } : n;
          }),
        );
        return;
      }

      // Caso 1: Reaninhar (Mover para dentro de outro nó alvo)
      if (
        targetParentId &&
        targetParentId !== node.id &&
        !drag.forbiddenIds.has(targetParentId) &&
        scopedItems[targetParentId]
      ) {
        const nextCollapsed = new Set(collapsed);
        if (nextCollapsed.has(targetParentId)) {
          nextCollapsed.delete(targetParentId);
          setCollapsed(nextCollapsed);
          saveMapStatePatch(rootId, { collapsedIds: Array.from(nextCollapsed) });
        }

        const targetSiblings = Object.values(scopedItems).filter(
          (i) => i.parent_id === targetParentId && i.id !== node.id && !i.canvas?.shape,
        );
        const maxOrder = targetSiblings.reduce((m, s) => Math.max(m, s.sort_order), -10);
        const nextSortOrder = maxOrder + 10;

        const rootX = root?.canvas?.x ?? 0;
        const targetItem = scopedItems[targetParentId];
        const targetSideDir =
          targetParentId === rootId
            ? node.position.x < rootX
              ? -1
              : 1
            : getBranchSide(targetParentId, scopedItems);
        const targetSideX =
          targetParentId === rootId
            ? rootX + targetSideDir * (DEFAULT_NODE_WIDTH + LEVEL_GAP_X)
            : (targetItem?.canvas?.x ?? rootX) + targetSideDir * (DEFAULT_NODE_WIDTH + LEVEL_GAP_X);

        const matchedKanbanStatus = getKanbanStatusForNode(scopedItems, targetParentId);

        const updatedItems: Record<string, ItemNode> = {
          ...scopedItems,
          [node.id]: {
            ...draggedItem,
            parent_id: targetParentId,
            sort_order: nextSortOrder,
            ...(matchedKanbanStatus ? { status: matchedKanbanStatus } : {}),
            ...(matchedKanbanStatus && targetItem?.project_id
              ? { project_id: targetItem.project_id }
              : {}),
            canvas: {
              ...(draggedItem.canvas ?? { color: null }),
              x: targetSideX,
              y: targetItem?.canvas?.y ?? 0,
              custom_pos: false,
            },
          },
        };

        const newPositions = layoutTree(updatedItems, rootId, nextCollapsed, dimensionsRef.current);
        const patches: { id: string; patch: Partial<ItemNode> }[] = [];

        for (const [id, p] of Object.entries(newPositions)) {
          if (isSubmap && id === rootId) continue;
          const cur = updatedItems[id];
          if (id === node.id) {
            patches.push({
              id,
              patch: {
                parent_id: targetParentId,
                sort_order: nextSortOrder,
                ...(matchedKanbanStatus ? { status: matchedKanbanStatus } : {}),
                ...(matchedKanbanStatus && targetItem?.project_id
                  ? { project_id: targetItem.project_id }
                  : {}),
                canvas: {
                  ...(draggedItem.canvas ?? { color: null }),
                  ...p,
                  custom_pos: false,
                },
              },
            });
          } else if (cur) {
            patches.push({
              id,
              patch: {
                canvas: {
                  ...(cur.canvas ?? { color: null }),
                  ...p,
                  custom_pos: false,
                },
              },
            });
          }
        }

        updateItems(patches);
        return;
      }

      // Caso 2: Reordenar entre irmãos (quando solto com indicador de mudança de ordem)
      if (indicator && indicator.targetIndex !== drag.initialIndex) {
        const others = drag.siblings.filter((s) => s.id !== node.id);
        const targetIdx = indicator.targetIndex;

        const reordered = [
          ...others.slice(0, targetIdx),
          draggedItem,
          ...others.slice(targetIdx),
        ];

        const updatedItems: Record<string, ItemNode> = { ...scopedItems };
        const orderMap = new Map<string, number>();
        reordered.forEach((s, idx) => {
          const nextOrder = idx * 10;
          orderMap.set(s.id, nextOrder);
          updatedItems[s.id] = { ...updatedItems[s.id], sort_order: nextOrder };
        });

        const newPositions = layoutTree(updatedItems, rootId, collapsed, dimensionsRef.current);
        const patches: { id: string; patch: Partial<ItemNode> }[] = [];

        for (const [id, p] of Object.entries(newPositions)) {
          if (isSubmap && id === rootId) continue;
          const cur = updatedItems[id];
          if (!cur) continue;
          patches.push({
            id,
            patch: {
              ...(orderMap.has(id) ? { sort_order: orderMap.get(id)! } : {}),
              canvas: {
                ...(cur.canvas ?? { color: null }),
                ...p,
                custom_pos: false,
              },
            },
          });
        }

        updateItems(patches);
        return;
      }

      // Caso 3: Solto no vazio ou sem alteração de índice -> Encaixa de volta na posição determinística da grade
      const pos = layoutTree(scopedItems, rootId, collapsed, dimensionsRef.current);
      setNodes((prev) =>
        prev.map((n) => {
          const p = pos[n.id] ?? items[n.id]?.canvas;
          return p ? { ...n, position: { x: p.x, y: p.y } } : n;
        }),
      );
    },
    [dropIndicator, rootId, root?.canvas?.x, items, scopedItems, isSubmap, collapsed, getBranchSide, updateItem, updateItems],
  );

  const deleteLinkEdge = useCallback(
    (sourceId: string, targetId: string) => {
      const currentItems = useStore.getState().items;
      const sourceItem = currentItems[sourceId];
      if (!sourceItem) return;
      const nextLinks = (sourceItem.links || []).filter((id) => id !== targetId);
      let nextCanvas = sourceItem.canvas ? { ...sourceItem.canvas } : null;
      if (nextCanvas?.link_handles && targetId in nextCanvas.link_handles) {
        const restHandles = { ...nextCanvas.link_handles };
        delete restHandles[targetId];
        nextCanvas = {
          ...nextCanvas,
          link_handles: Object.keys(restHandles).length > 0 ? restHandles : null,
        };
      }
      updateItem(sourceId, {
        links: nextLinks,
        ...(nextCanvas ? { canvas: nextCanvas } : {}),
      });
      setSelectedEdgeIds((prev) => {
        const edgeId = `l-${sourceId}-${targetId}`;
        if (!prev.has(edgeId)) return prev;
        const next = new Set(prev);
        next.delete(edgeId);
        return next;
      });
    },
    [updateItem],
  );

  const normalizeHandleForNode = useCallback(
    (nodeId: string, handleId: string | null | undefined, role: "source" | "target"): string | undefined => {
      if (!handleId) return undefined;
      const nodeItem = useStore.getState().items[nodeId];
      if (nodeItem?.canvas?.shape) {
        const suffix = role === "source" ? "-s" : "-t";
        return handleId.replace(/-(s|t)$/, suffix);
      }
      if (handleId.startsWith("l")) return role === "source" ? "l-s" : "l-t";
      if (handleId.startsWith("r")) return role === "source" ? "r-s" : "r-t";
      return handleId;
    },
    [],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const currentItems = useStore.getState().items;
      const sourceItem = currentItems[c.source];
      if (!sourceItem) return;

      const normSourceHandle = normalizeHandleForNode(c.source, c.sourceHandle, "source");
      const normTargetHandle = normalizeHandleForNode(c.target, c.targetHandle, "target");

      const currentLinks = sourceItem.links || [];
      const nextLinks = currentLinks.includes(c.target) ? currentLinks : [...currentLinks, c.target];
      const prevHandles = sourceItem.canvas?.link_handles ?? {};

      updateItem(c.source, {
        links: nextLinks,
        canvas: {
          ...(sourceItem.canvas ?? { x: 0, y: 0 }),
          link_handles: {
            ...prevHandles,
            [c.target]: {
              sourceHandle: normSourceHandle ?? prevHandles[c.target]?.sourceHandle ?? null,
              targetHandle: normTargetHandle ?? prevHandles[c.target]?.targetHandle ?? null,
            },
          },
        },
      });
      setSelectedEdgeIds(new Set([`l-${c.source}-${c.target}`]));
    },
    [normalizeHandleForNode, updateItem],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!oldEdge.data?.link) return;
      if (!newConnection.source || !newConnection.target || newConnection.source === newConnection.target) return;

      const currentItems = useStore.getState().items;
      const normSourceHandle = normalizeHandleForNode(newConnection.source, newConnection.sourceHandle, "source");
      const normTargetHandle = normalizeHandleForNode(newConnection.target, newConnection.targetHandle, "target");

      if (oldEdge.source === newConnection.source && oldEdge.target === newConnection.target) {
        const sourceItem = currentItems[oldEdge.source];
        if (!sourceItem) return;
        const prevHandles = sourceItem.canvas?.link_handles ?? {};
        updateItem(oldEdge.source, {
          canvas: {
            ...(sourceItem.canvas ?? { x: 0, y: 0 }),
            link_handles: {
              ...prevHandles,
              [oldEdge.target]: {
                sourceHandle: normSourceHandle ?? prevHandles[oldEdge.target]?.sourceHandle ?? null,
                targetHandle: normTargetHandle ?? prevHandles[oldEdge.target]?.targetHandle ?? null,
              },
            },
          },
        });
        setSelectedEdgeIds(new Set([`l-${newConnection.source}-${newConnection.target}`]));
        return;
      }

      // Se a reconexão mudou o nó de origem ou o nó de destino:
      const oldSourceItem = currentItems[oldEdge.source];
      const newSourceItem = currentItems[newConnection.source];
      if (!newSourceItem) return;

      if (oldEdge.source === newConnection.source) {
        // Mesma origem, novo destino
        const filteredLinks = (oldSourceItem?.links || []).filter((id) => id !== oldEdge.target);
        const nextLinks = filteredLinks.includes(newConnection.target)
          ? filteredLinks
          : [...filteredLinks, newConnection.target];
        const nextHandles = { ...(oldSourceItem?.canvas?.link_handles ?? {}) };
        delete nextHandles[oldEdge.target];
        nextHandles[newConnection.target] = {
          sourceHandle: normSourceHandle ?? null,
          targetHandle: normTargetHandle ?? null,
        };
        updateItem(oldEdge.source, {
          links: nextLinks,
          canvas: {
            ...(oldSourceItem?.canvas ?? { x: 0, y: 0 }),
            link_handles: nextHandles,
          },
        });
      } else {
        // Origem diferente
        const patches: { id: string; patch: Partial<ItemNode> }[] = [];
        if (oldSourceItem) {
          const oldHandles = { ...(oldSourceItem.canvas?.link_handles ?? {}) };
          delete oldHandles[oldEdge.target];
          patches.push({
            id: oldEdge.source,
            patch: {
              links: (oldSourceItem.links || []).filter((id) => id !== oldEdge.target),
              canvas: {
                ...(oldSourceItem.canvas ?? { x: 0, y: 0 }),
                link_handles: Object.keys(oldHandles).length > 0 ? oldHandles : null,
              },
            },
          });
        }
        const newLinks = (newSourceItem.links || []).includes(newConnection.target)
          ? newSourceItem.links
          : [...(newSourceItem.links || []), newConnection.target];
        const newHandles = {
          ...(newSourceItem.canvas?.link_handles ?? {}),
          [newConnection.target]: {
            sourceHandle: normSourceHandle ?? null,
            targetHandle: normTargetHandle ?? null,
          },
        };
        patches.push({
          id: newConnection.source,
          patch: {
            links: newLinks,
            canvas: {
              ...(newSourceItem.canvas ?? { x: 0, y: 0 }),
              link_handles: newHandles,
            },
          },
        });
        updateItems(patches);
      }

      setSelectedEdgeIds(new Set([`l-${newConnection.source}-${newConnection.target}`]));
    },
    [normalizeHandleForNode, updateItem, updateItems],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      for (const ch of changes) {
        if (ch.type === "select") {
          if (!ch.id.startsWith("l-")) continue;
          setSelectedEdgeIds((prev) => {
            const next = new Set(prev);
            if (ch.selected) next.add(ch.id);
            else next.delete(ch.id);
            return next;
          });
        } else if (ch.type === "remove") {
          if (!ch.id.startsWith("l-")) continue;
          const targetEdge = edges.find((e) => e.id === ch.id);
          if (targetEdge?.data?.link) {
            deleteLinkEdge(targetEdge.source, targetEdge.target);
          }
        }
      }
    },
    [edges, deleteLinkEdge],
  );

  const onEdgesDelete = useCallback(
    (es: Edge[]) => {
      es.forEach((e) => {
        if (e.data?.link) {
          deleteLinkEdge(e.source, e.target);
        }
      });
    },
    [deleteLinkEdge],
  );

  const selectOnly = useCallback((id: string) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  }, []);

  /* ---- addChild (Ramo do Mapa): Auto-layout determinístico bilateral e modo edição imediato ---- */
  const addChild = useCallback(
    (parentId: string) => {
      const parent = items[parentId];
      if (!parent) return;
      const rootX = root?.canvas?.x ?? 0;
      const kids = Object.values(scopedItems).filter((i) => i.parent_id === parentId && !i.canvas?.shape);

      let dir: 1 | -1 = getBranchSide(parentId, scopedItems);
      if (parentId === rootId) {
        const right = kids.filter(
          (k) =>
            (k.canvas?.x ?? rootX + 1) >= rootX &&
            k.title?.trim().toLowerCase() !== "contexto",
        ).length;
        dir = right <= kids.length - right ? 1 : -1;
      }

      const maxOrder = kids.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const parentX = parent.canvas?.x ?? rootX;
      const parentY = parent.canvas?.y ?? 0;
      const initialX =
        dir === 1
          ? parentX + DEFAULT_NODE_WIDTH + LEVEL_GAP_X
          : parentX - DEFAULT_NODE_WIDTH - LEVEL_GAP_X;

      const n = createItem({
        parent_id: parentId,
        scope_node_id: activeScopeId,
        type: "MINDMAP_NODE",
        title: "Novo ramo",
        project_id: parent.project_id ?? root?.project_id ?? null,
        sort_order: maxOrder + 10,
        canvas: { x: initialX, y: parentY, color: null, custom_pos: false },
      });

      const nextCollapsed = new Set(collapsed);
      if (nextCollapsed.has(parentId)) {
        nextCollapsed.delete(parentId);
        setCollapsed(nextCollapsed);
        saveMapStatePatch(rootId, { collapsedIds: Array.from(nextCollapsed) });
      }

      const updatedScope: Record<string, ItemNode> = {
        ...scopedItems,
        [n.id]: n,
      };
      const pos = layoutTree(updatedScope, rootId, nextCollapsed, dimensionsRef.current);
      updateItems(
        Object.entries(pos)
          .filter(([nodeId]) => !(isSubmap && nodeId === rootId))
          .map(([nodeId, p]) => ({
            id: nodeId,
            patch: {
              canvas: {
                ...(updatedScope[nodeId]?.canvas ?? { color: null }),
                ...p,
                custom_pos: false,
              },
            },
          })),
      );

      setEditingId(n.id);
      setTimeout(() => selectOnly(n.id), 0);
    },
    [items, scopedItems, activeScopeId, root, rootId, isSubmap, getBranchSide, createItem, updateItems, collapsed, selectOnly],
  );

  /* ---- addSibling (Irmão do Mapa): Insere abaixo do nó ativo no mesmo lado e recalcula a árvore ---- */
  const addSibling = useCallback(
    (id: string) => {
      const it = items[id];
      if (!it || !it.parent_id || id === rootId) return;

      const parent = items[it.parent_id];
      if (!parent) return;

      const rootX = root?.canvas?.x ?? 0;
      const dir = getBranchSide(id, scopedItems);

      const siblings = Object.values(scopedItems)
        .filter((i) => {
          if (i.parent_id !== it.parent_id || i.canvas?.shape) return false;
          if (it.parent_id === rootId) {
            return getBranchSide(i.id, scopedItems) === dir;
          }
          return true;
        })
        .sort((a, b) => a.sort_order - b.sort_order);

      const currentIdx = siblings.findIndex((s) => s.id === id);
      const insertIdx = currentIdx >= 0 ? currentIdx + 1 : siblings.length;

      const initialX =
        it.parent_id === rootId
          ? dir === 1
            ? rootX + DEFAULT_NODE_WIDTH + LEVEL_GAP_X
            : rootX - DEFAULT_NODE_WIDTH - LEVEL_GAP_X
          : it.canvas?.x ?? 0;
      const initialY = it.canvas?.y ?? 0;

      const n = createItem({
        parent_id: it.parent_id,
        scope_node_id: activeScopeId,
        type: "MINDMAP_NODE",
        title: "Novo ramo",
        project_id: it.project_id ?? root?.project_id ?? null,
        sort_order: insertIdx * 10,
        canvas: { x: initialX, y: initialY, color: null, custom_pos: false },
      });

      const reorderedSiblings = [
        ...siblings.slice(0, insertIdx),
        n,
        ...siblings.slice(insertIdx),
      ];

      const updatedScope: Record<string, ItemNode> = {
        ...scopedItems,
        [n.id]: n,
      };
      reorderedSiblings.forEach((s, idx) => {
        updatedScope[s.id] = { ...updatedScope[s.id], sort_order: idx * 10 };
      });

      const pos = layoutTree(updatedScope, rootId, collapsed, dimensionsRef.current);
      const siblingOrderMap = new Map(reorderedSiblings.map((s, idx) => [s.id, idx * 10]));

      updateItems(
        Object.entries(pos)
          .filter(([nodeId]) => !(isSubmap && nodeId === rootId))
          .map(([nodeId, p]) => ({
            id: nodeId,
            patch: {
              ...(siblingOrderMap.has(nodeId) ? { sort_order: siblingOrderMap.get(nodeId)! } : {}),
              canvas: {
                ...(updatedScope[nodeId]?.canvas ?? { color: null }),
                ...p,
                custom_pos: false,
              },
            },
          })),
      );

      setEditingId(n.id);
      setTimeout(() => selectOnly(n.id), 0);
    },
    [items, scopedItems, activeScopeId, root, rootId, isSubmap, getBranchSide, collapsed, createItem, updateItems, selectOnly],
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
        scope_node_id: activeScopeId,
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
    [rf, rootId, activeScopeId, root?.project_id, createItem, selectOnly],
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
      const targetH = shape === "diamond" ? 100 : shape === "circle" ? 80 : 80;

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
        scope_node_id: activeScopeId,
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
    [items, rootId, activeScopeId, root?.project_id, createItem, updateItem, selectOnly],
  );

  const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);

  const removeSelected = useCallback(() => {
    const ids = selectedIds.filter((id) => id !== rootId);
    if (!ids.length) return;
    const withKids = ids.some((id) => (childCounts[id] ?? 0) > 0);
    if (withKids && !confirm("Alguns nós possuem ramos filhos. Excluir tudo?")) return;

    ids.forEach((id) => deleteItem(id));

    setTimeout(() => {
      const allNow = useStore.getState().items;
      const rootNode = allNow[rootId];
      if (!rootNode) return;
      const remainingScoped: Record<string, ItemNode> = { [rootId]: rootNode };
      for (const it of Object.values(allNow)) {
        if (it.id === rootId) continue;
        if ((it.scope_node_id ?? null) === activeScopeId) {
          remainingScoped[it.id] = it;
        }
      }
      const pos = layoutTree(remainingScoped, rootId, collapsed, dimensionsRef.current);
      useStore.getState().updateItems(
        Object.entries(pos)
          .filter(([nodeId]) => !(isSubmap && nodeId === rootId))
          .map(([nodeId, p]) => ({
            id: nodeId,
            patch: { canvas: { ...(remainingScoped[nodeId]?.canvas ?? {}), ...p, custom_pos: false } },
          })),
      );
    }, 0);
  }, [selectedIds, rootId, activeScopeId, isSubmap, childCounts, deleteItem, collapsed]);

  const collapsibleParentIds = useMemo(() => {
    const nonRootParents = mindScope
      .filter((it) => it.id !== rootId && (childCounts[it.id] ?? 0) > 0)
      .map((it) => it.id);
    if (nonRootParents.length > 0) return nonRootParents;
    if ((childCounts[rootId] ?? 0) > 0) return [rootId];
    return [];
  }, [mindScope, rootId, childCounts]);

  const hasExpandedBranches = useMemo(
    () => collapsibleParentIds.some((id) => !collapsed.has(id)),
    [collapsibleParentIds, collapsed],
  );

  const autoLayout = useCallback(() => {
    const nextCollapsed =
      collapsibleParentIds.length > 0 && hasExpandedBranches
        ? new Set<string>(collapsibleParentIds)
        : new Set<string>();

    setCollapsed(nextCollapsed);
    saveMapStatePatch(rootId, { collapsedIds: Array.from(nextCollapsed) });

    const pos = layoutTree(mindScope, rootId, nextCollapsed, dimensionsRef.current);
    updateItems(
      Object.entries(pos)
        .filter(([id]) => !(isSubmap && id === rootId))
        .map(([id, p]) => ({
          id,
          patch: { canvas: { ...(items[id]?.canvas ?? {}), ...p, custom_pos: false } },
        })),
    );

    setTimeout(() => {
      rf.fitView({ duration: 400, padding: 0.2 });
    }, 80);
  }, [collapsibleParentIds, hasExpandedBranches, mindScope, rootId, isSubmap, items, updateItems, rf]);

  const setColor = (c: string) =>
    updateItems(selectedIds.map((id) => ({ id, patch: { canvas: { ...(items[id]?.canvas ?? { x: 0, y: 0 }), color: c } } })));

  const toTask = () =>
    updateItems(
      selectedIds.map((id) => ({ id, patch: { status: items[id]?.status ?? "TODO", project_id: items[id]?.project_id ?? root?.project_id ?? null } })),
    );

  /* ---- Reordenamento de Irmãos via Teclado (Ctrl/Cmd + ArrowUp / ArrowDown) ---- */
  const moveSiblingOrder = useCallback(
    (id: string, delta: -1 | 1) => {
      const it = items[id];
      if (!it || !it.parent_id || id === rootId || it.canvas?.shape) return;

      const dir = getBranchSide(id, scopedItems);
      const siblings = Object.values(scopedItems)
        .filter((s) => {
          if (s.parent_id !== it.parent_id || s.canvas?.shape) return false;
          if (it.parent_id === rootId) {
            return getBranchSide(s.id, scopedItems) === dir;
          }
          return true;
        })
        .sort((a, b) => a.sort_order - b.sort_order || (a.canvas?.y ?? 0) - (b.canvas?.y ?? 0));

      const idx = siblings.findIndex((s) => s.id === id);
      const targetIdx = idx + delta;
      if (idx < 0 || targetIdx < 0 || targetIdx >= siblings.length) return;

      const reordered = [...siblings];
      const [moved] = reordered.splice(idx, 1);
      reordered.splice(targetIdx, 0, moved);

      const updatedScope: Record<string, ItemNode> = { ...scopedItems };
      const orderMap = new Map<string, number>();
      reordered.forEach((s, i) => {
        const nextOrder = i * 10;
        orderMap.set(s.id, nextOrder);
        updatedScope[s.id] = { ...updatedScope[s.id], sort_order: nextOrder };
      });

      const pos = layoutTree(updatedScope, rootId, collapsed, dimensionsRef.current);
      const patches: { id: string; patch: Partial<ItemNode> }[] = [];

      for (const [nodeId, p] of Object.entries(pos)) {
        if (isSubmap && nodeId === rootId) continue;
        const cur = updatedScope[nodeId];
        if (!cur) continue;
        patches.push({
          id: nodeId,
          patch: {
            ...(orderMap.has(nodeId) ? { sort_order: orderMap.get(nodeId)! } : {}),
            canvas: {
              ...(cur.canvas ?? { color: null }),
              ...p,
              custom_pos: false,
            },
          },
        });
      }

      if (patches.length > 0) {
        updateItems(patches);
      }
    },
    [items, scopedItems, rootId, isSubmap, getBranchSide, collapsed, updateItems],
  );

  /* ---- keyboard shortcuts ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true], select") || useStore.getState().drawerId) return;
      if (!wrapRef.current) return;
      const sel = selectedIds[0];

      if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown") && sel) {
        e.preventDefault();
        moveSiblingOrder(sel, e.key === "ArrowUp" ? -1 : 1);
      } else if (e.key === "Tab" && sel) {
        e.preventDefault();
        addChild(sel);
      } else if (e.key === "Enter" && sel) {
        e.preventDefault();
        if (sel === rootId) addChild(sel);
        else addSibling(sel);
      } else if (e.key === "F2" && sel) {
        e.preventDefault();
        setEditingId(sel);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedEdgeIds.size > 0) {
        e.preventDefault();
        for (const edgeId of Array.from(selectedEdgeIds)) {
          const targetEdge = edges.find((ed) => ed.id === edgeId);
          if (targetEdge?.data?.link) {
            deleteLinkEdge(targetEdge.source, targetEdge.target);
          }
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, selectedEdgeIds, edges, deleteLinkEdge, addChild, addSibling, moveSiblingOrder, removeSelected, rootId]);

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
          const wasCollapsed = s.has(id);
          const c = new Set(s);
          if (wasCollapsed) c.delete(id);
          else c.add(id);

          saveMapStatePatch(rootId, { collapsedIds: Array.from(c) });

          setTimeout(() => {
            const currentItems = useStore.getState().items;
            const rootNode = currentItems[rootId];
            if (!rootNode) return;
            const currentScoped: Record<string, ItemNode> = { [rootId]: rootNode };
            for (const it of Object.values(currentItems)) {
              if (it.id === rootId) continue;
              if ((it.scope_node_id ?? null) === activeScopeId) {
                currentScoped[it.id] = it;
              }
            }
            const pos = layoutTree(currentScoped, rootId, c, dimensionsRef.current);
            useStore.getState().updateItems(
              Object.entries(pos)
                .filter(([nodeId]) => !(isSubmap && nodeId === rootId))
                .map(([nodeId, p]) => ({
                  id: nodeId,
                  patch: {
                    canvas: {
                      ...(currentScoped[nodeId]?.canvas ?? { color: null }),
                      ...p,
                      custom_pos: false,
                    },
                  },
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
          scope_node_id: activeScopeId,
          project_id: items[parentId]?.project_id ?? root?.project_id ?? null,
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
          const allNow = useStore.getState().items;
          const rootNode = allNow[rootId];
          if (!rootNode) return;
          const remainingScoped: Record<string, ItemNode> = { [rootId]: rootNode };
          for (const it of Object.values(allNow)) {
            if (it.id === rootId) continue;
            if ((it.scope_node_id ?? null) === activeScopeId) {
              remainingScoped[it.id] = it;
            }
          }
          const pos = layoutTree(remainingScoped, rootId, collapsed, dimensionsRef.current);
          useStore.getState().updateItems(
            Object.entries(pos)
              .filter(([nodeId]) => !(isSubmap && nodeId === rootId))
              .map(([nodeId, p]) => ({
                id: nodeId,
                patch: { canvas: { ...(remainingScoped[nodeId]?.canvas ?? {}), ...p, custom_pos: false } },
              })),
          );
        }, 0);
      },
      quickAddConnected: (sourceId, shape, direction) =>
        quickAddConnected(sourceId, shape, direction),
      deleteLinkEdge: (sourceId, targetId) => deleteLinkEdge(sourceId, targetId),
    }),
    [updateItem, openDrawer, createItem, deleteItem, rootId, activeScopeId, isSubmap, root?.project_id, collapsed, scheduleRelayout, items, quickAddConnected, deleteLinkEdge],
  );

  if (!root) return <div className="empty-state"><h1>Mapa não encontrado</h1></div>;

  return (
    <MindCtx.Provider value={ctx}>
      <div className="canvas-wrap" ref={wrapRef}>
        <ReactFlow<MindNode | ProcessNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={true}
          connectionMode={ConnectionMode.Loose}
          edgesReconnectable={true}
          reconnectRadius={24}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onEdgesDelete={onEdgesDelete}
          onEdgeClick={(event, edge) => {
            if (!edge.data?.link) return;
            event.stopPropagation();
            setSelectedEdgeIds((prev) => {
              if (event.shiftKey) {
                const next = new Set(prev);
                if (next.has(edge.id)) next.delete(edge.id);
                else next.add(edge.id);
                return next;
              }
              return new Set([edge.id]);
            });
            setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
          }}
          onNodeClick={() => {
            setSelectedEdgeIds((prev) => (prev.size > 0 ? new Set() : prev));
          }}
          onMoveEnd={(_event, viewport) => {
            latestViewportRef.current = viewport;
            saveMapStatePatch(rootId, { viewport });
          }}
          onPaneClick={() => {
            setEditingId(null);
            setProcessMenuOpen(false);
            setSelectedEdgeIds((prev) => (prev.size > 0 ? new Set() : prev));
          }}
          onPaneContextMenu={(e) => e.preventDefault()}
          panOnDrag={[1, 2]}
          selectionOnDrag={true}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode={null}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          fitView={false}
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

          {/* Linha guia de inserção entre irmãos renderizada dinamicamente no viewport */}
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

          <Panel
            position="top-left"
            className="canvas-panel glass"
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            {isSubmap && breadcrumbTrail.length > 0 ? (
              <>
                <Link
                  href={`/canvas/${breadcrumbTrail[breadcrumbTrail.length - 1].mapItem.id}?focusNode=${breadcrumbTrail[breadcrumbTrail.length - 1].focusNodeId}`}
                  className="btn btn-ghost btn-xs"
                  title="Voltar ao mapa anterior centralizando neste nó"
                >
                  <ArrowLeft size={13} />
                  <span>Voltar</span>
                </Link>

                <div
                  className="submap-breadcrumb"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12.5,
                    padding: "2px 6px",
                    flexWrap: "wrap",
                  }}
                >
                  {breadcrumbTrail.map((step) => (
                    <span
                      key={step.mapItem.id}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      <Link
                        href={`/canvas/${step.mapItem.id}?focusNode=${step.focusNodeId}`}
                        className="muted"
                        style={{ textDecoration: "none", fontWeight: 500 }}
                        title={`Voltar para ${step.label}`}
                      >
                        {step.label}
                      </Link>
                      <ChevronRight size={12} className="muted" />
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => openDrawer(root.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--text)",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: 0,
                      fontSize: "inherit",
                    }}
                    title="Abrir detalhes deste nó na gaveta"
                  >
                    {typeIcon(root)} {root.title || "Sem título"}
                  </button>
                  <ChevronRight size={12} className="muted" />
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "rgba(124, 92, 255, 0.14)",
                      color: "#a78bfa",
                      fontWeight: 600,
                      fontSize: 11.5,
                    }}
                  >
                    <Workflow size={11} />
                    Processo
                  </span>
                </div>
              </>
            ) : (
              <span className="canvas-root-title">{typeIcon(root)} {root.title || "Sem título"}</span>
            )}
            {(isSharedWithMe || rootShareCount > 0) && (
              <span className="shared-badge" title={isSharedWithMe ? "Compartilhado com você" : `Compartilhado com ${rootShareCount} pessoa(s)`}>
                <Users size={11} />
                <span>Compartilhado</span>
              </span>
            )}
            {root.project_id && (
              <Link
                href={`/board?project=${root.project_id}&tab=kanban`}
                className="btn btn-ghost btn-xs"
                title="Abrir quadro Kanban do projeto"
              >
                <KanbanSquare size={13} />
                <span>Quadro Kanban</span>
              </Link>
            )}
            <ViewSwitcher id={root.id} />
          </Panel>

          <Panel position="top-right" className="canvas-panel glass" style={{ overflow: "visible" }}>
            <button
              id="canvas-share-btn"
              className="btn btn-primary btn-xs"
              onClick={() => openShareModal(rootId)}
              title="Compartilhar mapa mental por e-mail"
            >
              <UserPlus size={14} /> Compartilhar{rootShareCount > 0 ? ` (${rootShareCount})` : ""}
            </button>

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

            <button
              id="canvas-auto-layout"
              className="btn btn-ghost btn-xs"
              onClick={autoLayout}
              title={
                hasExpandedBranches
                  ? "Recolher todos os nós e organizar"
                  : "Expandir tudo, organizar e enquadrar"
              }
            >
              {hasExpandedBranches ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}{" "}
              Organizar
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
            <kbd>Arrastar</kbd> reordenar/reaninhar · <kbd>Ctrl+↑/↓</kbd> subir/descer · <kbd>Tab</kbd> filho · <kbd>Enter</kbd> irmão · <kbd>F2</kbd> renomear · <kbd>Del</kbd> excluir
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
