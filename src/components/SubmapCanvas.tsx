"use client";

import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  ChevronRight,
  Circle,
  Diamond,
  FileText,
  LayoutGrid,
  Maximize,
  Plus,
  Square,
  Trash2,
  Workflow,
} from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "@/lib/store";
import type {
  ItemNode,
  ProcessShape,
  SubmapCanvasData,
  SubmapEdgeItem,
  SubmapNodeItem,
} from "@/lib/types";
import ViewSwitcher from "./ViewSwitcher";

const PALETTE = [
  "#7c5cff",
  "#ff4da6",
  "#00d4ff",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
];

type SubmapFlowNodeData = {
  nodeItem: SubmapNodeItem;
  editing: boolean;
};

type SubmapFlowNode = Node<SubmapFlowNodeData, "submapProcess">;

interface SubmapCtxValue {
  rename: (id: string, title: string) => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  updateDimensions: (id: string, width: number, height: number) => void;
  quickAddConnected: (
    sourceId: string,
    shape: ProcessShape,
    direction: "right" | "bottom" | "left" | "top",
  ) => void;
}

const SubmapCtx = createContext<SubmapCtxValue | null>(null);

const SubmapProcessNodeView = memo(function SubmapProcessNodeView({
  data,
  selected,
}: NodeProps<SubmapFlowNode>) {
  const ctx = useContext(SubmapCtx)!;
  const { nodeItem, editing } = data;
  const shape: ProcessShape = nodeItem.shape || "rectangle";
  const color = nodeItem.color || "#7c5cff";
  const [draft, setDraft] = useState(nodeItem.title);
  const [popoverAnchor, setPopoverAnchor] = useState<
    "right" | "bottom" | "left" | "top" | null
  >(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const defaultPlaceholder =
    shape === "diamond"
      ? "Decisão?"
      : shape === "circle"
      ? "Início / Fim"
      : "Etapa do Processo";

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    if (editing) {
      setDraft(nodeItem.title);
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.select();
          adjustTextareaHeight();
        }
      }, 25);
      return () => clearTimeout(timer);
    }
  }, [editing, nodeItem.title, adjustTextareaHeight]);

  useEffect(() => {
    if (editing) {
      adjustTextareaHeight();
    }
  }, [editing, draft, adjustTextareaHeight]);

  useEffect(() => {
    if (!popoverAnchor) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as unknown as HTMLElement)
      ) {
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
    ctx.rename(nodeItem.id, draft.trim() || defaultPlaceholder);
    ctx.stopEditing();
  };

  const handleResizeEnd = (
    _: unknown,
    params: { width: number; height: number },
  ) => {
    ctx.updateDimensions(
      nodeItem.id,
      Math.round(params.width),
      Math.round(params.height),
    );
  };

  const toggleAnchor = (dir: "right" | "bottom" | "left" | "top") => {
    setPopoverAnchor((cur) => (cur === dir ? null : dir));
  };

  return (
    <div
      className={`process-node shape-${shape} ${selected ? "is-selected" : ""}`}
      style={{
        ["--node" as string]: color,
        width:
          nodeItem.width ||
          (shape === "diamond" ? 140 : shape === "circle" ? 130 : 160),
        minHeight:
          nodeItem.height ||
          (shape === "diamond" ? 100 : shape === "circle" ? 70 : 80),
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        ctx.startEditing(nodeItem.id);
      }}
    >
      <NodeResizer
        minWidth={80}
        minHeight={40}
        isVisible={selected}
        color={color}
        onResizeEnd={handleResizeEnd}
      />

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
              ctx.quickAddConnected(nodeItem.id, "rectangle", dir);
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
              ctx.quickAddConnected(nodeItem.id, "diamond", dir);
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
              ctx.quickAddConnected(nodeItem.id, "circle", dir);
            }}
          >
            <Circle size={13} />
          </button>
        </div>
      )}

      {shape === "diamond" && (
        <svg
          className="process-diamond-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <polygon
            points="50,2 98,50 50,98 2,50"
            className="process-diamond-polygon"
          />
        </svg>
      )}

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
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.altKey &&
                !e.ctrlKey &&
                !e.metaKey
              ) {
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
          <span className="process-title">
            {nodeItem.title || <em className="muted">{defaultPlaceholder}</em>}
          </span>
        )}
      </div>
    </div>
  );
});

const submapNodeTypes = { submapProcess: SubmapProcessNodeView };

/** Walk up parent_id chain to find the root MindMap node of this item. */
function findRootMapItem(
  items: Record<string, ItemNode>,
  startItem: ItemNode | undefined,
): ItemNode | null {
  if (!startItem) return null;
  const visited = new Set<string>();
  let cur: ItemNode | undefined = startItem;
  while (cur && cur.parent_id && !visited.has(cur.id)) {
    visited.add(cur.id);
    const parent: ItemNode | undefined = items[cur.parent_id];
    if (!parent) break;
    cur = parent;
  }
  return cur && cur.id !== startItem.id ? cur : null;
}

function SubmapCanvasInner({ itemId }: { itemId: string }) {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const updateItem = useStore((s) => s.updateItem);
  const openDrawer = useStore((s) => s.openDrawer);
  const rf = useReactFlow();

  const item = items[itemId];
  const rootMap = useMemo(() => findRootMapItem(items, item), [items, item]);
  const project = useMemo(() => {
    const pid = item?.project_id ?? rootMap?.project_id;
    return pid ? projects[pid] ?? null : null;
  }, [item?.project_id, rootMap?.project_id, projects]);

  const projectDisplayName =
    project?.name || rootMap?.title || "Mapa Principal";
  const backMapHref = rootMap
    ? `/canvas/${rootMap.id}`
    : project?.page_id
    ? `/canvas/${project.page_id}`
    : "/";

  const [editingId, setEditingId] = useState<string | null>(null);
  const [processMenuOpen, setProcessMenuOpen] = useState(false);
  const [nodes, setNodes] = useState<SubmapFlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  const submapData: SubmapCanvasData = useMemo(
    () => ({
      nodes: Array.isArray(item?.submap_canvas_data?.nodes)
        ? item.submap_canvas_data!.nodes
        : [],
      edges: Array.isArray(item?.submap_canvas_data?.edges)
        ? item.submap_canvas_data!.edges
        : [],
    }),
    [item?.submap_canvas_data],
  );

  const persistSubmap = useCallback(
    (nextNodes: SubmapNodeItem[], nextEdges: SubmapEdgeItem[]) => {
      if (!item) return;
      updateItem(item.id, {
        submap_canvas_data: {
          nodes: nextNodes,
          edges: nextEdges,
        },
      });
    },
    [item, updateItem],
  );

  // Sync persisted submapData -> ReactFlow nodes & edges
  useEffect(() => {
    setNodes((prevNodes) => {
      const selectedSet = new Set(
        prevNodes.filter((n) => n.selected).map((n) => n.id),
      );
      return submapData.nodes.map((n) => ({
        id: n.id,
        type: "submapProcess",
        position: { x: n.x, y: n.y },
        selected: selectedSet.has(n.id),
        data: {
          nodeItem: n,
          editing: editingId === n.id,
        },
      }));
    });

    setEdges(
      submapData.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? "right-s",
        targetHandle: e.targetHandle ?? "left-t",
        type: "smoothstep",
        animated: true,
        style: {
          stroke: "#7c5cff",
          strokeWidth: 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "#7c5cff",
        },
      })),
    );
  }, [submapData, editingId]);

  const selectOnly = useCallback((id: string) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  }, []);

  const addShapeNode = useCallback(
    (shape: ProcessShape) => {
      if (!item) return;
      const count = submapData.nodes.length;
      const defaultTitle =
        shape === "diamond"
          ? "Decisão?"
          : shape === "circle"
          ? count === 0
            ? "Início"
            : "Fim"
          : count === 0
          ? item.title || "Início do Processo"
          : "Nova Etapa";
      const defaultColor =
        shape === "diamond"
          ? "#f59e0b"
          : shape === "circle"
          ? "#22c55e"
          : "#7c5cff";

      const newId = crypto.randomUUID();
      const newNode: SubmapNodeItem = {
        id: newId,
        title: defaultTitle,
        x: count === 0 ? 120 : 120 + (count % 4) * 230,
        y: count === 0 ? 120 : 120 + Math.floor(count / 4) * 140,
        shape,
        color: defaultColor,
        width: shape === "diamond" ? 150 : shape === "circle" ? 130 : 170,
        height: shape === "diamond" ? 105 : shape === "circle" ? 70 : 80,
      };

      const nextNodes = [...submapData.nodes, newNode];
      persistSubmap(nextNodes, submapData.edges);
      setProcessMenuOpen(false);
      setEditingId(newId);
      setTimeout(() => selectOnly(newId), 20);
    },
    [item, submapData, persistSubmap, selectOnly],
  );

  const quickAddConnected = useCallback(
    (
      sourceId: string,
      shape: ProcessShape,
      direction: "right" | "bottom" | "left" | "top",
    ) => {
      const source = submapData.nodes.find((n) => n.id === sourceId);
      if (!source) return;

      const srcW =
        source.width ||
        (source.shape === "diamond" ? 140 : source.shape === "circle" ? 130 : 160);
      const srcH =
        source.height ||
        (source.shape === "diamond" ? 100 : source.shape === "circle" ? 70 : 80);
      const newW = shape === "diamond" ? 150 : shape === "circle" ? 130 : 170;
      const newH = shape === "diamond" ? 105 : shape === "circle" ? 70 : 80;
      const GAP = 90;

      let targetX = source.x + srcW + GAP;
      let targetY = source.y + (srcH - newH) / 2;
      let sourceHandle = "right-s";
      let targetHandle = "left-t";

      if (direction === "bottom") {
        targetX = source.x + (srcW - newW) / 2;
        targetY = source.y + srcH + GAP;
        sourceHandle = "bottom-s";
        targetHandle = "top-t";
      } else if (direction === "left") {
        targetX = source.x - newW - GAP;
        targetY = source.y + (srcH - newH) / 2;
        sourceHandle = "left-s";
        targetHandle = "right-t";
      } else if (direction === "top") {
        targetX = source.x + (srcW - newW) / 2;
        targetY = source.y - newH - GAP;
        sourceHandle = "top-s";
        targetHandle = "bottom-t";
      }

      const defaultColor =
        shape === "diamond"
          ? "#f59e0b"
          : shape === "circle"
          ? "#22c55e"
          : source.color || "#7c5cff";
      const defaultTitle =
        shape === "diamond"
          ? "Decisão?"
          : shape === "circle"
          ? "Fim"
          : "Nova Etapa";

      const newId = crypto.randomUUID();
      const newNode: SubmapNodeItem = {
        id: newId,
        title: defaultTitle,
        x: Math.round(targetX),
        y: Math.round(targetY),
        shape,
        color: defaultColor,
        width: newW,
        height: newH,
      };

      const newEdge: SubmapEdgeItem = {
        id: `e-${sourceId}-${newId}-${crypto.randomUUID().slice(0, 6)}`,
        source: sourceId,
        target: newId,
        sourceHandle,
        targetHandle,
      };

      persistSubmap(
        [...submapData.nodes, newNode],
        [...submapData.edges, newEdge],
      );
      setEditingId(newId);
      setTimeout(() => selectOnly(newId), 20);
    },
    [submapData, persistSubmap, selectOnly],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<SubmapFlowNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, draggedNode: SubmapFlowNode) => {
      const nextNodes = submapData.nodes.map((n) =>
        n.id === draggedNode.id
          ? {
              ...n,
              x: Math.round(draggedNode.position.x),
              y: Math.round(draggedNode.position.y),
            }
          : n,
      );
      persistSubmap(nextNodes, submapData.edges);
    },
    [submapData, persistSubmap],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const duplicate = submapData.edges.some(
        (e) =>
          e.source === conn.source &&
          e.target === conn.target &&
          (e.sourceHandle ?? "right-s") === (conn.sourceHandle ?? "right-s") &&
          (e.targetHandle ?? "left-t") === (conn.targetHandle ?? "left-t"),
      );
      if (duplicate) return;

      const newEdge: SubmapEdgeItem = {
        id: `e-${conn.source}-${conn.target}-${crypto.randomUUID().slice(0, 6)}`,
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? "right-s",
        targetHandle: conn.targetHandle ?? "left-t",
      };
      persistSubmap(submapData.nodes, [...submapData.edges, newEdge]);
    },
    [submapData, persistSubmap],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const deletedIds = new Set(deleted.map((e) => e.id));
      const nextEdges = submapData.edges.filter((e) => !deletedIds.has(e.id));
      persistSubmap(submapData.nodes, nextEdges);
    },
    [submapData, persistSubmap],
  );

  const selectedIds = useMemo(
    () => nodes.filter((n) => n.selected).map((n) => n.id),
    [nodes],
  );

  const removeSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const removeSet = new Set(selectedIds);
    const nextNodes = submapData.nodes.filter((n) => !removeSet.has(n.id));
    const nextEdges = submapData.edges.filter(
      (e) => !removeSet.has(e.source) && !removeSet.has(e.target),
    );
    persistSubmap(nextNodes, nextEdges);
  }, [selectedIds, submapData, persistSubmap]);

  const setColor = useCallback(
    (color: string) => {
      if (!selectedIds.length) return;
      const selSet = new Set(selectedIds);
      const nextNodes = submapData.nodes.map((n) =>
        selSet.has(n.id) ? { ...n, color } : n,
      );
      persistSubmap(nextNodes, submapData.edges);
    },
    [selectedIds, submapData, persistSubmap],
  );

  const autoArrange = useCallback(() => {
    if (!submapData.nodes.length) return;
    const cols = Math.max(1, Math.ceil(Math.sqrt(submapData.nodes.length)));
    const nextNodes = submapData.nodes.map((n, idx) => ({
      ...n,
      x: 100 + (idx % cols) * 250,
      y: 120 + Math.floor(idx / cols) * 160,
    }));
    persistSubmap(nextNodes, submapData.edges);
    setTimeout(() => {
      rf.fitView({ duration: 350, padding: 0.25 });
    }, 60);
  }, [submapData, persistSubmap, rf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.closest("input, textarea, [contenteditable=true], select") ||
        useStore.getState().drawerId
      ) {
        return;
      }
      const sel = selectedIds[0];
      if (e.key === "Tab" && sel) {
        e.preventDefault();
        quickAddConnected(sel, "rectangle", "right");
      } else if (e.key === "Enter" && sel) {
        e.preventDefault();
        quickAddConnected(sel, "rectangle", "bottom");
      } else if (e.key === "F2" && sel) {
        e.preventDefault();
        setEditingId(sel);
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, quickAddConnected, removeSelected]);

  const ctxValue = useMemo<SubmapCtxValue>(
    () => ({
      rename: (id, title) => {
        const nextNodes = submapData.nodes.map((n) =>
          n.id === id ? { ...n, title } : n,
        );
        persistSubmap(nextNodes, submapData.edges);
      },
      startEditing: (id) => setEditingId(id),
      stopEditing: () => setEditingId(null),
      updateDimensions: (id, width, height) => {
        const nextNodes = submapData.nodes.map((n) =>
          n.id === id ? { ...n, width, height } : n,
        );
        persistSubmap(nextNodes, submapData.edges);
      },
      quickAddConnected,
    }),
    [submapData, persistSubmap, quickAddConnected],
  );

  if (!item) {
    return (
      <div className="empty-state">
        <h1>Nó não encontrado</h1>
      </div>
    );
  }

  return (
    <SubmapCtx.Provider value={ctxValue}>
      <div className="canvas-wrap" ref={wrapRef}>
        <ReactFlow<SubmapFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={submapNodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onEdgesChange={onEdgesChange}
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
          deleteKeyCode="Delete"
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1.05 }}
          minZoom={0.15}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.4}
            className="canvas-bg"
          />
          <MiniMap
            pannable
            zoomable
            className="canvas-minimap"
            nodeColor={(n) =>
              (n as SubmapFlowNode).data?.nodeItem?.color ?? "#7c5cff"
            }
            maskColor="var(--minimap-mask)"
          />
          <Controls showInteractive={false} className="canvas-controls" />

          {/* Cabeçalho com Trilha de Navegação (Breadcrumb) e botão de voltar ao mapa principal */}
          <Panel
            position="top-left"
            className="canvas-panel glass"
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            <Link
              href={backMapHref}
              className="btn btn-ghost btn-xs"
              title="Voltar para o mapa mental principal"
            >
              <ArrowLeft size={13} />
              <span>Mapa principal</span>
            </Link>

            <div
              className="submap-breadcrumb"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12.5,
                padding: "2px 6px",
              }}
            >
              <Link
                href={backMapHref}
                className="muted"
                style={{ textDecoration: "none", fontWeight: 500 }}
                title="Ir para o mapa principal do projeto"
              >
                {projectDisplayName}
              </Link>
              <ChevronRight size={12} className="muted" />
              <button
                type="button"
                onClick={() => openDrawer(item.id)}
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
                {item.icon ? `${item.icon} ` : ""}
                {item.title || "Sem título"}
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

            <ViewSwitcher id={item.id} />
          </Panel>

          {/* Barra de Ferramentas do Submapa Isolado */}
          <Panel
            position="top-right"
            className="canvas-panel glass"
            style={{ overflow: "visible" }}
          >
            <button
              className="btn btn-primary btn-xs"
              onClick={() => addShapeNode("rectangle")}
              title="Adicionar nova etapa (Retângulo)"
            >
              <Plus size={14} /> Etapa
            </button>

            <div style={{ position: "relative" }}>
              <button
                className={`btn btn-ghost btn-xs ${
                  processMenuOpen ? "is-active" : ""
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setProcessMenuOpen(!processMenuOpen);
                }}
                title="Adicionar forma de fluxograma (Retângulo, Losango, Círculo)"
              >
                <Workflow size={14} /> Formas
              </button>

              {processMenuOpen && (
                <div
                  className="process-dropdown-menu nodrag"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="process-dropdown-item"
                    onClick={() => addShapeNode("rectangle")}
                  >
                    <span className="process-dropdown-icon">
                      <Square size={16} />
                    </span>
                    <div>
                      <div>Retângulo</div>
                      <div className="process-dropdown-desc">
                        Ação / Etapa do Processo
                      </div>
                    </div>
                  </button>
                  <button
                    className="process-dropdown-item"
                    onClick={() => addShapeNode("diamond")}
                  >
                    <span className="process-dropdown-icon">
                      <Diamond size={16} />
                    </span>
                    <div>
                      <div>Losango</div>
                      <div className="process-dropdown-desc">
                        Decisão / Condicional
                      </div>
                    </div>
                  </button>
                  <button
                    className="process-dropdown-item"
                    onClick={() => addShapeNode("circle")}
                  >
                    <span className="process-dropdown-icon">
                      <Circle size={16} />
                    </span>
                    <div>
                      <div>Círculo</div>
                      <div className="process-dropdown-desc">
                        Início / Fim / Conector
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <button
              className="btn btn-ghost btn-xs"
              onClick={autoArrange}
              title="Organizar blocos em grade"
            >
              <LayoutGrid size={14} /> Organizar
            </button>

            <button
              className="btn btn-ghost btn-xs"
              onClick={() => rf.fitView({ duration: 350, padding: 0.25 })}
              title="Enquadrar diagrama"
            >
              <Maximize size={14} />
            </button>

            <button
              className="btn btn-ghost btn-xs"
              onClick={() => openDrawer(item.id)}
              title="Abrir propriedades e notas deste nó"
            >
              <FileText size={14} /> Notas do Nó
            </button>
          </Panel>

          {/* Estado inicial amigável quando o submapa ainda está vazio */}
          {submapData.nodes.length === 0 && (
            <Panel position="top-center" style={{ marginTop: 96 }}>
              <div
                className="glass"
                style={{
                  padding: "20px 24px",
                  borderRadius: 14,
                  textAlign: "center",
                  maxWidth: 420,
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: "rgba(124, 92, 255, 0.15)",
                    color: "#a78bfa",
                    marginBottom: 10,
                  }}
                >
                  <Workflow size={20} />
                </div>
                <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600 }}>
                  Submapa isolado de &ldquo;{item.title || "Sem título"}&rdquo;
                </h3>
                <p
                  className="muted"
                  style={{ margin: "0 0 14px", fontSize: 12.5, lineHeight: 1.45 }}
                >
                  Desenhe o fluxograma ou processo interno deste nó. Tudo o que for
                  criado aqui fica salvo exclusivamente neste submapa sem alterar o
                  mapa mental principal.
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    className="btn btn-primary btn-xs"
                    onClick={() => addShapeNode("circle")}
                  >
                    <Circle size={13} /> + Início
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => addShapeNode("rectangle")}
                  >
                    <Square size={13} /> + Etapa
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => addShapeNode("diamond")}
                  >
                    <Diamond size={13} /> + Decisão
                  </button>
                </div>
              </div>
            </Panel>
          )}

          {selectedIds.length > 0 && (
            <Panel
              position="bottom-center"
              className="canvas-panel canvas-selbar glass"
            >
              <span className="muted small">
                {selectedIds.length} selecionado(s)
              </span>
              <div className="swatches">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className="swatch"
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    title="Cor da forma"
                  />
                ))}
              </div>
              <button
                className="icon-btn icon-btn-danger"
                onClick={removeSelected}
                title="Excluir forma selecionada (Del)"
              >
                <Trash2 size={14} />
              </button>
            </Panel>
          )}

          <Panel position="bottom-left" className="canvas-hints">
            <kbd>+ Etapa / Formas</kbd> criar bloco · <kbd>Clique na âncora</kbd>{" "}
            adicionar conectado · <kbd>Tab</kbd> etapa à direita ·{" "}
            <kbd>Enter</kbd> etapa abaixo · <kbd>Duplo clique / F2</kbd> editar ·{" "}
            <kbd>Del</kbd> excluir
          </Panel>
        </ReactFlow>
      </div>
    </SubmapCtx.Provider>
  );
}

export default function SubmapCanvas({ itemId }: { itemId: string }) {
  return (
    <ReactFlowProvider>
      <SubmapCanvasInner itemId={itemId} />
    </ReactFlowProvider>
  );
}
