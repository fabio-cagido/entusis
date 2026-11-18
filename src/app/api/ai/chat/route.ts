import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  message?: string;
  history?: ChatMessageInput[];
  scope?: "current" | "all";
  projectId?: string | null;
  rootNodeId?: string | null;
}

interface DbProjectRow {
  id: string;
  user_id?: string;
  name: string;
  color: string;
  icon: string | null;
  page_id?: string | null;
  sort_order: number;
  is_archived?: boolean;
}

interface DbItemRow {
  id: string;
  user_id?: string;
  title: string;
  content: string;
  icon: string | null;
  type: "PAGE" | "MINDMAP_NODE" | "TASK" | "EVENT";
  parent_id: string | null;
  project_id: string | null;
  scope_node_id?: string | null;
  status: "BACKLOG" | "TODO" | "DOING" | "DONE" | null;
  is_today: boolean;
  is_recurring?: boolean;
  recurrence_type?: "monthly" | "weekly" | null;
  deleted_at?: string | null;
  start_time: string | null;
  end_time: string | null;
  attachments?: { id: string; label: string; url: string; kind: string }[];
  links?: string[];
  canvas?: {
    x?: number;
    y?: number;
    color?: string | null;
    shape?: string | null;
    deleted_at?: string | null;
    scope_node_id?: string | null;
    submap_canvas_data?: {
      nodes?: { id: string; data?: { label?: string } }[];
      edges?: { id: string; source: string; target: string; label?: string }[];
    } | null;
  } | null;
  submap_canvas_data?: {
    nodes?: { id: string; data?: { label?: string } }[];
    edges?: { id: string; source: string; target: string; label?: string }[];
  } | null;
  default_view: "PAGE" | "CANVAS" | "BOARD";
  sort_order: number;
  updated_at: string;
}

const STATUS_PT: Record<string, string> = {
  BACKLOG: "Brainstorming / Backlog",
  TODO: "A Fazer",
  DOING: "Fazendo (Em Andamento)",
  DONE: "Concluído",
};

/**
 * Converte HTML rico (TipTap) em texto limpo estruturado, preservando quebras de linha e listas de tarefas.
 */
function htmlToCleanText(html: string | null | undefined): string {
  if (!html) return "";
  let source = html;

  // Conteúdo salvo como JSON estruturado (ex: TipTap/ProseMirror): extrai apenas o texto útil e links
  const trimmedSource = source.trim();
  if (trimmedSource.startsWith("{") && trimmedSource.includes('"type"')) {
    try {
      const parsed = JSON.parse(trimmedSource) as unknown;
      const parts: string[] = [];
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        const n = node as {
          type?: string;
          text?: string;
          content?: unknown[];
          marks?: { type?: string; attrs?: { href?: string } }[];
        };
        if (typeof n.text === "string") {
          const link = n.marks?.find((m) => m.type === "link")?.attrs?.href;
          parts.push(link && link !== n.text ? `${n.text} [Link]: ${link}` : n.text);
        }
        if (Array.isArray(n.content)) n.content.forEach(walk);
        if (["paragraph", "heading", "listItem", "taskItem", "blockquote"].includes(n.type ?? "")) {
          parts.push("\n");
        }
      };
      walk(parsed);
      source = parts.join("");
      return source.replace(/\n{3,}/g, "\n\n").trim();
    } catch {
      // segue como HTML/texto simples
    }
  }

  return source
    // Preserva links: <a href="URL">texto</a> => texto [Link]: URL
    .replace(
      /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, inner: string) => {
        const text = inner.replace(/<[^>]+>/g, "").trim();
        if (!text || text === href) return ` [Link]: ${href} `;
        return `${text} [Link]: ${href} `;
      },
    )
    .replace(/<li[^>]*data-checked="true"[^>]*>/gi, "\n- [x] ")
    .replace(/<li[^>]*data-checked="false"[^>]*>/gi, "\n- [ ] ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Limpa o texto da página do nó e aplica um limite de caracteres (orçamento),
 * preservando sempre os links/URLs que ficariam fora do trecho cortado.
 */
function formatNodeText(raw: string | null | undefined, cap: number): string {
  const clean = htmlToCleanText(raw);
  if (!clean) return "";
  const urls = Array.from(new Set(clean.match(/https?:\/\/[^\s)\]>"']+/g) ?? []));

  if (cap <= 0) {
    return urls.slice(0, 5).map((u) => `[Link]: ${u}`).join("\n");
  }
  if (clean.length <= cap) return clean;

  const clipped = `${clean.slice(0, cap).trimEnd()}…`;
  const missing = urls.filter((u) => !clipped.includes(u)).slice(0, 5);
  return missing.length > 0
    ? `${clipped}\n${missing.map((u) => `[Link]: ${u}`).join("\n")}`
    : clipped;
}

function formatAttachments(
  atts: { label?: string; url?: string }[] | undefined,
): string {
  if (!Array.isArray(atts) || atts.length === 0) return "";
  return atts
    .filter((a) => a?.url)
    .map((a) => `[Link]: ${a.url}${a.label ? ` (${a.label})` : ""}`)
    .join(" | ");
}

export async function POST(request: NextRequest) {
  try {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return NextResponse.json(
        { error: "Chave GROQ_API_KEY não configurada no servidor." },
        { status: 500 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Configuração do Supabase ausente no servidor." },
        { status: 500 },
      );
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Somente leitura de sessão na rota de API
        },
      },
    });

    // Valida o usuário autenticado via cookies ou header Authorization Bearer
    let {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const authHeader = request.headers.get("authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
      if (token) {
        const { data: tokenUser } = await supabase.auth.getUser(token);
        user = tokenUser.user;
      }
    }

    if (!user?.id) {
      return NextResponse.json(
        { error: "Usuário não autenticado. Faça login novamente." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as ChatRequestBody;
    const userMessage = (body.message || "").trim();
    if (!userMessage) {
      return NextResponse.json(
        { error: "A mensagem não pode estar vazia." },
        { status: 400 },
      );
    }

    const scope: "current" | "all" = body.scope === "all" ? "all" : "current";
    const requestedProjectId = body.projectId || null;
    const requestedRootNodeId = body.rootNodeId || null;

    // 1. Consulta paginada estritamente isolada pelo user_id autenticado (tabelas reais: "projects" e "item_nodes")
    const PAGE_SIZE = 1000;
    const fetchAllUserRows = async <T>(table: string): Promise<T[]> => {
      const allRows: T[] = [];
      let from = 0;
      while (true) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);

        if (error) {
          throw new Error(`Erro ao consultar ${table}: ${error.message}`);
        }
        const batch = (data as T[]) ?? [];
        allRows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return allRows;
    };

    const [allProjects, rawItems] = await Promise.all([
      fetchAllUserRows<DbProjectRow>("projects"),
      fetchAllUserRows<DbItemRow>("item_nodes"),
    ]);

    // Filtra apenas itens ativos (não movidos para a lixeira)
    const activeItems = rawItems.filter(
      (it) => !it.deleted_at && !it.canvas?.deleted_at,
    );
    const itemsById = new Map<string, DbItemRow>(
      activeItems.map((it) => [it.id, it]),
    );
    const projectsById = new Map<string, DbProjectRow>(
      allProjects.map((p) => [p.id, p]),
    );

    // Índice de filhos por parent_id e submapas por scope_node_id
    const childrenByParent = new Map<string, DbItemRow[]>();
    const submapByScopeNode = new Map<string, DbItemRow[]>();

    for (const it of activeItems) {
      const scopeId = it.scope_node_id ?? it.canvas?.scope_node_id ?? null;
      if (scopeId) {
        const arr = submapByScopeNode.get(scopeId) ?? [];
        arr.push(it);
        submapByScopeNode.set(scopeId, arr);
      }
      if (it.parent_id) {
        const arr = childrenByParent.get(it.parent_id) ?? [];
        arr.push(it);
        childrenByParent.set(it.parent_id, arr);
      }
    }

    for (const arr of childrenByParent.values()) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    // Coleta recursivamente todos os descendentes de um nó raiz
    const collectSubtree = (rootId: string): DbItemRow[] => {
      const visited = new Set<string>([rootId]);
      const result: DbItemRow[] = [];
      const queue: string[] = [rootId];
      while (queue.length > 0) {
        const currId = queue.shift()!;
        const kids = childrenByParent.get(currId) ?? [];
        const scoped = submapByScopeNode.get(currId) ?? [];
        for (const child of [...kids, ...scoped]) {
          if (!visited.has(child.id)) {
            visited.add(child.id);
            result.push(child);
            queue.push(child.id);
          }
        }
      }
      return result;
    };

    // Sobe até a raiz da árvore caso requestedRootNodeId seja um sub-nó
    const findTopRoot = (nodeId: string): DbItemRow | null => {
      let cur = itemsById.get(nodeId) ?? null;
      let guard = 0;
      while (cur && guard++ < 100) {
        const scopeId = cur.scope_node_id ?? cur.canvas?.scope_node_id ?? null;
        if (scopeId && itemsById.has(scopeId)) {
          cur = itemsById.get(scopeId)!;
          continue;
        }
        if (cur.parent_id && itemsById.has(cur.parent_id)) {
          cur = itemsById.get(cur.parent_id)!;
          continue;
        }
        break;
      }
      return cur;
    };

    const normText = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    const projectsByRootPageId = new Map<string, DbProjectRow>();
    const projectsByNormName = new Map<string, DbProjectRow>();
    for (const p of allProjects) {
      if (p.page_id) projectsByRootPageId.set(p.page_id, p);
      if (p.name) projectsByNormName.set(normText(p.name), p);
    }

    // Resolve o projeto ao qual qualquer nó/tarefa pertence (diretamente ou subindo pela árvore)
    const resolveProjectForNode = (node: DbItemRow): DbProjectRow | null => {
      if (node.project_id && projectsById.has(node.project_id)) {
        return projectsById.get(node.project_id)!;
      }
      let cur: DbItemRow | undefined = node;
      let guard = 0;
      while (cur && guard++ < 100) {
        if (cur.project_id && projectsById.has(cur.project_id)) {
          return projectsById.get(cur.project_id)!;
        }
        if (projectsByRootPageId.has(cur.id)) {
          return projectsByRootPageId.get(cur.id)!;
        }
        const nextId =
          cur.parent_id ?? cur.scope_node_id ?? cur.canvas?.scope_node_id ?? null;
        if (nextId && itemsById.has(nextId)) {
          cur = itemsById.get(nextId);
        } else {
          break;
        }
      }
      if (cur?.title) {
        const byName = projectsByNormName.get(normText(cur.title));
        if (byName) return byName;
      }
      return null;
    };

    // Detecta colunas estruturais do Kanban no mapa para não confundi-las com tarefas reais e para inferir status por coluna pai
    const statusFromColumnTitle = (
      title: string | null | undefined,
    ): "BACKLOG" | "TODO" | "DOING" | "DONE" | null => {
      const cleaned = normText(title || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      if (cleaned === "brainstorming" || cleaned === "brainstorm" || cleaned === "backlog") {
        return "BACKLOG";
      }
      if (cleaned === "a fazer" || cleaned === "todo") return "TODO";
      if (cleaned === "fazendo" || cleaned === "doing" || cleaned === "em andamento") {
        return "DOING";
      }
      if (cleaned === "concluido" || cleaned === "concluidas" || cleaned === "done") {
        return "DONE";
      }
      return null;
    };

    const isStructuralKanbanNode = (node: DbItemRow): boolean => {
      const cleaned = normText(node.title || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      if (cleaned === "kanban" && node.status === null) return true;
      if (statusFromColumnTitle(node.title) !== null && node.status === null) {
        return true;
      }
      return false;
    };

    const getEffectiveStatus = (
      node: DbItemRow,
    ): "BACKLOG" | "TODO" | "DOING" | "DONE" | null => {
      if (isStructuralKanbanNode(node)) return null;
      if (node.status) return node.status;
      if (node.parent_id && itemsById.has(node.parent_id)) {
        const parent = itemsById.get(node.parent_id)!;
        const colStatus = statusFromColumnTitle(parent.title);
        if (colStatus) return colStatus;
      }
      return null;
    };

    const archivedProjectIds = new Set(
      allProjects.filter((p) => p.is_archived).map((p) => p.id),
    );

    // 1. BLOCO PRIORITÁRIO DE TAREFAS ATIVAS (SEMPRE NO TOPO DO CONTEXTO)
    const COMPACT_STATUS_LABEL: Record<string, string> = {
      DOING: "Fazendo",
      TODO: "A Fazer",
      BACKLOG: "Backlog",
    };

    interface ActiveTaskEntry {
      node: DbItemRow;
      projectName: string;
      status: "DOING" | "TODO" | "BACKLOG" | null;
      isToday: boolean;
    }

    const globalActiveTasks: ActiveTaskEntry[] = [];
    for (const it of activeItems) {
      if (isStructuralKanbanNode(it)) continue;
      const proj = resolveProjectForNode(it);
      if (proj && archivedProjectIds.has(proj.id)) continue;

      const effStatus = getEffectiveStatus(it);
      if (effStatus === "DONE") continue;
      if (effStatus === null && !it.is_today) continue;

      const topRoot = findTopRoot(it.id);
      const projectName =
        proj?.name || topRoot?.title || "Sem Projeto";

      globalActiveTasks.push({
        node: it,
        projectName,
        status: effStatus,
        isToday: Boolean(it.is_today),
      });
    }

    const statusRank = (entry: ActiveTaskEntry): number => {
      if (entry.status === "DOING") return 0;
      if (entry.isToday) return 1;
      if (entry.status === "TODO") return 2;
      return 3;
    };

    globalActiveTasks.sort((a, b) => {
      const rDiff = statusRank(a) - statusRank(b);
      if (rDiff !== 0) return rDiff;
      return a.projectName.localeCompare(b.projectName, "pt-BR");
    });

    const doingCount = globalActiveTasks.filter((t) => t.status === "DOING").length;
    const todayCount = globalActiveTasks.filter((t) => t.isToday).length;
    const todoCount = globalActiveTasks.filter((t) => t.status === "TODO").length;
    const backlogCount = globalActiveTasks.filter((t) => t.status === "BACKLOG").length;

    const globalTasksLines: string[] = [
      `## RESUMO GLOBAL DE TAREFAS ATIVAS (TODOS OS PROJETOS)`,
      `Total: ${globalActiveTasks.length} tarefas não concluídas (${doingCount} Fazendo | ${todayCount} Em foco hoje | ${todoCount} A Fazer | ${backlogCount} Backlog)`,
    ];

    if (globalActiveTasks.length === 0) {
      globalTasksLines.push(`- Nenhuma tarefa ativa pendente no momento.`);
    } else {
      for (const entry of globalActiveTasks) {
        const stLabel = entry.status
          ? COMPACT_STATUS_LABEL[entry.status] || entry.status
          : "Em Foco (Agenda/Hoje)";
        const dateSuffix = entry.node.start_time
          ? ` | Data: ${entry.node.start_time.slice(0, 10)}`
          : "";
        globalTasksLines.push(
          `- [${entry.projectName}] ${entry.node.title || "Sem título"} | Status: ${stLabel} | Em foco: ${entry.isToday ? "Sim" : "Não"}${dateSuffix}`,
        );
      }
    }

    const priorityTasksBlock = globalTasksLines.join("\n");

    // 2. EXPANSÃO CONTEXTUAL INTELIGENTE (ÁRVORE E PÁGINAS)
    let targetRoots: DbItemRow[] = [];
    let scopeLabel = "Todos os Projetos e Mapas Ativos";
    let hasSpecificProjectFocus = false;

    if (scope === "current" && (requestedRootNodeId || requestedProjectId)) {
      const rootSet = new Map<string, DbItemRow>();
      let resolvedProject: DbProjectRow | null = requestedProjectId
        ? projectsById.get(requestedProjectId) ?? null
        : null;

      if (requestedRootNodeId && itemsById.has(requestedRootNodeId)) {
        const topRoot = findTopRoot(requestedRootNodeId);
        const directNode = itemsById.get(requestedRootNodeId)!;
        if (topRoot) {
          rootSet.set(topRoot.id, topRoot);
          if (!resolvedProject) {
            resolvedProject = resolveProjectForNode(topRoot);
          }
        } else {
          rootSet.set(directNode.id, directNode);
        }
      }

      if (resolvedProject) {
        for (const it of activeItems) {
          if (
            it.project_id === resolvedProject.id &&
            !it.parent_id &&
            !(it.scope_node_id ?? it.canvas?.scope_node_id)
          ) {
            rootSet.set(it.id, it);
          }
        }
        if (resolvedProject.page_id && itemsById.has(resolvedProject.page_id)) {
          rootSet.set(
            resolvedProject.page_id,
            itemsById.get(resolvedProject.page_id)!,
          );
        }
        scopeLabel = `Projeto: ${resolvedProject.name}`;
      } else if (rootSet.size > 0) {
        const firstRoot = Array.from(rootSet.values())[0];
        scopeLabel = `Mapa/Página: ${firstRoot.title || "Sem título"}`;
      }

      targetRoots = Array.from(rootSet.values());
      if (targetRoots.length > 0) {
        hasSpecificProjectFocus = true;
      }
    }

    if (targetRoots.length === 0) {
      const allCandidateRoots = activeItems.filter((it) => {
        const scopeId = it.scope_node_id ?? it.canvas?.scope_node_id ?? null;
        if (it.parent_id || scopeId) return false;
        const proj = resolveProjectForNode(it);
        if (proj && archivedProjectIds.has(proj.id)) return false;
        return true;
      });

      const msgNorm = normText(userMessage);

      // Verifica se a mensagem do usuário cita o nome de algum projeto específico (case-insensitive)
      const matchedRoots = allCandidateRoots.filter((r) => {
        const proj = resolveProjectForNode(r);
        const rTitle = normText(r.title || "");
        const pTitle = proj ? normText(proj.name || "") : "";
        return (
          (rTitle.length >= 3 && msgNorm.includes(rTitle)) ||
          (pTitle.length >= 3 && msgNorm.includes(pTitle))
        );
      });

      if (matchedRoots.length > 0) {
        targetRoots = matchedRoots;
        hasSpecificProjectFocus = true;
        const matchedNames = matchedRoots.map((r) => {
          const p = resolveProjectForNode(r);
          return p?.name || r.title || "Sem título";
        });
        scopeLabel = `Foco no Projeto: ${Array.from(new Set(matchedNames)).join(", ")}`;
      } else {
        targetRoots = allCandidateRoots;
        hasSpecificProjectFocus = false;
        scopeLabel = "Todos os Projetos e Mapas Ativos";
      }
    }

    // 3. Serialização em Markdown Estruturado para o LLM
    let totalNodesSerialized = 0;
    const totalTasksSerialized = globalActiveTasks.length;
    let totalCustomLinksSerialized = 0;

    const getBranchPath = (node: DbItemRow, rootId: string): string => {
      const parts: string[] = [];
      let cur: DbItemRow | undefined = node;
      let guard = 0;
      while (cur && guard++ < 50) {
        parts.unshift(cur.title || "Sem título");
        if (cur.id === rootId) break;
        const nextParentId: string | null =
          cur.parent_id ||
          cur.scope_node_id ||
          cur.canvas?.scope_node_id ||
          null;
        cur = nextParentId ? itemsById.get(nextParentId) : undefined;
      }
      return parts.join(" > ");
    };

    const buildDetailedProjectContext = (noteCap: number): string => {
      totalNodesSerialized = 0;
      totalCustomLinksSerialized = 0;
      const contextSections: string[] = [priorityTasksBlock];

      for (const rootNode of targetRoots) {
        const proj = resolveProjectForNode(rootNode);
        const subtree = collectSubtree(rootNode.id);
        const allMapNodes = [rootNode, ...subtree];

        if (proj) {
          const inSet = new Set(allMapNodes.map((n) => n.id));
          for (const it of activeItems) {
            if (it.project_id === proj.id && !inSet.has(it.id)) {
              allMapNodes.push(it);
              inSet.add(it.id);
            }
          }
        }

        totalNodesSerialized += allMapNodes.length;

        const lines: string[] = [];
        const headerTitle = proj
          ? `PROJETO: "${proj.name}" (Mapa Raiz: "${rootNode.title || proj.name}")`
          : `MAPA MENTAL / PÁGINA: "${rootNode.title || "Sem título"}"`;

        lines.push(`## ${headerTitle}`);

        const rootCleanContent = formatNodeText(rootNode.content, noteCap * 2);
        if (rootCleanContent) {
          lines.push(`### Documento / Visão Geral da Raiz:`);
          lines.push(rootCleanContent);
        }

        const rootAtt = formatAttachments(rootNode.attachments);
        if (rootAtt) {
          lines.push(`Links/Anexos da Raiz: ${rootAtt}`);
        }

        lines.push(`### Estrutura Hierárquica Completa do Mapa (Árvore Pai -> Filho):`);

        const visitedRender = new Set<string>([rootNode.id]);
        const renderTree = (parentId: string, depth: number) => {
          const kids = childrenByParent.get(parentId) ?? [];
          const scopedKids = submapByScopeNode.get(parentId) ?? [];
          const combined = [
            ...kids,
            ...scopedKids.filter((s) => !kids.some((k) => k.id === s.id)),
          ];

          for (const child of combined) {
            if (visitedRender.has(child.id)) continue;
            visitedRender.add(child.id);

            const indent = "  ".repeat(depth);
            const metaTags: string[] = [];
            const effSt = getEffectiveStatus(child);
            if (child.canvas?.shape) metaTags.push(`Fluxo: ${child.canvas.shape}`);
            if (effSt) {
              metaTags.push(`Status Kanban: ${STATUS_PT[effSt] || effSt}`);
            }
            if (child.is_today) metaTags.push(`Foco de Hoje`);
            if (child.is_recurring) {
              metaTags.push(`Recorrente (${child.recurrence_type || "ativo"})`);
            }
            if (child.start_time) {
              metaTags.push(`Prazo/Agenda: ${child.start_time.slice(0, 10)}`);
            }

            const metaSuffix = metaTags.length > 0 ? ` [${metaTags.join(" | ")}]` : "";
            const iconPrefix = child.icon ? `${child.icon} ` : "";
            lines.push(
              `${indent}- **${iconPrefix}${child.title || "Sem título"}**${metaSuffix}`,
            );

            const cleanNote = formatNodeText(child.content, noteCap);
            if (cleanNote) {
              const indentedNote = cleanNote
                .split("\n")
                .map((l) => `${indent}  > ${l}`)
                .join("\n");
              lines.push(indentedNote);
            }

            const attLine = formatAttachments(child.attachments);
            if (attLine) {
              lines.push(`${indent}  > ${attLine}`);
            }

            const subCanvas =
              child.submap_canvas_data ?? child.canvas?.submap_canvas_data ?? null;
            if (subCanvas?.nodes && subCanvas.nodes.length > 0) {
              const subLabels = subCanvas.nodes
                .map((sn) => sn.data?.label)
                .filter(Boolean);
              if (subLabels.length > 0) {
                lines.push(
                  `${indent}  > Submapa de Processo: ${subLabels.join(" -> ")}`,
                );
              }
            }

            renderTree(child.id, depth + 1);
          }
        };

        renderTree(rootNode.id, 0);

        const customConnections: string[] = [];
        for (const n of allMapNodes) {
          if (!Array.isArray(n.links) || n.links.length === 0) continue;
          for (const targetId of n.links) {
            const targetNode = itemsById.get(targetId);
            if (!targetNode) continue;
            totalCustomLinksSerialized++;
            const fromPath = getBranchPath(n, rootNode.id);
            const toPath = getBranchPath(targetNode, rootNode.id);
            customConnections.push(`- **${fromPath}** ──(conexão direta)──> **${toPath}**`);
          }
        }

        if (customConnections.length > 0) {
          lines.push(`### Conexões Livres e Dependências Transversais (Linhas Laranjas):`);
          lines.push(...customConnections);
        }

        contextSections.push(lines.join("\n"));
      }

      return contextSections.join("\n\n---\n\n");
    };

    const buildGlobalOverviewContext = (): string => {
      totalNodesSerialized = 0;
      totalCustomLinksSerialized = 0;
      const overviewLines: string[] = [
        priorityTasksBlock,
        `## ESTRUTURA GERAL DOS PROJETOS E MAPAS ATIVOS (NÍVEIS 1 E 2)`,
      ];

      for (const rootNode of targetRoots) {
        const proj = resolveProjectForNode(rootNode);
        const subtree = collectSubtree(rootNode.id);
        totalNodesSerialized += 1 + subtree.length;

        const rootLabel = proj
          ? `Projeto: **${proj.name}** (Raiz: "${rootNode.title || proj.name}")`
          : `Mapa/Página: **${rootNode.title || "Sem título"}**`;
        overviewLines.push(`\n### ${rootLabel}`);

        const level1Kids = [
          ...(childrenByParent.get(rootNode.id) ?? []),
          ...(submapByScopeNode.get(rootNode.id) ?? []),
        ].filter((n, idx, arr) => arr.findIndex((x) => x.id === n.id) === idx);

        if (level1Kids.length === 0) {
          overviewLines.push(`- (Sem sub-ramos cadastrados)`);
          continue;
        }

        for (const l1 of level1Kids) {
          if (isStructuralKanbanNode(l1)) continue;
          const l1Kids = [
            ...(childrenByParent.get(l1.id) ?? []),
            ...(submapByScopeNode.get(l1.id) ?? []),
          ]
            .filter((n, idx, arr) => arr.findIndex((x) => x.id === n.id) === idx)
            .filter((n) => !isStructuralKanbanNode(n));

          const l2Titles = l1Kids
            .slice(0, 12)
            .map((l2) => l2.title || "Sem título");
          const l2Suffix =
            l2Titles.length > 0
              ? `: ${l2Titles.join(", ")}${l1Kids.length > 12 ? "…" : ""}`
              : "";
          overviewLines.push(`- **${l1.title || "Sem título"}**${l2Suffix}`);
        }
      }

      return overviewLines.join("\n");
    };

    // Orçamento estrito de contexto: máximo de 12.000 caracteres (~3.000 a 3.500 tokens)
    const maxContextChars = 12000;
    let contextText = "";

    if (hasSpecificProjectFocus) {
      const noteCaps = [4000, 2000, 1000, 500, 250, 120, 0];
      for (const cap of noteCaps) {
        contextText = buildDetailedProjectContext(cap);
        if (contextText.length <= maxContextChars) break;
      }
    } else {
      contextText = buildGlobalOverviewContext();
    }

    const boundedContext = contextText.slice(0, 12000);

    const systemPrompt = `Você é o **Ayo**, a inteligência artificial nativa da plataforma Ayolia — um parceiro sênior de consultoria estratégica e gestão de projetos que trabalha lado a lado com o consultor.

QUEM VOCÊ É E COMO CONVERSA:
- Seu nome é **Ayo**. Apresente-se assim apenas se perguntarem quem você é.
- Fale em Português (Brasil), de forma natural, direta e humana, como um colega experiente de consultoria — nunca como um relatório automático.
- **Proporcionalidade é a regra de ouro:** responda no tamanho da pergunta.
  - Perguntas simples de checagem ou abertura (ex: "Consegue ver o mapa da Hillo?", "Está vendo esse projeto?", "Oi"): responda em NO MÁXIMO 2 a 3 frases curtas, confirmando naturalmente que está com o mapa aberto (cite só 1 ou 2 elementos-chave para provar que leu, como um setor ou uma conexão) e pergunte como pode ajudar. Exemplo de tom: "Sim, já estou com o mapa da Hillo aberto aqui, incluindo os levantamentos dos setores e as conexões entre as áreas. Esse é um cliente que estamos diagnosticando agora? Como você quer avançar: preparar a próxima reunião ou analisar algum setor específico?"
  - NUNCA despeje tabelas gigantes, listas longas ou o mapa inteiro sem que o usuário peça.
  - Só entregue análises profundas, listas detalhadas, pautas ou planos de ação quando o usuário pedir explicitamente (ex: "Sugira uma pauta", "Analise os gargalos", "Resuma as reuniões"). Nesses casos, use Markdown claro (títulos \`###\`, tópicos, **negrito**) e seja objetivo.

COMO USAR OS DADOS:
1. **Fidelidade estrita:** baseie-se RIGOROSAMENTE nos fatos, ramos, setores, pessoas, textos/atas/transcrições das páginas, links, conexões transversais (linhas laranjas) e tarefas do Kanban presentes no CONTEXTO abaixo. Nunca invente fatos. Se algo não está no contexto, diga com naturalidade que não encontrou no mapa.
2. **Cite pelo nome** os ramos e setores relevantes (ex: Comercial, Fiscal, Contexto) quando a resposta for analítica.
3. **Leia o conteúdo das páginas:** o texto dentro de cada nó (atas, transcrições, notas) e os links marcados como \`[Link]: URL\` fazem parte do contexto. Quando o usuário perguntar sobre um link ou documento, use o que estiver registrado (título, nota e URL). Você não consegue abrir o conteúdo externo de uma URL — se for pedido, diga isso e use apenas o que está anotado no nó.
4. Preste atenção às conexões livres entre ramos e às notas: elas revelam dependências, dores e retrabalhos.

=== ESCOPO ATUAL: ${scopeLabel} ===
=== DADOS DO(S) PROJETO(S) E MAPA(S) MENTAL(IS) ===
${boundedContext}
=== FIM DOS DADOS ===`;

    // Histórico limitado às últimas 4 mensagens, truncando mensagens longas a no máximo 1.500 caracteres cada
    const history: ChatMessageInput[] = Array.isArray(body.history)
      ? body.history
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          )
          .slice(-4)
          .map((m) => ({
            role: m.role,
            content:
              m.content.length > 1500
                ? `${m.content.slice(0, 1500)}…`
                : m.content,
          }))
      : [];

    const groqMessages = [
      { role: "system" as const, content: systemPrompt },
      ...history,
      { role: "user" as const, content: userMessage },
    ];

    const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
    const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
    const PRIMARY_MODEL = "llama-3.3-70b-versatile";

    const callGroqWithModel = async (modelName: string) => {
      const res = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: groqMessages,
          temperature: 0.35,
          max_tokens: 1200,
        }),
      });
      if (res.ok) {
        return {
          ok: true as const,
          status: res.status,
          data: (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          },
          errText: "",
        };
      }
      const errText = await res.text();
      return { ok: false as const, status: res.status, data: null, errText };
    };

    let attempt = await callGroqWithModel(PRIMARY_MODEL);

    if (
      !attempt.ok &&
      (attempt.status === 404 ||
        attempt.status === 413 ||
        attempt.status === 429 ||
        attempt.errText.includes("model_not_found") ||
        attempt.errText.includes("model_decommissioned") ||
        attempt.errText.includes("rate_limit_exceeded"))
    ) {
      console.warn(
        `[api/ai/chat] Modelo principal "${PRIMARY_MODEL}" retornou HTTP ${attempt.status}. Consultando modelos ativos em ${GROQ_MODELS_URL}...`,
      );
      try {
        const modelsRes = await fetch(GROQ_MODELS_URL, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
          },
        });

        if (modelsRes.ok) {
          const modelsPayload = (await modelsRes.json()) as {
            data?: { id: string; active?: boolean }[];
          };

          const availableChatModels = (modelsPayload.data ?? [])
            .filter((m) => m && typeof m.id === "string" && m.active !== false)
            .map((m) => m.id)
            .filter((id) => {
              const lower = id.toLowerCase();
              return (
                id !== PRIMARY_MODEL &&
                !lower.includes("whisper") &&
                !lower.includes("guard") &&
                !lower.includes("safeguard") &&
                !lower.includes("tts") &&
                !lower.includes("orpheus") &&
                !lower.includes("playai") &&
                !lower.includes("embed")
              );
            })
            .sort((a, b) => {
              const score = (id: string) => {
                const lower = id.toLowerCase();
                if (lower.includes("llama")) return 0;
                if (lower.includes("qwen")) return 1;
                return 2;
              };
              return score(a) - score(b);
            });

          for (const dynamicModel of availableChatModels) {
            const dynamicAttempt = await callGroqWithModel(dynamicModel);
            attempt = dynamicAttempt;
            if (dynamicAttempt.ok) {
              break;
            }
            if (
              dynamicAttempt.status !== 404 &&
              dynamicAttempt.status !== 413 &&
              dynamicAttempt.status !== 429 &&
              !dynamicAttempt.errText.includes("model_not_found") &&
              !dynamicAttempt.errText.includes("rate_limit_exceeded")
            ) {
              break;
            }
          }
        }
      } catch (modelsErr) {
        console.warn("[api/ai/chat] Erro ao consultar lista dinâmica de modelos:", modelsErr);
      }
    }

    if (!attempt.ok || !attempt.data) {
      console.error(
        "[api/ai/chat] Erro final na API Groq:",
        attempt.status,
        attempt.errText,
      );
      return NextResponse.json(
        {
          error: `Erro ao consultar a API da Groq (${attempt.status}): ${attempt.errText}`,
        },
        { status: 502 },
      );
    }

    const reply =
      attempt.data.choices?.[0]?.message?.content?.trim() ||
      "Não foi possível gerar uma resposta para esta solicitação.";

    return NextResponse.json({
      reply,
      contextSummary: {
        scopeLabel,
        nodesCount: totalNodesSerialized,
        tasksCount: totalTasksSerialized,
        linksCount: totalCustomLinksSerialized,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/ai/chat] Falha inesperada:", err);
    return NextResponse.json(
      { error: `Falha ao processar consulta no Ayo: ${msg}` },
      { status: 500 },
    );
  }
}
