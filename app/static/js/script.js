/* ================================================================
   MODEL
================================================================ */
let model = [];
let selectedNode = null;   // context menu target
let inspectedNode = null;  // inspector panel target

const LEVEL_COLORS = ['#2b579a','#106ebe','#038387','#107c10','#ca5010','#6b3a7d'];
const levelColor = d => LEVEL_COLORS[Math.min(d, LEVEL_COLORS.length - 1)];

function mkNode(name) { return { id: crypto.randomUUID(), name, attributes: [], children: [] }; }

function allNodes(nodes, out = []) {
  for (const n of nodes) { out.push(n); allNodes(n.children, out); }
  return out;
}

function findById(id) { return allNodes(model).find(n => n.id === id); }

function getDepth(list, target, d = 0) {
  for (const n of list) {
    if (n === target) return d;
    const r = getDepth(n.children, target, d + 1);
    if (r !== -1) return r;
  }
  return -1;
}

function removeNode(list, target) {
  const i = list.indexOf(target);
  if (i !== -1) { list.splice(i, 1); return true; }
  for (const n of list) if (removeNode(n.children, target)) return true;
  return false;
}

function countAll(ns) { let c = 0; for (const n of ns) { c += 1 + countAll(n.children); } return c; }
function countAttrs(ns) { let c = 0; for (const n of ns) { c += n.attributes.length + countAttrs(n.children); } return c; }
function maxDepth(ns, d = 0) { if (!ns.length) return d; return Math.max(...ns.map(n => maxDepth(n.children, d + 1))); }

function updateStats() {
  document.getElementById('stat-nodes').textContent = countAll(model);
  document.getElementById('stat-levels').textContent = maxDepth(model);
  document.getElementById('stat-attrs').textContent = countAttrs(model);
  document.getElementById('stat-sel').textContent = inspectedNode ? '● ' + inspectedNode.name : '';
  document.getElementById('empty-state').style.display = model.length ? 'none' : 'block';
}

/* ================================================================
   MODAL — rewritten to avoid closure/delegation conflicts
================================================================ */
let _modalCb = null;

function openModal({ title, nameLabel = 'Nome', namePH = '', showValue = false, valuePH = '', defName = '', defValue = '', cb }) {
  _modalCb = cb;

  document.getElementById('modal-title').textContent = title;
  document.getElementById('lbl-name').textContent = nameLabel;

  const inputName = document.getElementById('input-name');
  const inputValue = document.getElementById('input-value');

  inputName.placeholder = namePH;
  inputName.value = defName;
  inputName.style.outline = '';

  document.getElementById('fg-value').style.display = showValue ? 'block' : 'none';
  inputValue.placeholder = valuePH;
  inputValue.value = defValue;

  document.getElementById('modal').classList.add('open');
  setTimeout(() => inputName.focus(), 40);
}

function _confirmModal() {
  const inputName = document.getElementById('input-name');
  const name = inputName.value.trim();
  if (!name) {
    inputName.style.outline = '2px solid var(--red)';
    inputName.focus();
    return;
  }
  inputName.style.outline = '';
  const value = document.getElementById('input-value').value.trim();
  const cb = _modalCb;
  closeModal();
  if (cb) cb(name, value);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  _modalCb = null;
}

/* Prevent clicks inside modal box from closing it via overlay listener */
document.getElementById('modal-box').addEventListener('click', e => e.stopPropagation());

/* Clicking the dark overlay closes the modal */
document.getElementById('modal').addEventListener('click', () => closeModal());

/* Confirm button */
document.getElementById('modal-ok').addEventListener('click', e => {
  e.stopPropagation();
  _confirmModal();
});

/* Keyboard shortcuts inside inputs */
['input-name', 'input-value'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _confirmModal(); }
    if (e.key === 'Escape') closeModal();
  })
);

/* ================================================================
   ACTIONS
================================================================ */
function openAddRoot() {
  openModal({
    title: 'Adicionar Nível Raiz',
    namePH: 'ex: Enterprise, Planta...',
    cb: name => {
      model.push(mkNode(name));
      updateTree();
    }
  });
}

function doAddChild(node) {
  const nodeId = node.id; // capture id, not reference (re-fetched after modal)
  openModal({
    title: `Filho de "${node.name}"`,
    namePH: 'ex: Site A, Área 1...',
    cb: name => {
      const target = findById(nodeId);
      if (!target) return;
      target.children.push(mkNode(name));
      updateTree();
      // Re-fetch inspectedNode in case it's this node
      if (inspectedNode && inspectedNode.id === nodeId) {
        renderInspector(target);
      }
    }
  });
}

function doAddAttr(node) {
  const nodeId = node.id;
  openModal({
    title: `Atributo em "${node.name}"`,
    namePH: 'ex: location, type...',
    showValue: true,
    valuePH: 'ex: Brasil, true, 42...',
    cb: (name, value) => {
      const target = findById(nodeId);
      if (!target) return;
      target.attributes.push({ id: crypto.randomUUID(), name, value });
      updateTree();
      if (inspectedNode && inspectedNode.id === nodeId) {
        renderInspector(target);
      }
    }
  });
}

function doRename(node) {
  const nodeId = node.id;
  openModal({
    title: 'Renomear nó',
    nameLabel: 'Novo nome',
    defName: node.name,
    cb: name => {
      const target = findById(nodeId);
      if (!target) return;
      target.name = name;
      updateTree();
      if (inspectedNode && inspectedNode.id === nodeId) {
        renderInspector(target);
      }
    }
  });
}

function doDelete(node) {
  if (!confirm(`Remover "${node.name}" e todos os seus filhos?`)) return;
  if (inspectedNode && inspectedNode.id === node.id) closeInspector();
  removeNode(model, node);
  selectedNode = null;
  updateTree();
}

function doDeleteChild(parentNode, childNode) {
  if (!confirm(`Remover "${childNode.name}"?`)) return;
  parentNode.children = parentNode.children.filter(c => c !== childNode);
  if (inspectedNode && inspectedNode.id === childNode.id) closeInspector();
  updateTree();
  renderInspector(parentNode);
}

function doDeleteAttr(node, attrId) {
  node.attributes = node.attributes.filter(a => a.id !== attrId);
  updateTree();
  renderInspector(node);
}

function doEditAttr(node, attr) {
  const nodeId = node.id;
  const attrId = attr.id;
  openModal({
    title: 'Editar atributo',
    nameLabel: 'Chave',
    defName: attr.name,
    showValue: true,
    valuePH: '...',
    defValue: attr.value,
    cb: (name, value) => {
      const target = findById(nodeId);
      if (!target) return;
      const a = target.attributes.find(x => x.id === attrId);
      if (a) { a.name = name; a.value = value; }
      updateTree();
      if (inspectedNode && inspectedNode.id === nodeId) {
        renderInspector(target);
      }
    }
  });
}

function clearAll() {
  if (!model.length || confirm('Limpar toda a árvore?')) {
    model = []; closeInspector(); updateTree();
  }
}

function loadSample() {
  model = [{
    id: 'n-plant', name: 'Plant', attributes: [],
    children: [{
      id: 'n-shop', name: 'Shop', attributes: [],
      children: [{
        id: 'n-line', name: 'Line', attributes: [],
        children: [
          {
            id: 'n-dp1', name: 'DataProducts', attributes: [],
            children: [
              { id: 'n-ww1', name: 'WeldingWizard', attributes: [], children: [] },
              { id: 'n-cd1', name: 'CycleData',     attributes: [], children: [] }
            ]
          },
          {
            id: 'n-station', name: 'Station', attributes: [],
            children: [{
              id: 'n-robot', name: 'Robot',
              attributes: [
                { id: 'a1', name: 'HomeStatus', value: '' },
                { id: 'a2', name: 'CSALD',      value: '' },
                { id: 'a3', name: 'CGOOD',      value: '' },
                { id: 'a4', name: 'NSEQ',       value: '' },
                { id: 'a5', name: 'TCData',     value: '' }
              ],
              children: [{
                id: 'n-dp2', name: 'DataProducts', attributes: [],
                children: [
                  { id: 'n-ww2', name: 'WeldingWizard', attributes: [], children: [] },
                  { id: 'n-cd2', name: 'CycleData',     attributes: [], children: [] }
                ]
              }]
            }]
          }
        ]
      }]
    }]
  }];
  updateTree();
}

function generateJson() {
  function bn(node) {
    const r = {};
    for (const a of node.attributes) r[a.name] = a.value;
    for (const c of node.children) r[c.name] = bn(c);
    return r;
  }
  const root = {};
  for (const n of model) root[n.name] = bn(n);
  document.getElementById('json-output').textContent = JSON.stringify(root, null, 2);
}

function copyJson() {
  navigator.clipboard.writeText(document.getElementById('json-output').textContent).catch(() => {});
}

/* ================================================================
   INSPECTOR
================================================================ */
function openInspector(node) {
  inspectedNode = node;
  document.getElementById('inspector').classList.add('open');
  renderInspector(node);
  updateStats();
  highlightNode(node.id);
}

function closeInspector() {
  inspectedNode = null;
  document.getElementById('inspector').classList.remove('open');
  highlightNode(null);
  updateStats();
}

function renderInspector(node) {
  if (!node) return;
  const depth = getDepth(model, node);
  const color = levelColor(depth);

  document.getElementById('ins-dot').style.background = color;
  document.getElementById('ins-name').textContent = node.name;

  const body = document.getElementById('ins-body');

  const icoEdit  = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 10.5l2.5-.5L11 3.5l-2-2L2.5 8 2 10.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const icoTrash = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 4h10M5 4V2h4v2M3 4l1 8h6l1-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const icoInfo  = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 6v4M7 4.5v.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const icoPlus  = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  const childColor = levelColor(depth + 1);

  const nodeHtml = `
    <div class="ins-section">
      <div class="ins-section-header">
        <span class="ins-section-title">Nó</span>
      </div>
      <div class="ins-node-actions">
        <button class="btn btn-sm" data-action="rename">
          ${icoEdit} Renomear
        </button>
        <button class="btn btn-sm btn-danger" data-action="delete">
          ${icoTrash} Remover nó
        </button>
      </div>
    </div>`;

  const childrenHtml = `
    <div class="ins-section">
      <div class="ins-section-header">
        <span class="ins-section-title">Filhos <span class="ins-count" style="color:${color}">${node.children.length}</span></span>
        <button class="btn btn-sm btn-primary" data-action="add-child">
          ${icoPlus} Adicionar
        </button>
      </div>
      ${node.children.length === 0
        ? `<div class="ins-empty">Nenhum filho — clique em Adicionar</div>`
        : node.children.map(ch => `
          <div class="child-row">
            <div class="child-dot" style="background:${childColor}"></div>
            <div class="child-name" title="${ch.name}">${ch.name}</div>
            <div class="child-sub">${ch.children.length ? ch.children.length + ' filho' + (ch.children.length > 1 ? 's' : '') : ch.attributes.length ? ch.attributes.length + ' attr' : ''}</div>
            <div class="child-acts">
              <button class="btn btn-icon btn-ghost btn-sm" title="Inspecionar" data-action="inspect-child" data-id="${ch.id}">${icoInfo}</button>
              <button class="btn btn-icon btn-ghost btn-sm" title="Renomear" data-action="rename-child" data-id="${ch.id}">${icoEdit}</button>
              <button class="btn btn-icon btn-ghost btn-sm" title="Remover" style="color:var(--red)" data-action="delete-child" data-id="${ch.id}">${icoTrash}</button>
            </div>
          </div>`).join('')}
    </div>`;

  const attrsHtml = `
    <div class="ins-section">
      <div class="ins-section-header">
        <span class="ins-section-title">Atributos <span class="ins-count" style="color:var(--teal)">${node.attributes.length}</span></span>
        <button class="btn btn-sm" style="border-color:var(--teal);color:var(--teal)" data-action="add-attr">
          ${icoPlus} Adicionar
        </button>
      </div>
      ${node.attributes.length === 0
        ? `<div class="ins-empty">Nenhum atributo — clique em Adicionar</div>`
        : node.attributes.map(at => `
          <div class="attr-row">
            <div class="attr-key" title="${at.name}">${at.name}</div>
            <div class="attr-val" title="${at.value}">${at.value || '<em style="opacity:.4">vazio</em>'}</div>
            <div class="attr-acts">
              <button class="btn btn-icon btn-ghost btn-sm" title="Editar" data-action="edit-attr" data-id="${at.id}">${icoEdit}</button>
              <button class="btn btn-icon btn-ghost btn-sm" title="Remover" style="color:var(--red)" data-action="delete-attr" data-id="${at.id}">${icoTrash}</button>
            </div>
          </div>`).join('')}
    </div>`;

  body.innerHTML = nodeHtml + childrenHtml + attrsHtml;

  /* ---------- Event delegation — node id captured in closure ---------- */
  const nodeId = node.id;

  body.onclick = e => {
    /* Ignore clicks that are bubbling up while modal is open */
    if (document.getElementById('modal').classList.contains('open')) return;

    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    e.stopPropagation();

    const action = btn.dataset.action;
    const id     = btn.dataset.id;

    // Always re-fetch the node from model so we have fresh data
    const freshNode = findById(nodeId);
    if (!freshNode) return;

    if      (action === 'rename')        doRename(freshNode);
    else if (action === 'delete')        doDelete(freshNode);
    else if (action === 'add-child')     doAddChild(freshNode);
    else if (action === 'add-attr')      doAddAttr(freshNode);
    else if (action === 'inspect-child') { const c = findById(id); if (c) openInspector(c); }
    else if (action === 'rename-child')  { const c = findById(id); if (c) doRename(c); }
    else if (action === 'delete-child')  { const c = findById(id); if (c) doDeleteChild(freshNode, c); }
    else if (action === 'edit-attr')     { const a = freshNode.attributes.find(x => x.id === id); if (a) doEditAttr(freshNode, a); }
    else if (action === 'delete-attr')   doDeleteAttr(freshNode, id);
  };
}

function highlightNode(nodeId) {
  document.querySelectorAll('[data-node-sel]').forEach(el => el.removeAttribute('data-node-sel'));
  if (!nodeId) return;
  const el = document.querySelector(`[data-nid="${nodeId}"] .node-body`);
  if (el) el.setAttribute('data-node-sel', '1');
}

/* ================================================================
   CONTEXT MENU
================================================================ */
const ctxMenu = document.getElementById('ctx-menu');

/* Close context menu on any click outside */
document.addEventListener('click', () => ctxMenu.classList.remove('open'));

document.getElementById('ctx-inspect').onclick   = e => { e.stopPropagation(); if (selectedNode) openInspector(selectedNode); };
document.getElementById('ctx-rename').onclick    = e => { e.stopPropagation(); if (selectedNode) doRename(selectedNode); };
document.getElementById('ctx-add-child').onclick = e => { e.stopPropagation(); if (selectedNode) doAddChild(selectedNode); };
document.getElementById('ctx-add-attr').onclick  = e => { e.stopPropagation(); if (selectedNode) doAddAttr(selectedNode); };
document.getElementById('ctx-delete').onclick    = e => { e.stopPropagation(); if (selectedNode) doDelete(selectedNode); };

/* ================================================================
   D3 TREE
================================================================ */
const svgEl = document.getElementById('tree-svg');
const g = d3.select('#canvas-g');
const NODE_W = 174, NODE_H = 56, NODE_GAP_X = 80, NODE_GAP_Y = 18;

function updateTree() {
  g.selectAll('*').remove();
  updateStats();
  if (!model.length) return;

  const root = d3.hierarchy(
    { id: '__root__', name: '__ROOT__', children: model, attributes: [] },
    d => d.children
  );
  d3.tree().nodeSize([NODE_H + NODE_GAP_Y, NODE_W + NODE_GAP_X])(root);

  const nodes = root.descendants().filter(d => d.depth > 0);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  nodes.forEach(d => {
    x0 = Math.min(x0, d.y); x1 = Math.max(x1, d.y + NODE_W);
    y0 = Math.min(y0, d.x - NODE_H / 2); y1 = Math.max(y1, d.x + NODE_H / 2);
  });

  const PAD = 60, offX = -x0 + PAD + 20, offY = -y0 + PAD;
  svgEl.setAttribute('width',  Math.max(x1 - x0 + PAD * 2 + 200, 800));
  svgEl.setAttribute('height', Math.max(y1 - y0 + PAD * 2, 500));

  // Links
  const lg = g.append('g');
  root.links().forEach(lnk => {
    const sx = lnk.source.depth === 0 ? offX - 40 : lnk.source.y + offX + NODE_W;
    const sy = lnk.source.depth === 0 ? lnk.target.x + offY : lnk.source.x + offY;
    const tx = lnk.target.y + offX, ty = lnk.target.x + offY;
    const mx = (sx + tx) / 2;
    lg.append('path')
      .attr('d', `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`)
      .style('stroke', '#d0ccc8').style('stroke-width', 1.5).style('fill', 'none');
  });

  // Nodes
  const ng = g.append('g');
  nodes.forEach(d => {
    const x = d.y + offX, y = d.x + offY - NODE_H / 2;
    const color = levelColor(d.depth - 1);
    const isInspected = inspectedNode && inspectedNode.id === d.data.id;
    const hasAttrs    = d.data.attributes.length > 0;
    const hasChildren = d.data.children.length > 0;

    const grp = ng.append('g')
      .attr('data-nid', d.data.id)
      .attr('transform', `translate(${x},${y})`);

    // shadow
    grp.append('rect').attr('x',2).attr('y',2).attr('width',NODE_W).attr('height',NODE_H).attr('rx',6)
      .style('fill','rgba(0,0,0,0.08)').style('filter','blur(3px)');

    // body
    grp.append('rect').attr('class','node-body')
      .attr('width',NODE_W).attr('height',NODE_H).attr('rx',6)
      .style('fill','#fff')
      .style('stroke', color)
      .style('stroke-width', isInspected ? 2.5 : 1.2);

    // stripe
    const cid = 'c' + d.data.id;
    const def = grp.append('defs');
    def.append('clipPath').attr('id',cid).append('rect').attr('width',5).attr('height',NODE_H);
    grp.append('rect').attr('width',5).attr('height',NODE_H).attr('clip-path',`url(#${cid})`).style('fill',color);

    // name
    const nameShort = d.data.name.length > 17 ? d.data.name.slice(0,16)+'…' : d.data.name;
    grp.append('text')
      .attr('x',14).attr('y', hasAttrs ? 21 : NODE_H/2+1).attr('dominant-baseline','central')
      .style('font-size','13px').style('font-weight','600').style('fill','#201f1e')
      .style('font-family',"'Segoe UI',sans-serif").style('pointer-events','none')
      .text(nameShort);

    // attr preview
    if (hasAttrs) {
      const str = d.data.attributes.map(a=>`${a.name}: ${a.value}`).join(' · ');
      grp.append('text')
        .attr('x',14).attr('y',39).attr('dominant-baseline','central')
        .style('font-size','10px').style('fill','#038387')
        .style('font-family',"'Segoe UI',sans-serif").style('pointer-events','none')
        .text('⚙ ' + (str.length>24 ? str.slice(0,23)+'…' : str));
    }

    // children badge
    if (hasChildren) {
      const cx = NODE_W - 13, cy = NODE_H - 13;
      grp.append('circle').attr('cx',cx).attr('cy',cy).attr('r',9).style('fill',color).style('opacity',0.12);
      grp.append('circle').attr('cx',cx).attr('cy',cy).attr('r',9).style('fill','none').style('stroke',color).style('stroke-width',1);
      grp.append('text').attr('x',cx).attr('y',cy).attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size','9px').style('font-weight','700').style('fill',color).style('pointer-events','none')
        .text(d.data.children.length);
    }

    // hit area
    grp.append('rect').attr('width',NODE_W).attr('height',NODE_H).attr('rx',6)
      .style('fill','transparent').style('cursor','pointer')
      .on('click', e => { e.stopPropagation(); openInspector(d.data); })
      .on('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        selectedNode = d.data;
        ctxMenu.style.left = e.clientX+'px'; ctxMenu.style.top = e.clientY+'px';
        ctxMenu.classList.add('open');
      })
      .on('mouseover', () => grp.select('.node-body').style('stroke-width', isInspected ? 2.5 : 2))
      .on('mouseout',  () => grp.select('.node-body').style('stroke-width', isInspected ? 2.5 : 1.2));
  });

  if (inspectedNode) highlightNode(inspectedNode.id);
}

/* ================================================================
   ZOOM / PAN
================================================================ */
const zoom = d3.zoom().scaleExtent([0.15,3]).on('zoom', e => g.attr('transform', e.transform));
d3.select(svgEl).call(zoom);

function fitView() {
  const wrap = document.getElementById('canvas-wrap');
  const bb = g.node().getBBox();
  if (!bb || bb.width === 0) return;
  const scale = Math.min(wrap.clientWidth/(bb.width+80), wrap.clientHeight/(bb.height+80), 1.1);
  const tx = (wrap.clientWidth  - bb.width  * scale) / 2 - bb.x * scale;
  const ty = (wrap.clientHeight - bb.height * scale) / 2 - bb.y * scale;
  d3.select(svgEl).call(zoom.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
}
function zoomIn()  { d3.select(svgEl).call(zoom.scaleBy, 1.3); }
function zoomOut() { d3.select(svgEl).call(zoom.scaleBy, 0.77); }

/* INIT */
updateTree();