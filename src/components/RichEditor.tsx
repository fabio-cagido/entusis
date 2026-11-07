"use client";

import { EditorContent, Node, mergeAttributes, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  Bold,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  FileDown,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Plus,
  Quote,
  Strikethrough,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";

export const PAGE_BREAK_DELIMITER = "<!-- pagebreak -->";
const ATTACHMENTS_BUCKET = "attachments";

export function splitDocumentPages(raw: string): string[] {
  if (!raw) return [""];
  const parts = raw.split(PAGE_BREAK_DELIMITER);
  return parts.length > 0 ? parts : [""];
}

export function joinDocumentPages(pages: string[]): string {
  if (!pages || pages.length === 0) return "";
  return pages.join(PAGE_BREAK_DELIMITER);
}

/** Custom TipTap Node extension for inline/block images inside document pages. */
const DocumentImage = Node.create({
  name: "image",
  group: "block",
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      class: { default: "doc-inline-image" },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes({ class: "doc-inline-image" }, HTMLAttributes)];
  },
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo de imagem."));
    reader.readAsDataURL(file);
  });
}

interface Props {
  itemId?: string;
  title?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  compact?: boolean;
}

export default function RichEditor({ itemId, title, value, onChange, placeholder, compact }: Props) {
  const currentUserId = useStore((s) => s.currentUserId);
  const initialPages = useMemo(() => splitDocumentPages(value), [value]);
  const [pages, setPages] = useState<string[]>(initialPages);
  const [currentPage, setCurrentPage] = useState(0);
  const [uploadingImage, setUploadingImage] = useState(false);

  const pagesRef = useRef<string[]>(pages);
  pagesRef.current = pages;
  const currentPageRef = useRef<number>(currentPage);
  currentPageRef.current = currentPage;

  const lastEmittedFull = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const uploadAndInsertImage = useCallback(
    async (file: File, ed: ReturnType<typeof useEditor>) => {
      if (!ed || ed.isDestroyed) return;
      setUploadingImage(true);
      try {
        let imageUrl: string | null = null;
        const sb = getSupabase();

        if (isSupabaseConfigured && sb) {
          let userId = currentUserId;
          if (!userId) {
            const { data } = await sb.auth.getUser();
            userId = data.user?.id ?? null;
          }
          if (userId) {
            const safeName =
              file.name
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-zA-Z0-9._-]+/g, "_")
                .replace(/^_+|_+$/g, "") || "imagem.png";
            const storagePath = `${userId}/${itemId || "doc"}/img-${Date.now()}-${safeName}`;
            const { data: upData, error: upErr } = await sb.storage
              .from(ATTACHMENTS_BUCKET)
              .upload(storagePath, file, {
                cacheControl: "3600",
                upsert: false,
                contentType: file.type || "image/png",
              });

            if (upErr) {
              console.error(
                "[ayolia] Aviso: upload de imagem no Supabase Storage falhou, usando Data URL local como fallback:",
                upErr
              );
            } else {
              const finalPath = upData?.path || storagePath;
              const { data: pubData } = sb.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(finalPath);
              if (pubData?.publicUrl) {
                imageUrl = pubData.publicUrl;
              }
            }
          }
        }

        if (!imageUrl) {
          imageUrl = await fileToDataUrl(file);
        }

        ed.chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: {
              src: imageUrl,
              alt: file.name || "Imagem do documento",
              class: "doc-inline-image",
            },
          })
          .run();
      } catch (err) {
        console.error("[ayolia] Erro ao inserir imagem no editor:", err);
      } finally {
        setUploadingImage(false);
      }
    },
    [currentUserId, itemId]
  );

  const emitPages = useCallback(
    (nextPages: string[]) => {
      const fullHtml = joinDocumentPages(nextPages);
      lastEmittedFull.current = fullHtml;
      onChange(fullHtml);
    },
    [onChange]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: true,
          autolink: true,
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        },
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      DocumentImage,
      Placeholder.configure({
        placeholder: placeholder ?? "Escreva o conteúdo desta página do documento…",
      }),
    ],
    content: initialPages[0] ?? "",
    editorProps: {
      attributes: {
        class: `prose ${compact ? "prose-compact" : "prose-a4"}`,
      },
      handlePaste: (_view, event) => {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find((it) => it.type.startsWith("image/"));
        if (imageItem) {
          const file = imageItem.getAsFile();
          if (file && editor) {
            event.preventDefault();
            void uploadAndInsertImage(file, editor);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const pageHtml = ed.getHTML();
        const nextPages = [...pagesRef.current];
        const idx = Math.min(currentPageRef.current, nextPages.length - 1);
        nextPages[idx] = pageHtml;
        pagesRef.current = nextPages;
        setPages(nextPages);
        emitPages(nextPages);
      }, 280);
    },
  });

  // Sincroniza alterações vindas de fora (ex: Realtime ou mudança de item)
  useEffect(() => {
    if (!editor || value === lastEmittedFull.current) return;
    if (!editor.isFocused) {
      const extPages = splitDocumentPages(value);
      const safePageIdx = Math.min(currentPageRef.current, extPages.length - 1);
      setPages(extPages);
      pagesRef.current = extPages;
      setCurrentPage(safePageIdx);
      currentPageRef.current = safePageIdx;
      editor.commands.setContent(extPages[safePageIdx] ?? "", { emitUpdate: false });
      lastEmittedFull.current = value;
    }
  }, [value, editor]);

  // Flush final ao desmontar
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (editor && !editor.isDestroyed) {
          const nextPages = [...pagesRef.current];
          const idx = Math.min(currentPageRef.current, nextPages.length - 1);
          nextPages[idx] = editor.getHTML();
          emitPages(nextPages);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor]
  );

  const flushCurrentPageImmediate = (): string[] => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const nextPages = [...pagesRef.current];
    if (editor && !editor.isDestroyed) {
      const idx = Math.min(currentPageRef.current, nextPages.length - 1);
      nextPages[idx] = editor.getHTML();
    }
    pagesRef.current = nextPages;
    setPages(nextPages);
    emitPages(nextPages);
    return nextPages;
  };

  const goToPage = (targetIndex: number) => {
    if (!editor) return;
    const synced = flushCurrentPageImmediate();
    const clamped = Math.max(0, Math.min(targetIndex, synced.length - 1));
    setCurrentPage(clamped);
    currentPageRef.current = clamped;
    editor.commands.setContent(synced[clamped] ?? "", { emitUpdate: false });
  };

  const handleAddPage = () => {
    if (!editor) return;
    const synced = flushCurrentPageImmediate();
    const insertAt = currentPageRef.current + 1;
    const nextPages = [
      ...synced.slice(0, insertAt),
      "<p></p>",
      ...synced.slice(insertAt),
    ];
    pagesRef.current = nextPages;
    setPages(nextPages);
    setCurrentPage(insertAt);
    currentPageRef.current = insertAt;
    editor.commands.setContent("<p></p>", { emitUpdate: false });
    editor.commands.focus("start");
    emitPages(nextPages);
  };

  const handleDuplicatePage = () => {
    if (!editor) return;
    const synced = flushCurrentPageImmediate();
    const curHtml = synced[currentPageRef.current] ?? "<p></p>";
    const insertAt = currentPageRef.current + 1;
    const nextPages = [
      ...synced.slice(0, insertAt),
      curHtml,
      ...synced.slice(insertAt),
    ];
    pagesRef.current = nextPages;
    setPages(nextPages);
    setCurrentPage(insertAt);
    currentPageRef.current = insertAt;
    editor.commands.setContent(curHtml, { emitUpdate: false });
    emitPages(nextPages);
  };

  const handleRemovePage = () => {
    if (!editor || pagesRef.current.length <= 1) return;
    const synced = flushCurrentPageImmediate();
    if (synced.length <= 1) return;
    const idx = currentPageRef.current;
    const rawText = (synced[idx] || "").replace(/<[^>]+>/g, "").trim();
    const hasImg = /<img\b/i.test(synced[idx] || "");
    if ((rawText.length > 0 || hasImg) && !confirm(`Remover a Página ${idx + 1} deste documento?`)) {
      return;
    }
    const nextPages = synced.filter((_, i) => i !== idx);
    const nextIdx = Math.max(0, Math.min(idx, nextPages.length - 1));
    pagesRef.current = nextPages;
    setPages(nextPages);
    setCurrentPage(nextIdx);
    currentPageRef.current = nextIdx;
    editor.commands.setContent(nextPages[nextIdx] ?? "", { emitUpdate: false });
    emitPages(nextPages);
  };

  const handleExportPdf = () => {
    flushCurrentPageImmediate();
    setTimeout(() => {
      window.print();
    }, 80);
  };

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2 }),
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            task: e.isActive("taskList"),
            quote: e.isActive("blockquote"),
            link: e.isActive("link"),
          }
        : null,
  });

  if (!editor) return <div className="prose prose-skeleton" />;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL do link", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const btns = [
    { k: "h1", icon: <Heading1 size={15} />, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), t: "Título" },
    { k: "h2", icon: <Heading2 size={15} />, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), t: "Subtítulo" },
    { k: "sep1" },
    { k: "bold", icon: <Bold size={15} />, run: () => editor.chain().focus().toggleBold().run(), t: "Negrito" },
    { k: "italic", icon: <Italic size={15} />, run: () => editor.chain().focus().toggleItalic().run(), t: "Itálico" },
    { k: "strike", icon: <Strikethrough size={15} />, run: () => editor.chain().focus().toggleStrike().run(), t: "Tachado" },
    { k: "code", icon: <Code size={15} />, run: () => editor.chain().focus().toggleCode().run(), t: "Código" },
    { k: "link", icon: <Link2 size={15} />, run: setLink, t: "Link" },
    { k: "sep2" },
    { k: "bullet", icon: <List size={15} />, run: () => editor.chain().focus().toggleBulletList().run(), t: "Lista" },
    { k: "ordered", icon: <ListOrdered size={15} />, run: () => editor.chain().focus().toggleOrderedList().run(), t: "Lista numerada" },
    { k: "task", icon: <ListChecks size={15} />, run: () => editor.chain().focus().toggleTaskList().run(), t: "Checklist" },
    { k: "quote", icon: <Quote size={15} />, run: () => editor.chain().focus().toggleBlockquote().run(), t: "Citação" },
    { k: "sep3" },
    {
      k: "image",
      icon: uploadingImage ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />,
      run: () => imageInputRef.current?.click(),
      t: "Inserir imagem (PNG, JPG, WebP) ou colar print (Ctrl+V)",
    },
  ];

  return (
    <div className={`doc-editor-root ${compact ? "is-compact" : "is-a4"}`}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && editor) {
            void uploadAndInsertImage(file, editor);
          }
        }}
      />

      {/* Barra Superior de Paginação + Exportar PDF */}
      <div className="doc-pagination-bar">
        <div className="doc-pagination-controls">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={currentPage <= 0}
            onClick={() => goToPage(currentPage - 1)}
            title="Página anterior"
          >
            <ChevronLeft size={14} /> Anterior
          </button>

          <span className="doc-page-indicator">
            Página <strong>{currentPage + 1}</strong> de <strong>{pages.length}</strong>
          </span>

          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={currentPage >= pages.length - 1}
            onClick={() => goToPage(currentPage + 1)}
            title="Próxima página"
          >
            Próxima <ChevronRight size={14} />
          </button>

          <span className="rich-sep" />

          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={handleAddPage}
            title="Adicionar nova página em branco ao documento"
          >
            <Plus size={13} /> Adicionar Página
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={handleDuplicatePage}
            title="Duplicar página atual"
          >
            <Copy size={13} />
          </button>

          {pages.length > 1 && (
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              onClick={handleRemovePage}
              title="Remover página atual"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <div className="doc-pagination-actions">
          <button
            type="button"
            id="doc-export-pdf-btn"
            className="btn btn-ghost btn-xs"
            onClick={handleExportPdf}
            title="Exportar documento A4 como PDF"
          >
            <FileDown size={14} /> Exportar PDF
          </button>
        </div>
      </div>

      {/* Barra de Formatação Rich Text */}
      <div className={`rich ${compact ? "rich-compact" : "rich-a4-container"}`}>
        <div className="rich-toolbar" role="toolbar">
          {btns.map((b) =>
            b.icon ? (
              <button
                key={b.k}
                type="button"
                title={b.t}
                className={state?.[b.k as keyof typeof state] ? "is-active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={b.run}
              >
                {b.icon}
              </button>
            ) : (
              <span key={b.k} className="rich-sep" />
            )
          )}
        </div>

        {/* Folha A4 interativa da página atual */}
        <div className={compact ? "doc-sheet-compact" : "doc-canvas-backdrop"}>
          <div className={`document-page-sheet ${compact ? "is-compact" : ""}`}>
            <EditorContent editor={editor} />
            <footer className="document-page-footer">
              <span>{title || "Documento"}</span>
              <span>
                Página {currentPage + 1} de {pages.length}
              </span>
            </footer>
          </div>
        </div>
      </div>

      {/* Container exclusivo para impressão / Exportação PDF de todas as páginas em formato A4 */}
      <div className="doc-print-all-pages" aria-hidden="true">
        {pages.map((pageHtml, idx) => (
          <div key={idx} className="document-page-sheet document-page-print-sheet">
            {idx === 0 && title && <h1 className="document-print-main-title">{title}</h1>}
            <div
              className="prose prose-a4"
              dangerouslySetInnerHTML={{ __html: pageHtml || "<p></p>" }}
            />
            <footer className="document-page-footer">
              <span>{title || "Documento"}</span>
              <span>
                Página {idx + 1} de {pages.length}
              </span>
            </footer>
          </div>
        ))}
      </div>
    </div>
  );
}
