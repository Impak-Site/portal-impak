// controle-dash-cadastros.js
//
// Tela "Cadastros" (/cadastros) — Empresas / Pessoas / Funcionários.
// Unifica num só lugar o cadastro de clientes/fornecedores/etc. (empresas,
// já existia como contatos_clientes) com um cadastro novo de PESSOAS
// individuais: contatos de uma empresa (com aniversário, telefone e e-mail
// próprios — antes só existia um e-mail/telefone por empresa inteira) e
// funcionários internos (ficha própria, podendo ser vinculados a um
// usuário de login já existente). Pedido do Ayslan (12/09/2026): "preciso
// pensar como podemos ter uma tela de cadastros pra todo o sistema".
//
// Reaproveita o modal de edição de Empresa (#modal-contato-edit-bg,
// abrirNovoContato/editarContato/salvarContato — ver controle-contatos.js)
// e adiciona um modal próprio de Pessoa (#modal-pessoa-edit-bg).

let _cadAba = 'empresas'; // 'empresas' | 'pessoas' | 'funcionarios' | 'listas'
let _cadUsuariosLoginCache = null;

function renderDashCadastros(){
  const el = document.getElementById('dash-cadastros-content');
  if(!el) return;
  const aba = (nome, label) => `<button class="btn btn-sm ${_cadAba===nome?'btn-primary':'btn-outline'}" onclick="_cadMudarAba('${nome}')">${label}</button>`;
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      ${aba('empresas','🏢 Empresas')}
      ${aba('pessoas','👤 Pessoas (contatos)')}
      ${aba('funcionarios','🧑‍💼 Funcionários')}
      ${aba('listas','📚 Listas (portos, bancos)')}
    </div>
    <div id="cad-aba-content"></div>
  `;
  _cadRenderAbaAtiva();
}

function _cadMudarAba(aba){
  _cadAba = aba;
  renderDashCadastros();
}

function _cadRenderAbaAtiva(){
  if(_cadAba === 'empresas') _cadRenderEmpresas();
  else if(_cadAba === 'pessoas') _cadRenderPessoas('CONTATO');
  else if(_cadAba === 'listas') _cadRenderListas();
  else _cadRenderPessoas('FUNCIONARIO');
}

// ── ABA LISTAS (cadastros fase 1b, 01/10/2026) ─────────────────────
// Portos de destino (com dias grátis de armazenagem), portos de origem (com
// país) e bancos de câmbio. Antes eram constantes fixas em controle-campos.js
// (só mudavam com deploy); agora vivem em cadastros_listas (migration 0040)
// e qualquer gerente/analista com acesso a Cadastros edita aqui. Os
// formulários do processo leem as mesmas listas (ver aplicarListas()).
let _cadListaCat = 'porto_destino';
let _cadListasCache = null; // resposta de /api/listas?todos=1 (inclui inativos)

async function _cadRenderListas(){
  const cont = document.getElementById('cad-aba-content');
  const cats = (typeof ListasPadrao !== 'undefined') ? ListasPadrao.CATEGORIAS : {};
  cont.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${Object.keys(cats).map(c=>`<button class="btn btn-sm ${c===_cadListaCat?'btn-primary':'btn-outline'}" onclick="_cadFiltrarListaCat('${c}')">${esc(cats[c].nome)}</button>`).join('')}
      </div>
      <div style="flex:1"></div>
      <button class="btn btn-primary" onclick="abrirNovoItemLista()">+ Adicionar</button>
    </div>
    <div id="cad-listas-aviso"></div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="background:var(--bg);" id="cad-listas-thead"></thead>
        <tbody id="cad-listas-tbody"><tr><td colspan="8" style="text-align:center;padding:30px;color:var(--dim);font-size:13px;">Carregando...</td></tr></tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.5;">
      💡 <b>Código</b> é o que fica gravado no processo (ex.: NVT); <b>Nome</b> é o que aparece nas telas e relatórios.
      <b>Sinônimos</b> são outras grafias que o time usa — ao salvar um processo com uma delas, o sistema troca pelo código.
      Item inativo some dos formulários mas continua valendo nos processos antigos.
    </div>
  `;
  try{
    const r = await fetch('/api/listas?todos=1');
    const d = await r.json();
    _cadListasCache = d.ok ? d : null;
  }catch(e){ _cadListasCache = null; }
  _cadRenderTabelaListas();
}

function _cadFiltrarListaCat(c){
  _cadListaCat = c;
  _cadRenderListas();
}

function _cadRenderTabelaListas(){
  const thead = document.getElementById('cad-listas-thead');
  const tbody = document.getElementById('cad-listas-tbody');
  const aviso = document.getElementById('cad-listas-aviso');
  if(!thead || !tbody) return;
  const cats = (typeof ListasPadrao !== 'undefined') ? ListasPadrao.CATEGORIAS : {};
  const campos = (cats[_cadListaCat] && cats[_cadListaCat].campos) || [];
  const th = (t, dir) => `<th style="text-align:${dir||'left'};padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">${t}</th>`;
  thead.innerHTML = `<tr style="border-bottom:1px solid var(--border);">${th('Código')}${th('Nome')}${campos.map(c=>th(esc(c[1]))).join('')}${th('Sinônimos')}${th('Situação')}${th('Ações','right')}</tr>`;
  if(aviso){
    aviso.innerHTML = (_cadListasCache && _cadListasCache.origem === 'padrao')
      ? `<div style="margin-bottom:10px;padding:10px 12px;background:#fff7e6;border:1px solid #f0c36d;border-radius:8px;font-size:12px;color:#7a4d00;">⚠ Mostrando a <b>lista padrão embutida</b> — a tabela <code>cadastros_listas</code> ainda não existe no banco (rode a migration 0040 no Supabase). Até lá, não dá pra salvar alterações aqui.</div>`
      : '';
  }
  const itens = ((_cadListasCache && _cadListasCache.listas && _cadListasCache.listas[_cadListaCat]) || []).slice()
    .sort((a,b)=> (a.ordem||0)-(b.ordem||0) || String(a.nome).localeCompare(String(b.nome),'pt-BR'));
  if(!itens.length){
    tbody.innerHTML = `<tr><td colspan="${4+campos.length}" style="text-align:center;padding:30px;color:var(--dim);font-size:13px;">Nenhum item nesta lista.</td></tr>`;
    return;
  }
  const ehGerente = (typeof _user !== 'undefined' && _user && _user.role === 'gerente');
  tbody.innerHTML = itens.map(it=>{
    const dados = it.dados || {};
    const inativo = it.ativo === false;
    return `<tr style="border-bottom:1px solid var(--border);cursor:pointer;${inativo?'opacity:.55;':''}" onclick="editarItemLista('${esc(it.id||'')}','${esc(it.codigo)}')" title="Clique para abrir">
      <td style="padding:9px 16px;font-family:'DM Mono',monospace;font-weight:600;">${esc(it.codigo)}</td>
      <td style="padding:9px 16px;font-weight:600;">${esc(it.nome)}</td>
      ${campos.map(c=>`<td style="padding:9px 16px;">${esc(dados[c[0]]!==undefined && dados[c[0]]!==null ? String(dados[c[0]]) : '—')}</td>`).join('')}
      <td style="padding:9px 16px;font-size:11px;color:var(--muted);">${(it.sinonimos||[]).length ? esc((it.sinonimos||[]).join(', ')) : '—'}</td>
      <td style="padding:9px 16px;font-size:11px;">${inativo ? '<span style="color:var(--err);">Inativo</span>' : '<span style="color:var(--ok,#16a34a);">Ativo</span>'}</td>
      <td style="padding:9px 16px;text-align:right;white-space:nowrap;">
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();editarItemLista('${esc(it.id||'')}','${esc(it.codigo)}')">Editar</button>
        ${ehGerente && it.id && !inativo ? `<button class="btn btn-sm" style="color:var(--err);border-color:var(--err);background:none;" onclick="event.stopPropagation();excluirItemLista('${esc(it.id)}')">Inativar</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function _clRenderCamposDados(categoria, dados){
  const cats = (typeof ListasPadrao !== 'undefined') ? ListasPadrao.CATEGORIAS : {};
  const campos = (cats[categoria] && cats[categoria].campos) || [];
  const wrap = document.getElementById('cl_dados');
  if(!wrap) return;
  wrap.innerHTML = campos.map(c=>`<div class="form-group"><label class="form-label">${esc(c[1])}</label>
    <input class="form-input" type="${c[2]==='number'?'number':'text'}" data-dado="${esc(c[0])}" value="${esc(dados && dados[c[0]]!==undefined && dados[c[0]]!==null ? String(dados[c[0]]) : '')}"></div>`).join('');
}

function abrirNovoItemLista(){
  const cats = (typeof ListasPadrao !== 'undefined') ? ListasPadrao.CATEGORIAS : {};
  document.getElementById('lista-edit-title').textContent = 'Novo item — ' + ((cats[_cadListaCat] && cats[_cadListaCat].nome) || _cadListaCat);
  document.getElementById('cl_id').value = '';
  document.getElementById('cl_categoria').value = _cadListaCat;
  document.getElementById('cl_codigo').value = '';
  document.getElementById('cl_codigo').disabled = false;
  document.getElementById('cl_nome').value = '';
  document.getElementById('cl_sinonimos').value = '';
  document.getElementById('cl_ordem').value = '0';
  document.getElementById('cl_ativo').value = '1';
  _clRenderCamposDados(_cadListaCat, {});
  document.getElementById('modal-lista-edit-bg').classList.add('open');
}

function editarItemLista(id, codigo){
  const itens = (_cadListasCache && _cadListasCache.listas && _cadListasCache.listas[_cadListaCat]) || [];
  const it = itens.find(x => (id && x.id === id) || (!id && x.codigo === codigo));
  if(!it) return;
  const cats = (typeof ListasPadrao !== 'undefined') ? ListasPadrao.CATEGORIAS : {};
  document.getElementById('lista-edit-title').textContent = 'Editar — ' + ((cats[_cadListaCat] && cats[_cadListaCat].nome) || _cadListaCat);
  document.getElementById('cl_id').value = it.id || '';
  document.getElementById('cl_categoria').value = _cadListaCat;
  document.getElementById('cl_codigo').value = it.codigo || '';
  // Código é a chave gravada nos processos — não muda em edição (crie outro item se precisar).
  document.getElementById('cl_codigo').disabled = !!it.id;
  document.getElementById('cl_nome').value = it.nome || '';
  document.getElementById('cl_sinonimos').value = (it.sinonimos||[]).join('\n');
  document.getElementById('cl_ordem').value = String(it.ordem||0);
  document.getElementById('cl_ativo').value = it.ativo === false ? '0' : '1';
  _clRenderCamposDados(_cadListaCat, it.dados || {});
  document.getElementById('modal-lista-edit-bg').classList.add('open');
}

function fecharModalListaEdit(){
  document.getElementById('modal-lista-edit-bg').classList.remove('open');
}

async function salvarItemLista(){
  const codigo = document.getElementById('cl_codigo').value.trim().toUpperCase();
  const nome = document.getElementById('cl_nome').value.trim();
  if(!codigo || !nome){ showToast('Código e nome são obrigatórios','err'); return; }
  const dados = {};
  document.querySelectorAll('#cl_dados input[data-dado]').forEach(inp=>{
    const v = inp.value.trim();
    if(v !== '') dados[inp.dataset.dado] = inp.type === 'number' ? Number(v) : v;
  });
  const vistos = new Set();
  const sinonimos = document.getElementById('cl_sinonimos').value.split(/[\n;]+/).map(x=>x.trim()).filter(x=>{ if(!x||vistos.has(x.toUpperCase())) return false; vistos.add(x.toUpperCase()); return true; });
  const payload = {
    id: document.getElementById('cl_id').value || undefined,
    categoria: document.getElementById('cl_categoria').value,
    codigo, nome, dados, sinonimos,
    ordem: parseInt(document.getElementById('cl_ordem').value,10) || 0,
    ativo: document.getElementById('cl_ativo').value === '1',
  };
  try{
    const r = await fetch('/api/listas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const d = await r.json();
    if(d.ok){
      showToast('✓ Lista atualizada','ok');
      fecharModalListaEdit();
      // Recarrega as listas usadas pelos formulários (portos/dias grátis/bancos) e a tabela.
      if(typeof carregarListas === 'function') await carregarListas();
      await _cadRenderListas();
    } else {
      showToast(d.erro || 'Erro ao salvar', 'err');
    }
  }catch(e){ showToast('Erro ao salvar item da lista','err'); }
}

async function excluirItemLista(id){
  if(!confirm('Inativar este item? Ele some dos formulários, mas os processos antigos continuam com o valor.')) return;
  try{
    const r = await fetch('/api/listas/'+encodeURIComponent(id), { method:'DELETE' });
    const d = await r.json();
    if(d.ok){
      showToast('Item inativado','ok');
      if(typeof carregarListas === 'function') await carregarListas();
      await _cadRenderListas();
    } else showToast(d.erro || 'Erro ao inativar','err');
  }catch(e){ showToast('Erro ao inativar','err'); }
}

// ── ABA EMPRESAS ────────────────────────────────────────────────
// Reaproveita as mesmas rotas/estado de controle-contatos.js
// (_contatosLista, carregarContatos, editarContato, excluirContato etc.)
// — só desenha a tabela num container próprio da aba em vez do modal
// antigo (removido, ver controle_v2.html).
let _cadEmpresaTipoAtivo = 'CLIENTE';

async function _cadRenderEmpresas(){
  const cont = document.getElementById('cad-aba-content');
  const tipos = [
    ['CLIENTE','👤 Clientes'], ['FORNECEDOR','🏭 Fornecedores'], ['EXPORTADOR','🏗 Exportadores'],
    ['DESPACHANTE','📋 Despachantes'], ['AGENTE','🚢 Agentes'], ['ARMADOR','⚓ Armadores'],
    ['TRANSPORTADORA','🚚 Transportadoras'], ['ARMAZEM_ALFANDEGADO','🏢 Armazém Alfandegado'],
    ['PORTO_ARMAZEM','🏗 Porto/Armazém'], ['DEPOT_DEVOLUCAO','🔄 Depot Devolução'],
  ];
  cont.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;" id="contatos-tipo-filter">
        ${tipos.map(([v,l])=>`<button class="btn btn-sm ${v===_cadEmpresaTipoAtivo?'btn-primary':'btn-outline'}" data-tipo="${v}" onclick="_cadFiltrarEmpresaTipo('${v}')">${l}</button>`).join('')}
      </div>
      <input class="search-box" id="contatos-search" placeholder="🔍 Buscar por razão social, CNPJ/CPF..." oninput="renderListaContatos()" style="flex:1;min-width:200px;">
      <button class="btn btn-primary" onclick="abrirNovoContato()">+ Nova Empresa</button>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="background:var(--bg);">
          <tr style="border-bottom:1px solid var(--border);">
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Razão Social</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">CNPJ/CPF</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Cidade/UF</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Contato</th>
            <th style="text-align:right;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Ações</th>
          </tr>
        </thead>
        <tbody id="contatos-tbody"></tbody>
      </table>
    </div>
  `;
  _contatosTipoAtivo = _cadEmpresaTipoAtivo;
  await carregarContatos();
}

function _cadFiltrarEmpresaTipo(tipo){
  _cadEmpresaTipoAtivo = tipo;
  _cadRenderEmpresas();
}

// ── ABA PESSOAS / FUNCIONÁRIOS ───────────────────────────────────
// Mesma tabela serve as duas abas — só muda o filtro de tipo e os
// campos em destaque (Pessoas mostra a empresa vinculada; Funcionários
// mostra o usuário de login vinculado).
let _cadPessoasLista = [];

async function _cadRenderPessoas(tipo){
  const cont = document.getElementById('cad-aba-content');
  const ehFuncionario = tipo === 'FUNCIONARIO';
  cont.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <input class="search-box" id="cad-pessoas-search" placeholder="🔍 Buscar por nome, cargo, e-mail..." oninput="_cadRenderTabelaPessoas()" style="flex:1;min-width:200px;">
      <button class="btn btn-primary" onclick="abrirNovaPessoa('${tipo}')">+ ${ehFuncionario ? 'Novo Funcionário' : 'Nova Pessoa'}</button>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="background:var(--bg);">
          <tr style="border-bottom:1px solid var(--border);">
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Nome</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Cargo</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">${ehFuncionario ? 'Usuário de login' : 'Empresa'}</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Telefone/E-mail</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Aniversário</th>
            <th style="text-align:right;padding:10px 16px;font-size:10px;color:var(--muted);text-transform:uppercase;">Ações</th>
          </tr>
        </thead>
        <tbody id="cad-pessoas-tbody"><tr><td colspan="6" style="text-align:center;padding:30px;color:var(--dim);font-size:13px;">Carregando...</td></tr></tbody>
      </table>
    </div>
  `;
  try{
    const r = await fetch('/api/cadastros/pessoas?tipo='+tipo+'&limit=500');
    const d = await r.json();
    _cadPessoasLista = d.ok ? d.pessoas : [];
  }catch(e){ _cadPessoasLista = []; }
  _cadRenderTabelaPessoas();
}

function _cadFmtData(iso){
  if(!iso) return '—';
  try{ return new Date(iso+'T00:00:00').toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}); }catch(e){ return iso; }
}

// Papéis de uma Pessoa (pedido Ayslan 14/09/2026: "preciso ter se a
// pessoa é diretor, contato comercial, contato operacional") — lista
// fechada, uma pessoa pode acumular vários. Ver migration 0030
// (cadastros_pessoas.papeis, text[]).
const PAPEIS_PESSOA = { DIRETOR: '👔 Diretor', COMERCIAL: '💼 Comercial', OPERACIONAL: '📦 Operacional', FINANCEIRO: '💰 Financeiro' };
function _cadRenderBadgesPapeis(papeis){
  if(!papeis || !papeis.length) return '';
  return papeis.map(p=>`<span style="display:inline-block;font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:var(--ac-soft);color:var(--ac);margin-right:4px;">${esc(PAPEIS_PESSOA[p]||p)}</span>`).join('');
}

function _cadRenderTabelaPessoas(){
  const tbody = document.getElementById('cad-pessoas-tbody');
  if(!tbody) return;
  const ehFuncionario = _cadAba === 'funcionarios';
  const q = (document.getElementById('cad-pessoas-search')?.value||'').toLowerCase().trim();
  let lista = _cadPessoasLista;
  if(q) lista = lista.filter(p=>
    (p.nome||'').toLowerCase().includes(q) || (p.cargo||'').toLowerCase().includes(q) || (p.email||'').toLowerCase().includes(q)
  );
  if(!lista.length){
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--dim);font-size:13px;">Nenhum cadastro ainda.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(p=>{
    const terceiraColuna = ehFuncionario
      ? (p.usuario_vinculado ? `🔑 ${esc(p.usuario_vinculado)}` : '—')
      : (p._empresaNome ? esc(p._empresaNome) : '—');
    const principalBadge = p.principal ? ' <span style="color:var(--ok);font-size:10px;font-weight:700;">★ principal</span>' : '';
    const papeisBadges = _cadRenderBadgesPapeis(p.papeis);
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:9px 16px;font-weight:600;">${esc(p.nome)}${principalBadge}${papeisBadges?'<div style="margin-top:4px;">'+papeisBadges+'</div>':''}</td>
      <td style="padding:9px 16px;">${esc(p.cargo||'—')}</td>
      <td style="padding:9px 16px;">${terceiraColuna}</td>
      <td style="padding:9px 16px;font-size:11px;color:var(--muted);">${esc(p.telefone||p.email||'—')}</td>
      <td style="padding:9px 16px;font-size:11px;">${_cadFmtData(p.aniversario)}</td>
      <td style="padding:9px 16px;text-align:right;">
        <button class="btn btn-sm btn-outline" onclick="editarPessoa('${p.id}')">Editar</button>
        <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);background:none;" onclick="excluirPessoa('${p.id}')">Excluir</button>
      </td>
    </tr>`;
  }).join('');

  // Resolve o nome da empresa vinculada (aba Pessoas) de forma preguiçosa —
  // busca só as empresas referenciadas pela lista atual, não o cadastro
  // inteiro, e re-renderiza quando chegar.
  if(!ehFuncionario){
    const idsFaltando = [...new Set(lista.filter(p=>p.empresa_id && !p._empresaNome).map(p=>p.empresa_id))];
    if(idsFaltando.length) _cadResolverNomesEmpresa(idsFaltando);
  }
}

async function _cadResolverNomesEmpresa(ids){
  try{
    const r = await fetch('/api/contatos?limit=1000');
    const d = await r.json();
    if(!d.ok) return;
    const porId = new Map(d.contatos.map(c=>[c.id, c.razao_social]));
    let mudou = false;
    _cadPessoasLista.forEach(p=>{
      if(p.empresa_id && porId.has(p.empresa_id) && !p._empresaNome){ p._empresaNome = porId.get(p.empresa_id); mudou = true; }
    });
    if(mudou) _cadRenderTabelaPessoas();
  }catch(e){ /* silencioso — só um enriquecimento visual */ }
}

// ── MODAL DE PESSOA (novo/editar) ────────────────────────────────
function _cpAtualizarCamposTipo(){
  const tipo = document.getElementById('cp_tipo').value;
  document.getElementById('cp_empresa_wrap').style.display = tipo === 'FUNCIONARIO' ? 'none' : '';
  document.getElementById('cp_usuario_wrap').style.display = tipo === 'FUNCIONARIO' ? '' : 'none';
  if(tipo === 'FUNCIONARIO') _cpCarregarUsuariosLogin();
}

async function _cpCarregarUsuariosLogin(){
  const sel = document.getElementById('cp_usuario_vinculado');
  if(!sel) return;
  if(!_cadUsuariosLoginCache){
    try{
      const r = await fetch('/api/cadastros/usuarios-login');
      const d = await r.json();
      _cadUsuariosLoginCache = d.ok ? d.usuarios : [];
    }catch(e){ _cadUsuariosLoginCache = []; }
  }
  const valorAtual = sel.value;
  sel.innerHTML = '<option value="">— nenhum —</option>' +
    _cadUsuariosLoginCache.map(u=>`<option value="${esc(u.usuario)}">${esc(u.nome)} (${esc(u.usuario)})</option>`).join('');
  sel.value = valorAtual;
}

// Autocomplete simples de empresa dentro do modal de Pessoa — parecido
// com autocompletarContato() (controle-contatos.js), mas precisa também
// capturar o ID da empresa escolhida (não só o nome), por isso é uma
// versão própria em vez de reaproveitar a genérica.
let _cpAcTimer = null;
async function _cpAutocompleteEmpresa(input){
  clearTimeout(_cpAcTimer);
  document.getElementById('cp_empresa_id').value = '';
  const q = input.value.trim();
  const dd = document.getElementById('cp-empresa-dropdown');
  if(q.length < 2){ dd.style.display='none'; return; }
  _cpAcTimer = setTimeout(async ()=>{
    try{
      const r = await fetch('/api/contatos?q='+encodeURIComponent(q)+'&limit=15');
      const d = await r.json();
      if(!d.ok || !d.contatos.length){ dd.style.display='none'; return; }
      dd.innerHTML = d.contatos.map(c=>`<div data-id="${c.id}" data-nome="${esc(c.razao_social)}"
        onclick="_cpSelecionarEmpresa(${jsArg(c.id)},${jsArg(c.razao_social)})"
        style="padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border2);"
        onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">${esc(c.razao_social)}${c.tipo?' · '+esc(c.tipo):''}</div>`).join('');
      dd.style.display = 'block';
    }catch(e){ dd.style.display='none'; }
  }, 300);
}
function _cpSelecionarEmpresa(id, nome){
  document.getElementById('cp_empresa_id').value = id;
  document.getElementById('cp_empresa_nome').value = nome;
  document.getElementById('cp-empresa-dropdown').style.display = 'none';
}
document.addEventListener('click', e=>{
  const dd = document.getElementById('cp-empresa-dropdown');
  if(dd && !dd.contains(e.target) && e.target.id !== 'cp_empresa_nome') dd.style.display = 'none';
});

function abrirNovaPessoa(tipoDefault){
  document.getElementById('pessoa-edit-title').textContent = tipoDefault === 'FUNCIONARIO' ? 'Novo Funcionário' : 'Nova Pessoa';
  ['cp_id','cp_nome','cp_cargo','cp_aniversario','cp_empresa_nome','cp_empresa_id','cp_cpf','cp_telefone','cp_whatsapp','cp_email','cp_obs'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('cp_principal').checked = false;
  document.querySelectorAll('.cp-papel').forEach(cb=>{ cb.checked = false; });
  document.getElementById('cp_tipo').value = tipoDefault || 'CONTATO';
  _cpAtualizarCamposTipo();
  document.getElementById('modal-pessoa-edit-bg').classList.add('open');
  _cpPessoaDirty = false;
  // Chamado a partir da aba "Pessoas" da tela de Cadastros (fluxo normal,
  // não o atalho de dentro do modal de Empresa — ver _ceNovaPessoa em
  // controle-contatos.js, que seta essa flag depois de chamar esta função).
  _ceModalPessoaOrigem = null;
}

async function editarPessoa(id){
  const p = _cadPessoasLista.find(x=>x.id===id);
  if(!p) return;
  _ceModalPessoaOrigem = null; // fluxo normal (aba Pessoas), não o modal de Empresa
  document.getElementById('pessoa-edit-title').textContent = 'Editar Pessoa';
  document.getElementById('cp_id').value = p.id;
  document.getElementById('cp_tipo').value = p.tipo || 'CONTATO';
  document.getElementById('cp_nome').value = p.nome || '';
  document.getElementById('cp_cargo').value = p.cargo || '';
  document.getElementById('cp_aniversario').value = p.aniversario || '';
  document.getElementById('cp_empresa_id').value = p.empresa_id || '';
  document.getElementById('cp_empresa_nome').value = p._empresaNome || '';
  document.getElementById('cp_cpf').value = p.cpf || '';
  document.getElementById('cp_telefone').value = p.telefone || '';
  document.getElementById('cp_whatsapp').value = p.whatsapp || '';
  document.getElementById('cp_email').value = p.email || '';
  document.getElementById('cp_obs').value = p.obs || '';
  document.getElementById('cp_principal').checked = !!p.principal;
  const papeisAtuais = p.papeis || [];
  document.querySelectorAll('.cp-papel').forEach(cb=>{ cb.checked = papeisAtuais.includes(cb.value); });
  _cpAtualizarCamposTipo();
  if(p.usuario_vinculado){
    await _cpCarregarUsuariosLogin();
    document.getElementById('cp_usuario_vinculado').value = p.usuario_vinculado;
  }
  document.getElementById('modal-pessoa-edit-bg').classList.add('open');
  _cpPessoaDirty = false;
}

function fecharModalPessoaEdit(){
  document.getElementById('modal-pessoa-edit-bg').classList.remove('open');
}

async function salvarPessoa(){
  const nome = document.getElementById('cp_nome').value.trim();
  if(!nome){ showToast('Nome é obrigatório', 'err'); return; }
  const tipo = document.getElementById('cp_tipo').value;
  const payload = {
    id: document.getElementById('cp_id').value || undefined,
    tipo,
    nome,
    cargo: document.getElementById('cp_cargo').value.trim(),
    aniversario: document.getElementById('cp_aniversario').value || null,
    empresa_id: tipo !== 'FUNCIONARIO' ? (document.getElementById('cp_empresa_id').value || null) : null,
    usuario_vinculado: tipo === 'FUNCIONARIO' ? (document.getElementById('cp_usuario_vinculado').value || null) : null,
    cpf: document.getElementById('cp_cpf').value.replace(/\D/g,''),
    telefone: document.getElementById('cp_telefone').value.trim(),
    whatsapp: document.getElementById('cp_whatsapp').value.trim(),
    email: document.getElementById('cp_email').value.trim(),
    principal: document.getElementById('cp_principal').checked,
    papeis: [...document.querySelectorAll('.cp-papel:checked')].map(cb=>cb.value),
    obs: document.getElementById('cp_obs').value.trim(),
  };
  try{
    const r = await fetch('/api/cadastros/pessoas', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const d = await r.json();
    if(d.ok){
      _cpPessoaDirty = false;
      showToast('✓ Cadastro salvo', 'ok');
      fecharModalPessoaEdit();
      if(_ceModalPessoaOrigem === 'contato-edit'){
        // Veio do atalho "+ Adicionar pessoa" dentro do modal de Empresa
        // (ver _ceNovaPessoa/_ceEditarPessoa em controle-contatos.js) —
        // recarrega a lista embutida ali, não a tabela da aba Pessoas.
        await _ceCarregarPessoas(document.getElementById('ce_id').value);
        _ceModalPessoaOrigem = null;
      } else {
        await _cadRenderPessoas(_cadAba === 'funcionarios' ? 'FUNCIONARIO' : 'CONTATO');
      }
    } else {
      showToast('Erro: '+(d.erro||''), 'err');
    }
  }catch(e){ showToast('Erro ao salvar', 'err'); }
}

async function excluirPessoa(id){
  if(!confirm('Excluir este cadastro?')) return;
  try{
    const r = await fetch('/api/cadastros/pessoas/'+id, { method: 'DELETE' });
    const d = await r.json();
    if(d.ok){ showToast('Removido', 'ok'); await _cadRenderPessoas(_cadAba === 'funcionarios' ? 'FUNCIONARIO' : 'CONTATO'); }
    else showToast('Erro ao excluir', 'err');
  }catch(e){ showToast('Erro ao excluir', 'err'); }
}
