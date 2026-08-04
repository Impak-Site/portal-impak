// controle-contatos.js
//
// Autocomplete genérico de contatos (Cliente/Fornecedor/Armador/etc.) e CRUD da tela de Cadastros (Contatos).
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
// ── AUTOCOMPLETE GENÉRICO (Cliente, Fornecedor, Armador, Agente, Despachante, Transportadora) ──
let _acTimer = null;
// onSelect (opcional): callback(nomeCompleto) chamado quando o usuário clica
// numa sugestão do dropdown. Necessário pra campos cujo valor não é lido
// direto do DOM no momento de salvar, e sim espelhado numa variável JS a
// cada tecla (ex.: _vendas[vi].cliente, na aba Vendas) — sem isso, clicar
// numa sugestão só atualizava o texto visível do input, e o array que
// realmente é salvo ficava com o texto parcial digitado antes de escolher.
async function autocompletarContato(input, tipo, dropdownId, onSelect){
  clearTimeout(_acTimer);
  const q = input.value.trim();
  const dd = document.getElementById(dropdownId);
  if(!dd) return;
  if(q.length < 2){ dd.style.display='none'; return; }
  _acTimer = setTimeout(async ()=>{
    try{
      const r = await fetch('/api/contatos?q='+encodeURIComponent(q)+'&tipo='+encodeURIComponent(tipo));
      const d = await r.json();
      if(!d.ok || !d.contatos.length){ dd.style.display='none'; return; }
      dd.innerHTML = d.contatos.map((c,ci)=>{
        // Nome completo (razão social) é o que vai pro campo — é o nome que
        // bate com o CNPJ/contrato social. Nome fantasia só ajuda a
        // identificar visualmente na lista, quando existir e for diferente.
        const nomeCompleto = c.razao_social || c.nome_fantasia;
        const label = `${nomeCompleto}${c.nome_fantasia && c.nome_fantasia!==c.razao_social ? ' ('+c.nome_fantasia+')' : ''}${c.uf?' · '+c.uf:''}${c.cnpj?' · '+c.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'):''}`;
        return `<div data-nome="${esc(nomeCompleto)}" onclick="_acSelecionar('${input.id}','${dropdownId}',this.dataset.nome,${onSelect?'window._acCallback':'null'})"
          style="padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border2);"
          onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">${label}</div>`;
      }).join('');
      window._acCallback = onSelect || null;
      dd.style.display='block';
    }catch(e){ dd.style.display='none'; }
  }, 300);
}
function _acSelecionar(inputId, dropdownId, nome, callback){
  const el = document.getElementById(inputId);
  if(el) el.value = nome;
  const dd = document.getElementById(dropdownId);
  if(dd) dd.style.display = 'none';
  if(typeof callback === 'function') callback(nome);
}
document.addEventListener('click', e=>{
  ['cliente-dropdown','fornecedor-dropdown','armador-dropdown','agente-dropdown','despachante-dropdown','transportadora-dropdown'].forEach(id=>{
    const dd = document.getElementById(id);
    if(dd && !dd.contains(e.target) && e.target.id!=='f_'+id.replace('-dropdown','')) dd.style.display='none';
  });
});

// ════════════════════════════════════════════════════════════════
// CADASTRO DE CONTATOS (Clientes, Fornecedores, Despachantes, Agentes)
// ════════════════════════════════════════════════════════════════
let _contatosTipoAtivo = 'CLIENTE';
let _contatosLista = [];

function abrirContatos(){
  document.getElementById('modal-contatos-bg').classList.add('open');
  filtrarContatosTipo('CLIENTE');
}
function fecharModalContatos(){
  document.getElementById('modal-contatos-bg').classList.remove('open');
}

async function filtrarContatosTipo(tipo){
  _contatosTipoAtivo = tipo;
  document.querySelectorAll('#contatos-tipo-filter button').forEach(b=>{
    const ativo = b.dataset.tipo===tipo;
    b.className = ativo ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  });
  await carregarContatos();
}

async function carregarContatos(){
  try{
    const r = await fetch('/api/contatos?tipo='+_contatosTipoAtivo+'&limit=500');
    const d = await r.json();
    _contatosLista = d.ok ? d.contatos : [];
  }catch(e){ _contatosLista = []; }
  renderListaContatos();
}

function renderListaContatos(){
  const tbody = document.getElementById('contatos-tbody');
  if(!tbody) return;
  const q = (document.getElementById('contatos-search')?.value||'').toLowerCase().trim();
  let lista = _contatosLista;
  if(q) lista = lista.filter(c=>
    (c.razao_social||'').toLowerCase().includes(q) ||
    (c.cnpj||'').includes(q) ||
    (c.nome_fantasia||'').toLowerCase().includes(q)
  );
  if(!lista.length){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--dim);font-size:13px;">Nenhum contato cadastrado neste tipo.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(c=>{
    const cnpjFmt = c.cnpj ? c.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5') : '—';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:9px 16px;font-weight:600;">${esc(c.razao_social)}</td>
      <td style="padding:9px 16px;font-family:'DM Mono',monospace;font-size:11px;">${cnpjFmt}</td>
      <td style="padding:9px 16px;">${esc(c.cidade||'')}${c.uf?'/'+c.uf:''}</td>
      <td style="padding:9px 16px;font-size:11px;color:var(--muted);">${esc(c.email||c.telefone||'—')}</td>
      <td style="padding:9px 16px;text-align:right;">
        <button class="btn btn-sm btn-outline" onclick="editarContato('${c.id}')">Editar</button>
        <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);background:none;" onclick="excluirContato('${c.id}')">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

function formatarCnpjInput(input){
  let v = input.value.replace(/\D/g,'').slice(0,14);
  if(v.length > 12) v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, '$1.$2.$3/$4-$5');
  else if(v.length > 8) v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})/, '$1.$2.$3/$4');
  else if(v.length > 5) v = v.replace(/^(\d{2})(\d{3})(\d{0,3})/, '$1.$2.$3');
  else if(v.length > 2) v = v.replace(/^(\d{2})(\d{0,3})/, '$1.$2');
  input.value = v;
}

async function buscarDadosCnpj(valor){
  const cnpj = (valor||'').replace(/\D/g,'');
  const statusEl = document.getElementById('ce_cnpj_status');
  if(cnpj.length !== 14){
    if(statusEl) statusEl.textContent = '';
    return;
  }
  if(statusEl){ statusEl.textContent = 'Buscando dados na Receita Federal...'; statusEl.style.color = 'var(--dim)'; }
  try{
    const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/'+cnpj);
    if(!r.ok){
      if(statusEl){ statusEl.textContent = 'CNPJ não encontrado na base pública'; statusEl.style.color = 'var(--warn)'; }
      return;
    }
    const d = await r.json();
    const razaoEl = document.getElementById('ce_razao_social');
    const fantasiaEl = document.getElementById('ce_nome_fantasia');
    const cidadeEl = document.getElementById('ce_cidade');
    const ufEl = document.getElementById('ce_uf');
    const emailEl = document.getElementById('ce_email');
    const telEl = document.getElementById('ce_telefone');
    // Só preenche campos vazios, não sobrescreve o que o usuário já digitou
    if(razaoEl && !razaoEl.value) razaoEl.value = d.razao_social || '';
    if(fantasiaEl && !fantasiaEl.value) fantasiaEl.value = d.nome_fantasia || '';
    if(cidadeEl && !cidadeEl.value) cidadeEl.value = d.municipio || '';
    if(ufEl && !ufEl.value) ufEl.value = d.uf || '';
    if(emailEl && !emailEl.value && d.email) emailEl.value = d.email || '';
    if(telEl && !telEl.value && d.ddd_telefone_1) telEl.value = d.ddd_telefone_1 || '';
    if(statusEl){
      const situacao = d.descricao_situacao_cadastral || '';
      statusEl.textContent = '✓ Dados preenchidos automaticamente'+(situacao?' · Situação: '+situacao:'');
      statusEl.style.color = situacao==='ATIVA' ? 'var(--ok)' : 'var(--warn)';
    }
  }catch(e){
    if(statusEl){ statusEl.textContent = 'Erro ao consultar CNPJ — preencha manualmente'; statusEl.style.color = 'var(--err)'; }
  }
}

function abrirNovoContato(){
  document.getElementById('contato-edit-title').textContent = 'Novo Contato';
  ['ce_id','ce_razao_social','ce_nome_fantasia','ce_cnpj','ce_uf','ce_cidade','ce_email','ce_telefone','ce_obs'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('ce_tipo').value = _contatosTipoAtivo;
  const statusEl = document.getElementById('ce_cnpj_status');
  if(statusEl) statusEl.textContent = '';
  document.getElementById('modal-contato-edit-bg').classList.add('open');
}

function editarContato(id){
  const c = _contatosLista.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('contato-edit-title').textContent = 'Editar Contato';
  document.getElementById('ce_id').value = c.id;
  document.getElementById('ce_tipo').value = c.tipo||'CLIENTE';
  document.getElementById('ce_razao_social').value = c.razao_social||'';
  document.getElementById('ce_nome_fantasia').value = c.nome_fantasia||'';
  document.getElementById('ce_cnpj').value = c.cnpj||'';
  document.getElementById('ce_uf').value = c.uf||'';
  document.getElementById('ce_cidade').value = c.cidade||'';
  document.getElementById('ce_email').value = c.email||'';
  document.getElementById('ce_telefone').value = c.telefone||'';
  document.getElementById('ce_obs').value = c.obs||'';
  const statusEl = document.getElementById('ce_cnpj_status');
  if(statusEl) statusEl.textContent = '';
  document.getElementById('modal-contato-edit-bg').classList.add('open');
}

function fecharModalContatoEdit(){
  document.getElementById('modal-contato-edit-bg').classList.remove('open');
}

async function salvarContato(){
  const razao = document.getElementById('ce_razao_social').value.trim();
  if(!razao){ showToast('Razão social é obrigatória','err'); return; }
  const payload = {
    id: document.getElementById('ce_id').value || undefined,
    tipo: document.getElementById('ce_tipo').value,
    razao_social: razao,
    nome_fantasia: document.getElementById('ce_nome_fantasia').value.trim(),
    cnpj: document.getElementById('ce_cnpj').value.replace(/\D/g,''),
    uf: document.getElementById('ce_uf').value.trim().toUpperCase(),
    cidade: document.getElementById('ce_cidade').value.trim(),
    email: document.getElementById('ce_email').value.trim(),
    telefone: document.getElementById('ce_telefone').value.trim(),
    obs: document.getElementById('ce_obs').value.trim(),
  };
  try{
    const r = await fetch('/api/contatos', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if(d.ok){
      showToast('✓ Contato salvo','ok');
      fecharModalContatoEdit();
      await carregarContatos();
    } else if(d.duplicado_id){
      // Trava de duplicidade (ver POST /api/contatos no server) — não é bem
      // um "erro" do sistema, é um aviso de negócio, por isso toast 'warn'
      // em vez de 'err' e sem o prefixo "Erro:".
      showToast(d.erro || 'Já existe um cadastro parecido com esse.', 'warn');
    } else {
      showToast('Erro: '+(d.erro||''),'err');
    }
  }catch(e){ showToast('Erro ao salvar contato','err'); }
}

async function excluirContato(id){
  if(!confirm('Excluir este contato?')) return;
  try{
    const r = await fetch('/api/contatos/'+id, { method:'DELETE' });
    const d = await r.json();
    if(d.ok){ showToast('Contato removido','ok'); await carregarContatos(); }
    else showToast('Erro ao excluir','err');
  }catch(e){ showToast('Erro ao excluir','err'); }
}

// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA EXCEL
// ════════════════════════════════════════════════════════════════
