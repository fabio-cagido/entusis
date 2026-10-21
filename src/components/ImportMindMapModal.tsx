"use client";

import { useState, useRef, useEffect, DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileJson,
  Check,
  AlertCircle,
  X,
  Network,
  Sparkles,
  Layers,
  ArrowRight,
  FileText,
  Link2,
} from "lucide-react";
import { parseMindMapJson, ParsedMindMap } from "@/lib/importers/mindmap";
import { useStore } from "@/lib/store";

interface ImportMindMapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ImportMindMapModal({ isOpen, onClose }: ImportMindMapModalProps) {
  const router = useRouter();
  const addItems = useStore((s) => s.addItems);
  const projects = useStore((s) => s.projects);

  const [activeTab, setActiveTab] = useState<"file" | "paste">("file");
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedMap, setParsedMap] = useState<ParsedMindMap | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when opened/closed
  useEffect(() => {
    if (!isOpen) {
      setJsonText("");
      setFileName(null);
      setParsedMap(null);
      setCustomTitle("");
      setError(null);
      setIsDragging(false);
      setIsImporting(false);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const processJson = (content: string, name?: string) => {
    setError(null);
    try {
      const result = parseMindMapJson(content);
      setParsedMap(result);
      setCustomTitle(result.title);
      if (name) setFileName(name);
    } catch (err: any) {
      setParsedMap(null);
      setError(err?.message || "Erro ao processar arquivo JSON.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processJson(content, file.name);
    };
    reader.onerror = () => {
      setError("Não foi possível ler o arquivo selecionado.");
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processJson(content, file.name);
    };
    reader.readAsText(file);
  };

  const handlePasteChange = (val: string) => {
    setJsonText(val);
    if (!val.trim()) {
      setParsedMap(null);
      setError(null);
      return;
    }
    processJson(val, "JSON colado");
  };

  const handleConfirmImport = async () => {
    if (!parsedMap) return;
    setIsImporting(true);

    try {
      const finalTitle = customTitle.trim() || parsedMap.title;
      // Update root title if customized
      const nodesToInsert = parsedMap.nodes.map((node) => {
        // Keep project links only if that project exists in this account (FK safety).
        const project_id = node.project_id && projects[node.project_id] ? node.project_id : null;
        if (node.id === parsedMap.root.id) {
          return { ...node, project_id, title: finalTitle };
        }
        return { ...node, project_id };
      });

      // Insert all nodes into the global store & repository
      addItems(nodesToInsert);

      // Close modal and navigate directly to canvas view
      onClose();
      router.push(`/canvas/${parsedMap.root.id}`);
    } catch (err: any) {
      setError(`Erro ao salvar nós no banco: ${err?.message || err}`);
      setIsImporting(false);
    }
  };

  // Extract direct branch names for preview
  const directBranches = parsedMap
    ? parsedMap.nodes
        .filter((n) => n.parent_id === parsedMap.root.id)
        .map((n) => n.title)
    : [];

  const totalAttachments = parsedMap
    ? parsedMap.nodes.reduce((acc, n) => acc + (n.attachments?.length || 0), 0)
    : 0;

  return (
    <div
      className="modal-scrim"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        animation: "fadeIn 0.15s ease-out",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass"
        style={{
          width: "100%",
          maxWidth: "640px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px",
          border: "1px solid var(--border)",
          background: "var(--panel)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(139, 123, 255, 0.15)",
                color: "var(--primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Network size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>Importar Mapa Mental</h2>
              <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: 0 }}>
                Compatível com exportações do <strong>Lucidchart</strong> e estruturas JSON
              </p>
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            title="Fechar (Esc)"
            style={{ borderRadius: "8px" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: "6px",
              padding: "4px",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: "10px",
              border: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("file")}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: "0.85rem",
                fontWeight: 500,
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                background: activeTab === "file" ? "var(--primary)" : "transparent",
                color: activeTab === "file" ? "#fff" : "var(--muted)",
              }}
            >
              <Upload size={14} /> Selecionar Arquivo
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("paste")}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: "0.85rem",
                fontWeight: 500,
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                background: activeTab === "paste" ? "var(--primary)" : "transparent",
                color: activeTab === "paste" ? "#fff" : "var(--muted)",
              }}
            >
              <FileJson size={14} /> Colar JSON
            </button>
          </div>

          {/* Tab 1: File Upload */}
          {activeTab === "file" && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? "var(--primary)" : "var(--border)"}`,
                borderRadius: "12px",
                padding: "32px 20px",
                textAlign: "center",
                cursor: "pointer",
                background: isDragging ? "rgba(139, 123, 255, 0.08)" : "rgba(255, 255, 255, 0.02)",
                transition: "all 0.2s ease",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  background: "rgba(139, 123, 255, 0.12)",
                  color: "var(--primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FileJson size={24} />
              </div>
              <div>
                <p style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 500 }}>
                  {fileName ? (
                    <span style={{ color: "var(--primary)" }}>{fileName}</span>
                  ) : (
                    "Arraste e solte o arquivo .json aqui"
                  )}
                </p>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                  {fileName ? "Clique para trocar de arquivo" : "ou clique para navegar no computador"}
                </p>
              </div>
            </div>
          )}

          {/* Tab 2: Paste JSON */}
          {activeTab === "paste" && (
            <div>
              <textarea
                value={jsonText}
                onChange={(e) => handlePasteChange(e.target.value)}
                placeholder="Cole o código JSON do Lucidchart ou mapa mental aqui..."
                rows={6}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "rgba(0, 0, 0, 0.2)",
                  color: "inherit",
                  fontFamily: "monospace",
                  fontSize: "0.82rem",
                  resize: "vertical",
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                fontSize: "0.85rem",
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>{error}</div>
            </div>
          )}

          {/* Parsed Result Preview */}
          {parsedMap && (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Sparkles size={15} style={{ color: "var(--primary)" }} />
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--primary)" }}>
                    MAPA DETECTADO COM SUCESSO
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "0.74rem",
                    padding: "3px 8px",
                    borderRadius: "6px",
                    background: "rgba(139, 123, 255, 0.15)",
                    color: "var(--primary)",
                    fontWeight: 600,
                  }}
                >
                  {parsedMap.summary.source}
                </span>
              </div>

              {/* Title input */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: "6px" }}>
                  Título do Mapa
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Nome do mapa mental"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "rgba(0, 0, 0, 0.15)",
                    color: "inherit",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    outline: "none",
                  }}
                />
              </div>

              {/* Stats badges */}
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <div
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid var(--border)",
                    fontSize: "0.82rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Layers size={14} style={{ color: "var(--primary)" }} />
                  <strong>{parsedMap.summary.totalNodes}</strong> nós totais
                </div>
                <div
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid var(--border)",
                    fontSize: "0.82rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Network size={14} style={{ color: "#38bdf8" }} />
                  <strong>{parsedMap.summary.branchesCount}</strong> ramos principais
                </div>
                {totalAttachments > 0 && (
                  <div
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      background: "rgba(255, 255, 255, 0.04)",
                      border: "1px solid var(--border)",
                      fontSize: "0.82rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Link2 size={14} style={{ color: "#2dd4bf" }} />
                    <strong>{totalAttachments}</strong> links externos
                  </div>
                )}
              </div>

              {/* Branch Tags Preview */}
              {directBranches.length > 0 && (
                <div>
                  <span style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: "8px" }}>
                    Ramos identificados:
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", maxHeight: "100px", overflowY: "auto" }}>
                    {directBranches.map((branch, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: "0.78rem",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "rgba(255, 255, 255, 0.06)",
                          border: "1px solid var(--border)",
                          color: "inherit",
                        }}
                      >
                        {branch}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "10px",
            padding: "16px 24px",
            borderTop: "1px solid var(--border)",
            background: "rgba(0, 0, 0, 0.1)",
          }}
        >
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isImporting}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirmImport}
            disabled={!parsedMap || isImporting}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              opacity: !parsedMap || isImporting ? 0.6 : 1,
              cursor: !parsedMap || isImporting ? "not-allowed" : "pointer",
            }}
          >
            {isImporting ? (
              "Importando mapa..."
            ) : (
              <>
                Importar e Abrir Mapa <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
