# entusis

> **Plataforma Integrada de Produtividade**  
> Combina o melhor de **Notion** (páginas hierárquicas e Kanban), **Miro** (canvas infinito de mapas mentais) e **Google Calendar** (gestão de tempo bidirecional) sob uma arquitetura de dados unificada: **`ItemNode`**.

---

## 🚀 Visão Geral

No **entusis**, cada ideia, tarefa, página, evento ou nó de mapa mental é a mesma entidade: um `ItemNode`. Isso elimina a fragmentação entre ferramentas:
- Uma ideia rabiscada em um mapa mental pode se tornar uma tarefa no Kanban com **1 clique**.
- Um nó pode abrir uma **gaveta lateral** contendo uma página completa com editor rico (TipTap), checklists, arquivos e vínculos.
- Alterne entre visão de **Página**, **Canvas** e **Kanban** instantaneamente para os mesmos dados.
- O painel **To Do Today** consolida tarefas com swimlanes por projeto e agenda do dia.

---

## 🛠️ Stack Tecnológica

- **Framework**: [Next.js](https://nextjs.org/) (App Router) + TypeScript
- **Canvas Infinito**: [@xyflow/react](https://reactflow.dev/) (React Flow)
- **Editor Rico**: [TipTap](https://tiptap.dev/) (ProseMirror headless) com suporte a checklists
- **Kanban Drag-and-Drop**: [@dnd-kit/core](https://dndkit.com/)
- **Estilização**: CSS Puro com Glassmorphism e Dark Mode automático
- **Gerenciamento de Estado**: [Zustand](https://github.com/pmndrs/zustand)
- **Persistência**: Local-first (navegador) com suporte integrado a [Supabase](https://supabase.com/) (Postgres + Auth + Realtime)

---

## 📦 Como Executar

### 1. Clonar o repositório
```bash
git clone https://github.com/fabio-cagido/entusis.git
cd entusis
```

### 2. Instalar dependências
```bash
npm install
```

### 3. Rodar em desenvolvimento
```bash
npm run dev
```
Acesse [http://localhost:3000](http://localhost:3000) no seu navegador.

### 4. Build de produção
```bash
npm run build
npm run start
```

---

## 🗄️ Configuração do Supabase (Opcional)

Por padrão, o app roda em modo **local-first** imediatamente (sem necessidade de banco externo). Para habilitar multi-dispositivo e sincronização em nuvem:

1. Crie um projeto no [Supabase](https://supabase.com/).
2. No **SQL Editor**, execute o script localizado em [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. Crie um arquivo `.env.local` na raiz com as chaves:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
   ```
4. Reinicie o servidor de desenvolvimento. O app ativará a autenticação e sincronização em tempo real automaticamente.

---

## 📄 Licença

MIT
