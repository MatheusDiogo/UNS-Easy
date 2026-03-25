/* ================================================================
   API HELPERS
================================================================ */
const API = {
  async listUseCases()          { return fetch('/api/use-cases/').then(r => r.json()); },
  async createUseCase(name)     { return fetch('/api/use-cases/', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) }).then(r => r.json()); },
  async getUseCase(id)          { return fetch(`/api/use-cases/${id}`).then(r => r.json()); },
  async renameUseCase(id, name) { return fetch(`/api/use-cases/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) }).then(r => r.json()); },
  async saveTree(id, tree)      { return fetch(`/api/use-cases/${id}/tree`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({tree}) }).then(r => r.json()); },
  async deleteUseCase(id)       { return fetch(`/api/use-cases/${id}`, { method:'DELETE' }).then(r => r.json()); },
  async getConfig(id)           { return fetch(`/api/use-cases/${id}/config`).then(r => r.json()); },
  async saveConfig(id, config)  { return fetch(`/api/use-cases/${id}/config`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(config) }).then(r => r.json()); },
};

/* ================================================================
   MODEL
================================================================ */
let model            = [];
let currentUseCaseId = null;
let selectedNode     = null;
let inspectedNode    = null;
let _dirty           = false;
let ucConfig         = {}; // OPC UA + MQTT connection settings for current use case

const LEVEL_COLORS      = ['#2b579a','#106ebe','#038387','#107c10','#ca5010','#6b3a7d'];
const levelColor        = d => LEVEL_COLORS[Math.min(d, LEVEL_COLORS.length - 1)];
const FLAG_INSTANTIABLE = 'instantiable';
const FLAG_DATA_OUTPUT  = 'dataOutput';
const FLAG_DATA_INPUT   = 'dataInput';
const FLAG_FOLDER       = 'folder';
const FLAG_TOPIC        = 'topic';

function mkNode(name) {
  return { id: crypto.randomUUID(), name, flags: [], attributes: [], children: [] };
}

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

function isInstantiable(node) { return (node.flags || []).includes(FLAG_INSTANTIABLE); }
function isDataOutput(node)   { return (node.flags || []).includes(FLAG_DATA_OUTPUT); }
function isDataInput(node)    { return (node.flags || []).includes(FLAG_DATA_INPUT); }
function isFolder(node)       { return (node.flags || []).includes(FLAG_FOLDER); }
function isTopic(node)        { return (node.flags || []).includes(FLAG_TOPIC); }

function toggleFlag(node, flag) {
  if (!node.flags) node.flags = [];
  const idx = node.flags.indexOf(flag);
  if (idx === -1) node.flags.push(flag); else node.flags.splice(idx, 1);
}

function countAll(ns)   { let c = 0; for (const n of ns) { c += 1 + countAll(n.children); } return c; }
function countAttrs(ns) { let c = 0; for (const n of ns) { c += n.attributes.length + countAttrs(n.children); } return c; }
function maxDepth(ns, d = 0) { if (!ns.length) return d; return Math.max(...ns.map(n => maxDepth(n.children, d + 1))); }

function updateStats() {
  document.getElementById('stat-nodes').textContent    = countAll(model);
  document.getElementById('stat-levels').textContent   = maxDepth(model);
  document.getElementById('stat-attrs').textContent    = countAttrs(model);
  document.getElementById('stat-sel').textContent      = inspectedNode ? '● ' + inspectedNode.name : '';
  document.getElementById('empty-state').style.display = model.length ? 'none' : 'block';
}

/* ================================================================
   SAVE STATE
================================================================ */
function markDirty() {
  if (!currentUseCaseId) return;
  _dirty = true;
  const btn = document.getElementById('btn-save');
  if (btn) { btn.disabled = false; document.getElementById('btn-save-label').textContent = 'Salvar'; }
}

function markClean() {
  _dirty = false;
  const btn = document.getElementById('btn-save');
  if (btn) { btn.disabled = true; document.getElementById('btn-save-label').textContent = 'Salvar'; }
}

async function saveCurrentUseCase() {
  if (!currentUseCaseId || !_dirty) return;
  const btn = document.getElementById('btn-save');
  const lbl = document.getElementById('btn-save-label');
  btn.disabled = true;
  lbl.textContent = 'Salvando...';
  try {
    const res = await API.saveTree(currentUseCaseId, model);
    if (res && res.ok) {
      markClean();
    } else {
      throw new Error(res?.error || 'Resposta inesperada');
    }
  } catch (err) {
    console.error('Erro ao salvar:', err);
    lbl.textContent = 'Erro ao salvar';
    btn.disabled = false;
    setTimeout(() => { lbl.textContent = 'Salvar'; }, 3000);
  }
}

/* ================================================================
   USE CASE SIDEBAR
================================================================ */
async function loadUseCaseList() {
  const list = await API.listUseCases();
  renderUseCaseList(list);
}

function toggleSidebar() {
  const sidebar = document.getElementById('uc-sidebar');
  const toggle  = document.getElementById('uc-toggle');
  const collapsed = sidebar.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed', collapsed);
}

function renderUseCaseList(list) {
  const container = document.getElementById('uc-list');

  if (!list.length) {
    container.innerHTML = `<div class="uc-empty">Nenhum caso salvo.<br>Clique em <b>Novo</b> para criar.</div>`;
    return;
  }

  const icoEdit  = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 10.5l2.5-.5L11 3.5l-2-2L2.5 8 2 10.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const icoTrash = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 4h10M5 4V2h4v2M3 4l1 8h6l1-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  container.innerHTML = list.map(uc => `
    <div class="uc-item ${uc.id === currentUseCaseId ? 'active' : ''}" data-id="${uc.id}">
      <div class="uc-item-name" title="${uc.name}">${uc.name}</div>
      <div class="uc-item-acts">
        <button class="btn btn-icon btn-ghost btn-sm" title="Renomear" data-action="rename-uc" data-id="${uc.id}">${icoEdit}</button>
        <button class="btn btn-icon btn-ghost btn-sm" title="Excluir" style="color:var(--red)" data-action="delete-uc" data-id="${uc.id}">${icoTrash}</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.uc-item').forEach(el => {
    el.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (btn) {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        if (btn.dataset.action === 'rename-uc') await doRenameUseCase(id);
        if (btn.dataset.action === 'delete-uc') await doDeleteUseCase(id);
        return;
      }
      await loadUseCaseById(parseInt(el.dataset.id));
    });
  });
}

/* ── única definição de loadUseCaseById ── */
async function loadUseCaseById(id) {
  const data = await API.getUseCase(id);
  currentUseCaseId = data.id;
  model = data.tree || [];
  closeInspector();
  updateTree();
  await loadUseCaseList();
  document.getElementById('uc-title').textContent = 'Caso de Uso: ' + data.name;
  ucConfig = data.config || {};
  API.getConfig(currentUseCaseId)
    .then(cfg => { if (cfg && !cfg.error) ucConfig = cfg; })
    .catch(() => {})
  markClean();
}

async function doNewUseCase() {
  openModal({
    title: 'Novo Caso de Uso',
    namePH: 'ex: Planta Principal, Projeto X...',
    cb: async name => {
      const uc = await API.createUseCase(name);
      await loadUseCaseById(uc.id);
    }
  });
}

async function doRenameUseCase(id) {
  const list = await API.listUseCases();
  const uc = list.find(u => u.id === id);
  if (!uc) return;
  openModal({
    title: 'Renomear Caso de Uso',
    nameLabel: 'Novo nome',
    defName: uc.name,
    cb: async name => {
      await API.renameUseCase(id, name);
      if (currentUseCaseId === id) document.getElementById('uc-title').textContent = 'Caso de Uso: ' + name;
      await loadUseCaseList();
    }
  });
}

async function doDeleteUseCase(id) {
  const list = await API.listUseCases();
  const uc = list.find(u => u.id === id);
  if (!uc || !confirm(`Excluir "${uc.name}" permanentemente?`)) return;
  await API.deleteUseCase(id);
  if (currentUseCaseId === id) {
    currentUseCaseId = null;
    model = [];
    closeInspector();
    updateTree();
    document.getElementById('uc-title').textContent = 'Selecione um caso de uso';
    markClean();
  }
  await loadUseCaseList();
}

/* ================================================================
   MODAL
================================================================ */
let _modalCb = null;

function openModal({ title, nameLabel = 'Nome', namePH = '', showValue = false, valuePH = '', defName = '', defValue = '', cb }) {
  _modalCb = cb;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('lbl-name').textContent = nameLabel;
  const inputName  = document.getElementById('input-name');
  const inputValue = document.getElementById('input-value');
  inputName.placeholder  = namePH;  inputName.value  = defName;  inputName.style.outline = '';
  document.getElementById('fg-value').style.display = showValue ? 'block' : 'none';
  inputValue.placeholder = valuePH; inputValue.value = defValue;
  document.getElementById('modal').classList.add('open');
  setTimeout(() => inputName.focus(), 40);
}

function _confirmModal() {
  const inputName = document.getElementById('input-name');
  const name = inputName.value.trim();
  if (!name) { inputName.style.outline = '2px solid var(--red)'; inputName.focus(); return; }
  inputName.style.outline = '';
  const value = document.getElementById('input-value').value.trim();
  const cb = _modalCb;
  closeModal();
  if (cb) cb(name, value);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  _modalCb = null;
  const fgInput = document.getElementById('fg-input');
  if (fgInput) fgInput.style.display = 'none';
  document.getElementById('fg-value').style.display = 'none';
}

document.getElementById('modal-box').addEventListener('click', e => e.stopPropagation());
document.getElementById('modal').addEventListener('click', () => closeModal());
document.getElementById('modal-ok').addEventListener('click', e => { e.stopPropagation(); _confirmModal(); });
['input-name', 'input-value'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _confirmModal(); }
    if (e.key === 'Escape') closeModal();
  })
);

/* ================================================================
   ATTR MODAL
================================================================ */
function openAttrModal({ node, attr = null, cb }) {
  const isEdit   = !!attr;
  const defName  = attr ? attr.name  : '';
  const defValue = attr ? attr.value : '';
  const defInput = attr ? !!attr.isInput : false;

  let fgInput = document.getElementById('fg-input');
  if (!fgInput) {
    fgInput = document.createElement('div');
    fgInput.className = 'form-group';
    fgInput.id = 'fg-input';
    fgInput.innerHTML = `
      <label class="form-label">Tipo do Atributo</label>
      <div class="attr-type-row">
        <label class="attr-type-opt">
          <input type="radio" name="attr-type" id="attr-type-value" value="value">
          <span class="attr-type-badge badge-val">Valor</span>
          <span class="attr-type-desc">Valor padrão definido</span>
        </label>
        <label class="attr-type-opt">
          <input type="radio" name="attr-type" id="attr-type-input" value="input">
          <span class="attr-type-badge badge-in">Input</span>
          <span class="attr-type-desc">Endereço externo — sem valor</span>
        </label>
      </div>`;
    document.querySelector('.modal-footer').before(fgInput);
  }

  fgInput.style.display = 'block';

  const radioVal   = document.getElementById('attr-type-value');
  const radioInput = document.getElementById('attr-type-input');
  const fgValue    = document.getElementById('fg-value');

  function syncFields() { fgValue.style.display = radioInput.checked ? 'none' : 'block'; }

  radioVal.checked   = !defInput;
  radioInput.checked = defInput;
  syncFields();
  radioVal.onchange   = syncFields;
  radioInput.onchange = syncFields;

  openModal({
    title: isEdit ? 'Editar atributo' : `Atributo em "${node.name}"`,
    namePH: 'ex: location, type...',
    showValue: !defInput,
    valuePH: 'ex: Brasil, true, 42...',
    defName, defValue,
    cb: (name, value) => {
      const isInput = document.getElementById('attr-type-input').checked;
      cb(name, value, isInput);
    }
  });
}

/* ================================================================
   TREE ACTIONS
================================================================ */
function openAddRoot() {
  if (!currentUseCaseId) { alert('Selecione ou crie um Caso de Uso primeiro.'); return; }
  openModal({
    title: 'Adicionar Nível Raiz', namePH: 'ex: Enterprise, Planta...',
    cb: name => { model.push(mkNode(name)); updateTree(); markDirty(); }
  });
}

function doAddChild(node) {
  const nodeId = node.id;
  openModal({
    title: `Filho de "${node.name}"`, namePH: 'ex: Site A, Área 1...',
    cb: name => {
      const target = findById(nodeId); if (!target) return;
      target.children.push(mkNode(name)); updateTree(); markDirty();
      if (inspectedNode && inspectedNode.id === nodeId) renderInspector(target);
    }
  });
}

function doAddAttr(node) {
  if (!isInstantiable(node)) return;
  const nodeId = node.id;
  openAttrModal({ node, cb: (name, value, isInput) => {
    const target = findById(nodeId); if (!target) return;
    target.attributes.push({ id: crypto.randomUUID(), name, value: isInput ? '' : value, isInput: !!isInput });
    updateTree(); markDirty();
    if (inspectedNode && inspectedNode.id === nodeId) renderInspector(target);
  }});
}

function doRename(node) {
  const nodeId = node.id;
  openModal({
    title: 'Renomear nó', nameLabel: 'Novo nome', defName: node.name,
    cb: name => {
      const target = findById(nodeId); if (!target) return;
      target.name = name; updateTree(); markDirty();
      if (inspectedNode && inspectedNode.id === nodeId) renderInspector(target);
    }
  });
}

function doDelete(node) {
  if (!confirm(`Remover "${node.name}" e todos os seus filhos?`)) return;
  if (inspectedNode && inspectedNode.id === node.id) closeInspector();
  removeNode(model, node); selectedNode = null; updateTree(); markDirty();
}

function doDeleteChild(parentNode, childNode) {
  if (!confirm(`Remover "${childNode.name}"?`)) return;
  parentNode.children = parentNode.children.filter(c => c !== childNode);
  if (inspectedNode && inspectedNode.id === childNode.id) closeInspector();
  updateTree(); markDirty(); renderInspector(parentNode);
}

function doDeleteAttr(node, attrId) {
  node.attributes = node.attributes.filter(a => a.id !== attrId);
  updateTree(); markDirty(); renderInspector(node);
}

function doEditAttr(node, attr) {
  const nodeId = node.id; const attrId = attr.id;
  openAttrModal({ node, attr, cb: (name, value, isInput) => {
    const target = findById(nodeId); if (!target) return;
    const a = target.attributes.find(x => x.id === attrId);
    if (a) { a.name = name; a.value = isInput ? '' : value; a.isInput = !!isInput; }
    updateTree(); markDirty();
    if (inspectedNode && inspectedNode.id === nodeId) renderInspector(target);
  }});
}

function doToggleFlag(node, flag) {
  if (flag === FLAG_INSTANTIABLE && isInstantiable(node) && node.attributes.length > 0) {
    if (!confirm(`Remover o tipo "Instanciável" também apagará os ${node.attributes.length} atributo(s). Continuar?`)) return;
    node.attributes = [];
  }
  toggleFlag(node, flag);
  updateTree(); markDirty(); renderInspector(node);
}

function clearAll() {
  if (!model.length || confirm('Limpar toda a árvore?')) {
    model = []; closeInspector(); updateTree(); markDirty();
  }
}

function loadSample() {
  if (!currentUseCaseId) { alert('Selecione ou crie um Caso de Uso primeiro.'); return; }
  const u = () => crypto.randomUUID();
  model = [{
    id: u(),
    name: 'eMille',
    flags: [FLAG_TOPIC],
    attributes: [],
    children: [{
      id: u(),
      name: 'v1',
      flags: [FLAG_TOPIC],
      attributes: [],
      children: [{
        id: u(),
        name: 'Plant',
        flags: [],
        attributes: [],
        children: [{
          id: u(),
          name: 'Shop',
          flags: [],
          attributes: [],
          children: [{
            id: u(),
            name: 'Line',
            flags: [],
            attributes: [],
            children: [
              // Item 1 da Line: Pasta de Temporário
              {
                id: u(),
                name: 'Temp',
                flags: [FLAG_FOLDER],
                attributes: [],
                children: [{
                  id: u(),
                  name: 'CycleTime',
                  flags: [FLAG_TOPIC, FLAG_DATA_OUTPUT, FLAG_DATA_INPUT],
                  attributes: [],
                  children: []
                }]
              },
              // Item 2 da Line: Data Products
              {
                id: u(),
                name: 'DataProducts',
                flags: [FLAG_TOPIC],
                attributes: [],
                children: [{
                  id: u(),
                  name: 'CycleTime',
                  flags: [FLAG_TOPIC],
                  attributes: [],
                  children: [
                    { id: u(), name: 'Raw', flags: [FLAG_DATA_OUTPUT, FLAG_DATA_INPUT], attributes: [], children: [] },
                    { id: u(), name: 'Final', flags: [FLAG_DATA_OUTPUT], attributes: [], children: [] }
                  ]
                }]
              },
              // Item 3 da Line: Station
              {
                id: u(),
                name: 'Station',
                flags: [],
                attributes: [],
                children: [{
                  id: u(),
                  name: 'Robot',
                  flags: [FLAG_INSTANTIABLE],
                  attributes: [
                    { id: u(), name: 'HomeStatus', value: '', isInput: true },
                    { id: u(), name: 'CSALD', value: '', isInput: true },
                    { id: u(), name: 'CGOOD', value: '', isInput: true },
                    { id: u(), name: 'NSEQ', value: '', isInput: true },
                    { id: u(), name: 'TCData', value: '', isInput: true }
                  ],
                  children: [
                    {
                      id: u(),
                      name: 'Temp',
                      flags: [FLAG_FOLDER],
                      attributes: [],
                      children: [{
                        id: u(),
                        name: 'CycleTime',
                        flags: [FLAG_TOPIC, FLAG_DATA_OUTPUT, FLAG_DATA_INPUT],
                        attributes: [],
                        children: []
                      }]
                    },
                    {
                      id: u(),
                      name: 'DataProducts',
                      flags: [FLAG_TOPIC],
                      attributes: [],
                      children: [{
                        id: u(),
                        name: 'CycleTime',
                        flags: [FLAG_TOPIC],
                        attributes: [],
                        children: [
                          { id: u(), name: 'Raw', flags: [FLAG_DATA_OUTPUT, FLAG_DATA_INPUT], attributes: [], children: [] },
                          { id: u(), name: 'Final', flags: [FLAG_DATA_OUTPUT], attributes: [] , children: [] }
                        ]
                      }]
                    }
                  ]
                }]
              }
            ]
          }]
        }]
      }]
    }]
  }];

  updateTree(); markDirty();
}

function generateJson() {
  openCsvModal(csvData => {
    _doGenerateJson(csvData);
  });
}

function openCsvModal(onConfirm) {
  const overlay = document.createElement('div');
  overlay.id = 'csv-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:2000';

  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.2);width:440px;overflow:hidden" onclick="event.stopPropagation()">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);font-size:14px;font-weight:600;color:var(--accent)">
        Anexar CSV de Endereços
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:14px">

        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5">
          Anexe o CSV gerado pelo botão <b>Gerar CSV</b> com os endereços preenchidos.
          Os endereços serão usados para montar o JSON de exportação.
        </div>

        <label id="csv-drop-area" style="
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:8px;padding:28px 20px;border:2px dashed var(--border2);border-radius:var(--radius);
          cursor:pointer;transition:border-color 0.15s,background 0.15s;
          background:var(--surface2);text-align:center;
        ">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28" style="opacity:0.35">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M14 2v6h6M12 11v6M9 14l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span id="csv-drop-label" style="font-size:12px;color:var(--text-muted)">
            Clique para selecionar ou arraste o arquivo CSV aqui
          </span>
          <input type="file" id="csv-file-input" accept=".csv" style="display:none">
        </label>

        <div id="csv-skip-hint" style="font-size:11px;color:var(--text-muted);text-align:center">
          Sem CSV? <a href="#" id="csv-skip-link" style="color:var(--accent);text-decoration:none">Continuar sem endereços</a>
        </div>

      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-sm" id="csv-cancel-btn">Cancelar</button>
        <button class="btn btn-sm btn-primary" id="csv-confirm-btn" disabled>Confirmar</button>
      </div>
    </div>`;

  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  const fileInput   = document.getElementById('csv-file-input');
  const dropArea    = document.getElementById('csv-drop-area');
  const dropLabel   = document.getElementById('csv-drop-label');
  const confirmBtn  = document.getElementById('csv-confirm-btn');
  const cancelBtn   = document.getElementById('csv-cancel-btn');
  const skipLink    = document.getElementById('csv-skip-link');
  let parsedCsv     = null;

  // Click to pick file
  dropArea.addEventListener('click', () => fileInput.click());

  // Drag & drop styling
  dropArea.addEventListener('dragover', e => {
    e.preventDefault();
    dropArea.style.borderColor = 'var(--accent)';
    dropArea.style.background  = 'var(--accent-light)';
  });
  dropArea.addEventListener('dragleave', () => {
    dropArea.style.borderColor = 'var(--border2)';
    dropArea.style.background  = 'var(--surface2)';
  });
  dropArea.addEventListener('drop', e => {
    e.preventDefault();
    dropArea.style.borderColor = 'var(--border2)';
    dropArea.style.background  = 'var(--surface2)';
    const file = e.dataTransfer.files[0];
    if (file) handleCsvFile(file);
  });

  function handleCsvFile(file) {
    if (!file.name.endsWith('.csv')) {
      dropLabel.textContent = '⚠ Arquivo inválido — selecione um .csv';
      dropLabel.style.color = 'var(--red)';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      parsedCsv = ev.target.result;
      dropLabel.textContent = '✓ ' + file.name;
      dropLabel.style.color = 'var(--teal)';
      dropArea.style.borderColor = 'var(--teal)';
      confirmBtn.disabled = false;
    };
    reader.readAsText(file);
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleCsvFile(fileInput.files[0]);
  });

  confirmBtn.addEventListener('click', e => {
    e.stopPropagation();
    overlay.remove();
    onConfirm(parsedCsv);
  });

  cancelBtn.addEventListener('click', e => {
    e.stopPropagation();
    overlay.remove();
  });

  skipLink.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    overlay.remove();
    onConfirm(null);
  });
}

function _doGenerateJson(csvData) {
  const opc  = ucConfig.opcua || {};
  const mqtt = ucConfig.mqtt  || {};

  const connections = [];

  if (mqtt.name || mqtt.host) {
    connections.push({
      name: mqtt.name || 'MQTT',
      uri:  `mqtt://${mqtt.host || ''}:${mqtt.port || 1883}`,
      tags: [],
      writes: { flattenModeledValues: false },
      subscriptions: {},
      storeForward: {
        enabled: false,
        maxEntries: 100,
        waitOnFailureInterval: { duration: 1, units: 'Seconds' },
      },
      settings: {
        connectionTimeoutSeconds: 10,
        keepAliveSeconds: 60,
        requestTimeoutMS: 5000,
        cleanSession: true,
        clientId: mqtt.clientId || '',
        ssl: false,
        redundantBrokers: [],
        inputDiscovery: '',
        maxInflight : 1000
      },
    });
  }

  if (opc.name || opc.host) {
    connections.push({
      name: opc.name || 'OPC UA',
      uri:  `opc.tcp://${opc.host || ''}:${opc.port || 4840}${opc.path || ''}`,
      tags: [],
      writes: { flattenModeledValues: false },
      subscriptions: {
        subscriptionRate: { duration: 100, units: 'Milliseconds' },
      },
      storeForward: {
        enabled: false,
        maxEntries: 100,
        waitOnFailureInterval: { duration: 1, units: 'Seconds' },
      },
      settings: {
        security: 'None',
        authentication: { type: 'Anonymous' },
        connectTimeoutSeconds: 5,
        requestTimeoutMS: 5000,
        maxItemsPerRead: 512,
        maxItemsPerWrite: 256,
        sessionName: '',
      },
    });
  }

  const ucName = document.getElementById('uc-title').textContent.replace('Caso de Uso: ', '').trim();
  const outputs = [];
  const inputs = [];

  if (csvData) {
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      alert('CSV inválido: precisa de cabeçalho e pelo menos uma linha de dados.');
      return;
    }

    const header = parseCsvLine(lines[0]);
    const outputPaths = findAllOutputPaths(model);
    const inputPaths = findAllInputPaths(model);
    const createdOutputTopics = new Set();
    const createdInputTopics = new Set();

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      if (values.length === 0 || values.every(v => v.trim() === '')) continue;

      const rowData = {};
      header.forEach((col, idx) => {
        rowData[col] = values[idx] || '';
      });

      for (const outputPath of outputPaths) {
        const { topic, instanceName } = buildOutputEntry(outputPath, rowData);

        if (createdOutputTopics.has(topic)) continue;
        createdOutputTopics.add(topic);

        outputs.push({
          name: `OutTopic_${ucName}_${instanceName}`,
          connection: mqtt.name || 'MQTT',
          type: 'mqtt',
          qualifier: {
            qos: 0,
            namedRoot: false,
            breakupArrays: false,
            topic: topic,
            retained: true
          }
        });
      }

      for (const inputPath of inputPaths) {
        const { topic, instanceName } = buildInputEntry(inputPath, rowData);

        if (createdInputTopics.has(topic)) continue;
        createdInputTopics.add(topic);

        inputs.push({
          name: `InpTopic_${mqtt.name || 'MQTT'}_${instanceName}`,
          connection: mqtt.name || 'MQTT',
          type: 'mqtt',
          qualifier: {
            payloadType: 'json',
            qos: 0,
            topic: topic,
            includeTopic: false
          },
          cacheLifetime: {
            enabled: false
          },
          template: {
            type: 'Off'
          },
          parameters: {
            type: 'EmptyParameters'
          }
        });
      }
    }
  }
  

  const output = {
    productInfo: {
      company: 'HighByte',
      product: 'IntelligenceHub',
      version: '4.2.5',
      build:   '2026.1.5.1',
      stage:   'Release',
    },
    project: {
      version:    10,
      connections,
      inputs,
      outputs,
      modeling:   { models: [], instances: [] },
      conditions: [],
      functions:  [],
      tags:       [],
      pipelines:  [],
      namespace:  [],
    },
    network: {
      groups: [],
      hubs:   [],
    },
  };

  document.getElementById('json-output').textContent = JSON.stringify(output, null, 2);
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ';' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function findAllOutputPaths(nodes, ancestors = []) {
  const outputs = [];
  for (const node of nodes) {
    const currentAnc = [...ancestors, node];
    if (isDataOutput(node)) {
      outputs.push({ path: currentAnc });
    }
    if (node.children.length) {
      outputs.push(...findAllOutputPaths(node.children, currentAnc));
    }
  }
  return outputs;
}

function findAllInputPaths(nodes, ancestors = []) {
  const inputs = [];
  for (const node of nodes) {
    const currentAnc = [...ancestors, node];
    if (isDataInput(node)) {
      inputs.push({ path: currentAnc });
    }
    if (node.children.length) {
      inputs.push(...findAllInputPaths(node.children, currentAnc));
    }
  }
  return inputs;
}

function buildEntryName(path, rowData) {
  const topicParts = [];
  const instanceParts = [];

  for (const node of path) {
    if (isTopic(node)) {
      topicParts.push(node.name);
    } else if (rowData[node.name]) {
      topicParts.push(rowData[node.name]);
      instanceParts.push(rowData[node.name]);
    } else {
      topicParts.push(node.name);
      instanceParts.push(node.name);
    }
  }

  return {
    topic: topicParts.join('/'),
    instanceName: instanceParts.join('_')
  };
}

function buildOutputEntry(outputPath, rowData) {
  return buildEntryName(outputPath.path, rowData);
}

function buildInputEntry(inputPath, rowData) {
  return buildEntryName(inputPath.path, rowData);
}

function copyJson() {
  navigator.clipboard.writeText(document.getElementById('json-output').textContent).catch(() => {});
}
function openConfigModal() {
  if (!currentUseCaseId) { alert('Selecione um Caso de Uso primeiro.'); return; }
  // Always fetch fresh config from backend before rendering
  API.getConfig(currentUseCaseId)
    .then(cfg => { if (cfg && !cfg.error) ucConfig = cfg; })
    .catch(() => {})
    .finally(() => _renderConfigModal());
}

function _renderConfigModal() {
  const opc  = ucConfig.opcua || {};
  const mqtt = ucConfig.mqtt  || {};

  const overlay = document.createElement('div');
  overlay.id = 'config-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:2000';

  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.2);width:460px;overflow:hidden" onclick="event.stopPropagation()">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);font-size:14px;font-weight:600;color:var(--accent)">
        Configurações de Conexão
      </div>
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:16px;max-height:70vh;overflow-y:auto">

        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted);padding-bottom:4px;border-bottom:1px solid var(--border)">OPC UA</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome da conexão</label>
            <input class="form-input" id="cfg-opc-name" value="${opc.name||''}" placeholder="ex: OPC_Server">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Host</label>
            <input class="form-input" id="cfg-opc-host" value="${opc.host||''}" placeholder="ex: 192.168.1.10">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Porta</label>
            <input class="form-input" id="cfg-opc-port" value="${opc.port||'4840'}" placeholder="4840">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Path</label>
            <input class="form-input" id="cfg-opc-path" value="${opc.path||''}" placeholder="ex: /Discover">
          </div>
        </div>

        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted);padding-bottom:4px;border-bottom:1px solid var(--border);margin-top:4px">MQTT</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome da conexão</label>
            <input class="form-input" id="cfg-mqtt-name" value="${mqtt.name||''}" placeholder="ex: MQTT_HIGHBYTE">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Host</label>
            <input class="form-input" id="cfg-mqtt-host" value="${mqtt.host||''}" placeholder="ex: 192.168.1.20">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Porta</label>
            <input class="form-input" id="cfg-mqtt-port" value="${mqtt.port||'1883'}" placeholder="1883">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Client ID</label>
            <input class="form-input" id="cfg-mqtt-clientid" value="${mqtt.clientId||''}" placeholder="ex: Highbyte_TOS">
          </div>
        </div>

      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-sm" onclick="document.getElementById('config-modal').remove()">Cancelar</button>
        <button class="btn btn-sm btn-primary" onclick="saveConfig()">Salvar</button>
      </div>
    </div>`;

  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('cfg-opc-name').focus(), 40);

  overlay.querySelectorAll('.form-input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveConfig();
      if (e.key === 'Escape') overlay.remove();
    });
  });
}

async function saveConfig() {
  const config = {
    opcua: {
      name: document.getElementById('cfg-opc-name').value.trim(),
      host: document.getElementById('cfg-opc-host').value.trim(),
      port: document.getElementById('cfg-opc-port').value.trim(),
      path: document.getElementById('cfg-opc-path').value.trim(),
    },
    mqtt: {
      name:     document.getElementById('cfg-mqtt-name').value.trim(),
      host:     document.getElementById('cfg-mqtt-host').value.trim(),
      port:     document.getElementById('cfg-mqtt-port').value.trim(),
      clientId: document.getElementById('cfg-mqtt-clientid').value.trim(),
    },
  };

  try {
    const res = await API.saveConfig(currentUseCaseId, config);
    if (res && res.ok) {
      ucConfig = config;
      document.getElementById('config-modal').remove();
    } else {
      throw new Error(res?.error || 'Erro ao salvar');
    }
  } catch (err) {
    console.error('Erro ao salvar config:', err);
    alert('Erro ao salvar configurações. Verifique o console.');
  }
}

function generateCsv() {
  // Single CSV row: all non-folder/non-output node names + empty attributes of instantiable nodes
  const cols = [];

  function walk(node) {
    const flags = node.flags || [];
    const isFolder   = flags.includes(FLAG_FOLDER);
    const isTopicNode = flags.includes(FLAG_TOPIC);
    const isOutput   = flags.includes(FLAG_DATA_OUTPUT);
    const isInput    = flags.includes(FLAG_DATA_INPUT);
    const isInst     = flags.includes(FLAG_INSTANTIABLE);

    // Skip folders, topics, outputs and inputs entirely (don't add name, don't recurse)
    if (isFolder || isTopicNode || isOutput || isInput) return;

    // Add node name as a column
    cols.push(node.name);

    // If instantiable, add attributes with no value as columns
    if (isInst) {
      const emptyAttrs = (node.attributes || []).filter(a => {
        const v = a.value;
        return v === null || v === undefined || v === '';
      });
      for (const a of emptyAttrs) cols.push(a.name);
    }

    for (const child of (node.children || [])) walk(child);
  }

  for (const root of model) walk(root);

  if (!cols.length) {
    alert('Nenhum nó encontrado para exportar.');
    return;
  }

  // Single line CSV
  const lines = [cols];

  const csvContent = lines
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  // Filename with use case name
  const ucTitle = document.getElementById('uc-title').textContent.replace('Caso de Uso: ', '').trim();
  const filename = `UNS Modeler - ${ucTitle}.csv`;

  // Download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}



/* ================================================================
   INSPECTOR
================================================================ */
function openInspector(node) {
  inspectedNode = node;
  document.getElementById('inspector').classList.add('open');
  renderInspector(node); updateStats(); highlightNode(node.id);
}

function closeInspector() {
  inspectedNode = null;
  document.getElementById('inspector').classList.remove('open');
  highlightNode(null); updateStats();
}

function renderInspector(node) {
  if (!node) return;
  const depth      = getDepth(model, node);
  const color      = levelColor(depth);
  const childColor = levelColor(depth + 1);
  const instanc    = isInstantiable(node);
  const dataOut    = isDataOutput(node);
  const dataIn     = isDataInput(node);
  const folder     = isFolder(node);
  const topic      = isTopic(node);

  document.getElementById('ins-dot').style.background = color;
  document.getElementById('ins-name').textContent = node.name;
  const body = document.getElementById('ins-body');

  const icoEdit  = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 10.5l2.5-.5L11 3.5l-2-2L2.5 8 2 10.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const icoTrash = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 4h10M5 4V2h4v2M3 4l1 8h6l1-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const icoInfo  = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 6v4M7 4.5v.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const icoPlus  = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  body.innerHTML = `
    <div class="ins-section">
      <div class="ins-section-header"><span class="ins-section-title">Tipo do Nó</span></div>
      <div class="ins-node-actions">
        <button class="btn btn-sm ${instanc ? 'btn-flag-active' : ''}" data-action="toggle-instantiable">
          <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 3V2h4v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>
          Instanciável
        </button>
        <button class="btn btn-sm ${folder ? 'btn-flag-active btn-flag-folder' : ''}" data-action="toggle-folder">
          <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M1 3.5A1 1 0 012 2.5h3l1.5 1.5H12a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          Folder
        </button>
        <button class="btn btn-sm ${topic ? 'btn-flag-active btn-flag-topic' : ''}" data-action="toggle-topic">
          <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          Tópico
        </button>
        <button class="btn btn-sm ${dataIn ? 'btn-flag-active btn-flag-input' : ''}" data-action="toggle-datainput">
          <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M7 13V5M4 8l3-4 3 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 2h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          Input
        </button>
        <button class="btn btn-sm ${dataOut ? 'btn-flag-active btn-flag-data' : ''}" data-action="toggle-dataoutput">
          <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M7 1v8M4 6l3 4 3-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          Output
        </button>
      </div>
    </div>    </div>

    <div class="ins-section">
      <div class="ins-section-header"><span class="ins-section-title">Nó</span></div>
      <div class="ins-node-actions">
        <button class="btn btn-sm" data-action="rename">${icoEdit} Renomear</button>
        <button class="btn btn-sm btn-danger" data-action="delete">${icoTrash} Remover nó</button>
      </div>
    </div>

    <div class="ins-section">
      <div class="ins-section-header">
        <span class="ins-section-title">Filhos <span class="ins-count" style="color:${color}">${node.children.length}</span></span>
        <button class="btn btn-sm btn-primary" data-action="add-child">${icoPlus} Adicionar</button>
      </div>
      ${node.children.length === 0
        ? `<div class="ins-empty">Nenhum filho — clique em Adicionar</div>`
        : node.children.map(ch => `
          <div class="child-row">
            <div class="child-dot" style="background:${childColor}"></div>
            <div class="child-name" title="${ch.name}">${ch.name}</div>
            <div class="child-sub">${ch.children.length ? ch.children.length+' filho'+(ch.children.length>1?'s':'') : ch.attributes.length ? ch.attributes.length+' attr' : ''}</div>
            <div class="child-acts">
              <button class="btn btn-icon btn-ghost btn-sm" title="Inspecionar" data-action="inspect-child" data-id="${ch.id}">${icoInfo}</button>
              <button class="btn btn-icon btn-ghost btn-sm" title="Renomear"    data-action="rename-child"  data-id="${ch.id}">${icoEdit}</button>
              <button class="btn btn-icon btn-ghost btn-sm" title="Remover" style="color:var(--red)" data-action="delete-child" data-id="${ch.id}">${icoTrash}</button>
            </div>
          </div>`).join('')}
    </div>

    <div class="ins-section">
      <div class="ins-section-header">
        <span class="ins-section-title">Atributos ${instanc ? `<span class="ins-count" style="color:var(--teal)">${node.attributes.length}</span>` : ''}</span>
        ${instanc ? `<button class="btn btn-sm" style="border-color:var(--teal);color:var(--teal)" data-action="add-attr">${icoPlus} Adicionar</button>` : ''}
      </div>
      ${!instanc
        ? `<div class="ins-empty ins-locked">
             <svg viewBox="0 0 14 14" fill="none" width="14" height="14" style="opacity:.35;display:block;margin:0 auto 6px"><rect x="3" y="6" width="8" height="6" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 6V4.5a2 2 0 014 0V6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
             Marque o nó como <b>Instanciável</b><br>para adicionar atributos
           </div>`
        : node.attributes.length === 0
          ? `<div class="ins-empty">Nenhum atributo — clique em Adicionar</div>`
          : node.attributes.map(at => `
            <div class="attr-row">
              <div class="attr-pill ${at.isInput ? 'pill-in' : 'pill-val'}">${at.isInput ? 'IN' : 'VAL'}</div>
              <div class="attr-key" title="${at.name}">${at.name}</div>
              <div class="attr-val">${at.isInput ? `<em class="attr-input-hint">input</em>` : (at.value || `<em style="opacity:.4">vazio</em>`)}</div>
              <div class="attr-acts">
                <button class="btn btn-icon btn-ghost btn-sm" title="Editar"  data-action="edit-attr"   data-id="${at.id}">${icoEdit}</button>
                <button class="btn btn-icon btn-ghost btn-sm" title="Remover" style="color:var(--red)" data-action="delete-attr" data-id="${at.id}">${icoTrash}</button>
              </div>
            </div>`).join('')}
    </div>`;

  const nodeId = node.id;
  body.onclick = e => {
    if (document.getElementById('modal').classList.contains('open')) return;
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    const id     = btn.dataset.id;
    const fresh  = findById(nodeId); if (!fresh) return;
    if      (action === 'rename')              doRename(fresh);
    else if (action === 'delete')              doDelete(fresh);
    else if (action === 'add-child')           doAddChild(fresh);
    else if (action === 'add-attr')            doAddAttr(fresh);
    else if (action === 'toggle-instantiable') doToggleFlag(fresh, FLAG_INSTANTIABLE);
    else if (action === 'toggle-datainput')    doToggleFlag(fresh, FLAG_DATA_INPUT);
    else if (action === 'toggle-dataoutput')   doToggleFlag(fresh, FLAG_DATA_OUTPUT);
    else if (action === 'toggle-folder')        doToggleFlag(fresh, FLAG_FOLDER);
    else if (action === 'toggle-topic')         doToggleFlag(fresh, FLAG_TOPIC);
    else if (action === 'inspect-child')       { const c = findById(id); if (c) openInspector(c); }
    else if (action === 'rename-child')        { const c = findById(id); if (c) doRename(c); }
    else if (action === 'delete-child')        { const c = findById(id); if (c) doDeleteChild(fresh, c); }
    else if (action === 'edit-attr')           { const a = fresh.attributes.find(x => x.id === id); if (a) doEditAttr(fresh, a); }
    else if (action === 'delete-attr')         doDeleteAttr(fresh, id);
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
const g     = d3.select('#canvas-g');
const NODE_W = 174, NODE_H = 56, NODE_GAP_X = 80, NODE_GAP_Y = 18;

function updateTree() {
  g.selectAll('*').remove();
  updateStats();
  if (!model.length) return;

  const root = d3.hierarchy(
    { id: '__root__', name: '__ROOT__', children: model, flags: [], attributes: [] },
    d => d.children
  );
  d3.tree().nodeSize([NODE_H + NODE_GAP_Y, NODE_W + NODE_GAP_X])(root);

  const nodes = root.descendants().filter(d => d.depth > 0);
  let x0=Infinity, x1=-Infinity, y0=Infinity, y1=-Infinity;
  nodes.forEach(d => {
    x0=Math.min(x0,d.y); x1=Math.max(x1,d.y+NODE_W);
    y0=Math.min(y0,d.x-NODE_H/2); y1=Math.max(y1,d.x+NODE_H/2);
  });

  const PAD=60, offX=-x0+PAD+20, offY=-y0+PAD;
  svgEl.setAttribute('width',  Math.max(x1-x0+PAD*2+200, 800));
  svgEl.setAttribute('height', Math.max(y1-y0+PAD*2, 500));

  const lg = g.append('g');
  root.links().forEach(lnk => {
    const sx = lnk.source.depth===0 ? offX-40 : lnk.source.y+offX+NODE_W;
    const sy = lnk.source.depth===0 ? lnk.target.x+offY : lnk.source.x+offY;
    const tx = lnk.target.y+offX, ty = lnk.target.x+offY;
    const mx = (sx+tx)/2;
    lg.append('path').attr('d',`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`)
      .style('stroke','#d0ccc8').style('stroke-width',1.5).style('fill','none');
  });

  const ng = g.append('g');
  nodes.forEach(d => {
    const x=d.y+offX, y=d.x+offY-NODE_H/2;
    const color       = levelColor(d.depth-1);
    const isInspected = inspectedNode && inspectedNode.id===d.data.id;
    const hasAttrs    = d.data.attributes.length > 0;
    const hasChildren = d.data.children.length > 0;
    const instanc     = isInstantiable(d.data);
    const dataOut     = isDataOutput(d.data);
    const dataIn      = isDataInput(d.data);
    const folder      = isFolder(d.data);
    const topic       = isTopic(d.data);

    // grp SEMPRE primeiro
    const grp = ng.append('g')
      .attr('data-nid', d.data.id)
      .attr('transform', `translate(${x},${y})`);

    // shadow
    grp.append('rect').attr('x',2).attr('y',2).attr('width',NODE_W).attr('height',NODE_H).attr('rx',6)
      .style('fill','rgba(0,0,0,0.08)').style('filter','blur(3px)');
    // body
    grp.append('rect').attr('class','node-body').attr('width',NODE_W).attr('height',NODE_H).attr('rx',6)
      .style('fill','#fff').style('stroke',color).style('stroke-width',isInspected?2.5:1.2);
    // stripe
    const cid='c'+d.data.id;
    grp.append('defs').append('clipPath').attr('id',cid).append('rect').attr('width',5).attr('height',NODE_H);
    grp.append('rect').attr('width',5).attr('height',NODE_H).attr('clip-path',`url(#${cid})`).style('fill',color);
    // name
    const nameShort = d.data.name.length>17 ? d.data.name.slice(0,16)+'…' : d.data.name;
    grp.append('text').attr('x',14).attr('y',hasAttrs?21:NODE_H/2+1).attr('dominant-baseline','central')
      .style('font-size','13px').style('font-weight','600').style('fill','#201f1e')
      .style('font-family',"'Segoe UI',sans-serif").style('pointer-events','none').text(nameShort);
    // attr preview
    if (hasAttrs) {
      const str = d.data.attributes.map(a => a.isInput ? `${a.name}:∅` : `${a.name}:${a.value}`).join(' · ');
      grp.append('text').attr('x',14).attr('y',39).attr('dominant-baseline','central')
        .style('font-size','10px').style('fill','#038387')
        .style('font-family',"'Segoe UI',sans-serif").style('pointer-events','none')
        .text('⚙ '+(str.length>24?str.slice(0,23)+'…':str));
    }
    // children badge
    if (hasChildren) {
      const cx=NODE_W-13, cy=NODE_H-13;
      grp.append('circle').attr('cx',cx).attr('cy',cy).attr('r',9).style('fill',color).style('opacity',0.12);
      grp.append('circle').attr('cx',cx).attr('cy',cy).attr('r',9).style('fill','none').style('stroke',color).style('stroke-width',1);
      grp.append('text').attr('x',cx).attr('y',cy).attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size','9px').style('font-weight','700').style('fill',color).style('pointer-events','none')
        .text(d.data.children.length);
    }
    // type badges — depois do grp e antes do hit area
    let bx = NODE_W - 6;
    if (dataOut) {
      bx -= 17;
      const bg = grp.append('g').attr('transform',`translate(${bx},4)`);
      bg.append('rect').attr('width',16).attr('height',10).attr('rx',3).style('fill','#ca5010').style('opacity',0.14);
      bg.append('text').attr('x',8).attr('y',5).attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size','7px').style('font-weight','700').style('fill','#ca5010').style('pointer-events','none').text('OUT');
    }
    if (dataIn) {
      bx -= 17;
      const bgIn = grp.append('g').attr('transform',`translate(${bx},4)`);
      bgIn.append('rect').attr('width',16).attr('height',10).attr('rx',3).style('fill','#107c10').style('opacity',0.14);
      bgIn.append('text').attr('x',8).attr('y',5).attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size','7px').style('font-weight','700').style('fill','#107c10').style('pointer-events','none').text('IN');
    }
    if (instanc) {
      bx -= 17;
      const bg2 = grp.append('g').attr('transform',`translate(${bx},4)`);
      bg2.append('rect').attr('width',16).attr('height',10).attr('rx',3).style('fill','#106ebe').style('opacity',0.14);
      bg2.append('text').attr('x',8).attr('y',5).attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size','7px').style('font-weight','700').style('fill','#106ebe').style('pointer-events','none').text('OBJ');
    }
    if (folder) {
      bx -= 17;
      const bg3 = grp.append('g').attr('transform',`translate(${bx},4)`);
      bg3.append('rect').attr('width',16).attr('height',10).attr('rx',3).style('fill','#6b3a7d').style('opacity',0.14);
      bg3.append('text').attr('x',8).attr('y',5).attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size','7px').style('font-weight','700').style('fill','#6b3a7d').style('pointer-events','none').text('FLD');
    }
    if (topic) {
      bx -= 17;
      const bg4 = grp.append('g').attr('transform',`translate(${bx},4)`);
      bg4.append('rect').attr('width',16).attr('height',10).attr('rx',3).style('fill','#038387').style('opacity',0.14);
      bg4.append('text').attr('x',8).attr('y',5).attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size','7px').style('font-weight','700').style('fill','#038387').style('pointer-events','none').text('TPK');
    }
    // hit area — sempre por último
    grp.append('rect').attr('width',NODE_W).attr('height',NODE_H).attr('rx',6)
      .style('fill','transparent').style('cursor','pointer')
      .on('click', e => { e.stopPropagation(); openInspector(d.data); })
      .on('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        selectedNode = d.data;
        ctxMenu.style.left=e.clientX+'px'; ctxMenu.style.top=e.clientY+'px';
        ctxMenu.classList.add('open');
      })
      .on('mouseover', () => grp.select('.node-body').style('stroke-width', isInspected?2.5:2))
      .on('mouseout',  () => grp.select('.node-body').style('stroke-width', isInspected?2.5:1.2));
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
  if (!bb || bb.width===0) return;
  const scale = Math.min(wrap.clientWidth/(bb.width+80), wrap.clientHeight/(bb.height+80), 1.1);
  const tx = (wrap.clientWidth  - bb.width *scale)/2 - bb.x*scale;
  const ty = (wrap.clientHeight - bb.height*scale)/2 - bb.y*scale;
  d3.select(svgEl).call(zoom.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
}
function zoomIn()  { d3.select(svgEl).call(zoom.scaleBy, 1.3); }
function zoomOut() { d3.select(svgEl).call(zoom.scaleBy, 0.77); }

/* ================================================================
   INIT
================================================================ */
(async () => {
  await loadUseCaseList();
  updateTree();
})();