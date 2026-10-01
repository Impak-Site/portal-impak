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
// ── Campos de empresa no processo: seleção do cadastro + "cadastrar" ──
// Cadastros fase 1c (01/10/2026): armador, agente, despachante,
// transportadora, armazém e depot deixam de ser texto livre "de fato": o
// campo abre a lista do cadastro já no foco (sem precisar digitar), o nome
// que vai pro processo é o canônico (nome fantasia pra armador/despachante/
// armazém/depot — ex. "PIL", "FIND COMEX" —, razão social pros demais,
// mesma regra do servidor em lib/cadastros-normalizar.js), e quando o que
// foi digitado não existe aparece "+ Cadastrar" que abre o modal de Empresa
// já preenchido e devolve o nome pro campo. Um aviso "⚠ não cadastrado"
// fica ao lado do rótulo enquanto o valor não bate com nenhum cadastro.
const PAPEIS_NOME_CURTO_CLIENTE = ['ARMADOR','DESPACHANTE','ARMAZEM_ALFANDEGADO','PORTO_ARMAZEM','DEPOT_DEVOLUCAO'];
const TIPOS_EMPRESA_LABEL = { CLIENTE:'Cliente', FORNECEDOR:'Fornecedor', EXPORTADOR:'Exportador', DESPACHANTE:'Despachante', AGENTE:'Agente de Carga', ARMADOR:'Armador', TRANSPORTADORA:'Transportadora', ARMAZEM_ALFANDEGADO:'Armazém', PORTO_ARMAZEM:'Porto/Armazém', DEPOT_DEVOLUCAO:'Depot' };
function papelPrincipalDe(tipo){ return String(tipo||'').split(',')[0].trim().toUpperCase(); }
function nomeContatoParaCampo(c, tipo){
  const papel = papelPrincipalDe(tipo);
  if(PAPEIS_NOME_CURTO_CLIENTE.includes(papel) && c.nome_fantasia && String(c.nome_fantasia).trim()) return String(c.nome_fantasia).trim();
  return c.razao_social || c.nome_fantasia || '';
}
// Mesma "chave" do servidor (sem acento, maiúsculas, só letras/números).
function chaveCadastro(t){ return String(t==null?'':t).normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim(); }
function contatoBateComValor(c, valor){
  const k = chaveCadastro(valor); if(!k) return false;
  return [c.razao_social, c.nome_fantasia].concat(Array.isArray(c.sinonimos)?c.sinonimos:[]).some(g => chaveCadastro(g) === k);
}
async function buscarContatos(q, tipo, limit){
  const r = await fetch('/api/contatos?q='+encodeURIComponent(q||'')+'&tipo='+encodeURIComponent(tipo||'')+'&limit='+(limit||15));
  const d = await r.json();
  return d.ok ? (d.contatos||[]) : [];
}
// ── Regras por cadastro (regras_json, migration 0042) ──
// Pedido Emanuelly 01/10/2026: na proforma da Tyre Export, Inc. a referência
// do processo é o campo "Number PO" (ex.: BR26R124) — e isso deve valer
// "sempre que for ele". A regra fica no cadastro do fornecedor (campo
// "Referência do processo ao ler PI/CI" no modal de Empresa), não no código,
// pra outros exportadores entrarem sem nova versão.
function regrasDoCadastro(c){
  const r = c && c.regras_json;
  if(!r) return {};
  if(typeof r === 'string'){ try{ return JSON.parse(r) || {}; }catch(e){ return {}; } }
  return (typeof r === 'object' && !Array.isArray(r)) ? r : {};
}
// Dado o JSON extraído pela IA e as regras do fornecedor, devolve a
// referência que a regra manda usar — ou '' quando não há regra/valor.
function referenciaPelaRegraDoFornecedor(extracted, regras){
  const origem = String((regras||{}).referencia_origem || '').toUpperCase();
  const campo = { PO:'po_numero', PI:'pi_numero', CI:'ci_numero' }[origem];
  if(!campo || !extracted) return '';
  return String(extracted[campo] || '').trim();
}
// Acha o cadastro de fornecedor/exportador que bate com o nome (razão
// social, nome fantasia ou sinônimo) — busca no servidor, compara com a
// mesma chave normalizada do autocomplete. null quando não bate ou é ambíguo.
async function acharCadastroFornecedor(nome){
  const n = String(nome||'').trim();
  if(n.length < 2) return null;
  let lista = [];
  try{ lista = await buscarContatos(n, 'FORNECEDOR,EXPORTADOR', 20); }catch(e){ return null; }
  const exatos = lista.filter(c => contatoBateComValor(c, n));
  if(exatos.length === 1) return exatos[0];
  if(exatos.length > 1) return null;
  // Sem batida exata: aceita quando a busca devolveu um único cadastro e o
  // nome digitado está contido nele (ex.: "Tyre Export" x "Tyre Export, Inc.").
  if(lista.length === 1){
    const k = chaveCadastro(n);
    const alvo = [lista[0].razao_social, lista[0].nome_fantasia].map(chaveCadastro);
    if(alvo.some(a => a && (a.includes(k) || k.includes(a)))) return lista[0];
  }
  return null;
}
// onSelect (opcional): callback(nomeCompleto) chamado quando o usuário clica
// numa sugestão do dropdown. Necessário pra campos cujo valor não é lido
// direto do DOM no momento de salvar, e sim espelhado numa variável JS a
// cada tecla (ex.: _vendas[vi].cliente, na aba Vendas) — sem isso, clicar
// numa sugestão só atualizava o texto visível do input, e o array que
// realmente é salvo ficava com o texto parcial digitado antes de escolher.
// Com texto vazio (foco no campo) lista os primeiros cadastros do tipo.
async function autocompletarContato(input, tipo, dropdownId, onSelect){
  clearTimeout(_acTimer);
  const q = input.value.trim();
  const dd = document.getElementById(dropdownId);
  if(!dd) return;
  if(q.length === 1){ dd.style.display='none'; return; }
  _acTimer = setTimeout(async ()=>{
    try{
      const contatos = await buscarContatos(q, tipo, q ? 15 : 12);
      // Se o usuário continuou digitando enquanto a busca rodava, ignora esta resposta.
      if(input.value.trim() !== q) return;
      const papel = papelPrincipalDe(tipo);
      const temMatch = contatos.some(c => contatoBateComValor(c, q));
      let html = contatos.map(c=>{
        const nomeCampo = nomeContatoParaCampo(c, tipo);
        const extra = [];
        if(c.razao_social && c.razao_social !== nomeCampo) extra.push(esc(c.razao_social));
        else if(c.nome_fantasia && c.nome_fantasia !== nomeCampo) extra.push(esc(c.nome_fantasia));
        if(c.uf) extra.push(esc(c.uf));
        if(c.cnpj) extra.push(esc(c.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5')));
        return `<div data-nome="${esc(nomeCampo)}" onclick="_acSelecionar(${jsArg(input.id)},${jsArg(dropdownId)},this.dataset.nome,${onSelect?'window._acCallback':'null'})"
          style="padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border2);"
          onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''"><b style="font-weight:600;">${esc(nomeCampo)}</b>${extra.length?' <span style="color:var(--muted);">· '+extra.join(' · ')+'</span>':''}</div>`;
      }).join('');
      if(q.length >= 2 && !temMatch && TIPOS_EMPRESA_LABEL[papel]){
        html += `<div onclick="cadastrarContatoRapido(${jsArg(tipo)},${jsArg(q)},${jsArg(input.id)},${jsArg(dropdownId)},${onSelect?'window._acCallback':'null'})"
          style="padding:8px 12px;font-size:12px;cursor:pointer;color:var(--ac);font-weight:600;background:rgba(26,127,212,.04);"
          onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='rgba(26,127,212,.04)'">+ Cadastrar “${esc(q)}” como ${esc(TIPOS_EMPRESA_LABEL[papel])}</div>`;
      }
      if(!html){ dd.style.display='none'; return; }
      dd.innerHTML = html;
      window._acCallback = onSelect || null;
      dd.style.display='block';
    }catch(e){ dd.style.display='none'; }
  }, q ? 300 : 80);
}
// "+ Cadastrar" do dropdown: abre o modal de Empresa (o mesmo de /cadastros,
// que também existe na página do Controle) com o tipo e o nome já
// preenchidos; ao salvar, o nome canônico volta pro campo que originou.
let _ceAposSalvar = null;
function cadastrarContatoRapido(tipo, texto, inputId, dropdownId, callback){
  const papel = papelPrincipalDe(tipo);
  const dd = document.getElementById(dropdownId); if(dd) dd.style.display='none';
  if(typeof abrirNovoContato !== 'function' || !document.getElementById('modal-contato-edit-bg')){
    showToast('O cadastro de empresas não está disponível nesta tela — use a tela Cadastros.', 'warn'); return;
  }
  _contatosTipoAtivo = papel;
  abrirNovoContato();
  const rs = document.getElementById('ce_razao_social'); if(rs) rs.value = texto;
  const nf = document.getElementById('ce_nome_fantasia'); if(nf && PAPEIS_NOME_CURTO_CLIENTE.includes(papel)) nf.value = texto;
  _ceAposSalvar = function(contato){
    const el = document.getElementById(inputId);
    if(!el) return;
    const nome = nomeContatoParaCampo(contato, papel);
    el.value = nome;
    if(typeof callback === 'function') callback(nome);
    el.dispatchEvent(new Event('change', {bubbles:true}));
  };
  if(rs) rs.focus();
}
// Aviso "⚠ não cadastrado" ao lado do rótulo do campo (badgeId), com atalho
// pra cadastrar. Chamado no change do campo e logo depois de abrir o painel.
const _verificaCadastroCache = new Map();
async function verificarCadastroCampo(input, tipo, badgeId){
  const badge = document.getElementById(badgeId);
  if(!badge) return;
  const valor = (input.value||'').trim();
  if(!valor){ badge.style.display='none'; return; }
  const chave = tipo+'|'+chaveCadastro(valor);
  let ok = _verificaCadastroCache.get(chave);
  if(ok === undefined){
    try{ ok = (await buscarContatos(valor, tipo, 20)).some(c => contatoBateComValor(c, valor)); }
    catch(e){ return; } // sem rede: não acusa nada
    _verificaCadastroCache.set(chave, ok);
  }
  if((input.value||'').trim() !== valor) return; // mudou enquanto buscava
  if(ok){ badge.style.display='none'; return; }
  const papel = papelPrincipalDe(tipo);
  badge.innerHTML = `⚠ não cadastrado <a href="#" onclick="event.preventDefault();cadastrarContatoRapido(${jsArg(tipo)},${jsArg(valor)},${jsArg(input.id)},${jsArg(input.id.replace(/^f_/,'')+'-dropdown')},null)" style="color:var(--ac);font-weight:600;">cadastrar</a>`;
  badge.title = 'Esse nome não bate com nenhum cadastro de ' + (TIPOS_EMPRESA_LABEL[papel]||papel) + ' — cadastre pra padronizar (o sistema troca pelo nome do cadastro ao salvar).';
  badge.style.display = 'inline';
}
// Roda a verificação nos campos de empresa do painel que já têm valor
// (chamado no fim de renderModal, quando os inputs existem no DOM).
function verificarCadastrosDoPainel(){
  document.querySelectorAll('#modal-bg input[data-cadastro-tipo]').forEach(el=>{
    if(el.value && el.value.trim()) verificarCadastroCampo(el, el.dataset.cadastroTipo, el.id + '_warn');
    else { const b = document.getElementById(el.id + '_warn'); if(b) b.style.display='none'; }
  });
}
// Autocomplete client-side pra campos de texto livre que se repetem entre
// processos (Armazém, Depot) -- sem cadastro próprio, então as sugestões
// vêm dos valores já usados nos processos carregados (_processos), não do
// servidor. Filtra por substring (não só prefixo) pra achar mais rápido.
function autocompletarValorLocal(input, campo, dropdownId){
  const dd = document.getElementById(dropdownId);
  if(!dd) return;
  const q = input.value.trim().toLowerCase();
  if(q.length < 1){ dd.style.display='none'; return; }
  const vistos = new Set();
  const sugestoes = [];
  (typeof _processos !== 'undefined' ? _processos : []).forEach(p=>{
    const v = (p[campo]||'').trim();
    if(!v) return;
    const chave = v.toLowerCase();
    if(chave === q || vistos.has(chave)) return;
    if(!chave.includes(q)) return;
    vistos.add(chave);
    sugestoes.push(v);
  });
  if(!sugestoes.length){ dd.style.display='none'; return; }
  sugestoes.sort((a,b)=>a.localeCompare(b,'pt-BR'));
  dd.innerHTML = sugestoes.slice(0,8).map(v=>
    `<div data-nome="${esc(v)}" onclick="_acSelecionar(${jsArg(input.id)},${jsArg(dropdownId)},this.dataset.nome,null)"
      style="padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border2);"
      onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">${esc(v)}</div>`
  ).join('');
  dd.style.display='block';
}
function _acSelecionar(inputId, dropdownId, nome, callback){
  const el = document.getElementById(inputId);
  if(el) el.value = nome;
  const dd = document.getElementById(dropdownId);
  if(dd) dd.style.display = 'none';
  if(typeof callback === 'function') callback(nome);
  // 'change' (não 'input', que reabriria o dropdown): marca o painel como
  // alterado e dispara o onchange do campo (aviso de cadastro, etc.).
  if(el) el.dispatchEvent(new Event('change', {bubbles:true}));
}
document.addEventListener('click', e=>{
  ['cliente-dropdown','fornecedor-dropdown','armador-dropdown','agente-dropdown','despachante-dropdown','transportadora-dropdown','consignatario-dropdown','notify-dropdown','armazem-dropdown','depot-dropdown'].forEach(id=>{
    const dd = document.getElementById(id);
    if(dd && !dd.contains(e.target) && e.target.id!=='f_'+id.replace('-dropdown','')) dd.style.display='none';
  });
});

// ════════════════════════════════════════════════════════════════
// CADASTRO DE CONTATOS (Clientes, Fornecedores, Despachantes, Agentes)
// ════════════════════════════════════════════════════════════════
let _contatosTipoAtivo = 'CLIENTE';
let _contatosLista = [];

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
    // FORNECEDOR e EXPORTADOR foram unificados (fase 2a) — a lista de
    // fornecedores mostra os dois enquanto houver cadastro antigo EXPORTADOR.
    const tipoBusca = _contatosTipoAtivo === 'FORNECEDOR' ? 'FORNECEDOR,EXPORTADOR' : _contatosTipoAtivo;
    const r = await fetch('/api/contatos?tipo='+encodeURIComponent(tipoBusca)+'&limit=500');
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
    (c.documento||c.cnpj||'').includes(q) ||
    (c.nome_fantasia||'').toLowerCase().includes(q) ||
    (Array.isArray(c.sinonimos) && c.sinonimos.some(s=>String(s||'').toLowerCase().includes(q)))
  );
  if(!lista.length){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--dim);font-size:13px;">Nenhum contato cadastrado neste tipo.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(c=>{
    const doc = c.documento || c.cnpj || '';
    const cnpjFmt = doc
      ? (c.tipo_pessoa==='FISICA' ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4') : doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'))
      : '—';
    // Papéis extras além do tipo que está sendo filtrado (cadastros fase 1b)
    const extras = (Array.isArray(c.papeis) ? c.papeis : []).filter(pp => pp && pp !== _contatosTipoAtivo);
    const badges = extras.map(pp => `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;background:var(--bg);border:1px solid var(--border);font-size:10px;color:var(--muted);font-weight:500;" title="Também cadastrada como ${esc(PAPEIS_EMPRESA[pp]||pp)}">${esc(PAPEIS_EMPRESA[pp]||pp)}</span>`).join('');
    const fantasia = c.nome_fantasia && c.nome_fantasia !== c.razao_social ? `<div style="font-size:11px;color:var(--muted);font-weight:400;">${esc(c.nome_fantasia)}</div>` : '';
    return `<tr style="border-bottom:1px solid var(--border);cursor:pointer;" onclick="editarContato('${c.id}')" title="Clique para abrir">
      <td style="padding:9px 16px;font-weight:600;">${esc(c.razao_social)}${badges}${fantasia}</td>
      <td style="padding:9px 16px;font-family:'DM Mono',monospace;font-size:11px;">${cnpjFmt}</td>
      <td style="padding:9px 16px;">${esc(c.cidade||'')}${c.uf?'/'+c.uf:''}</td>
      <td style="padding:9px 16px;font-size:11px;color:var(--muted);">${esc(c.email||c.telefone||'—')}</td>
      <td style="padding:9px 16px;text-align:right;">
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();editarContato('${c.id}')">Editar</button>
        <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);background:none;" onclick="event.stopPropagation();excluirContato('${c.id}')">Excluir</button>
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

// Formata CPF (000.000.000-00), pra pessoa física.
function formatarCpfInput(input){
  let v = input.value.replace(/\D/g,'').slice(0,11);
  if(v.length > 9) v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
  else if(v.length > 6) v = v.replace(/^(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
  else if(v.length > 3) v = v.replace(/^(\d{3})(\d{0,3})/, '$1.$2');
  input.value = v;
}

// O campo "Documento" muda de máscara/comportamento conforme Tipo de
// Pessoa + País: Jurídica+Brasil = CNPJ (com busca automática na Receita),
// Física+Brasil = CPF (só máscara, sem busca pública), qualquer coisa do
// exterior = texto livre, sem máscara nem regra (ainda não há uma fonte
// pública única de documento por país pra automatizar isso).
function _ceAtualizarCamposDocumento(){
  const tipoPessoa = document.getElementById('ce_tipo_pessoa').value;
  const pais = (document.getElementById('ce_pais').value||'').trim().toLowerCase();
  const label = document.getElementById('ce_documento_label');
  const isBrasil = pais === 'brasil' || pais === '';
  if(!isBrasil){ label.textContent = 'Documento'; return; }
  label.textContent = tipoPessoa === 'FISICA' ? 'CPF' : 'CNPJ';
}
function _ceFormatarDocumento(input){
  const tipoPessoa = document.getElementById('ce_tipo_pessoa').value;
  const pais = (document.getElementById('ce_pais').value||'').trim().toLowerCase();
  const isBrasil = pais === 'brasil' || pais === '';
  if(!isBrasil) return; // exterior: sem máscara, digita livre
  if(tipoPessoa === 'FISICA') formatarCpfInput(input);
  else formatarCnpjInput(input);
}
function _ceBuscarCnpjSeAplicavel(valor){
  const tipoPessoa = document.getElementById('ce_tipo_pessoa').value;
  const pais = (document.getElementById('ce_pais').value||'').trim().toLowerCase();
  const isBrasil = pais === 'brasil' || pais === '';
  if(isBrasil && tipoPessoa === 'JURIDICA') buscarDadosCnpj(valor);
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
    const logradouroEl = document.getElementById('ce_logradouro');
    const numeroEl = document.getElementById('ce_numero');
    const complementoEl = document.getElementById('ce_complemento');
    const bairroEl = document.getElementById('ce_bairro');
    const cepEl = document.getElementById('ce_cep');
    // Só preenche campos vazios, não sobrescreve o que o usuário já digitou
    if(razaoEl && !razaoEl.value) razaoEl.value = d.razao_social || '';
    if(fantasiaEl && !fantasiaEl.value) fantasiaEl.value = d.nome_fantasia || '';
    if(cidadeEl && !cidadeEl.value) cidadeEl.value = d.municipio || '';
    if(ufEl && !ufEl.value) ufEl.value = d.uf || '';
    if(emailEl && !emailEl.value && d.email) emailEl.value = d.email || '';
    if(telEl && !telEl.value && d.ddd_telefone_1) telEl.value = d.ddd_telefone_1 || '';
    if(logradouroEl && !logradouroEl.value) logradouroEl.value = d.logradouro || '';
    if(numeroEl && !numeroEl.value) numeroEl.value = d.numero || '';
    if(complementoEl && !complementoEl.value) complementoEl.value = d.complemento || '';
    if(bairroEl && !bairroEl.value) bairroEl.value = d.bairro || '';
    if(cepEl && !cepEl.value) cepEl.value = d.cep || '';
    if(statusEl){
      const situacao = d.descricao_situacao_cadastral || '';
      statusEl.textContent = '✓ Dados preenchidos automaticamente'+(situacao?' · Situação: '+situacao:'');
      statusEl.style.color = situacao==='ATIVA' ? 'var(--ok)' : 'var(--warn)';
    }
  }catch(e){
    if(statusEl){ statusEl.textContent = 'Erro ao consultar CNPJ — preencha manualmente'; statusEl.style.color = 'var(--err)'; }
  }
}

// Papéis possíveis de uma empresa (mesma lista de TIPOS_EMPRESA no server).
// Cadastros fase 1b (01/10/2026): uma empresa pode ter vários papéis — o
// tipo principal (select) sempre fica marcado; os demais são checkboxes.
const PAPEIS_EMPRESA = {
  CLIENTE:'Cliente', FORNECEDOR:'Fornecedor (exportador)', DESPACHANTE:'Despachante',
  AGENTE:'Agente de Carga', ARMADOR:'Armador', TRANSPORTADORA:'Transportadora',
  ARMAZEM_ALFANDEGADO:'Armazém Alfandegado', PORTO_ARMAZEM:'Porto/Armazém', DEPOT_DEVOLUCAO:'Depot Devolução',
};
function _ceRenderPapeis(marcados){
  const wrap = document.getElementById('ce_papeis');
  if(!wrap) return;
  const set = new Set((marcados||[]).map(x=>String(x).toUpperCase()==='EXPORTADOR' ? 'FORNECEDOR' : String(x).toUpperCase()));
  wrap.innerHTML = Object.keys(PAPEIS_EMPRESA).map(k=>
    `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;"><input type="checkbox" data-papel="${k}" ${set.has(k)?'checked':''} onchange="_ceContatoDirty=true"> ${esc(PAPEIS_EMPRESA[k])}</label>`
  ).join('');
  _ceSincronizarPapeis();
}
// O tipo principal sempre fica marcado (e travado) entre os papéis.
function _ceSincronizarPapeis(){
  const tipo = document.getElementById('ce_tipo')?.value;
  document.querySelectorAll('#ce_papeis input[type=checkbox]').forEach(cb=>{
    const ehPrincipal = cb.dataset.papel === tipo;
    if(ehPrincipal) cb.checked = true;
    cb.disabled = ehPrincipal;
  });
}
function _cePapeisMarcados(){
  return Array.from(document.querySelectorAll('#ce_papeis input[type=checkbox]:checked')).map(cb=>cb.dataset.papel);
}
// Sinônimos: textarea com uma grafia por linha (ou separadas por ;).
function _ceSinonimosLidos(){
  const t = document.getElementById('ce_sinonimos')?.value || '';
  const vistos = new Set();
  return t.split(/[\n;]+/).map(x=>x.trim()).filter(x=>{ if(!x||vistos.has(x.toUpperCase())) return false; vistos.add(x.toUpperCase()); return true; });
}

function abrirNovoContato(){
  document.getElementById('contato-edit-title').textContent = 'Novo Contato';
  ['ce_id','ce_razao_social','ce_nome_fantasia','ce_documento','ce_uf','ce_cidade','ce_email','ce_telefone','ce_obs',
   'ce_logradouro','ce_numero','ce_complemento','ce_bairro','ce_cep','ce_sinonimos','ce_ref_origem'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('ce_tipo').value = _contatosTipoAtivo;
  _ceRenderPapeis([_contatosTipoAtivo]);
  document.getElementById('ce_tipo_pessoa').value = 'JURIDICA';
  document.getElementById('ce_pais').value = 'Brasil';
  _ceAtualizarCamposDocumento();
  const statusEl = document.getElementById('ce_cnpj_status');
  if(statusEl) statusEl.textContent = '';
  // Empresa ainda não existe (sem ID) — não dá pra vincular pessoas a ela
  // ainda (ver payload.empresa_id em cadastros_pessoas), então some a
  // lista e mostra a dica "salve primeiro" (pedido Ayslan 14/09/2026).
  _cePessoasLista = [];
  const wrap = document.getElementById('ce-pessoas-wrap');
  const hint = document.getElementById('ce-pessoas-hint');
  if(wrap) wrap.style.display = 'none';
  if(hint) hint.style.display = '';
  document.getElementById('modal-contato-edit-bg').classList.add('open');
  _ceContatoDirty = false;
}

function editarContato(id){
  const c = _contatosLista.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('contato-edit-title').textContent = 'Editar Contato';
  document.getElementById('ce_id').value = c.id;
  // EXPORTADOR foi unificado em FORNECEDOR (fase 2a): cadastro antigo abre
  // como Fornecedor e é regravado assim ao salvar.
  const tipoTela = (c.tipo||'CLIENTE') === 'EXPORTADOR' ? 'FORNECEDOR' : (c.tipo||'CLIENTE');
  document.getElementById('ce_tipo').value = tipoTela;
  _ceRenderPapeis((Array.isArray(c.papeis) && c.papeis.length) ? c.papeis : [tipoTela]);
  const elSin = document.getElementById('ce_sinonimos');
  if(elSin) elSin.value = (Array.isArray(c.sinonimos) ? c.sinonimos : []).join('\n');
  const elRef = document.getElementById('ce_ref_origem');
  if(elRef) elRef.value = regrasDoCadastro(c).referencia_origem || '';
  document.getElementById('ce_tipo_pessoa').value = c.tipo_pessoa||'JURIDICA';
  document.getElementById('ce_pais').value = c.pais||'Brasil';
  document.getElementById('ce_razao_social').value = c.razao_social||'';
  document.getElementById('ce_nome_fantasia').value = c.nome_fantasia||'';
  document.getElementById('ce_documento').value = c.documento||c.cnpj||'';
  document.getElementById('ce_uf').value = c.uf||'';
  document.getElementById('ce_cidade').value = c.cidade||'';
  document.getElementById('ce_email').value = c.email||'';
  document.getElementById('ce_telefone').value = c.telefone||'';
  document.getElementById('ce_obs').value = c.obs||'';
  document.getElementById('ce_logradouro').value = c.logradouro||'';
  document.getElementById('ce_numero').value = c.numero||'';
  document.getElementById('ce_complemento').value = c.complemento||'';
  document.getElementById('ce_bairro').value = c.bairro||'';
  document.getElementById('ce_cep').value = c.cep||'';
  _ceAtualizarCamposDocumento();
  const statusEl = document.getElementById('ce_cnpj_status');
  if(statusEl) statusEl.textContent = '';
  const hint = document.getElementById('ce-pessoas-hint');
  if(hint) hint.style.display = 'none';
  document.getElementById('modal-contato-edit-bg').classList.add('open');
  _ceContatoDirty = false;
  _ceCarregarPessoas(c.id);
}

// ── PESSOAS DE CONTATO DA EMPRESA (dentro do próprio modal de Empresa) ──
// Pedido Ayslan (14/09/2026): "preciso conseguir colocar varias pessoas
// no contato, com email, telefone e tudo mais" — antes só dava pra
// vincular pessoas a uma empresa indo na aba "Pessoas" separada e
// buscando a empresa pelo autocomplete. Agora dá pra ver, adicionar,
// editar e excluir as pessoas direto no modal da própria empresa.
let _cePessoasLista = [];
// Marca de onde o modal de Pessoa foi aberto, pra salvarPessoa() (em
// controle-dash-cadastros.js) saber se deve recarregar a lista da aba
// "Pessoas" (fluxo normal) ou a lista embutida aqui no modal de Empresa.
let _ceModalPessoaOrigem = null;

async function _ceCarregarPessoas(empresaId){
  const wrap = document.getElementById('ce-pessoas-wrap');
  if(!wrap) return;
  if(!empresaId){ wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  try{
    const r = await fetch('/api/cadastros/pessoas?empresa_id='+encodeURIComponent(empresaId)+'&tipo=CONTATO&limit=200');
    const d = await r.json();
    _cePessoasLista = d.ok ? d.pessoas : [];
  }catch(e){ _cePessoasLista = []; }
  _ceRenderPessoasLista();
}

function _ceRenderPessoasLista(){
  const tbody = document.getElementById('ce-pessoas-tbody');
  if(!tbody) return;
  if(!_cePessoasLista.length){
    tbody.innerHTML = `<tr><td style="padding:10px;color:var(--dim);font-size:12px;text-align:center;">Nenhuma pessoa cadastrada ainda.</td></tr>`;
    return;
  }
  tbody.innerHTML = _cePessoasLista.map(p=>{
    const principalBadge = p.principal ? ' <span style="color:var(--ok);font-size:10px;font-weight:700;">★ principal</span>' : '';
    const papeisBadges = (typeof _cadRenderBadgesPapeis === 'function') ? _cadRenderBadgesPapeis(p.papeis) : '';
    const contatoInfo = [p.telefone, p.email].filter(Boolean).map(esc).join(' · ') || '—';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:7px 10px;font-weight:600;font-size:12px;">${esc(p.nome)}${principalBadge}${papeisBadges?'<div style="margin-top:4px;">'+papeisBadges+'</div>':''}</td>
      <td style="padding:7px 10px;font-size:12px;">${esc(p.cargo||'—')}</td>
      <td style="padding:7px 10px;font-size:11px;color:var(--muted);">${contatoInfo}</td>
      <td style="padding:7px 10px;text-align:right;white-space:nowrap;">
        <button class="btn btn-sm btn-outline" onclick="_ceEditarPessoa('${p.id}')">Editar</button>
        <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);background:none;" onclick="_ceExcluirPessoa('${p.id}')">×</button>
      </td>
    </tr>`;
  }).join('');
}

function _ceNovaPessoa(){
  const empresaId = document.getElementById('ce_id').value;
  const empresaNome = document.getElementById('ce_razao_social').value;
  if(!empresaId){ showToast('Salve a empresa antes de adicionar pessoas', 'warn'); return; }
  abrirNovaPessoa('CONTATO');
  document.getElementById('cp_empresa_id').value = empresaId;
  document.getElementById('cp_empresa_nome').value = empresaNome;
  _ceModalPessoaOrigem = 'contato-edit';
}

function _ceEditarPessoa(id){
  const p = _cePessoasLista.find(x=>x.id===id);
  if(!p) return;
  document.getElementById('pessoa-edit-title').textContent = 'Editar Pessoa';
  document.getElementById('cp_id').value = p.id;
  document.getElementById('cp_tipo').value = p.tipo || 'CONTATO';
  document.getElementById('cp_nome').value = p.nome || '';
  document.getElementById('cp_cargo').value = p.cargo || '';
  document.getElementById('cp_aniversario').value = p.aniversario || '';
  document.getElementById('cp_empresa_id').value = p.empresa_id || document.getElementById('ce_id').value || '';
  document.getElementById('cp_empresa_nome').value = document.getElementById('ce_razao_social').value || '';
  document.getElementById('cp_cpf').value = p.cpf || '';
  document.getElementById('cp_telefone').value = p.telefone || '';
  document.getElementById('cp_whatsapp').value = p.whatsapp || '';
  document.getElementById('cp_email').value = p.email || '';
  document.getElementById('cp_obs').value = p.obs || '';
  document.getElementById('cp_principal').checked = !!p.principal;
  const papeisAtuais = p.papeis || [];
  document.querySelectorAll('.cp-papel').forEach(cb=>{ cb.checked = papeisAtuais.includes(cb.value); });
  _cpAtualizarCamposTipo();
  document.getElementById('modal-pessoa-edit-bg').classList.add('open');
  _cpPessoaDirty = false;
  _ceModalPessoaOrigem = 'contato-edit';
}

async function _ceExcluirPessoa(id){
  if(!confirm('Excluir esta pessoa?')) return;
  try{
    const r = await fetch('/api/cadastros/pessoas/'+id, { method:'DELETE' });
    const d = await r.json();
    if(d.ok){ showToast('Removido', 'ok'); await _ceCarregarPessoas(document.getElementById('ce_id').value); }
    else showToast('Erro ao excluir', 'err');
  }catch(e){ showToast('Erro ao excluir', 'err'); }
}

function fecharModalContatoEdit(){
  document.getElementById('modal-contato-edit-bg').classList.remove('open');
  _ceAposSalvar = null;
}

async function salvarContato(){
  const razao = document.getElementById('ce_razao_social').value.trim();
  if(!razao){ showToast('Razão social é obrigatória','err'); return; }
  const tipoPessoa = document.getElementById('ce_tipo_pessoa').value;
  const pais = document.getElementById('ce_pais').value.trim() || 'Brasil';
  const documentoRaw = document.getElementById('ce_documento').value;
  const isBrasil = pais.toLowerCase() === 'brasil';
  const payload = {
    id: document.getElementById('ce_id').value || undefined,
    tipo: document.getElementById('ce_tipo').value,
    papeis: _cePapeisMarcados(),
    sinonimos: _ceSinonimosLidos(),
    regras_json: { referencia_origem: document.getElementById('ce_ref_origem')?.value || '' },
    tipo_pessoa: tipoPessoa,
    pais: pais,
    razao_social: razao,
    nome_fantasia: document.getElementById('ce_nome_fantasia').value.trim(),
    documento: isBrasil ? documentoRaw.replace(/\D/g,'') : documentoRaw.trim(),
    uf: document.getElementById('ce_uf').value.trim().toUpperCase(),
    cidade: document.getElementById('ce_cidade').value.trim(),
    email: document.getElementById('ce_email').value.trim(),
    telefone: document.getElementById('ce_telefone').value.trim(),
    obs: document.getElementById('ce_obs').value.trim(),
    logradouro: document.getElementById('ce_logradouro').value.trim(),
    numero: document.getElementById('ce_numero').value.trim(),
    complemento: document.getElementById('ce_complemento').value.trim(),
    bairro: document.getElementById('ce_bairro').value.trim(),
    cep: document.getElementById('ce_cep').value.trim(),
  };
  const eraNovo = !payload.id;
  try{
    const r = await fetch('/api/contatos', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if(d.ok){
      _ceContatoDirty = false;
      showToast('✓ Contato salvo','ok');
      if(d.aviso) showToast(d.aviso, 'warn');
      await carregarContatos();
      if(_ceAposSalvar){
        // Veio do "+ Cadastrar" de um campo do processo: devolve o nome pro
        // campo e fecha (as pessoas de contato ficam pra tela Cadastros).
        const cb = _ceAposSalvar; _ceAposSalvar = null;
        try{ cb(Object.assign({}, payload, { id: d.id || payload.id })); }catch(e){}
        _verificaCadastroCache.clear();
        fecharModalContatoEdit();
        return;
      }
      if(eraNovo && d.id){
        // Empresa acabou de ser criada agora — em vez de fechar o modal,
        // deixa ele aberto em modo "editar" e já revela a seção de
        // Pessoas, pra dar pra cadastrar os contatos dela na sequência
        // sem precisar reabrir (pedido Ayslan 14/09/2026).
        document.getElementById('ce_id').value = d.id;
        document.getElementById('contato-edit-title').textContent = 'Editar Contato';
        const hint = document.getElementById('ce-pessoas-hint');
        if(hint) hint.style.display = 'none';
        await _ceCarregarPessoas(d.id);
        showToast('✓ Agora já dá pra adicionar as pessoas de contato desta empresa', 'ok');
      } else {
        fecharModalContatoEdit();
      }
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

// ── ESC fecha Editar Contato / Editar Pessoa (pedido Ayslan, 14/09/2026) ──
// Mesmo padrão do painel do processo (ver _painelDirty em controle-core.js):
// marca "sujo" em qualquer input/change dentro do modal aberto, e ESC só
// pergunta se realmente houver algo não salvo — senão fecha direto. Os dois
// modais entram no mesmo listener porque o de Pessoa pode abrir por cima do
// de Contato (atalho "+ Adicionar pessoa"), então o ESC precisa fechar o de
// cima primeiro sem derrubar o de baixo junto.
let _ceContatoDirty = false;
let _cpPessoaDirty = false;

['input','change'].forEach(function(evt){
  document.addEventListener(evt, function(e){
    if(e.target.closest('#modal-pessoa-edit-bg')) _cpPessoaDirty = true;
    else if(e.target.closest('#modal-contato-edit-bg')) _ceContatoDirty = true;
  }, true);
});

document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  // Modal de item de lista (Cadastros → Listas): formulário curto, fecha direto.
  const listaBg = document.getElementById('modal-lista-edit-bg');
  if(listaBg && listaBg.classList.contains('open')){ fecharModalListaEdit(); return; }
  const pessoaBg = document.getElementById('modal-pessoa-edit-bg');
  if(pessoaBg && pessoaBg.classList.contains('open')){
    if(_cpPessoaDirty){
      if(confirm('Você tem alterações não salvas nesta pessoa. Deseja descartar e fechar?')) fecharModalPessoaEdit();
    } else {
      fecharModalPessoaEdit();
    }
    return;
  }
  const contatoBg = document.getElementById('modal-contato-edit-bg');
  if(contatoBg && contatoBg.classList.contains('open')){
    if(_ceContatoDirty){
      if(confirm('Você tem alterações não salvas neste contato. Deseja descartar e fechar?')) fecharModalContatoEdit();
    } else {
      fecharModalContatoEdit();
    }
  }
});

// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA EXCEL
// ════════════════════════════════════════════════════════════════
