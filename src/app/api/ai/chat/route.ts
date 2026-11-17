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
  DONE: "ConcluÃ­do",
};

/**
 * Converte HTML rico (TipTap) em texto limpo estruturado, preservando quebras de linha e listas de tarefas.
 */
function htmlToCleanText(html: string | null | undefined): string {
  if (!html) return "";
  let source = html;

  // ConteÃºdo salvo como JSON estruturado (ex: TipTap/ProseMirror): extrai apenas o texto Ãºtil e links
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
 * Limpa o texto da pÃ¡gina do nÃ³ e aplica um limite de caracteres (orÃ§amento),
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

  const clipped = `${clean.slice(0, cap).trimEnd()}â€¦`;
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
        { error: "Chave GROQ_API_KEY nÃ£o configurada no servidor." },
        { status: 500 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "ConfiguraÃ§Ã£o do Supabase ausente no servidor." },
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
          // Somente leitura de sessÃ£o na rota de API
        },
      },
    });

    // Valida o usuÃ¡rio autenticado via cookies ou header Authorization Bearer
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
        { error: "UsuÃ¡rio nÃ£o autenticado. FaÃ§a login novamente." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as ChatRequestBody;
    const userMessage = (body.message || "").trim();
    if (!userMessage) {
      return NextResponse.json(
        { error: "A mensagem nÃ£o pode estar vazia." },
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

    // Filtra apenas itens ativos (nÃ£o movidos para a lixeira)
    const activeItems = rawItems.filter(
      (it) => !it.deleted_at && !it.canvas?.deleted_at,
    );
    const itemsById = new Map<string, DbItemRow>(
      activeItems.map((it) => [it.id, it]),
    );
    const projectsById = new Map<string, DbProjectRow>(
      allProjects.map((p) => [p.id, p]),
    );

    // Ãndice de filhos por parent_id e submapas por scope_node_id
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

    // Coleta recursivamente todos os descendentes de um nÃ³ raiz
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

    // Sobe atÃ© a raiz da Ã¡rvore caso requestedRootNodeId seja um sub-nÃ³
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

    // Determina quais raÃ­zes / projetos compÃµem o contexto solicitado
    let targetRoots: DbItemRow[] = [];
    let scopeLabel = "Todos os Projetos e Mapas Ativos";

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
          if (!resolvedProject && topRoot.project_id) {
            resolvedProject = projectsById.get(topRoot.project_id) ?? null;
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
        scopeLabel = `Projeto: ${resolvedProject.name}`;
      } else if (rootSet.size > 0) {
        const firstRoot = Array.from(rootSet.values())[0];
        scopeLabel = `Mapa/PÃ¡gina: ${firstRoot.title || "Sem tÃ­tulo"}`;
      }

      targetRoots = Array.from(rootSet.values());
    }

    // Se scope === 'all' ou se nÃ£o havia projeto/mapa especÃ­fico aberto na rota atual:
    let otherProjectsSummaryLine = "";
    if (targetRoots.length === 0) {
      const archivedProjectIds = new Set(
        allProjects.filter((p) => p.is_archived).map((p) => p.id),
      );
      const allCandidateRoots = activeItems.filter((it) => {
        const scopeId = it.scope_node_id ?? it.canvas?.scope_node_id ?? null;
        if (it.parent_id || scopeId) return false;
        if (it.project_id && archivedProjectIds.has(it.project_id)) return false;
        return true;
      });

      const normText = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();

      const msgNorm = normText(userMessage);

      // Verifica se a mensagem do usuÃ¡rio menciona algum projeto ou mapa especÃ­fico (ex: "Hillo", "Audima", "Ayolia")
      const matchedRoots = allCandidateRoots.filter((r) => {
        const proj = r.project_id ? projectsById.get(r.project_id) : null;
        const rTitle = normText(r.title || "");
        const pTitle = proj ? normText(proj.name || "") : "";
        return (
          (rTitle.length >= 3 && msgNorm.includes(rTitle)) ||
          (pTitle.length >= 3 && msgNorm.includes(pTitle))
        );
      });

      if (matchedRoots.length > 0) {
        targetRoots = matchedRoots;
        const matchedNames = matchedRoots.map((r) => {
          const p = r.project_id ? projectsById.get(r.project_id) : null;
          return p?.name || r.title || "Sem tÃ­tulo";
        });
        const otherNames = allCandidateRoots
          .filter((r) => !matchedRoots.some((m) => m.id === r.id))
          .map((r) => {
            const p = r.project_id ? projectsById.get(r.project_id) : null;
            return p?.name || r.title || "Sem tÃ­tulo";
          });
        scopeLabel = `Foco detectado: ${matchedNames.join(", ")}`;
        if (otherNames.length > 0) {
          otherProjectsSummaryLine = `\n\n### Demais Projetos/Mapas Ativos na Conta (visÃ£o geral de nomes):\n${Array.from(new Set(otherNames)).join(", ")}`;
        }
      } else {
        targetRoots = allCandidateRoots;
        scopeLabel = "Todos os Projetos e Mapas Ativos";
      }
    }

    // 2. SerializaÃ§Ã£o em Markdown Estruturado para o LLM
    let totalNodesSerialized = 0;
    let totalTasksSerialized = 0;
    let totalCustomLinksSerialized = 0;
    const buildContext = (noteCap: number): string => {
    totalNodesSerialized = 0;
    totalTasksSerialized = 0;
    totalCustomLinksSerialized = 0;
    const contextSections: string[] = [];

    const getBranchPath = (node: DbItemRow, rootId: string): string => {
      const parts: string[] = [];
      let cur: DbItemRow | undefined = node;
      let guard = 0;
      while (cur && guard++ < 50) {
        parts.unshift(cur.title || "Sem tÃ­tulo");
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

    for (const rootNode of targetRoots) {
      const proj = rootNode.project_id
        ? projectsById.get(rootNode.project_id) ?? null
        : null;
      const subtree = collectSubtree(rootNode.id);
      const allMapNodes = [rootNode, ...subtree];

      // Inclui tambÃ©m nÃ³s que tenham project_id igual ao projeto mas estejam Ã³rfÃ£os
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
        : `MAPA MENTAL / PÃGINA: "${rootNode.title || "Sem tÃ­tulo"}"`;

      lines.push(`## ${headerTitle}`);

      const rootCleanContent = formatNodeText(rootNode.content, noteCap * 2);
      if (rootCleanContent) {
        lines.push(`### Documento / VisÃ£o Geral da Raiz:`);
        lines.push(rootCleanContent);
      }

      const rootAtt = formatAttachments(rootNode.attachments);
      if (rootAtt) {
        lines.push(`Links/Anexos da Raiz: ${rootAtt}`);
      }

      // RenderizaÃ§Ã£o recursiva da Ã¡rvore hierÃ¡rquica (Pai -> Filho)
      lines.push(`### Estrutura HierÃ¡rquica do Mapa Mental (Ãrvore Pai -> Filho):`);

      const visitedRender = new Set<string>([rootNode.id]);
      const renderTree = (parentId: string, depth: number) => {
        const kids = childrenByParent.get(parentId) ?? [];
        const scopedKids = submapByScopeNode.get(parentId) ?? [];
        const combined = [...kids, ...scopedKids.filter((s) => !kids.some((k) => k.id === s.id))];

        for (const child of combined) {
          if (visitedRender.has(child.id)) continue;
          visitedRender.add(child.id);

          const indent = "  ".repeat(depth);
          const metaTags: string[] = [];
          if (child.canvas?.shape) metaTags.push(`Fluxo: ${child.canvas.shape}`);
          if (child.status) metaTags.push(`Status Kanban: ${STATUS_PT[child.status] || child.status}`);
          if (child.is_today) metaTags.push(`Foco de Hoje`);
          if (child.is_recurring) metaTags.push(`Recorrente (${child.recurrence_type || "ativo"})`);
          if (child.start_time) metaTags.push(`Prazo/Agenda: ${child.start_time.slice(0, 10)}`);

          const metaSuffix = metaTags.length > 0 ? ` [${metaTags.join(" | ")}]` : "";
          const iconPrefix = child.icon ? `${child.icon} ` : "";
          lines.push(
            `${indent}- **${iconPrefix}${child.title || "Sem tÃ­tulo"}**${metaSuffix}`,
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

      // ConexÃµes Livres / Arestas Tracejadas Laranjas (links transversais entre nÃ³s)
      const customConnections: string[] = [];
      for (const n of allMapNodes) {
        if (!Array.isArray(n.links) || n.links.length === 0) continue;
        for (const targetId of n.links) {
          const targetNode = itemsById.get(targetId);
          if (!targetNode) continue;
          totalCustomLinksSerialized++;
          const fromPath = getBranchPath(n, rootNode.id);
          const toPath = getBranchPath(targetNode, rootNode.id);
          customConnections.push(`- **${fromPath}** â”€â”€(conexÃ£o direta)â”€â”€> **${toPath}**`);
        }
      }

      if (customConnections.length > 0) {
        lines.push(`### ConexÃµes Livres e DependÃªncias Transversais (Linhas Laranjas):`);
        lines.push(...customConnections);
      }

      // Resumo de Tarefas / Kanban do Projeto ou Mapa
      const taskNodes = allMapNodes.filter((n) => n.status !== null);
      totalTasksSerialized += taskNodes.length;
      if (taskNodes.length > 0) {
        lines.push(`### Quadro Kanban / Tarefas Vinculadas (${taskNodes.length}):`);
        for (const st of ["DOING", "TODO", "BACKLOG", "DONE"] as const) {
          const group = taskNodes.filter((t) => t.status === st);
          if (group.length === 0) continue;
          lines.push(`- **${STATUS_PT[st]} (${group.length}):**`);
          for (const tk of group) {
            const note = formatNodeText(tk.content, Math.min(noteCap, 300));
            const noteInline = note ? ` â€” Nota: "${note.replace(/\n+/g, " ")}"` : "";
            const todayFlag = tk.is_today ? " [FOCO HOJE]" : "";
            lines.push(`  - ${tk.title || "Sem tÃ­tulo"}${todayFlag}${noteInline}`);
          }
        }
      }

      contextSections.push(lines.join("\n"));
    }

    return (
      (contextSections.length > 0
        ? contextSections.join("\n\n---\n\n")
        : "Nenhum mapa mental ou projeto encontrado neste escopo.") +
      otherProjectsSummaryLine
    );
    };

    // OrÃ§amento inteligente de contexto (~18.000 caracteres / ~5.000 tokens) para nunca exceder o limite de 8.000 TPM da Groq.
    // Prioriza manter TODA a estrutura + links, reduzindo progressivamente o tamanho das notas/transcriÃ§Ãµes por nÃ³ atÃ© caber.
    const maxContextChars = 18000;
    const noteCaps = [6000, 3000, 1500, 800, 400, 200, 0];
    let fullContextMarkdown = "";
    for (const cap of noteCaps) {
      fullContextMarkdown = buildContext(cap);
      if (fullContextMarkdown.length <= maxContextChars) break;
    }
    const boundedContext =
      fullContextMarkdown.length > maxContextChars
        ? `${fullContextMarkdown.slice(0, maxContextChars)}\n\n[...contexto truncado em 18.000 caracteres para respeitar o limite de tokens da API...]`
        : fullContextMarkdown;

    const systemPrompt = `VocÃª Ã© o **Ayo**, a inteligÃªncia artificial nativa da plataforma Ayolia â€” um parceiro sÃªnior de consultoria estratÃ©gica e gestÃ£o de projetos que trabalha lado a lado com o consultor.

QUEM VOCÃŠ Ã‰ E COMO CONVERSA:
- Seu nome Ã© **Ayo**. Apresente-se assim apenas se perguntarem quem vocÃª Ã©.
- Fale em PortuguÃªs (Brasil), de forma natural, direta e humana, como um colega experiente de consultoria â€” nunca como um relatÃ³rio automÃ¡tico.
- **Proporcionalidade Ã© a regra de ouro:** responda no tamanho da pergunta.
  - Perguntas simples de checagem ou abertura (ex: "Consegue ver o mapa da Hillo?", "EstÃ¡ vendo esse projeto?", "Oi"): responda em NO MÃXIMO 2 a 3 frases curtas, confirmando naturalmente que estÃ¡ com o mapa aberto (cite sÃ³ 1 ou 2 elementos-chave para provar que leu, como um setor ou uma conexÃ£o) e pergunte como pode ajudar. Exemplo de tom: "Sim, jÃ¡ estou com o mapa da Hillo aberto aqui, incluindo os levantamentos dos setores e as conexÃµes entre as Ã¡reas. Esse Ã© um cliente que estamos diagnosticando agora? Como vocÃª quer avanÃ§ar: preparar a prÃ³xima reuniÃ£o ou analisar algum setor especÃ­fico?"
  - NUNCA despeje tabelas gigantes, listas longas ou o mapa inteiro sem que o usuÃ¡rio peÃ§a.
  - SÃ³ entregue anÃ¡lises profundas, listas detalhadas, pautas ou planos de aÃ§Ã£o quando o usuÃ¡rio pedir explicitamente (ex: "Sugira uma pauta", "Analise os gargalos", "Resuma as reuniÃµes"). Nesses casos, use Markdown claro (tÃ­tulos \`###\`, tÃ³picos, **negrito**) e seja objetivo.

COMO USAR OS DADOS:
1. **Fidelidade estrita:** baseie-se RIGOROSAMENTE nos fatos, ramos, setores, pessoas, textos/atas/transcriÃ§Ãµes das pÃ¡ginas, links, conexÃµes transversais (linhas laranjas) e tarefas do Kanban presentes no CONTEXTO abaixo. Nunca invente fatos. Se algo nÃ£o estÃ¡ no contexto, diga com naturalidade que nÃ£o encontrou no mapa.
2. **Cite pelo nome** os ramos e setores relevantes (ex: Comercial, Fiscal, Contexto) quando a resposta for analÃ­tica.
3. **Leia o conteÃºdo das pÃ¡ginas:** o texto dentro de cada nÃ³ (atas, transcriÃ§Ãµes, notas) e os links marcados como \`[Link]: URL\` fazem parte do contexto. Quando o usuÃ¡rio perguntar sobre um link ou documento, use o que estiver registrado (tÃ­tulo, nota e URL). VocÃª nÃ£o consegue abrir o conteÃºdo externo de uma URL â€” se for pedido, diga isso e use apenas o que estÃ¡ anotado no nÃ³.
4. Preste atenÃ§Ã£o Ã s conexÃµes livres entre ramos e Ã s notas: elas revelam dependÃªncias, dores e retrabalhos.

=== ESCOPO ATUAL: ${scopeLabel} ===
=== DADOS DO(S) PROJETO(S) E MAPA(S) MENTAL(IS) ===
${boundedContext}
=== FIM DOS DADOS ===`;

    const sanitizedHistory: ChatMessageInput[] = Array.isArray(body.history)
      ? body.history
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          )
          .slice(-6)
          .map((m) => ({
            role: m.role,
            content: m.content.slice(0, 2000),
          }))
      : [];

    const groqMessages = [
      { role: "system" as const, content: systemPrompt },
      ...sanitizedHistory,
      { role: "user" as const, content: userMessage },
    ];

    const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
    const candidateModels = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "openai/gpt-oss-120b",
    ];

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
          max_tokens: 1500,
        }),
      });
      if (res.ok) {
        return { ok: true as const, status: res.status, data: await res.json(), errText: "" };
      }
      const errText = await res.text();
      return { ok: false as const, status: res.status, data: null, errText };
    };

    let lastStatus = 500;
    let lastErrText = "";
    let groqData: { choices?: { message?: { content?: string } }[] } | null = null;

    for (const modelName of candidateModels) {
      const attempt = await callGroqWithModel(modelName);
      if (attempt.ok) {
        groqData = attempt.data as { choices?: { message?: { content?: string } }[] };
        break;
      }
      lastStatus = attempt.status;
      lastErrText = attempt.errText;
      console.warn(
        `[api/ai/chat] Modelo "${modelName}" retornou HTTP ${attempt.status}:`,
        attempt.errText,
      );
      // Continua para o fallback se for 404, 413 (TPM), 429 (rate limit), model_not_found ou model_decommissioned
      if (
        attempt.status !== 404 &&
        attempt.status !== 413 &&
        attempt.status !== 429 &&
        !attempt.errText.includes("model_not_found") &&
        !attempt.errText.includes("model_decommissioned") &&
        !attempt.errText.includes("rate_limit_exceeded")
      ) {
        break;
      }
    }

    // Se todos os modelos candidatos retornarem 404/model_not_found, descobre automaticamente um modelo ativo na conta via /openai/v1/models
    if (
      !groqData &&
      (lastStatus === 404 ||
        lastErrText.includes("model_not_found") ||
        lastErrText.includes("model_decommissioned"))
    ) {
      try {
        const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${groqApiKey}` },
        });
        if (modelsRes.ok) {
          const modelsJson = (await modelsRes.json()) as {
            data?: { id: string; active?: boolean }[];
          };
          const availableChatModel = (modelsJson.data ?? [])
            .map((m) => m.id)
            .find(
              (id) =>
                !id.includes("whisper") &&
                !id.includes("tts") &&
                !id.includes("guard") &&
                !id.includes("embed") &&
                !candidateModels.includes(id),
            );
          if (availableChatModel) {
            const fallbackAttempt = await callGroqWithModel(availableChatModel);
            if (fallbackAttempt.ok) {
              groqData = fallbackAttempt.data as {
                choices?: { message?: { content?: string } }[];
              };
            } else {
              lastStatus = fallbackAttempt.status;
              lastErrText = fallbackAttempt.errText;
            }
          }
        }
      } catch (modelsErr) {
        console.warn("[api/ai/chat] Falha ao consultar /openai/v1/models:", modelsErr);
      }
    }

    if (!groqData) {
      console.error("[api/ai/chat] Erro final na API Groq:", lastStatus, lastErrText);
      return NextResponse.json(
        {
          error: `Erro ao consultar a API da Groq (${lastStatus}): ${lastErrText}`,
        },
        { status: 502 },
      );
    }

    const reply =
      groqData.choices?.[0]?.message?.content?.trim() ||
      "NÃ£o foi possÃ­vel gerar uma resposta para esta solicitaÃ§Ã£o.";

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
