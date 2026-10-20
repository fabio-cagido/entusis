import type { ItemNode, Project } from "./types";
import { emptySchedule } from "./types";
import { layoutTree } from "./layout";

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

function item(p: Partial<ItemNode> & Pick<ItemNode, "title">): ItemNode {
  const t = now();
  return {
    id: uid(),
    content: "",
    icon: null,
    type: "PAGE",
    parent_id: null,
    project_id: null,
    status: null,
    is_today: false,
    schedule: emptySchedule(),
    attachments: [],
    links: [],
    canvas: null,
    default_view: "PAGE",
    sort_order: 0,
    created_at: t,
    updated_at: t,
    ...p,
  };
}

/** First-run demo data so every view has something meaningful to show. */
export function buildSeed(): { items: ItemNode[]; projects: Project[] } {
  const t = now();
  const rede: Project = { id: uid(), name: "Rede Cruzada", color: "#8b7bff", icon: "🕸️", sort_order: 0, created_at: t };
  const ensitec: Project = { id: uid(), name: "Ensitec", color: "#2dd4bf", icon: "🎓", sort_order: 1, created_at: t };

  const welcome = item({
    title: "Bem-vindo ao êntusis",
    icon: "👋",
    sort_order: 0,
    content:
      "<h2>Tudo é um nó</h2><p>Páginas, tarefas, eventos e ramos de mapa mental compartilham a mesma base. " +
      "Alterne entre <strong>Página</strong>, <strong>Canvas</strong> e <strong>Kanban</strong> no topo de qualquer item.</p>" +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Explorar o dashboard Hoje</p></li>' +
      '<li data-type="taskItem" data-checked="false"><p>Abrir o mapa mental de exemplo</p></li>' +
      '<li data-type="taskItem" data-checked="false"><p>Criar sua primeira subpágina</p></li></ul>',
  });

  const redeHub = item({ title: "Rede Cruzada", icon: "🕸️", project_id: rede.id, sort_order: 1 });
  const ensitecHub = item({ title: "Ensitec", icon: "🎓", project_id: ensitec.id, sort_order: 2 });

  const today = new Date();
  today.setHours(14, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(15, 0, 0, 0);

  const tasks: ItemNode[] = [
    item({ title: "Planejar campanha de lançamento", type: "TASK", status: "DOING", is_today: true, project_id: rede.id, parent_id: redeHub.id, sort_order: 0 }),
    item({ title: "Revisar parcerias regionais", type: "TASK", status: "TODO", is_today: true, project_id: rede.id, parent_id: redeHub.id, sort_order: 1 }),
    item({ title: "Mapear stakeholders", type: "TASK", status: "BACKLOG", project_id: rede.id, parent_id: redeHub.id, sort_order: 2 }),
    item({ title: "Preparar aula de quinta", type: "TASK", status: "TODO", is_today: true, project_id: ensitec.id, parent_id: ensitecHub.id, sort_order: 0 }),
    item({
      title: "Reunião com coordenação",
      type: "EVENT",
      status: "TODO",
      project_id: ensitec.id,
      parent_id: ensitecHub.id,
      sort_order: 1,
      schedule: { start_time: today.toISOString(), end_time: todayEnd.toISOString(), google_event_id: null },
    }),
    item({ title: "Publicar notas do semestre", type: "TASK", status: "DONE", is_today: true, project_id: ensitec.id, parent_id: ensitecHub.id, sort_order: 2 }),
  ];

  const map = item({ title: "Estratégia 2027", icon: "🧠", default_view: "CANVAS", project_id: rede.id, sort_order: 3, canvas: { x: 0, y: 0, color: "#8b7bff" } });
  const branches = [
    { t: "Crescimento", c: "#f472b6", kids: ["Novos parceiros", "Eventos regionais"] },
    { t: "Produto", c: "#38bdf8", kids: ["Plataforma web", "App mobile", "Integrações"] },
    { t: "Pessoas", c: "#facc15", kids: ["Contratações", "Treinamento"] },
  ];
  const mapNodes: ItemNode[] = [];
  branches.forEach((b, i) => {
    const br = item({ title: b.t, type: "MINDMAP_NODE", parent_id: map.id, sort_order: i, canvas: { x: 0, y: 0, color: b.c } });
    mapNodes.push(br);
    b.kids.forEach((k, j) =>
      mapNodes.push(item({ title: k, type: "MINDMAP_NODE", parent_id: br.id, sort_order: j, canvas: { x: 0, y: 0, color: b.c } })),
    );
  });
  // A mind-map node that is also a Kanban task — the unification in action.
  const plat = mapNodes.find((n) => n.title === "Plataforma web")!;
  plat.status = "DOING";
  plat.project_id = rede.id;
  plat.links = [tasks[0].id];

  const pos = layoutTree([map, ...mapNodes], map.id);
  for (const n of mapNodes) n.canvas = { ...n.canvas!, ...pos[n.id] };

  return { items: [welcome, redeHub, ensitecHub, ...tasks, map, ...mapNodes], projects: [rede, ensitec] };
}

export function newItem(p: Partial<ItemNode>): ItemNode {
  return item({ title: "", ...p });
}
