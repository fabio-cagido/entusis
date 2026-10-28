"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Network, Plus, Upload, UserPlus, Users } from "lucide-react";
import { descendantsOf, useStore } from "@/lib/store";
import ImportMindMapModal from "./ImportMindMapModal";

export default function CanvasIndex() {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const shares = useStore((s) => s.shares);
  const currentUserId = useStore((s) => s.currentUserId);
  const openShareModal = useStore((s) => s.openShareModal);
  const createItem = useStore((s) => s.createItem);
  const router = useRouter();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const shareCountByItem = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of Object.values(shares)) {
      counts[s.item_id] = (counts[s.item_id] ?? 0) + 1;
    }
    return counts;
  }, [shares]);

  const maps = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.default_view === "CANVAS")
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
        .map((m) => ({ m, count: descendantsOf(items, m.id).length })),
    [items],
  );

  const create = () => {
    const n = createItem({ title: "Novo mapa mental", icon: "🧠", default_view: "CANVAS", canvas: { x: 0, y: 0, color: "#8b7bff" } });
    router.push(`/canvas/${n.id}`);
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Canvas infinito</p>
          <h1 className="view-title">Mapas mentais</h1>
          <p className="muted">Qualquer página também pode ser aberta como canvas pelo seletor de visão.</p>
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
      <div className="map-grid">
        {maps.map(({ m, count }) => {
          const p = m.project_id ? projects[m.project_id] : null;
          const isSharedWithMe = Boolean(m.user_id && currentUserId && m.user_id !== currentUserId);
          const shareCount = shareCountByItem[m.id] ?? 0;
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
                <div className="map-card-title-row">
                  <h3>{m.icon ?? "🧠"} {m.title || "Sem título"}</h3>
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
