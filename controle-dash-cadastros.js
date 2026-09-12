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

let _cadAba = 'empresas'; // 'empresas' | 'pessoas' | 'funcionarios'
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
  else _cadRenderPessoas('FUNCIONARIO');
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
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:9px 16px;font-weight:600;">${esc(p.nome)}${principalBadge}</td>
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
        onclick="_cpSelecionarEmpresa('${c.id}','${esc(c.razao_social).replace(/'/g,"\\'")}')"
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
  document.getElementById('cp_tipo').value = tipoDefault || 'CONTATO';
  _cpAtualizarCamposTipo();
  document.getElementById('modal-pessoa-edit-bg').classList.add('open');
}

async function editarPessoa(id){
  const p = _cadPessoasLista.find(x=>x.id===id);
  if(!p) return;
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
  _cpAtualizarCamposTipo();
  if(p.usuario_vinculado){
    await _cpCarregarUsuariosLogin();
    document.getElementById('cp_usuario_vinculado').value = p.usuario_vinculado;
  }
  document.getElementById('modal-pessoa-edit-bg').classList.add('open');
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
    obs: document.getElementById('cp_obs').value.trim(),
  };
  try{
    const r = await fetch('/api/cadastros/pessoas', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const d = await r.json();
    if(d.ok){
      showToast('✓ Cadastro salvo', 'ok');
      fecharModalPessoaEdit();
      await _cadRenderPessoas(_cadAba === 'funcionarios' ? 'FUNCIONARIO' : 'CONTATO');
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
