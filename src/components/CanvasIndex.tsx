"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FolderKanban, Network, Plus, Search, Upload, UserPlus, Users, X } from "lucide-react";
import { descendantsOf, useStore } from "@/lib/store";
import type { ItemNode, Project } from "@/lib/types";
import ImportMindMapModal from "./ImportMindMapModal";

const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export default function CanvasIndex() {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const shares = useStore((s) => s.shares);
  const currentUserId = useStore((s) => s.currentUserId);
  const openShareModal = useStore((s) => s.openShareModal);
  const createItem = useStore((s) => s.createItem);
  const router = useRouter();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const shareCountByItem = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of Object.values(shares)) {
      counts[s.item_id] = (counts[s.item_id] ?? 0) + 1;
    }
    return counts;
  }, [shares]);

  const maps = useMemo(() => {
    const mapById = new Map<string, { m: ItemNode; project: Project | null }>();

    // 1. Inclui os mapas raiz de todos os Projetos ativos
    for (const pr of Object.values(projects)) {
      if (pr.is_archived) continue;
      const rootItem =
        (pr.page_id ? items[pr.page_id] : null) ??
        Object.values(items).find(
          (i) =>
            !i.deleted_at &&
            !i.parent_id &&
            !i.scope_node_id &&
            i.type === "PAGE" &&
            i.project_id === pr.id,
        );
      if (rootItem && !rootItem.deleted_at) {
        mapById.set(rootItem.id, { m: rootItem, project: pr });
      }
    }

    // 2. Inclui todos os mapas mentais avulsos (default_view === "CANVAS") e raízes vinculadas a projetos ativos
    for (const it of Object.values(items)) {
      if (it.deleted_at || it.parent_id !== null || it.scope_node_id != null) continue;
      const linkedProj = it.project_id ? projects[it.project_id] ?? null : null;
      if (linkedProj?.is_archived) continue;

      if (it.default_view === "CANVAS" || linkedProj) {
        if (!mapById.has(it.id)) {
          mapById.set(it.id, { m: it, project: linkedProj });
        }
      }
    }

    return Array.from(mapById.values())
      .sort((a, b) => (a.m.updated_at < b.m.updated_at ? 1 : -1))
      .map(({ m, project }) => ({
        m,
        project,
        count: descendantsOf(items, m.id).length,
      }));
  }, [items, projects]);

  const filteredMaps = useMemo(() => {
    const q = normalizeText(searchQuery.trim());
    if (!q) return maps;
    return maps.filter(({ m, project }) => {
      const titleNorm = normalizeText(m.title || "Sem título");
      const projNameNorm = project ? normalizeText(project.name) : "";
      return titleNorm.includes(q) || projNameNorm.includes(q);
    });
  }, [maps, searchQuery]);

  const create = () => {
    const n = createItem({ title: "Novo mapa mental", icon: "🧠", default_view: "CANVAS", canvas: { x: 0, y: 0, color: "#8b7bff" } });
    router.push(`/canvas/${n.id}`);
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Mapa infinito</p>
          <h1 className="view-title">Mapas mentais</h1>
          <p className="muted">Qualquer página também pode ser aberta como mapa pelo seletor de visão.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            id="import-mindmap"
            className="btn btn-secondary"
            onClick={() => setIsImportModalOpen(true)}
            title="Importar mapa mental em formato JSON (Lucidchart, etc.)"
          >
            <Upload size={15} /> Importar mapa (JSON)
          </button>
          <button id="new-mindmap" className="btn btn-primary" onClick={create}>
            <Plus size={15} /> Novo mapa
          </button>
        </div>
      </header>
      <div className="map-search-bar">
        <div className="map-search-input-wrap">
          <Search size={15} className="map-search-icon" />
          <input
            id="mindmap-search-input"
            type="text"
            className="map-search-input"
            placeholder="Pesquisar mapa mental pelo nome..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="icon-btn map-search-clear"
              title="Limpar pesquisa"
              onClick={() => setSearchQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <span className="muted small map-search-count">
          {searchQuery.trim()
            ? `${filteredMaps.length} de ${maps.length} ${maps.length === 1 ? "mapa" : "mapas"}`
            : `${maps.length} ${maps.length === 1 ? "mapa" : "mapas"}`}
        </span>
      </div>

      {filteredMaps.length === 0 && searchQuery.trim() ? (
        <div className="map-search-empty glass">
          <p className="muted">Nenhum mapa mental encontrado para &ldquo;{searchQuery.trim()}&rdquo;.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSearchQuery("")}>
            Limpar busca
          </button>
        </div>
      ) : null}

      <div className="map-grid">
        {filteredMaps.map(({ m, project: p, count }) => {
          const isSharedWithMe = Boolean(m.user_id && currentUserId && m.user_id !== currentUserId);
          const shareCount = shareCountByItem[m.id] ?? 0;
          const displayTitle = m.title || p?.name || "Sem título";
          return (
            <Link key={m.id} href={`/canvas/${m.id}`} className="map-card glass" style={{ ["--accent" as string]: m.canvas?.color ?? p?.color ?? "var(--primary)" }}>
              <div className="map-card-art">
                <Network size={34} />
                <button
                  type="button"
                  className="map-card-share-btn icon-btn"
                  title="Compartilhar mapa mental"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openShareModal(m.id);
                  }}
                >
                  <UserPlus size={14} />
                </button>
              </div>
              <div className="map-card-body">
                <div className="map-card-title-row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <h3>{m.icon ?? (p ? "📁" : "🧠")} {displayTitle}</h3>
                  {p && (
                    <span
                      className="shared-badge"
                      style={{
                        background: "rgba(139, 123, 255, 0.14)",
                        color: p.color || "#a78bfa",
                        borderColor: "rgba(139, 123, 255, 0.28)",
                      }}
                      title={`Mapa mental vinculado ao projeto "${p.name}"`}
                    >
                      <FolderKanban size={11} />
                      <span>Projeto</span>
                    </span>
                  )}
                  {(isSharedWithMe || shareCount > 0) && (
                    <span className="shared-badge">
                      <Users size={11} />
                      <span>Compartilhado</span>
                    </span>
                  )}
                </div>
                <p className="muted small">
                  {count} nós{p ? ` · ${p.name}` : ""} · editado {new Date(m.updated_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </Link>
          );
        })}
        <button className="map-card map-card-new" onClick={create}>
          <Plus size={22} />
          <span>Criar mapa mental</span>
        </button>
        <button
          className="map-card map-card-new"
          onClick={() => setIsImportModalOpen(true)}
          style={{ borderStyle: "dashed" }}
          title="Importar mapa mental exportado do Lucidchart ou JSON"
        >
          <Upload size={22} />
          <span>Importar JSON</span>
        </button>
      </div>

      <ImportMindMapModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  );
}
