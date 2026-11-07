"use client";

import { useMemo, useState } from "react";
import { Clock, RotateCcw, Search, Trash2, X } from "lucide-react";
import { TRASH_RETENTION_DAYS, TRASH_RETENTION_MS, useStore } from "@/lib/store";
import { TYPE_LABEL } from "@/lib/types";
import type { ItemNode } from "@/lib/types";
import { typeIcon } from "@/lib/format";

function formatRemainingRetention(deletedAt?: string | null): string {
  if (!deletedAt) return `${TRASH_RETENTION_DAYS}d restantes`;
  const deletedMs = new Date(deletedAt).getTime();
  if (Number.isNaN(deletedMs)) return `${TRASH_RETENTION_DAYS}d restantes`;
  const elapsedMs = Date.now() - deletedMs;
  const remainingMs = Math.max(0, TRASH_RETENTION_MS - elapsedMs);
  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  if (remainingDays <= 1) return "Expira em menos de 24h";
  return `Expira em ${remainingDays} dias`;
}

export default function TrashModal() {
  const isOpen = useStore((s) => s.trashModalOpen);
  const openTrashModal = useStore((s) => s.openTrashModal);
  const trashedItems = useStore((s) => s.trashedItems);
  const projects = useStore((s) => s.projects);
  const restoreItem = useStore((s) => s.restoreItem);
  const permanentlyDeleteItem = useStore((s) => s.permanentlyDeleteItem);
  const emptyTrash = useStore((s) => s.emptyTrash);

  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(trashedItems)
      .filter((it) => {
        if (!q) return true;
        return (it.title || "Sem título").toLowerCase().includes(q);
      })
      .sort((a, b) => (b.deleted_at || "").localeCompare(a.deleted_at || ""));
  }, [trashedItems, query]);

  if (!isOpen) return null;

  const totalCount = Object.keys(trashedItems).length;

  const handlePermanentDelete = (it: ItemNode) => {
    if (
      confirm(
        `Excluir permanentemente "${it.title || "Sem título"}"? Esta ação não pode ser desfeita.`
      )
    ) {
      permanentlyDeleteItem(it.id);
    }
  };

  const handleEmptyTrash = () => {
    if (
      confirm(
        `Esvaziar a lixeira e excluir permanentemente ${totalCount} ${
          totalCount === 1 ? "item" : "itens"
        }? Esta ação não pode ser desfeita.`
      )
    ) {
      emptyTrash();
    }
  };

  return (
    <div
      className="share-modal-backdrop"
      onClick={() => openTrashModal(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trash-modal-title"
    >
      <div
        className="share-modal glass"
        style={{ maxWidth: 560, width: "92vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="share-modal-head">
          <div className="share-modal-title-group">
            <span className="share-modal-icon">
              <Trash2 size={18} />
            </span>
            <div>
              <h2 id="trash-modal-title">Lixeira</h2>
              <p className="muted small">
                Itens na lixeira são retidos por {TRASH_RETENTION_DAYS} dias antes da exclusão definitiva.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => openTrashModal(false)}
            aria-label="Fechar lixeira"
          >
            <X size={16} />
          </button>
        </header>

        <div className="share-modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Search
              size={14}
              style={{ position: "absolute", left: 10, color: "var(--text-muted)", pointerEvents: "none" }}
            />
            <input
              id="trash-search-input"
              type="text"
              className="input"
              style={{ width: "100%", paddingLeft: 32 }}
              placeholder="Pesquisar item na lixeira..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="icon-btn"
                style={{ position: "absolute", right: 6 }}
                onClick={() => setQuery("")}
                title="Limpar filtro"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div
            style={{
              maxHeight: 340,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {list.length === 0 ? (
              <div style={{ padding: "28px 12px", textAlign: "center" }} className="muted small">
                {totalCount === 0
                  ? "A lixeira está vazia."
                  : `Nenhum item encontrado para "${query.trim()}".`}
              </div>
            ) : (
              list.map((it) => {
                const proj = it.project_id ? projects[it.project_id] : null;
                return (
                  <div
                    key={it.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-surface-elevated, rgba(255,255,255,0.03))",
                      border: "1px solid var(--border-subtle, var(--border))",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                      <span style={{ flexShrink: 0 }}>{typeIcon(it)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 500,
                            fontSize: "0.86rem",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {it.title || "Sem título"}
                        </div>
                        <div
                          className="muted"
                          style={{
                            fontSize: "0.72rem",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <span>{TYPE_LABEL[it.type]}</span>
                          {proj && <span>· {proj.name}</span>}
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            · <Clock size={10} /> {formatRemainingRetention(it.deleted_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        title="Restaurar item"
                        onClick={() => restoreItem(it.id)}
                      >
                        <RotateCcw size={12} /> Restaurar
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        title="Excluir permanentemente"
                        onClick={() => handlePermanentDelete(it)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <footer className="share-modal-footer">
          <span className="muted small">
            {totalCount} {totalCount === 1 ? "item na lixeira" : "itens na lixeira"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {totalCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                style={{ color: "#ef4444" }}
                onClick={handleEmptyTrash}
              >
                <Trash2 size={13} /> Esvaziar lixeira
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => openTrashModal(false)}
            >
              Fechar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

