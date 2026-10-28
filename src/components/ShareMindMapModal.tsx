"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  Link2,
  Loader2,
  Mail,
  PenLine,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useStore, viewHref } from "@/lib/store";
import type { ItemShare, SharePermission } from "@/lib/types";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ShareMindMapModal() {
  const shareModalItemId = useStore((s) => s.shareModalItemId);
  const openShareModal = useStore((s) => s.openShareModal);
  const items = useStore((s) => s.items);
  const sharesMap = useStore((s) => s.shares);
  const currentUserId = useStore((s) => s.currentUserId);
  const upsertShareLocal = useStore((s) => s.upsertShareLocal);
  const removeShareLocal = useStore((s) => s.removeShareLocal);

  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<SharePermission>("write");
  const [loadingList, setLoadingList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const item = shareModalItemId ? items[shareModalItemId] : null;
  const isOpen = Boolean(shareModalItemId && item);

  const itemShares = useMemo(() => {
    if (!shareModalItemId) return [];
    return Object.values(sharesMap)
      .filter((s) => s.item_id === shareModalItemId)
      .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  }, [sharesMap, shareModalItemId]);

  const isOwner = useMemo(() => {
    if (!item || !currentUserId) return true;
    return !item.user_id || item.user_id === currentUserId;
  }, [item, currentUserId]);

  const onClose = () => {
    openShareModal(null);
  };

  useEffect(() => {
    if (!isOpen || !shareModalItemId) {
      setEmail("");
      setPermission("write");
      setError(null);
      setSuccessMsg(null);
      setCopiedLink(false);
      return;
    }

    const sb = getSupabase();
    if (!sb || !isSupabaseConfigured) return;

    let cancelled = false;
    setLoadingList(true);
    setError(null);

    (async () => {
      try {
        const { data, error: fetchErr } = await sb
          .from("item_node_shares")
          .select("*")
          .eq("item_id", shareModalItemId)
          .order("created_at", { ascending: false });

        if (cancelled) return;
        if (fetchErr) {
          if (fetchErr.code === "42P01" || fetchErr.message?.includes("item_node_shares")) {
            setError(
              "A tabela 'item_node_shares' ainda não foi criada no Supabase. Execute o script supabase/migrations/0002_shares.sql no SQL Editor."
            );
          } else {
            setError(fetchErr.message);
          }
          return;
        }
        for (const row of (data as ItemShare[]) ?? []) {
          upsertShareLocal(row);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar lista de compartilhamento.");
        }
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, shareModalItemId, upsertShareLocal]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen || !item) return null;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Digite o e-mail do convidado.");
      return;
    }
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError("Digite um endereço de e-mail válido.");
      return;
    }

    const sb = getSupabase();
    if (!sb || !isSupabaseConfigured) {
      setError("O compartilhamento por e-mail requer conexão ativa com o Supabase.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const uid = sessionData.session?.user?.id ?? currentUserId;
      const myEmail = sessionData.session?.user?.email?.toLowerCase();

      if (!uid) {
        throw new Error("Sessão expirada. Faça login novamente para compartilhar.");
      }
      if (myEmail && myEmail === normalizedEmail) {
        throw new Error("Você já é o proprietário deste mapa mental.");
      }

      const { data, error: upsertErr } = await sb
        .from("item_node_shares")
        .upsert(
          {
            item_id: item.id,
            invited_email: normalizedEmail,
            permission,
            created_by: uid,
          },
          { onConflict: "item_id,invited_email" }
        )
        .select("*")
        .single();

      if (upsertErr) {
        throw upsertErr;
      }

      if (data) {
        upsertShareLocal(data as ItemShare);
      }
      setEmail("");
      setSuccessMsg(`Acesso concedido para ${normalizedEmail}!`);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(`Não foi possível compartilhar: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePermission = async (share: ItemShare, nextPerm: SharePermission) => {
    if (share.permission === nextPerm) return;
    setError(null);
    const sb = getSupabase();
    if (!sb) return;

    setUpdatingId(share.id);
    try {
      const { data, error: updErr } = await sb
        .from("item_node_shares")
        .update({ permission: nextPerm })
        .eq("id", share.id)
        .select("*")
        .single();

      if (updErr) throw updErr;
      if (data) {
        upsertShareLocal(data as ItemShare);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(`Erro ao atualizar permissão: ${msg}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemoveShare = async (share: ItemShare) => {
    setError(null);
    const sb = getSupabase();
    if (!sb) return;

    setDeletingId(share.id);
    try {
      const { error: delErr } = await sb
        .from("item_node_shares")
        .delete()
        .eq("id", share.id);

      if (delErr) throw delErr;
      removeShareLocal(share.id);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(`Erro ao remover acesso: ${msg}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyShareLink = () => {
    const url = `${window.location.origin}${viewHref(item)}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="share-modal-backdrop" onClick={onClose}>
      <div
        className="share-modal glass"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        <header className="share-modal-header">
          <div className="share-modal-title-group">
            <div className="share-modal-icon">
              <Users size={18} />
            </div>
            <div>
              <h2 id="share-modal-title">Compartilhar &ldquo;{item.title || "Sem título"}&rdquo;</h2>
              <p className="muted small">
                Convide contatos por e-mail para acessar este mapa mental e seus nós.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Fechar modal de compartilhamento"
          >
            <X size={18} />
          </button>
        </header>

        <div className="share-modal-body">
          {isOwner && (
            <form className="share-invite-form" onSubmit={handleInvite}>
              <div className="share-input-wrap">
                <Mail size={15} className="share-input-icon" />
                <input
                  id="share-email-input"
                  type="email"
                  className="input share-email-input"
                  placeholder="Digite o e-mail do convidado (ex: nome@empresa.com)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  autoFocus
                />
              </div>

              <select
                id="share-permission-select"
                className="select share-perm-select"
                value={permission}
                onChange={(e) => setPermission(e.target.value as SharePermission)}
                disabled={submitting}
                aria-label="Permissão de acesso"
              >
                <option value="write">Pode editar</option>
                <option value="read">Apenas visualizar</option>
              </select>

              <button
                id="share-submit-btn"
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !email.trim()}
              >
                {submitting ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />}
                <span>{submitting ? "Enviando…" : "Convidar"}</span>
              </button>
            </form>
          )}

          {error && (
            <div className="share-alert share-alert-error" role="alert">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="share-alert share-alert-success" role="status">
              <Check size={15} />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="share-access-section">
            <div className="share-section-heading">
              <span>Pessoas com acesso ({itemShares.length})</span>
              {loadingList && <Loader2 size={13} className="spin muted" />}
            </div>

            {itemShares.length === 0 ? (
              <div className="share-empty-state">
                <ShieldCheck size={22} className="muted" />
                <p>Apenas você tem acesso a este mapa no momento.</p>
              </div>
            ) : (
              <ul className="share-user-list">
                {itemShares.map((s) => (
                  <li key={s.id} className="share-user-row">
                    <div className="share-user-avatar">
                      {s.invited_email.charAt(0).toUpperCase()}
                    </div>
                    <div className="share-user-info">
                      <span className="share-user-email">{s.invited_email}</span>
                      <span className="share-user-meta">
                        Convidado em {new Date(s.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>

                    <div className="share-user-actions">
                      {isOwner ? (
                        <>
                          <select
                            className="select input-sm share-row-perm-select"
                            value={s.permission}
                            disabled={updatingId === s.id || deletingId === s.id}
                            onChange={(e) =>
                              handleChangePermission(s, e.target.value as SharePermission)
                            }
                          >
                            <option value="write">Pode editar</option>
                            <option value="read">Apenas visualizar</option>
                          </select>
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            title="Remover acesso"
                            disabled={deletingId === s.id}
                            onClick={() => handleRemoveShare(s)}
                          >
                            {deletingId === s.id ? (
                              <Loader2 size={14} className="spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        </>
                      ) : (
                        <span className="count-pill">
                          {s.permission === "write" ? (
                            <>
                              <PenLine size={11} /> Pode editar
                            </>
                          ) : (
                            <>
                              <Eye size={11} /> Visualizador
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="share-modal-footer">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={handleCopyShareLink}
          >
            {copiedLink ? <Check size={14} /> : <Link2 size={14} />}
            <span>{copiedLink ? "Link copiado!" : "Copiar link do mapa"}</span>
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
            Concluído
          </button>
        </footer>
      </div>
    </div>
  );
}

