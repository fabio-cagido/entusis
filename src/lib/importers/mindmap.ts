import type { ItemNode } from "../types";
import { emptySchedule } from "../types";
import { layoutTree } from "../layout";

const PALETTE = ["#8b7bff", "#f472b6", "#38bdf8", "#2dd4bf", "#facc15", "#fb923c", "#a3e635", "#94a3b8"];

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export interface ParsedMindMap {
  title: string;
  root: ItemNode;
  nodes: ItemNode[];
  summary: {
    totalNodes: number;
    branchesCount: number;
    source: string;
  };
}

/**
 * Parses a mind map JSON from various tools, with dedicated support
 * for Lucidchart mind maps and generic hierarchical JSONs.
 */
export function parseMindMapJson(raw: string | object): ParsedMindMap {
  let doc: any;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch (err: any) {
      throw new Error(`Arquivo JSON inválido: ${err?.message || "erro de sintaxe"}`);
    }
  } else {
    doc = raw;
  }

  if (!doc || typeof doc !== "object") {
    throw new Error("O arquivo JSON está vazio ou não contém um objeto válido.");
  }

  // 1. Êntusis exported items { format: "entusis.mindmap", items: [...], edges: [...] }
  if (isEntusisExport(doc)) {
    return parseEntusisExport(doc);
  }

  // 2. Lucidchart MindMap format
  if (isLucidchart(doc)) {
    return parseLucidchart(doc);
  }

  // 3. Generic Tree structure { title/name, children: [...] }
  if (isGenericTree(doc)) {
    return parseGenericTree(doc);
  }

  // 4. Nodes and Edges graph { nodes: [...], edges: [...] }
  if (isNodesAndEdges(doc)) {
    return parseNodesAndEdges(doc);
  }

  throw new Error(
    "Formato de mapa mental não reconhecido. Certifique-se de que o arquivo JSON foi exportado do Lucidchart ou possui uma estrutura hierárquica válida."
  );
}

/* ================================================================== */
/* 1. Lucidchart Parser                                               */
/* ================================================================== */

function isLucidchart(doc: any): boolean {
  if (doc.product === "lucidchart") return true;
  if (Array.isArray(doc.pages) && doc.pages.some((p: any) => p?.items?.shapes)) return true;
  return false;
}

function parseLucidchart(doc: any): ParsedMindMap {
  const t = now();
  const page = (doc.pages || []).find((p: any) => p?.items?.shapes?.length > 0) || doc.pages?.[0] || {};
  const items = page.items || {};
  const rawShapes: any[] = items.shapes || [];
  const lines: any[] = items.lines || [];

  // Filter out decorative collapsed badges or blank helpers
  const shapes = rawShapes.filter(
    (s: any) => s && s.class !== "IntelligentMindMapCollapsedCircleBlock"
  );

  if (shapes.length === 0) {
    throw new Error("Nenhum nó de mapa mental foi encontrado no arquivo do Lucidchart.");
  }

  const getShapeText = (s: any): string => {
    // 1. Look for textAreas labeled t_Text
    const tText = s.textAreas?.find((ta: any) => ta.label === "t_Text")?.text;
    if (tText && tText.trim()) return tText.trim();

    // 2. Look for linkedData Text
    const linked = s.linkedData?.[0]?.data;
    const lText = linked?.find((d: any) => d.key === "Text")?.value;
    if (lText && lText.trim()) return lText.trim();

    // 3. Fallback to any non-empty text area that isn't placeholder
    for (const ta of s.textAreas || []) {
      if (ta.text && ta.text.trim() && ta.label !== "Placeholder") return ta.text.trim();
    }

    return "";
  };

  const getShapeDataId = (s: any): string => {
    const linked = s.linkedData?.[0]?.data;
    const idVal = linked?.find((d: any) => d.key === "Id")?.value;
    return idVal || s.id;
  };

  const getShapeParentDataId = (s: any): string | null => {
    // 1. From linkedData
    const linked = s.linkedData?.[0]?.data;
    const pidVal = linked?.find((d: any) => d.key === "ParentId")?.value;
    if (pidVal) return pidVal;

    // 2. From lines
    const line = lines.find((l: any) => l.endpoint2?.connectedTo === s.id);
    if (line?.endpoint1?.connectedTo) {
      const parentShape = shapes.find((sh: any) => sh.id === line.endpoint1.connectedTo);
      if (parentShape) return getShapeDataId(parentShape);
    }
    return null;
  };

  // Identify root shape:
  // - Shape with class including "root"
  // - Shape with ParentId === ""
  // - Or first shape
  let rootShape = shapes.find(
    (s) => typeof s.class === "string" && s.class.toLowerCase().includes("root")
  );
  if (!rootShape) {
    rootShape = shapes.find((s) => {
      const linked = s.linkedData?.[0]?.data;
      const pid = linked?.find((d: any) => d.key === "ParentId")?.value;
      return pid === "" || pid === undefined || pid === null;
    });
  }
  if (!rootShape) {
    rootShape = shapes[0];
  }

  const rootDataId = getShapeDataId(rootShape);
  const rootTitle =
    (doc.title && doc.title.trim() && doc.title !== "Untitled")
      ? doc.title.trim()
      : getShapeText(rootShape) || "Mapa mental Lucidchart";

  const rootId = uid();
  const idMap = new Map<string, string>();
  idMap.set(rootDataId, rootId);
  idMap.set(rootShape.id, rootId);

  // Map other shape IDs
  const otherShapes = shapes.filter((s) => s !== rootShape);
  for (const s of otherShapes) {
    const newId = uid();
    idMap.set(getShapeDataId(s), newId);
    idMap.set(s.id, newId);
  }

  // Create Root ItemNode
  const rootNode: ItemNode = {
    id: rootId,
    title: rootTitle,
    content: `<p>Mapa mental importado do Lucidchart.</p>`,
    icon: "🧠",
    type: "PAGE",
    parent_id: null,
    project_id: null,
    status: null,
    is_today: false,
    schedule: emptySchedule(),
    attachments: [],
    links: [],
    canvas: { x: 0, y: 0, color: PALETTE[0] },
    default_view: "CANVAS",
    sort_order: 0,
    created_at: t,
    updated_at: t,
  };

  // Create Child ItemNodes
  const childNodes: ItemNode[] = [];
  for (const s of otherShapes) {
    const text = getShapeText(s);
    // Ignore completely empty shapes without text and without links
    if (!text && !s.linkUrl) continue;

    const dataId = getShapeDataId(s);
    const newId = idMap.get(dataId) || uid();
    const parentDataId = getShapeParentDataId(s);
    const parentId = (parentDataId ? idMap.get(parentDataId) : null) || rootId;

    const attachments: ItemNode["attachments"] = [];
    if (s.linkUrl) {
      attachments.push({
        id: uid(),
        label: text || "Link externo",
        url: s.linkUrl,
        kind: "web",
      });
    }

    childNodes.push({
      id: newId,
      title: text || "Sem título",
      content: s.linkUrl ? `<p><a href="${s.linkUrl}" target="_blank" rel="noopener noreferrer">${s.linkUrl}</a></p>` : "",
      icon: null,
      type: "MINDMAP_NODE",
      parent_id: parentId,
      project_id: null,
      status: null,
      is_today: false,
      schedule: emptySchedule(),
      attachments,
      links: [],
      canvas: null,
      default_view: "PAGE",
      sort_order: childNodes.length,
      created_at: t,
      updated_at: t,
    });
  }

  // Assign distinct palette colors to direct children of root (the main branches)
  const directChildren = childNodes.filter((c) => c.parent_id === rootId);
  directChildren.forEach((child, idx) => {
    child.canvas = { x: 0, y: 0, color: PALETTE[idx % PALETTE.length] };
  });

  const allNodes = [rootNode, ...childNodes];

  // Calculate balanced bilateral coordinates with layoutTree
  try {
    const positions = layoutTree(allNodes, rootId);
    for (const node of allNodes) {
      const pos = positions[node.id] || { x: 0, y: 0 };
      node.canvas = {
        x: pos.x,
        y: pos.y,
        color: node.canvas?.color || (node.id === rootId ? PALETTE[0] : null),
      };
    }
  } catch (err) {
    console.warn("[importer] layoutTree auto-positioning:", err);
  }

  return {
    title: rootTitle,
    root: rootNode,
    nodes: allNodes,
    summary: {
      totalNodes: allNodes.length,
      branchesCount: directChildren.length,
      source: "Lucidchart",
    },
  };
}

/* ================================================================== */
/* 2. Generic Tree Parser { title, children: [...] }                  */
/* ================================================================== */

function isGenericTree(doc: any): boolean {
  return (
    typeof doc === "object" &&
    (typeof doc.title === "string" || typeof doc.name === "string") &&
    Array.isArray(doc.children)
  );
}

function parseGenericTree(doc: any): ParsedMindMap {
  const t = now();
  const rootTitle = doc.title || doc.name || "Mapa mental";
  const rootId = uid();

  const rootNode: ItemNode = {
    id: rootId,
    title: rootTitle,
    content: "<p>Mapa mental importado.</p>",
    icon: "🧠",
    type: "PAGE",
    parent_id: null,
    project_id: null,
    status: null,
    is_today: false,
    schedule: emptySchedule(),
    attachments: [],
    links: [],
    canvas: { x: 0, y: 0, color: PALETTE[0] },
    default_view: "CANVAS",
    sort_order: 0,
    created_at: t,
    updated_at: t,
  };

  const childNodes: ItemNode[] = [];

  function traverse(item: any, parentId: string, depth: number, branchIndex: number) {
    const children = Array.isArray(item.children) ? item.children : [];
    children.forEach((child: any, idx: number) => {
      const childId = uid();
      const title = child.title || child.name || child.text || "Sem título";
      const color = depth === 1 ? PALETTE[idx % PALETTE.length] : null;

      childNodes.push({
        id: childId,
        title,
        content: child.content || child.description || "",
        icon: null,
        type: "MINDMAP_NODE",
        parent_id: parentId,
        project_id: null,
        status: null,
        is_today: false,
        schedule: emptySchedule(),
        attachments: [],
        links: [],
        canvas: color ? { x: 0, y: 0, color } : null,
        default_view: "PAGE",
        sort_order: idx,
        created_at: t,
        updated_at: t,
      });

      traverse(child, childId, depth + 1, depth === 1 ? idx : branchIndex);
    });
  }

  traverse(doc, rootId, 1, 0);

  const allNodes = [rootNode, ...childNodes];
  const directChildren = childNodes.filter((c) => c.parent_id === rootId);

  try {
    const positions = layoutTree(allNodes, rootId);
    for (const node of allNodes) {
      const pos = positions[node.id] || { x: 0, y: 0 };
      node.canvas = {
        x: pos.x,
        y: pos.y,
        color: node.canvas?.color || (node.id === rootId ? PALETTE[0] : null),
      };
    }
  } catch {}

  return {
    title: rootTitle,
    root: rootNode,
    nodes: allNodes,
    summary: {
      totalNodes: allNodes.length,
      branchesCount: directChildren.length,
      source: "Estrutura Hierárquica (Tree JSON)",
    },
  };
}

/* ================================================================== */
/* 3. Nodes and Edges Graph { nodes: [...], edges: [...] }            */
/* ================================================================== */

function isNodesAndEdges(doc: any): boolean {
  return Array.isArray(doc.nodes) && (Array.isArray(doc.edges) || Array.isArray(doc.links));
}

function parseNodesAndEdges(doc: any): ParsedMindMap {
  const t = now();
  const rawNodes: any[] = doc.nodes || [];
  const rawEdges: any[] = doc.edges || doc.links || [];

  if (rawNodes.length === 0) {
    throw new Error("Nenhum nó encontrado no grafo.");
  }

  // Map original id to new ItemNode.id
  const idMap = new Map<string, string>();
  rawNodes.forEach((n) => {
    idMap.set(String(n.id), uid());
  });

  // Find incoming edge count to locate root
  const incomingCount = new Map<string, number>();
  rawEdges.forEach((e) => {
    const target = String(e.target || e.to || e.endpoint2);
    incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
  });

  // Root has 0 incoming edges
  let rootOriginal = rawNodes.find((n) => (incomingCount.get(String(n.id)) || 0) === 0) || rawNodes[0];
  const rootId = idMap.get(String(rootOriginal.id))!;
  const rootTitle = doc.title || rootOriginal.label || rootOriginal.title || rootOriginal.name || "Mapa mental";

  // Build parent map from edges
  const parentMap = new Map<string, string>();
  rawEdges.forEach((e) => {
    const src = String(e.source || e.from || e.endpoint1);
    const tgt = String(e.target || e.to || e.endpoint2);
    if (idMap.has(src) && idMap.has(tgt) && !parentMap.has(tgt)) {
      parentMap.set(tgt, src);
    }
  });

  const rootNode: ItemNode = {
    id: rootId,
    title: rootTitle,
    content: "<p>Mapa mental importado.</p>",
    icon: "🧠",
    type: "PAGE",
    parent_id: null,
    project_id: null,
    status: null,
    is_today: false,
    schedule: emptySchedule(),
    attachments: [],
    links: [],
    canvas: { x: 0, y: 0, color: PALETTE[0] },
    default_view: "CANVAS",
    sort_order: 0,
    created_at: t,
    updated_at: t,
  };

  const childNodes: ItemNode[] = [];
  rawNodes
    .filter((n) => n !== rootOriginal)
    .forEach((n, idx) => {
      const origId = String(n.id);
      const newId = idMap.get(origId)!;
      const origParent = parentMap.get(origId);
      const parentId = origParent ? idMap.get(origParent) || rootId : rootId;

      childNodes.push({
        id: newId,
        title: n.label || n.title || n.name || n.text || "Sem título",
        content: n.description || "",
        icon: null,
        type: "MINDMAP_NODE",
        parent_id: parentId,
        project_id: null,
        status: null,
        is_today: false,
        schedule: emptySchedule(),
        attachments: [],
        links: [],
        canvas: null,
        default_view: "PAGE",
        sort_order: idx,
        created_at: t,
        updated_at: t,
      });
    });

  const directChildren = childNodes.filter((c) => c.parent_id === rootId);
  directChildren.forEach((child, idx) => {
    child.canvas = { x: 0, y: 0, color: PALETTE[idx % PALETTE.length] };
  });

  const allNodes = [rootNode, ...childNodes];

  try {
    const positions = layoutTree(allNodes, rootId);
    for (const node of allNodes) {
      const pos = positions[node.id] || { x: 0, y: 0 };
      node.canvas = {
        x: pos.x,
        y: pos.y,
        color: node.canvas?.color || (node.id === rootId ? PALETTE[0] : null),
      };
    }
  } catch {}

  return {
    title: rootTitle,
    root: rootNode,
    nodes: allNodes,
    summary: {
      totalNodes: allNodes.length,
      branchesCount: directChildren.length,
      source: "Grafo (Nodes & Edges JSON)",
    },
  };
}

/* ================================================================== */
/* 4. Êntusis Export Parser                                           */
/* ================================================================== */

function isEntusisExport(doc: any): boolean {
  if (doc?.format === "entusis.mindmap" || doc?.format === "entusis.canvas") return true;
  if (Array.isArray(doc)) return doc.every((d) => d && typeof d.id === "string" && typeof d.title === "string");
  if (Array.isArray(doc.items)) return doc.items.every((d: any) => d && typeof d.id === "string");
  return false;
}

function parseEntusisExport(doc: any): ParsedMindMap {
  const rawList: ItemNode[] = Array.isArray(doc) ? doc : doc.items;
  if (rawList.length === 0) throw new Error("A lista de nós exportada está vazia.");
  const t = now();

  // Remap IDs to avoid collision with existing database
  const idMap = new Map<string, string>();
  rawList.forEach((it) => idMap.set(it.id, uid()));

  // Find root: explicit root_id (written by the exporter) wins.
  const rootOrig =
    (!Array.isArray(doc) && typeof doc.root_id === "string" && rawList.find((it) => it.id === doc.root_id)) ||
    rawList.find((it) => !it.parent_id || it.default_view === "CANVAS") ||
    rawList[0];
  const rootId = idMap.get(rootOrig.id)!;

  // Build link set per node from both item.links and doc.edges/doc.connections
  const linksMap = new Map<string, Set<string>>();
  rawList.forEach((it) => {
    const set = new Set<string>();
    (it.links ?? []).forEach((l) => {
      const remapped = idMap.get(l);
      if (remapped) set.add(remapped);
    });
    linksMap.set(it.id, set);
  });

  // Also ingest any edges/connections from doc.edges or doc.connections
  const rawEdges = Array.isArray(doc.edges) ? doc.edges : Array.isArray(doc.connections) ? doc.connections : [];
  rawEdges.forEach((e: any) => {
    const from = e.fromNodeId || e.source || e.from;
    const to = e.toNodeId || e.target || e.to;
    if (from && to && idMap.has(from) && idMap.has(to)) {
      const set = linksMap.get(from) || new Set<string>();
      set.add(idMap.get(to)!);
      linksMap.set(from, set);
    }
  });

  const nodes: ItemNode[] = rawList.map((it) => {
    const isRoot = it.id === rootOrig.id;
    const newId = idMap.get(it.id)!;
    const remappedParent = it.parent_id ? idMap.get(it.parent_id) : null;

    return {
      ...it,
      id: newId,
      // Se for a raiz do mapa: parent_id = null
      // Se for nó de processo ou filho sem pai mapeado: associa à raiz do mapa para garantir exibição no canvas
      parent_id: isRoot ? null : remappedParent || rootId,
      default_view: isRoot ? ("CANVAS" as const) : it.default_view,
      // Links remapeados garantindo todas as conexões de setas de processos
      links: Array.from(linksMap.get(it.id) || []),
      attachments: it.attachments ?? [],
      schedule: { ...(it.schedule ?? emptySchedule()), google_event_id: null },
      // Preservação fiel de geometria, dimensões, forma de processo e cores
      canvas: it.canvas
        ? {
            x: Number(it.canvas.x) || 0,
            y: Number(it.canvas.y) || 0,
            color: it.canvas.color ?? null,
            shape: it.canvas.shape ?? null,
            width: it.canvas.width ? Number(it.canvas.width) : null,
            height: it.canvas.height ? Number(it.canvas.height) : null,
          }
        : null,
      created_at: t,
      updated_at: t,
    };
  });

  const root = nodes.find((n) => n.id === rootId)!;

  const processCount = nodes.filter((n) => n.canvas?.shape).length;
  const treeBranchCount = nodes.filter((n) => n.parent_id === rootId && !n.canvas?.shape).length;

  return {
    title: root.title,
    root,
    nodes,
    summary: {
      totalNodes: nodes.length,
      branchesCount: treeBranchCount,
      source: processCount > 0 ? `Backup Êntusis (${processCount} processos)` : "Backup Êntusis",
    },
  };
}
