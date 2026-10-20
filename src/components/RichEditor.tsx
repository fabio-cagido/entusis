"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  compact?: boolean;
}

export default function RichEditor({ value, onChange, placeholder, compact }: Props) {
  const lastEmitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: true, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? "Escreva algo, ou use a barra acima para blocos…" }),
    ],
    content: value,
    editorProps: { attributes: { class: `prose ${compact ? "prose-compact" : ""}` } },
    onUpdate: ({ editor }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const html = editor.getHTML();
        lastEmitted.current = html;
        onChange(html);
      }, 300);
    },
  });

  // Apply external changes (e.g. realtime sync or another view editing the same node).
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    if (!editor.isFocused) {
      editor.commands.setContent(value, { emitUpdate: false });
      lastEmitted.current = value;
    }
  }, [value, editor]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (editor && !editor.isDestroyed) onChange(editor.getHTML());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );

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
  ];

  return (
    <div className={`rich ${compact ? "rich-compact" : ""}`}>
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
          ),
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
