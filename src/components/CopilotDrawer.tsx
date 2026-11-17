"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  FolderKanban,
  Globe,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  scopeLabel?: string;
}

const QUICK_PROMPTS = [
  {
    label: "Preparar pauta para próxima reunião",
    prompt:
      "Com base em toda a estrutura deste mapa mental, notas internas e tarefas pendentes, prepare uma pauta estratégica estruturada para a minha próxima reunião com este cliente, destacando os pontos prioritários por setor.",
  },
  {
    label: "Identificar gargalos e riscos",
    prompt:
      "Analise os ramos, transcrições/notas internas e as conexões livres transversais deste mapa. Quais são os principais gargalos operacionais, riscos ocultos e dependências críticas entre os departamentos?",
  },
  {
    label: "Resumir status e pendências",
    prompt:
      "Faça um diagnóstico executivo do status atual deste projeto/mapa, listando o que está em andamento (Fazendo), o que está travado ou A Fazer, e sugira os 3 próximos passos de maior impacto.",
  },
  {
    label: "Analisar conexões entre setores",
    prompt:
      "Quais são as conexões transversais e interdependências entre os diferentes ramos/setores deste mapa e que ações práticas você recomenda para alinhar essas áreas?",
  },
];

/**
 * Renderiza formatação inline de Markdown (**negrito**, *itálico*, `código`).
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      return <strong key={i}>{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return <em key={i}>{tok.slice(1, -1)}</em>;
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return (
        <code key={i} className="copilot-inline-code">
          {tok.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{tok}</React.Fragment>;
  });
}

/**
 * Renderizador leve e seguro de Markdown para as respostas estruturadas do Copiloto IA.
 */
function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: { text: string; ordered: boolean; indent: number }[] = [];
  let keyCounter = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const isOrdered = listItems[0].ordered;
    const ListTag = isOrdered ? "ol" : "ul";
    elements.push(
      <ListTag key={`list-${keyCounter++}`} className="copilot-md-list">
        {listItems.map((item, idx) => (
          <li
            key={idx}
            style={item.indent > 0 ? { marginLeft: `${Math.min(item.indent, 3) * 14}px` } : undefined}
          >
            {renderInlineMarkdown(item.text)}
          </li>
        ))}
      </ListTag>,
    );
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={`hr-${keyCounter++}`} className="copilot-md-hr" />);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1 || level === 2) {
        elements.push(
          <h3 key={`h-${keyCounter++}`} className="copilot-md-h3">
            {renderInlineMarkdown(text)}
          </h3>,
        );
      } else {
        elements.push(
          <h4 key={`h-${keyCounter++}`} className="copilot-md-h4">
            {renderInlineMarkdown(text)}
          </h4>,
        );
      }
      continue;
    }

    const bulletMatch = rawLine.match(/^(\s*)([-*•])\s+(.+)$/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      listItems.push({ text: bulletMatch[3], ordered: false, indent });
      continue;
    }

    const numMatch = rawLine.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (numMatch) {
      const indent = Math.floor(numMatch[1].length / 2);
      listItems.push({ text: numMatch[2], ordered: true, indent });
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushList();
      const quoteText = trimmed.replace(/^>\s*/, "");
      elements.push(
        <blockquote key={`q-${keyCounter++}`} className="copilot-md-quote">
          {renderInlineMarkdown(quoteText)}
        </blockquote>,
      );
      continue;
    }

    flushList();
    elements.push(
      <p key={`p-${keyCounter++}`} className="copilot-md-p">
        {renderInlineMarkdown(trimmed)}
      </p>,
    );
  }

  flushList();
  return <div className="copilot-markdown">{elements}</div>;
}

function CopilotDrawerInner() {
  const copilotOpen = useStore((s) => s.copilotOpen);
  const copilotContext = useStore((s) => s.copilotContext);
  const openCopilot = useStore((s) => s.openCopilot);
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);

  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Detecta automaticamente o Mapa/Projeto aberto na rota atual ou passado pelo botão
  const detectedContext = useMemo(() => {
    let projectId: string | null = copilotContext?.projectId ?? null;
    let rootNodeId: string | null = copilotContext?.rootNodeId ?? null;

    if (pathname.startsWith("/canvas/")) {
      const id = pathname.split("/canvas/")[1]?.split("/")[0]?.split("?")[0];
      if (id) rootNodeId = id;
    } else if (pathname.startsWith("/page/")) {
      const id = pathname.split("/page/")[1]?.split("/")[0]?.split("?")[0];
      if (id) rootNodeId = id;
    } else if (pathname === "/board") {
      const qProj = searchParams.get("project");
      const qRoot = searchParams.get("root");
      if (qProj) projectId = qProj;
      if (qRoot) rootNodeId = qRoot;
    }

    // Sobe até o mapa/página raiz se rootNodeId for um sub-nó
    if (rootNodeId && items[rootNodeId]) {
      let cur = items[rootNodeId];
      let guard = 0;
      while (cur && guard++ < 50) {
        if (!projectId && cur.project_id) {
          projectId = cur.project_id;
        }
        const nextId = cur.scope_node_id || cur.parent_id;
        if (nextId && items[nextId]) {
          cur = items[nextId];
        } else {
          break;
        }
      }
      if (cur) rootNodeId = cur.id;
    }

    if (projectId && projects[projectId] && !rootNodeId) {
      const pr = projects[projectId];
      rootNodeId =
        pr.page_id ??
        Object.values(items).find(
          (i) => i.project_id === projectId && !i.parent_id && i.type === "PAGE",
        )?.id ??
        null;
    }

    const activeProject = projectId ? projects[projectId] ?? null : null;
    const activeRootItem = rootNodeId ? items[rootNodeId] ?? null : null;
    const hasSpecificTarget = Boolean(activeProject || activeRootItem);
    const targetName =
      activeProject?.name ||
      activeRootItem?.title ||
      "Todos os Projetos";

    return {
      projectId,
      rootNodeId,
      hasSpecificTarget,
      targetName,
    };
  }, [copilotContext, pathname, searchParams, items, projects]);

  const [scope, setScope] = useState<"current" | "all">("current");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<{
    scopeLabel: string;
    nodesCount: number;
    tasksCount: number;
    linksCount: number;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Ajusta escopo padrão quando abre em tela geral (/today ou /canvas) vs dentro de um mapa/projeto
  useEffect(() => {
    if (copilotOpen) {
      if (detectedContext.hasSpecificTarget) {
        setScope("current");
      } else {
        setScope("all");
      }
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [copilotOpen, detectedContext.hasSpecificTarget, detectedContext.projectId, detectedContext.rootNodeId]);

  useEffect(() => {
    if (copilotOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, copilotOpen]);

  useEffect(() => {
    if (!copilotOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openCopilot(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copilotOpen, openCopilot]);

  if (!copilotOpen) return null;

  const sendPrompt = async (textToSend?: string) => {
    const promptText = (textToSend ?? input).trim();
    if (!promptText || loading) return;

    setError(null);
    if (!textToSend) setInput("");

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: promptText,
      timestamp: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const sb = getSupabase();
      let accessToken: string | null = null;
      if (sb) {
        const { data } = await sb.auth.getSession();
        accessToken = data.session?.access_token ?? null;
      }

      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          message: promptText,
          history: historyPayload,
          scope: detectedContext.hasSpecificTarget ? scope : "all",
          projectId: detectedContext.projectId,
          rootNodeId: detectedContext.rootNodeId,
        }),
      });

      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        contextSummary?: {
          scopeLabel: string;
          nodesCount: number;
          tasksCount: number;
          linksCount: number;
        };
      };

      if (!res.ok || data.error) {
        throw new Error(data.error || `Erro HTTP ${res.status}`);
      }

      if (data.contextSummary) {
        setLastSummary(data.contextSummary);
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply || "Sem resposta.",
        timestamp: new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        scopeLabel: data.contextSummary?.scopeLabel,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  };

  const activeScopeDescription =
    scope === "current" && detectedContext.hasSpecificTarget
      ? detectedContext.targetName
      : "Todos os Projetos Ativos";

  return (
    <>
      <div
        className="drawer-scrim copilot-scrim is-open"
        onClick={() => openCopilot(false)}
      />
      <aside
        className="drawer copilot-drawer glass is-open"
        aria-label="Ayo, a IA do Ayolia"
      >
        {/* Cabeçalho do Ayo */}
        <header className="copilot-header">
          <div className="copilot-header-title">
            <div className="copilot-avatar-badge">
              <Sparkles size={17} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <h2>Ayo</h2>
                <span className="copilot-model-pill">IA do Ayolia</span>
              </div>
              <p className="muted small">
                Lendo: <strong>{activeScopeDescription}</strong>
                {lastSummary ? ` · ${lastSummary.nodesCount} nós` : ""}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {messages.length > 0 && (
              <button
                type="button"
                className="icon-btn"
                title="Limpar conversa"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              title="Fechar Ayo (Esc)"
              onClick={() => openCopilot(false)}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        {/* Seletor Rápido de Contexto */}
        <div className="copilot-scope-bar">
          <span className="copilot-scope-label">Escopo de leitura:</span>
          <div className="segmented segmented-sm copilot-scope-segmented">
            <button
              type="button"
              className={
                scope === "current" && detectedContext.hasSpecificTarget
                  ? "is-active"
                  : ""
              }
              disabled={!detectedContext.hasSpecificTarget}
              onClick={() => setScope("current")}
              title={
                detectedContext.hasSpecificTarget
                  ? `Analisar apenas "${detectedContext.targetName}"`
                  : "Abra um projeto ou mapa mental para usar o escopo atual"
              }
            >
              <FolderKanban size={13} />
              <span>Mapa/Projeto Atual</span>
            </button>
            <button
              type="button"
              className={
                scope === "all" || !detectedContext.hasSpecificTarget
                  ? "is-active"
                  : ""
              }
              onClick={() => setScope("all")}
              title="Analisar todos os projetos e mapas mentais ativos da sua conta"
            >
              <Globe size={13} />
              <span>Todos os Projetos</span>
            </button>
          </div>
        </div>

        {/* Área de Mensagens */}
        <div className="copilot-messages">
          {messages.length === 0 ? (
            <div className="copilot-empty-state">
              <div className="copilot-empty-icon">
                <Bot size={28} />
              </div>
              <h3>Oi, eu sou o Ayo. Como posso ajudar?</h3>
              <p className="muted small">
                Eu leio toda a árvore hierárquica, notas internas, transcrições,
                conexões laranjas entre setores e tarefas do Kanban de{" "}
                <strong>{activeScopeDescription}</strong>.
              </p>

              <div className="copilot-quick-prompts">
                <span className="copilot-quick-title">Sugestões rápidas:</span>
                {QUICK_PROMPTS.map((qp, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="copilot-prompt-chip"
                    onClick={() => void sendPrompt(qp.prompt)}
                  >
                    <Sparkles size={13} className="copilot-prompt-chip-icon" />
                    <span>{qp.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`copilot-msg copilot-msg--${m.role}`}
              >
                <div className="copilot-msg-meta">
                  <span className="copilot-msg-author">
                    {m.role === "assistant" ? (
                      <>
                        <Sparkles size={12} /> Ayo
                      </>
                    ) : (
                      <>
                        <User size={12} /> Você
                      </>
                    )}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="copilot-msg-time">{m.timestamp}</span>
                    {m.role === "assistant" && (
                      <button
                        type="button"
                        className="copilot-copy-btn"
                        title="Copiar resposta"
                        onClick={() => handleCopy(m.id, m.content)}
                      >
                        {copiedId === m.id ? (
                          <>
                            <Check size={11} /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy size={11} /> Copiar
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="copilot-msg-bubble">
                  {m.role === "assistant" ? (
                    <MarkdownMessage content={m.content} />
                  ) : (
                    <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.content}</p>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="copilot-msg copilot-msg--assistant">
              <div className="copilot-msg-meta">
                <span className="copilot-msg-author">
                  <Sparkles size={12} /> Ayo
                </span>
              </div>
              <div className="copilot-msg-bubble copilot-loading-bubble">
                <Loader2 size={16} className="copilot-spinner" />
                <span>O Ayo está lendo o mapa…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="copilot-error-banner" role="alert">
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input de Chat */}
        <form
          className="copilot-input-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void sendPrompt();
          }}
        >
          <textarea
            ref={textareaRef}
            className="copilot-textarea"
            rows={2}
            placeholder={`Converse com o Ayo sobre ${activeScopeDescription}... (Enter para enviar)`}
            value={input}
            disabled={loading}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendPrompt();
              }
            }}
          />
          <button
            type="submit"
            className="btn btn-primary copilot-send-btn"
            disabled={!input.trim() || loading}
            title="Enviar pergunta (Enter)"
          >
            {loading ? <Loader2 size={16} className="copilot-spinner" /> : <Send size={15} />}
          </button>
        </form>
      </aside>
    </>
  );
}

export default function CopilotDrawer() {
  return (
    <Suspense fallback={null}>
      <CopilotDrawerInner />
    </Suspense>
  );
}
