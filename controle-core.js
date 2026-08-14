// controle-core.js
// 
// Estado global, boot (login/DOMContentLoaded), cÃ¢mbio, CRUD de processos (API), cÃ¡lculo de fase/demurrage/fechamento, notificaÃ§Ãµes, filtros/stats e a renderizaÃ§Ã£o da lista principal.
//
// Parte do controle_v2.html, extraÃ­do do <script> Ãºnico original pra
// facilitar manutenÃ§Ã£o. Carregado via <script src> junto com os outros
// mÃ³dulos (ver controle_v2.html) â nÃ£o Ã© um ES module, entÃ£o todo
// estado (let/const de topo) e funÃ§Ãµes aqui continuam visÃ­veis pros
// outros arquivos, exatamente como estavam quando tudo era um sÃ³
// <script>. controle-core.js precisa carregar ANTES dos demais (Ã©
// quem declara o estado global: _processos, _user, FASES etc.).
//
// ââ SESSÃO EXPIRADA: mensagem clara em vez de erro de parse ââââââ
// Quando a sessÃ£o cai (ex.: reinÃ­cio do servidor), as rotas protegidas
// redirecionam pra /login (HTML) em vez de responder JSON. O cÃ³digo que
// chama fetch(...).then(r=>r.json()) entÃ£o quebra com um erro confuso tipo
// "Unexpected token '<' ... is not valid JSON". Este wrapper detecta esse
// redirecionamento e troca por uma mensagem que o usuÃ¡rio entende, usando os
// mesmos catch() que jÃ¡ existem em cada tela.
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(...args){
    const res = await _fetch(...args);
    if (res.redirected && res.url.startsWith(location.origin) && res.url.includes('/login')) {
      throw new Error('SessÃ£o expirada. Abra outra aba, faÃ§a login novamente e tente de novo (seus dados nÃ£o foram perdidos).');
    }
    return res;
  };
})();

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// UUID â compatÃ­vel com Safari, Chrome, Firefox
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function gerarUUID(){
  // Usar crypto.randomUUID se disponÃ­vel (Chrome, Firefox, Edge)
  if(typeof crypto !== 'undefined' && crypto.randomUUID){
    return crypto.randomUUID();
  }
  // Fallback para Safari e browsers mais antigos
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  // Ãltimo fallback: Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

// Analisa uma data "sem hora" (ex.: "2026-07-18", vinda de <input type=date>
// ou do banco) SEMPRE no fuso LOCAL do navegador, nunca em UTC.
// `new Date('2026-07-18')` (sem hora) Ã© interpretado pelo JS como meia-noite
// UTC â em fusos negativos (ex.: Brasil, UTC-3) isso exibe/compara como o
// dia ANTERIOR (17/07) em vez do dia certo. `new Date('2026-07-18T00:00:00')`
// (sem "Z") Ã© interpretado em horÃ¡rio LOCAL, entÃ£o bate com o que a pessoa
// realmente digitou. Antes deste helper, os dois estilos apareciam
// misturados neste arquivo (e em controle-dashboards.js/controle-export.js)
// pro MESMO tipo de campo â ex.: renderDemurInfo() lia data_chegada sem
// sufixo (UTC) enquanto calcularFase() lia o mesmo campo com sufixo (local),
// podendo mostrar dias diferentes pro mesmo processo em telas diferentes.
// Use esta funÃ§Ã£o pra qualquer campo de data-sÃ³ (data_chegada, eta,
// demurrage_vencimento, pi_data_saldo, nf_entrada_data, nf_saida_data etc.).
// Para timestamps completos (created_at/updated_at, que jÃ¡ vÃªm com hora e
// "Z" de toISOString()), continue usando new Date(...) direto â nÃ£o passar
// por aqui.
function parseDataLocal(str){
  return str ? new Date(str + 'T00:00:00') : null;
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// ESTADO
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
let _user = null;
let _processos = [];
let _faseFilter = '';
let _searchText = '';
let _pagina = 1;
const POR_PAGINA = 50;
let _editando = null; // processo sendo editado
// Snapshot do processo exatamente como veio do servidor quando o modal foi
// aberto (ou {} pra um processo novo) â usado sÃ³ pra saber quais campos o
// usuÃ¡rio de fato alterou nesta sessÃ£o de ediÃ§Ã£o (ver coletarESalvar). Nunca
// Ã© mutado depois de setado; existe sÃ³ pra comparaÃ§Ã£o, nÃ£o Ã© enviado ao
// servidor. ConcorrÃªncia: com vÃ¡rios usuÃ¡rios editando processos ao mesmo
// tempo, salvar o processo inteiro sempre que alguÃ©m clica em Salvar
// sobrescrevia silenciosamente qualquer campo que outra pessoa tivesse
// alterado nesse meio tempo (quem salvasse por Ãºltimo "vencia" em TUDO, nÃ£o
// sÃ³ no que de fato editou). Agora sÃ³ os campos realmente alterados nesta
// sessÃ£o sÃ£o enviados â os demais ficam intocados no banco.
let _editandoOriginal = null;
let _notifAberto = false;
let _cambio = { USD: 1, BRL: 1, EUR: 1 };

// ââ URL por processo (task #59) ââââââââââââââââââââââââââââââââââ
// _baseUrlPath Ã© a tela "de baixo" (/controle ou /financeiro) â pra onde
// a URL volta quando o painel lateral do processo fecha. Se a pÃ¡gina jÃ¡
// carregou num deep link (ex: /controle/UD26-005), guardamos a referÃªncia
// pedida em _refPendenteDeepLink pra abrir o painel assim que a lista de
// processos terminar de carregar (ver carregarProcessos).
const _pathPartsInicial = location.pathname.split('/').filter(Boolean);
let _baseUrlPath = '/' + (_pathPartsInicial[0] || 'controle');
let _refPendenteDeepLink = _pathPartsInicial[1] ? decodeURIComponent(_pathPartsInicial[1]) : null;

const FASES = [
  { id:'PI',                label:'PI Recebida',       icon:'ð' },
  { id:'AGUARDANDO_EMBARQUE',label:'Ag. Embarque',      icon:'â³' },
  { id:'EMBARCADO',          label:'Embarcado',          icon:'ð¢' },
  { id:'DESEMBARCADO',       label:'Desembarcado',       icon:'â' },
  { id:'REGISTRO_DI',        label:'Registro DI',        icon:'ð' },
  { id:'PARAMETRIZACAO',     label:'ParametrizaÃ§Ã£o',     icon:'ð' },
  { id:'CARREGAMENTO',       label:'Carregamento',       icon:'ð' },
  { id:'FATURAMENTO',        label:'Faturamento',        icon:'ð°' },
  { id:'DEVOLUCAO_VAZIO',    label:'Dev. Vazio',         icon:'ð¦' },
  { id:'FINALIZADO',         label:'Finalizado',         icon:'â' },
];

const FASE_LABEL = Object.fromEntries(FASES.map(f=>[f.id, f.label]));
const FASE_ICON  = Object.fromEntries(FASES.map(f=>[f.id, f.icon]));

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// INIT
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
window.addEventListener('DOMContentLoaded', function(){
  fetch('/api/me').then(r=>r.json()).then(d=>{
    if(!d.logado){ location.href='/login?destino='+encodeURIComponent(location.pathname); return; }
    _user = d;
    document.getElementById('user-badge').textContent = d.displayName || d.usuario;
    // Link do Dashboard NarcÃ©lio sÃ³ aparece pro prÃ³prio usuÃ¡rio narcelio â
    // cosmÃ©tico (a proteÃ§Ã£o real Ã© o back-end em GET /narcelio, ver
    // server.js), mas evita mostrar um link "quebrado" (403) pra quem nÃ£o
    // tem acesso.
    document.getElementById('menu-narcelio')?.style.setProperty('display', ['narcelio','suporte'].includes(d.usuario) ? '' : 'none');
// BotÃ£o "Gerar Follow-up Semanal" (task #327): sÃ³ visÃ­vel pra usuÃ¡rios
// gerente â mesma role jÃ¡ usada pelo back-end em POST /api/admin/
// followup-semanal (ver server.js), cosmÃ©tico aqui (a proteÃ§Ã£o real Ã©
// o back-end checar req.session.role==='gerente').
document.getElementById('btn-followup-semanal')?.style.setProperty('display', d.role==='gerente' ? '' : 'none');
    carregarCambio();
    carregarProcessos().then(()=>{
      if(location.pathname==='/financeiro') ativarTelaFinanceiroExclusiva();
      if(location.pathname==='/resultado') ativarTelaResultadoExclusiva();
      if(location.pathname==='/narcelio') ativarTelaNarcelioExclusiva();
      // Deep-link ?processo=<id> â usado pelo Calculador pra abrir direto o
      // processo recÃ©m-criado ao aprovar uma cotaÃ§Ã£o (ver aprovarCotacao()
      // em calculador.html). SÃ³ tenta abrir depois que a lista carregou,
      // senÃ£o abrirProcesso() nÃ£o acha o processo em _processos ainda.
      const idDeepLink = new URLSearchParams(location.search).get('processo');
      if(idDeepLink){
        const achou = _processos.some(p=>p.id===idDeepLink);
        if(achou) abrirProcesso(idDeepLink);
        else showToast('Processo recÃ©m-criado ainda nÃ£o apareceu na lista â atualize a pÃ¡gina em alguns segundos', 'err');
      }
    });
    renderFaseFilter();
    // Auto-refresh a cada 30s
    setInterval(function(){ if(!document.getElementById('modal-bg').classList.contains('open')) carregarProcessos(true); }, 30000);
  });
});

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// TELA EXCLUSIVA /financeiro â mesma pÃ¡gina (controle_v2.html) e mesmo
// JS do Controle normal, sÃ³ que ao carregar em /financeiro a tela jÃ¡ abre
// direto no Dashboard Financeiro, com o que Ã© sobre "lista de processos"
// (busca, filtros de fase, cards de status) escondido â foco sÃ³ no
// financeiro. A TABELA de processos continua existindo mais abaixo (nÃ£o Ã©
// removida do DOM), porque os cards e a lista de pagamentos do Dashboard
// Financeiro contam com ela pra "abrir o processo" ao clicar numa linha e
// pro drill-down dos filtros (Saldo a Pagar, ExposiÃ§Ã£o, Capital Parado)
// funcionar exatamente como jÃ¡ funciona dentro do Controle â reaproveitar
// em vez de duplicar essa lÃ³gica evita ter duas versÃµes de "abrir
// processo" pra manter sincronizadas.
function ativarTelaFinanceiroExclusiva(){
  document.title = 'IMPAK â Dashboard Financeiro';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Financeiro';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  // Sidebar: esconde "VisÃ£o" e "Por fase" (nÃ£o fazem sentido sem a busca/
  // lista principal em destaque) â mantÃ©m Dashboard Executivo e Cadastros.
  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-financeiro')?.classList.add('active');

  const dashFin = document.getElementById('dash-financeiro');
  if(dashFin) dashFin.style.display = 'block';
  renderDashFinanceiro();
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// TELA EXCLUSIVA /resultado â mesmo esquema do /financeiro acima: o
// Dashboard Resultado responde "quanto lucramos de verdade" cruzando o
// estimado na cotaÃ§Ã£o (estimativa_json, gravado ao aprovar no Calculador)
// com o resultado real de cada processo (calcularFechamento â NF SaÃ­da â
// Custo Real Total). Reaproveita _processos e calcularFechamento() em vez
// de duplicar essa lÃ³gica.
function ativarTelaResultadoExclusiva(){
  document.title = 'IMPAK â Dashboard Resultado';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Resultado';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-resultado')?.classList.add('active');

  const dashRes = document.getElementById('dash-resultado');
  if(dashRes) dashRes.style.display = 'block';
  renderDashResultado();
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// TRAVA DE PROCESSO ("Fechar Processo") â ver server.js (POST /api/
// controle/v2/processo) pra a validaÃ§Ã£o que de fato importa (o front-end
// aqui sÃ³ evita o usuÃ¡rio clicar sem querer; quem garante que ninguÃ©m
// edita um processo fechado Ã© o servidor).
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// TELA EXCLUSIVA /narcelio â visÃ£o do dono da empresa: containers por fase
// (PI recebida/previsÃ£o de embarque/embarcado/chegando), faturamento por
// perÃ­odo, estoque parado no armazÃ©m (NF entrada lanÃ§ada + NF saÃ­da com
// CFOP 5905 ou ainda nÃ£o emitida) e previsÃ£o de recurso de numerÃ¡rio
// (fluxo de caixa combinando pagamentos de PI com custos reais do
// processo). Acesso jÃ¡ Ã© restrito no back-end (ver /narcelio em
// server.js) â aqui Ã© sÃ³ a apresentaÃ§Ã£o.
function ativarTelaNarcelioExclusiva(){
  document.title = 'IMPAK â Dashboard NarcÃ©lio';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard NarcÃ©lio';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-narcelio')?.classList.add('active');

  const dashNarc = document.getElementById('dash-narcelio');
  if(dashNarc) dashNarc.style.display = 'block';
  const tw = document.querySelector('.table-wrap'); if(tw) tw.style.display = 'none';
  renderDashNarcelio();
}

async function fecharProcesso(id){
  if(!confirm('Fechar este processo? NF, Custos Reais e o resultado (lucro) ficam travados â sÃ³ um gerente pode reabrir depois.')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, fechado:true } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('ð Processo fechado','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao fechar: '+(d.erro||''),'err');
}

async function reabrirProcesso(id){
  if(!confirm('Reabrir este processo para ediÃ§Ã£o?')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, fechado:false } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('ð Processo reaberto','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao reabrir: '+(d.erro||''),'err');
}

// Dispara na hora o e-mail de follow-up semanal (task #327) â mesma rota
// usada pelo job automÃ¡tico de domingo (ver server.js,
// POST /api/admin/followup-semanal), sÃ³ que sob demanda. Restrito a
// gerente no back-end; o botÃ£o em si jÃ¡ fica escondido no boot (ver
// DOMContentLoaded acima) pra quem nÃ£o Ã© gerente.
async function gerarFollowUpManual(){
showToast('Gerando follow-up semanal...','info');
try{
const r = await fetch('/api/admin/followup-semanal', { method:'POST' });
const d = await r.json();
if(d.ok) showToast(`â Follow-up enviado (${d.processos} processo${d.processos===1?'':'s'})`,'ok');
else showToast('Erro ao gerar follow-up: '+(d.erro||''),'err');
}catch(e){ showToast('Erro de rede ao gerar follow-up: '+e.message,'err'); }
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// CÃMBIO
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function carregarCambio(){
  try{
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,CNY-BRL');
    const d = await r.json();
    // Valor bruto sem arredondar â DÃ³lar Comercial (bid da AwesomeAPI)
    _cambio.USD = parseFloat(d.USDBRL?.bid||5.2)||5.2;
    _cambio.EUR = parseFloat(d.EURBRL?.bid||5.7)||5.7;
    _cambio.CNY = parseFloat(d.CNYBRL?.bid||0.72)||0.72;
    const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const bar = document.getElementById('cambio-bar');
    if(bar) bar.innerHTML = [
      `USD R$ ${_cambio.USD.toFixed(4)}`,
      `EUR R$ ${_cambio.EUR.toFixed(4)}`,
      `CNY R$ ${_cambio.CNY.toFixed(4)}`,
    ].map(t=>`<span style="font-size:11px;font-family:'DM Mono',monospace;opacity:.8;background:rgba(255,255,255,.1);padding:2px 7px;border-radius:4px;" title="Atualizado ${hora}">${t}</span>`).join('');
  }catch(e){ console.warn('CÃ¢mbio erro:',e.message); }
  setTimeout(carregarCambio, 5*60*1000);
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// DADOS
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function carregarProcessos(silencioso){
  if(!silencioso) showToast('Carregando...','info');
  try{
    const r = await fetch('/api/controle/v2/processos');
    const d = await r.json();
    if(d.ok){
      _processos = d.processos || [];
      // Popular select de clientes
      const selCliente = document.getElementById('filtro-cliente');
      if(selCliente){
        const clientesUnicos = [...new Set(_processos.flatMap(p=>clientesDoProcesso(p)))].sort();
        const valAtual = selCliente.value;
        selCliente.innerHTML = '<option value="">ð¤ Todos os clientes</option>' +
          clientesUnicos.map(c=>`<option value="${c}" ${c===valAtual?'selected':''}>${c}</option>`).join('');
      }
      render();
      renderStats();
      renderFaseFilter();
      carregarNotificacoes();
      if(!silencioso) showToast(`${_processos.length} processos carregados`,'ok');
      // Deep link (task #59) â se a pÃ¡gina abriu direto em /controle/UD26-005,
      // abre o painel do processo assim que a lista termina de carregar.
      if(_refPendenteDeepLink){
        _abrirProcessoPorReferencia(_refPendenteDeepLink);
        _refPendenteDeepLink = null;
      }
    }
  }catch(e){
    showToast('Erro ao carregar processos','err');
  }
}

// Abre o painel de um processo pela referÃªncia (usado por deep link e pelo
// botÃ£o voltar/avanÃ§ar do navegador), SEM mexer no histÃ³rico â quem decide
// se pushState/popstate acontece Ã© sempre o chamador (abrirProcesso ou o
// listener de popstate), nunca esta funÃ§Ã£o.
function _abrirProcessoPorReferencia(ref){
  const proc = _processos.find(p=>p.referencia===ref);
  if(!proc) return;
  _editando = {...proc, _camposIA: {}};
  _editandoOriginal = {...proc};
  renderModal();
}

// BotÃ£o voltar/avanÃ§ar do navegador â mantÃ©m o painel lateral sincronizado
// com a URL (ex: abrir processo A, abrir processo B, voltar â reabre A;
// voltar de novo â fecha o painel e volta pra lista).
window.addEventListener('popstate', function(){
  const partes = location.pathname.split('/').filter(Boolean);
  const ref = partes[1] ? decodeURIComponent(partes[1]) : null;
  if(ref){
    _abrirProcessoPorReferencia(ref);
  } else if(_editando){
    _editando = null;
    document.getElementById('modal-bg').classList.remove('open');
  }
});

async function salvarProcesso(proc, patchFields){
  const isNovo = !proc.id;
  if(isNovo) proc.id = gerarUUID();
  proc.updated_by = _user.usuario;
  proc.updated_at = new Date().toISOString();
  if(isNovo){ proc.created_by = _user.usuario; proc.created_at = new Date().toISOString(); }

  // Registrar cÃ¢mbio USD no momento do pedido se nÃ£o preenchido
  if(!proc.pi_cambio && proc.pi_valor_usd && _cambio.USD){
    proc.pi_cambio = _cambio.USD;
    if(patchFields) patchFields.push('pi_cambio');
  }

  // Calcular vencimento demurrage automaticamente
  if(proc.data_chegada && proc.free_time){
    const chegada = new Date(proc.data_chegada);
    chegada.setDate(chegada.getDate() + parseInt(proc.free_time||0));
    proc.demurrage_vencimento = chegada.toISOString().split('T')[0];
  }

  // AvanÃ§ar fase automaticamente
  proc.fase = calcularFase(proc);

  // ââ CONCORRÃNCIA: enviar sÃ³ o que mudou ââââââââââââââââââââââââââ
  // Se quem chamou informou patchFields (lista de campos de fato alterados
  // nesta sessÃ£o de ediÃ§Ã£o), manda ao servidor sÃ³ esses campos + os
  // metadados/calculados de sempre â nÃ£o o processo inteiro. Isso evita que
  // duas pessoas editando o mesmo processo ao mesmo tempo apaguem uma a
  // mudanÃ§a da outra: cada save sÃ³ toca nos campos que aquele usuÃ¡rio de
  // fato mexeu. Sem patchFields (chamada antiga/desconhecida), mantÃ©m o
  // comportamento de sempre â manda o processo inteiro.
  let payload = proc;
  if(patchFields && Array.isArray(patchFields)){
    const camposFixos = ['id','referencia','fase','demurrage_vencimento','pi_cambio',
      'updated_by','updated_at','created_by','created_at','log'];
    const chaves = [...new Set([...camposFixos, ...patchFields])];
    payload = {};
    chaves.forEach(k=>{ if(proc[k]!==undefined) payload[k] = proc[k]; });
  }

  showToast('Salvando...','info');
  let r, d;
  try{
    r = await fetch('/api/controle/v2/processo', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ processo: payload })
    });
    d = await r.json();
  } catch(netErr){
    showToast('Erro de rede ao salvar: '+netErr.message,'err');
    return false;
  }
  if(d.ok){
    showToast('â Salvo','ok');
    // Criar notificaÃ§Ã£o se houver alerta
    verificarAlertas(proc, true);
    await carregarProcessos(true);
    return true;
  } else {
    showToast('Erro ao salvar: '+(d.erro||''),'err');
    return false;
  }
}

async function excluirProcesso(id){
  if(!confirm('Excluir este processo?')) return;
  const r = await fetch('/api/controle/v2/processo/'+id, {method:'DELETE'});
  const d = await r.json();
  if(d.ok){ showToast('Processo excluÃ­do','ok'); fecharModal(); carregarProcessos(true); }
  else showToast('Erro ao excluir','err');
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// FASE AUTOMÃTICA
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function calcularFase(p){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  // "Data Chegada", "Data PresenÃ§a" e "Data de Embarque" sÃ³ contam pra
  // avanÃ§ar a fase se jÃ¡ aconteceram de fato. Se alguÃ©m preencher uma data
  // futura ali (comum quando o booking jÃ¡ traz uma previsÃ£o e a pessoa
  // preenche no campo errado por hÃ¡bito), NÃO trata como jÃ¡ embarcado/
  // desembarcado â fica na fase anterior atÃ© a data realmente chegar. Use
  // os campos de previsÃ£o (ETD/ETA/PrevisÃ£o ProntidÃ£o) pra isso â e na
  // prÃ¡tica o prÃ³prio formulÃ¡rio jÃ¡ move a data automaticamente pro campo
  // de previsÃ£o certo quando detecta uma data futura nesses campos (ver
  // moverDataFuturaParaPrevisao) â isso aqui Ã© sÃ³ a segunda camada de
  // proteÃ§Ã£o, pro caso de a data chegar aqui por outro caminho (ex: leitura
  // por IA), sem depender sÃ³ do que roda no onchange do campo.
  const chegadaPassada  = p.data_chegada  && new Date(p.data_chegada+'T00:00:00')  <= hoje ? p.data_chegada  : null;
  const presencaPassada = p.data_presenca && new Date(p.data_presenca+'T00:00:00') <= hoje ? p.data_presenca : null;
  const embarquePassado = p.data_embarque && new Date(p.data_embarque+'T00:00:00') <= hoje ? p.data_embarque : null;

  if(p.data_devolucao_vazio)                                        return 'FINALIZADO';
  // Quando AMBAS as NFs (entrada e saÃ­da) estÃ£o emitidas, isso jÃ¡ Ã© prova
  // suficiente de que o carregamento aconteceu de fato â avanÃ§a direto para
  // DevoluÃ§Ã£o do Vazio, mesmo sem a data_carregamento manual preenchida,
  // para jÃ¡ acionar o alerta de demurrage dessa etapa.
  if(p.data_carregamento || (p.nf_entrada_numero && p.nf_saida_numero)) return 'DEVOLUCAO_VAZIO';
  if(p.data_agendamento || p.nf_saida_numero || p.nf_entrada_numero) return 'CARREGAMENTO';
  if(p.data_liberacao || (p.canal==='VERDE' && p.data_parametrizacao)) return 'FATURAMENTO';
  if(p.canal || p.data_parametrizacao)                              return 'PARAMETRIZACAO';
  if(p.numero_di || p.data_registro_di)                             return 'REGISTRO_DI';
  if(presencaPassada || chegadaPassada)                             return 'DESEMBARCADO';
  // Igual ao caso do Booking acima: o NÂº HBL costuma ser preenchido antes
  // do embarque acontecer de fato (o armador/agente jÃ¡ manda o HBL com
  // antecedÃªncia), entÃ£o usar sÃ³ "p.hbl" aqui fazia o status pular pra
  // "Embarcado" antes da hora â mesmo com o embarque real ainda previsto
  // pra outro dia. Agora sÃ³ a Data de Embarque (Efetiva) â quando jÃ¡
  // passou â conta como embarque de verdade.
  if(embarquePassado)                                               return 'EMBARCADO';
  // O status avanÃ§a pra "Ag. Embarque" sÃ³ com a PrevisÃ£o de Embarque (ETD)
  // preenchida â NÃO mais com o NÂº Booking. Motivo: como o booking real
  // muitas vezes nÃ£o chega a tempo, o time preenche esse campo com a
  // referÃªncia da Royal (nÃ£o o booking de verdade), e o status mudava
  // prematuramente/erradamente por causa disso. O ETD Ã© um dado mais
  // confiÃ¡vel desse ponto do processo.
  if(p.etd)                                                         return 'AGUARDANDO_EMBARQUE';
  return 'PI';
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// DEMURRAGE
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function demurrageDias(proc){
  if(!proc.demurrage_vencimento) return null;
  const venc = parseDataLocal(proc.demurrage_vencimento);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((venc-hoje)/86400000);
}

// Processo com chegada prevista (ETA) nos prÃ³ximos N dias e que ainda nÃ£o
// desembarcou de fato (sem data_chegada preenchida â assim que a chegada
// efetiva Ã© registrada, o processo sai naturalmente deste card). Usado
// pelo card "Chegada em 7 dias" do Dashboard e pelo filtro correspondente
// na tabela â mesma regra nos dois lugares, pra nÃ£o desalinhar contagem e
// lista exibida ao clicar no card.
function chegandoEmDias(proc, dias){
  if(proc.data_chegada || proc.fase==='FINALIZADO' || !proc.eta) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(hoje); limite.setDate(hoje.getDate()+dias);
  const eta = new Date(proc.eta+'T00:00:00');
  return eta>=hoje && eta<=limite;
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// PAGAMENTOS DE PI â fonte Ãºnica pro Dashboard Financeiro
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Um processo com forma "Entrada+Saldo" na verdade tem DUAS datas de
// vencimento e DOIS cÃ¢mbios diferentes â tratar isso como "um pagamento sÃ³"
// (como o resto do sistema faz) esconde a parcela de Entrada inteira do
// fluxo de caixa e do controle cambial. Essa funÃ§Ã£o "achata" cada processo
// em 1 ou 2 parcelas de pagamento individuais, cada uma jÃ¡ com fornecedor,
// paÃ­s (via porto de origem), valor, vencimento, cÃ¢mbio previsto/fechado e
// se jÃ¡ foi paga â pra nÃ£o reimplementar essa lÃ³gica 3x (KPIs, calendÃ¡rio,
// cÃ¢mbio) de formas ligeiramente diferentes e desalinhadas entre si.
//
// "Pago" por parcela (nÃ£o usa sÃ³ o pi_pago geral do processo, que sÃ³ vira
// true quando TUDO foi pago):
//  - Ãºnica (Vista/Prazo): usa pi_pago mesmo â Ã© o Ãºnico pagamento do processo.
//  - entrada: considera paga se jÃ¡ tem cÃ¢mbio de entrada fechado registrado.
//  - saldo: usa pi_pago â Ã© a parcela que fecha o processo (ver confirmarCambioComo).
function listarPagamentosPI(processos){
  const pagamentos = [];
  (processos||[]).forEach(p=>{
    const valorTotal = parseFloat(p.pi_valor_usd)||0;
    if(!valorTotal || p.fase==='FINALIZADO') return;
    const base = { referencia:p.referencia, processoId:p.id, fornecedor:p.fornecedor||'â', pais:paisDoProcesso(p), moeda:'USD', cliente:p.cliente||'â' };
    if(p.pi_pagamento==='ENTRADA_SALDO'){
      const pct = parseFloat(p.pi_entrada_pct||30)/100;
      const cambioPrevisto = parseFloat(p.pi_cambio)||null;
      pagamentos.push({...base, parcela:'entrada',
        valorUsd: valorTotal*pct, vencimento: p.pi_data_entrada||null,
        cambioPrevisto, cambioFechado: parseFloat(p.pi_cambio_entrada)||null,
        pago: !!p.pi_cambio_entrada });
      pagamentos.push({...base, parcela:'saldo',
        valorUsd: valorTotal*(1-pct), vencimento: p.pi_data_saldo||null,
        cambioPrevisto, cambioFechado: parseFloat(p.pi_cambio_saldo)||null,
        pago: !!p.pi_pago });
    } else if(p.pi_pagamento==='PARCELADO'){
      // "Parcelado" (N cÃ¢mbios, valor fixo em USD cada) â achata cada linha
      // de pi_parcelas_json num pagamento prÃ³prio, mesmo espÃ­rito de
      // Entrada+Saldo acima, sÃ³ que sem limite de 2. "Paga" por parcela usa
      // a presenÃ§a de cÃ¢mbio fechado (mesma regra da parcela "entrada"), jÃ¡
      // que aqui nÃ£o existe um pi_pago Ãºnico cobrindo "a Ãºltima parcela".
      let parcelas = [];
      try{ parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ parcelas = []; }
      parcelas.forEach((pc,i)=>{
        const v = parseFloat(pc.valor_usd)||0;
        if(!v) return;
        pagamentos.push({...base, parcela: pc.label || ('parcela '+(i+1)),
          valorUsd: v, vencimento: pc.data_vencimento||null,
          cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: parseFloat(pc.cambio_fechado)||null,
          pago: !!pc.cambio_fechado });
      });
    } else if(p.pi_pagamento==='VISTA' || p.pi_pagamento==='PRAZO'){
      const vencimento = p.pi_pagamento==='PRAZO' ? p.pi_data_saldo : p.pi_data_entrada;
      pagamentos.push({...base, parcela:'unico',
        valorUsd: valorTotal, vencimento: vencimento||null,
        cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: parseFloat(p.pi_cambio_fechado)||null,
        pago: !!p.pi_pago });
    }
    // Sem pi_pagamento definido ainda (processo recÃ©m-criado, sÃ³ com valor
    // da PI preenchido): nÃ£o dÃ¡ pra saber vencimento nem parcelas, mas ainda
    // conta pra ExposiÃ§Ã£o em USD â entra como pagamento "sem forma definida".
    else {
      pagamentos.push({...base, parcela:'indefinido',
        valorUsd: valorTotal, vencimento: null,
        cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: null,
        pago: !!p.pi_pago });
    }
  });
  return pagamentos;
}

function demurrageDisplay(proc){
  if(proc.fase === 'FINALIZADO' || proc.data_devolucao_vazio) return '<span style="color:var(--ok)">â Devolvido</span>';
  const dias = demurrageDias(proc);
  if(dias === null) return '<span style="color:var(--dim)">â</span>';
  if(dias < 0) return `<span class="demur-err">Vencido hÃ¡ ${Math.abs(dias)}d</span>`;
  if(dias <= 5) return `<span class="demur-warn">â  ${dias}d</span>`;
  return `<span class="demur-ok">${dias}d</span>`;
}

// Gera o bloco "CÃ¡lculo do Demurrage" (aba LogÃ­stica). ExtraÃ­da como funÃ§Ã£o prÃ³pria
// para poder ser recalculada em tempo real conforme o usuÃ¡rio digita (ver
// atualizarFaseEmTempoReal), e nÃ£o apenas uma vez quando o modal abre.
function renderDemurInfo(p){
  if(!p.data_chegada && !p.demurrage_vencimento) return '';
  const chegada   = parseDataLocal(p.data_chegada);
  const freeTime  = parseInt(p.free_time||21);
  const vencCalc  = chegada ? new Date(chegada) : null;
  if(vencCalc) vencCalc.setDate(chegada.getDate() + freeTime);
  const vencReal  = p.demurrage_vencimento ? parseDataLocal(p.demurrage_vencimento) : vencCalc;
  const dias = demurrageDias(p);
  const cor  = dias===null?'var(--muted)':dias<0?'var(--err)':dias<=5?'var(--warn)':'var(--ok)';

  let statusTxt = '', statusIcon = '';
  if(p.data_devolucao_vazio){
    statusIcon = 'â'; statusTxt = `Container devolvido em ${parseDataLocal(p.data_devolucao_vazio).toLocaleDateString('pt-BR')}`;
  } else if(dias !== null && dias < 0){
    statusIcon = 'ð´'; statusTxt = `VENCIDO hÃ¡ ${Math.abs(dias)} dia(s) â custos acumulando!`;
  } else if(dias !== null && dias <= 5){
    statusIcon = 'â ï¸'; statusTxt = `AtenÃ§Ã£o: vence em ${dias} dia(s)`;
  } else if(dias !== null){
    statusIcon = 'ð¢'; statusTxt = `${dias} dias restantes`;
  }

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:10px;">
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">ð CÃ¡lculo do Demurrage</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      ${chegada ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">ð Data de chegada</span><strong>${chegada.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">â± Free time</span><strong>${freeTime} dias</strong></div>
      ${vencReal ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">ð Vencimento</span><strong style="color:${cor}">${vencReal.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      ${statusTxt ? `<div style="margin-top:4px;padding:8px 12px;background:${dias!==null&&dias<0?'rgba(220,38,38,.08)':dias!==null&&dias<=5?'rgba(217,119,6,.08)':'rgba(22,163,74,.08)'};border-radius:6px;font-weight:600;color:${cor};">${statusIcon} ${statusTxt}</div>` : ''}
      ${p.demurrage_valor ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">ð¸ Valor registrado</span><strong>R$ ${parseFloat(p.demurrage_valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>` : ''}
    </div>
  </div>`;
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// FECHAMENTO â estimado (da cotaÃ§Ã£o aprovada) Ã real (NF Entrada/SaÃ­da)
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// FunÃ§Ã£o pura (sem DOM) que compara o que foi cotado no Calculador
// (p.estimativa_json, gravado em POST /api/calculador/cotacoes/:id/aprovar)
// com o resultado real do processo (NF SaÃ­da â NF Entrada, jÃ¡ preenchidos
// na aba Documentos). Compara sempre contra o cenÃ¡rio Com S.T. (Ã© o mais
// comum na prÃ¡tica â resumo antigo, salvo antes dos dois cenÃ¡rios existirem,
// cai no faturamento genÃ©rico que tinha na Ã©poca).
// ââ CUSTOS REAIS â apuraÃ§Ã£o de lucro por processo, item a item ââââ
// Mesmos grupos/campos usados no Calculador (TAXAS_CONFIG + FOB/Frete/
// Seguro/Taxa C.E. + Impostos + ComissÃµes) â pra dar pra apurar o lucro
// real de QUALQUER processo, com ou sem cotaÃ§Ã£o aprovada. `cotado(c)` lÃª o
// valor cotado de dentro de p.estimativa_json.custos_cotados_json (gravado
// por resumoParaLista() no calculador.html, ao salvar a cotaÃ§Ã£o) â usado sÃ³
// como REFERÃNCIA/ponto de partida na aba Custos Reais; o cÃ¡lculo do lucro
// real (ver calcularCustoRealTotal) usa exclusivamente o que estÃ¡ em
// p.real_json/p.real_cambio, preenchido pelo usuÃ¡rio no Controle.
//
// p.real_json e p.real_cambio jÃ¡ existem no banco (migration
// 0004_add_custos_reais_processo.sql, aplicada em produÃ§Ã£o e no lab em
// 2026-07-19) â a coluna foi criada antes pra essa mesma finalidade, mas o
// cÃ³digo que a usava nunca chegou a ser commitado. Reaproveitada aqui em vez
// de criar coluna nova. real_json guarda um valor TOTAL (jÃ¡ em R$ ou US$,
// conforme a unidade do item) por chave de item (ver custosReaisItensFlat) â
// mais simples que o { fixas, usd } por-container original documentado na
// migration, e cobre tambÃ©m Compra/Impostos/ComissÃµes, nÃ£o sÃ³ as 21 taxas.
// FIX (a pedido do usuÃ¡rio): FOB/Frete/Seguro/Taxa C.E. e as Taxas em USD
// (destino) eram unidade:'USD' aqui â exigia conversÃ£o manual toda vez que
// alguÃ©m abria a aba, mesmo o Calculador jÃ¡ parametrizando um cÃ¢mbio
// especÃ­fico pra cada um desses itens (cÃ¢mbio ponderado pelas parcelas pro
// FOB, cÃ¢mbio de abertura+2% pro Frete/Seguro/Taxas em USD, cÃ¢mbio Ãºnico da
// simulaÃ§Ã£o pra Taxa C.E â ver resumoParaLista() em calculador.html). Agora
// unidade:'BRL' em todos â os valores que chegam em custos_cotados_json jÃ¡
// vÃªm convertidos pelo cÃ¢mbio correto de cada item, nÃ£o mais em dÃ³lar puro.
const CUSTOS_REAIS_CONFIG = [
  { grupo:'Compra e Frete', itens:[
    { id:'fob',      label:'Custo da mercadoria', unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.fob },
    { id:'frete',    label:'Frete Internacional',  unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.frete },
    { id:'seguro',   label:'Seguro',               unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.seguro_usd },
    { id:'taxa_ce',  label:'Taxa C.E.',            unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.taxa_ce },
  ]},
  // apenasPago:true = imposto nÃ£o tem "compra Ã venda" â Ã© sÃ³ um valor a
  // pagar pro governo, sempre em R$, sem contrapartida cobrada do cliente
  // (diferente das taxas operacionais, que podem ter margem). A aba mostra
  // sÃ³ um campo "Valor a pagar", sem Cobrado/Margem nem seletor de moeda.
  { grupo:'Impostos de ImportaÃ§Ã£o', itens:[
    { id:'ii',     label:'II',     unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.ii },
    { id:'ipi',    label:'IPI',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.ipi },
    { id:'pis',    label:'PIS',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.pis },
    { id:'cofins', label:'COFINS', unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.cofins },
    { id:'icms',   label:'ICMS',   unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.icms },
    { id:'ibs',    label:'IBS',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.ibs },
    { id:'cbs',    label:'CBS',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.cbs },
    // Antidumping: direito antidumping (encargo governamental cobrado quando o
    // toggle "dump" estÃ¡ SIM no Calculador) â igual aos demais impostos, sem
    // compraÃvenda, sÃ³ existe quando a cotaÃ§Ã£o de origem teve o toggle ativo.
    { id:'antidumping', label:'Antidumping', unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.antidumping },
  ]},
  { grupo:'ComissÃµes', itens:[
    { id:'comissao_br',    label:'ComissÃ£o BR (Representante)', unidade:'BRL', cotado:c=>c?.comissoes?.br },
    { id:'comissao_china', label:'ComissÃ£o China',              unidade:'BRL', cotado:c=>c?.comissoes?.china },
    { id:'comissao_boss',  label:'ComissÃ£o Boss/Lopes',         unidade:'BRL', cotado:c=>c?.comissoes?.boss },
  ]},
  // porContainer:true = no Calculador esse valor Ã© POR container (r.txOp);
  // usado sÃ³ pra multiplicar corretamente ao calcular o "Cotado" total abaixo
  // (calcularCustoCotadoItem). Os valores REAIS lanÃ§ados na aba sÃ£o sempre o
  // TOTAL do item pro processo inteiro â o usuÃ¡rio nÃ£o precisa multiplicar.
  { grupo:'Taxas Operacionais', itens:[
    { id:'siscomex',         label:'Siscomex',                unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.siscomex },
    { id:'marinha',          label:'Marinha/AFRMM',           unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.marinha },
    { id:'armazenagem',      label:'Armazenagem',             unidade:'BRL', porContainer:false, cotado:c=>c?.taxas_fixas?.armazenagem },
    { id:'emissao_li',       label:'EmissÃ£o L.I.',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.emissao_li },
    { id:'baixa_patio',      label:'Baixa PÃ¡tio',             unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.baixa_patio },
    { id:'capatazia',        label:'Capatazia/THC',           unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.capatazia },
    { id:'liberacao_bl',     label:'LiberaÃ§Ã£o BL',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.liberacao_bl },
    { id:'despachante',      label:'Despachante',             unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.despachante },
    { id:'sda',              label:'SDA',                     unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.sda },
    { id:'lavacao',          label:'LavaÃ§Ã£o Container',       unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.lavacao },
    { id:'administrativo',   label:'Administrativo',          unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.administrativo },
    { id:'agente',           label:'Agente Carga',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.agente },
    { id:'custos_diversos',  label:'Custos Diversos',         unidade:'BRL', porContainer:false, cotado:c=>c?.custos_diversos },
    // Seguro de Venda: distinto do Seguro (Compra e Frete acima, custo interno
    // da importaÃ§Ã£o) â Ã© a taxa de seguro cobrada na proposta ao cliente, que
    // compÃµe total_taxas/custo_total no Calculador (ver comentÃ¡rio em
    // calcular(), "deve compor as Taxas Operacionais").
    { id:'seguro_venda',    label:'Seguro de Venda',         unidade:'BRL', porContainer:false, cotado:c=>c?.seguro_venda },
    { id:'handling',         label:'Handling at Destination', unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.handling },
    { id:'additional_costs', label:'Additional Costs',        unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.additional_costs },
    { id:'import_logistics', label:'Import Logistics',        unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.import_logistics },
    { id:'trs',              label:'TRS',                     unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.trs },
    { id:'tsc',              label:'TSC',                     unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.tsc },
    { id:'drop_off',         label:'Drop Off',                unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.drop_off },
    { id:'isps',             label:'ISPS',                    unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.isps },
    { id:'iof',              label:'IOF',                     unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.iof },
    { id:'desconsolidacao',  label:'DesconsolidaÃ§Ã£o',         unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.desconsolidacao },
  ]},
];

function custosReaisItensFlat(){
  return CUSTOS_REAIS_CONFIG.flatMap(g => g.itens.map(it => ({...it, grupo:g.grupo})));
}

// ââ MULTI-MOEDA + QUEBRA POR CONTAINER (Pago Ã Cobrado por taxa) ââââââ
// Igual Ã  tela de Taxas do Conexos: cada taxa pode ter Pago e Cobrado em
// moedas diferentes (BRL/USD/EUR, cada lado com sua prÃ³pria moeda â ex.:
// paga o representante em BRL, recebe do importador em USD), e quando o
// processo tem mais de um container, cada taxa "porContainer" pode ser
// detalhada container a container em vez de um valor Ãºnico pro processo
// inteiro. Formato salvo em real_json[item.id] (e o mesmo com sufixo
// "_cobrado"), aceita 3 formatos pra manter compatibilidade com dados jÃ¡
// salvos antes dessa mudanÃ§a:
//   nÃºmero puro            â legado: valor na moeda padrÃ£o do item (unidade)
//   { valor, moeda }       â valor Ãºnico, moeda escolhida pelo usuÃ¡rio
//   { porContainer:{ 'CONTAINER1':{valor,moeda}, ... } } â detalhado
const MOEDAS_REAIS = [
  { code:'BRL', simbolo:'R$' },
  { code:'USD', simbolo:'US$' },
  { code:'EUR', simbolo:'â¬' },
];

// CÃ¢mbio de uma moeda em relaÃ§Ã£o a R$ pra este processo. USD usa a mesma
// coluna jÃ¡ existente (p.real_cambio, com fallback pro cÃ¢mbio da PI); EUR
// nÃ£o tem coluna prÃ³pria â pra nÃ£o precisar de migration nova, fica salvo
// dentro do prÃ³prio real_json (_cambio_eur), com fallback pro cÃ¢mbio do dia
// (_cambio.EUR, jÃ¡ buscado no boot pra barra do topo).
function taxaCambioMoedaReal(moeda, p){
  if(moeda === 'BRL') return 1;
  if(moeda === 'USD'){
    return parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || (typeof _cambio !== 'undefined' ? _cambio.USD : null) || null;
  }
  if(moeda === 'EUR'){
    const salvo = p.real_json && parseFloat(p.real_json._cambio_eur);
    return (salvo && !isNaN(salvo) ? salvo : null) || (typeof _cambio !== 'undefined' ? _cambio.EUR : null) || null;
  }
  return null;
}

// Lista de containers do processo â usada sÃ³ pra oferecer o detalhamento
// por container nas taxas "porContainer". Sem containers cadastrados (ou sÃ³
// 1), a taxa fica como valor Ãºnico, sem opÃ§Ã£o de detalhar.
//
// Fonte da verdade: p.containers_json, o MESMO campo preenchido na tela
// "+ Adicionar Container" da aba Documentos (ver controle-campos.js,
// renderMultiContainers/sincronizarContainerLegado) â array de
// {numero, tipo, lacre}. Antes esta funÃ§Ã£o lia p.container (o campo texto
// legado, que sÃ³ guarda o nÃºmero do PRIMEIRO container, sincronizado
// automaticamente a partir de containers_json) â por isso processos com
// mais de um container apareciam com sÃ³ 1 na aba Custos Reais. MantÃ©m
// fallback pro campo legado sÃ³ pra processos antigos que nunca chegaram a
// usar a tela de multi-container (containers_json ainda vazio).
function containersDoProcesso(p){
  if(!p) return [];
  if(p.containers_json){
    try{
      const lista = JSON.parse(p.containers_json);
      if(Array.isArray(lista)){
        const numeros = lista.map(c => (c && c.numero || '').trim()).filter(Boolean);
        if(numeros.length) return numeros;
      }
    }catch(e){ /* containers_json invÃ¡lido â cai no fallback abaixo */ }
  }
  if(!p.container) return [];
  return String(p.container).split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
}

// Converte o valor bruto salvo em real_json[item.id] (nos 3 formatos
// possÃ­veis, ver comentÃ¡rio acima) pro total em R$ desse item. Retorna
// null quando nÃ£o hÃ¡ nada lanÃ§ado.
function normalizarValorRealItem(raw, item, p){
  if(raw == null || raw === '') return null;
  if(typeof raw === 'object'){
    if(raw.porContainer && typeof raw.porContainer === 'object'){
      let totalBrl = 0, count = 0;
      Object.values(raw.porContainer).forEach(entry => {
        if(!entry || entry.valor == null || entry.valor === '') return;
        const valor = parseFloat(entry.valor);
        if(isNaN(valor)) return;
        const moeda = entry.moeda || item.unidade;
        const cambio = taxaCambioMoedaReal(moeda, p);
        totalBrl += moeda === 'BRL' ? valor : valor * (cambio || 0);
        count++;
      });
      if(count === 0) return null;
      return { totalBrl, count, porContainer:true };
    }
    if(raw.valor != null && raw.valor !== ''){
      const valor = parseFloat(raw.valor);
      if(isNaN(valor)) return null;
      const moeda = raw.moeda || item.unidade;
      const cambio = taxaCambioMoedaReal(moeda, p);
      return { totalBrl: moeda === 'BRL' ? valor : valor * (cambio || 0), count:1, moeda };
    }
    return null;
  }
  // legado: nÃºmero (ou string numÃ©rica) puro, sem objeto {valor,moeda} â sÃ³
  // existe em processos criados ANTES do multi-moeda (task #159). Usa
  // unidadeLegado quando existe (itens que mudaram de padrÃ£o USD->BRL nesta
  // correÃ§Ã£o â ver comentÃ¡rio no topo de CUSTOS_REAIS_CONFIG) pra nÃ£o
  // reinterpretar retroativamente valores antigos que foram salvos em USD
  // como se jÃ¡ fossem BRL. Itens que sempre foram BRL nÃ£o tÃªm
  // unidadeLegado, entÃ£o caem direto em item.unidade (sem mudanÃ§a).
  const unidadeParaLegado = item.unidadeLegado || item.unidade;
  const valor = parseFloat(raw);
  if(isNaN(valor)) return null;
  const cambio = taxaCambioMoedaReal(unidadeParaLegado, p);
  return { totalBrl: unidadeParaLegado === 'BRL' ? valor : valor * (cambio || 0), count:1, moeda:unidadeParaLegado };
}

// Valor COTADO de um item, jÃ¡ no TOTAL do processo (multiplicado pelos
// containers quando for porContainer) â usado sÃ³ pra prÃ©-preencher/mostrar
// como referÃªncia na aba Custos Reais, nunca entra direto no cÃ¡lculo do
// lucro real (ver calcularCustoRealTotal, que sÃ³ olha p.real_json).
function calcularCustoCotadoItem(item, cotado){
  if(!cotado) return null;
  const base = item.cotado(cotado);
  if(base == null) return null;
  return item.porContainer ? base * (cotado.containers || 1) : base;
}

// Soma tudo que estiver preenchido em p.real_json (valores TOTAIS, jÃ¡
// digitados pelo usuÃ¡rio na aba Custos Reais â sem fallback automÃ¡tico pro
// cotado aqui; o fallback acontece sÃ³ visualmente, prÃ©-preenchendo o campo
// quando a aba abre). Itens em USD convertem pelo cÃ¢mbio salvo em
// p.real_cambio ou, na falta dele, pelo cÃ¢mbio da PI do processo. Retorna
// null quando nÃ£o hÃ¡ NENHUM custo real lanÃ§ado ainda â nesse caso
// calcularFechamento() cai no cÃ¡lculo antigo (NF SaÃ­da â NF Entrada),
// preservando o comportamento de processos que nunca abriram essa aba.
function calcularCustoRealTotal(p){
  const reais = p.real_json;
  if(!reais || typeof reais !== 'object') return null;
  const cambio = parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || null;
  let total = 0, count = 0;
  const detalhe = [];
  custosReaisItensFlat().forEach(item => {
    const norm = normalizarValorRealItem(reais[item.id], item, p);
    if(!norm) return;
    total += norm.totalBrl;
    count++;
    detalhe.push({ id:item.id, label:item.label, grupo:item.grupo, unidade:item.unidade, valorBrl:norm.totalBrl, porContainer:!!norm.porContainer });
  });
  if(count === 0) return null;
  return { total, detalhe, cambio, count };
}

// Espelha calcularCustoRealTotal, mas soma o que foi COBRADO DO CLIENTE por
// item (nÃ£o o que foi pago ao fornecedor/agente) â guardado nas mesmas
// chaves de real_json, com sufixo "_cobrado" (ex.: reais.siscomex = pago,
// reais.siscomex_cobrado = cobrado). Isso dÃ¡ pra ver a margem de CADA taxa
// individualmente (compra Ã venda), igual ao Conexos mostra na aba Taxas â
// nÃ£o sÃ³ o total do processo (NF SaÃ­da â Custo Real Total).
function calcularReceitaRealTotal(p){
  const reais = p.real_json;
  if(!reais || typeof reais !== 'object') return null;
  const cambio = parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || null;
  let total = 0, count = 0;
  const detalhe = [];
  custosReaisItensFlat().forEach(item => {
    const norm = normalizarValorRealItem(reais[item.id+'_cobrado'], item, p);
    if(!norm) return;
    total += norm.totalBrl;
    count++;
    detalhe.push({ id:item.id, label:item.label, grupo:item.grupo, unidade:item.unidade, valorBrl:norm.totalBrl, porContainer:!!norm.porContainer });
  });
  if(count === 0) return null;
  return { total, detalhe, cambio, count };
}

// ââ VENDAS MULTI-CLIENTE (rateio de custo) ââââââââââââââââââââââââ
// Um processo (de qualquer finalidade) pode ser vendido a mais de um
// cliente â ex.: meio contÃªiner pra um, meio pra outro. p.vendas_json guarda
// um array de vendas, cada uma com seu prÃ³prio cliente, NF SaÃ­da e a
// quantidade que levou de cada item. Quando existe pelo menos uma venda
// cadastrada, o Lucro Real deixa de ser um nÃºmero Ãºnico do processo (NF
// SaÃ­da â Custo Real Total) e passa a ser calculado VENDA A VENDA: cada
// custo real lanÃ§ado na aba Custos Reais Ã© rateado proporcionalmente Ã 
// quantidade que aquela venda levou (sobre a quantidade total de produtos do
// processo, ver totalQuantidadeProdutos), e alguns custos podem ser
// lanÃ§ados DIRETO numa venda especÃ­fica (custos_diretos), sem entrar no
// rateio â ex.: um frete rodoviÃ¡rio que sÃ³ existiu porque aquele cliente
// pediu entrega em outra cidade.
// Sem nenhuma venda cadastrada (vendas_json vazio/null), calcularFechamento
// continua exatamente como antes â 100% retrocompatÃ­vel com todo processo
// jÃ¡ cadastrado.

// Soma a quantidade de todos os itens em produtos_json â Ã© o "tamanho
// total" do processo (ex.: 1400 pneus), denominador do rateio.
function totalQuantidadeProdutos(p){
  if(!p || !p.produtos_json) return 0;
  try{
    const produtos = JSON.parse(p.produtos_json);
    if(!Array.isArray(produtos)) return 0;
    return produtos.reduce((s,it)=> s + (parseFloat(it.quantidade)||0), 0);
  }catch(e){ return 0; }
}

// LÃª e normaliza p.vendas_json â nunca lanÃ§a, sempre devolve array (vazio
// se nÃ£o houver nada salvo ou o JSON estiver corrompido).
function parseVendas(p){
  if(!p || !p.vendas_json) return [];
  try{
    const vendas = JSON.parse(p.vendas_json);
    return Array.isArray(vendas) ? vendas : [];
  }catch(e){ return []; }
}
function clientesDoProcesso(p){
const nomes = new Set();
if(p && p.cliente) nomes.add(p.cliente);
parseVendas(p).forEach(v=>{ if(v && v.cliente) nomes.add(v.cliente); });
return [...nomes];
}


// Quantidade total alocada pra uma venda (soma de todos os itens dela).
function quantidadeVenda(venda){
  return (venda.itens||[]).reduce((s,it)=> s + (parseFloat(it.quantidade)||0), 0);
}

// Soma dos custos diretos (nÃ£o-rateados) de uma venda â cada um jÃ¡ Ã© um
// valor TOTAL em R$, lanÃ§ado manualmente (ex.: "Frete RodoviÃ¡rio Extra").
function custosDiretosVenda(venda){
  return (venda.custos_diretos||[]).reduce((s,c)=> s + (parseFloat(c.valor)||0), 0);
}

// Rateia o Custo Real Total do processo por uma venda especÃ­fica,
// proporcional Ã  quantidade que ela levou, e soma os custos diretos dela
// por cima (esses nÃ£o sÃ£o rateados â sÃ£o sÃ³ dessa venda).
function calcularRateioVenda(p, venda, custoRealTotal){
  const totalQtd = totalQuantidadeProdutos(p);
  const qtdVenda = quantidadeVenda(venda);
  const fracao = totalQtd > 0 ? (qtdVenda / totalQtd) : 0;
  const custoRateado = (custoRealTotal||0) * fracao;
  const custoDireto = custosDiretosVenda(venda);
  return { totalQtd, qtdVenda, fracao, custoRateado, custoDireto, custoTotal: custoRateado + custoDireto };
}

// Lucro de uma venda especÃ­fica: NF SaÃ­da DELA (nÃ£o do processo) â a fatia
// de custo que lhe cabe (rateado + direto). null quando a venda ainda nÃ£o
// tem NF SaÃ­da lanÃ§ada (mesma convenÃ§Ã£o do Lucro Real do processo inteiro).
function calcularLucroVenda(p, venda, custoRealTotal){
  const rateio = calcularRateioVenda(p, venda, custoRealTotal);
  const nfSaida = parseFloat(venda.nf_saida_valor);
  const temNf = !isNaN(nfSaida) && nfSaida > 0;
  const lucro = temNf ? (nfSaida - rateio.custoTotal) : null;
  const pctLucro = (temNf && lucro != null && nfSaida > 0) ? (lucro / nfSaida) : null;
  return { ...rateio, nfSaida: temNf?nfSaida:null, temNf, lucro, pctLucro };
}

// Ajusta uma lista de valores fracionÃ¡rios (em R$) que deveriam somar
// "totalAlvo" pra somarem EXATAMENTE isso atÃ© o centavo â mÃ©todo do maior
// resto (largest remainder / Hamilton), o mesmo usado pra distribuir
// cadeiras em sistemas proporcionais. Sem isso, ratear R$100.000,00 em 3
// partes de 33.333,33... e converter cada uma pra centavos pode deixar 1-2
// centavos "perdidos" ou "sobrando" que nunca aparecem em lugar nenhum â
// pequeno, mas incomoda numa tela financeira onde a soma devia bater exato.
function arredondarComRestoExato(valores, totalAlvo){
  const totalCentavosAlvo = Math.round((totalAlvo||0) * 100);
  const centavosBase = valores.map(v => Math.floor((v||0) * 100));
  const somaBase = centavosBase.reduce((s,c)=> s+c, 0);
  let restante = totalCentavosAlvo - somaBase;
  // Distribui o restante (positivo ou negativo) 1 centavo de cada vez,
  // priorizando quem tem a maior parte fracionÃ¡ria "perdida" no floor.
  const ordem = valores
    .map((v,i)=>({ i, frac: (v||0)*100 - Math.floor((v||0)*100) }))
    .sort((a,b)=> b.frac - a.frac);
  const resultado = [...centavosBase];
  for(let k=0; k<ordem.length && restante>0; k++){ resultado[ordem[k].i] += 1; restante--; }
  for(let k=ordem.length-1; k>=0 && restante<0; k--){ resultado[ordem[k].i] -= 1; restante++; }
  return resultado.map(c => c/100);
}

// Resumo agregado de todas as vendas de um processo â null quando nÃ£o hÃ¡
// nenhuma venda cadastrada (processo continua no modelo antigo, 1 NF SaÃ­da
// Ãºnica pro processo inteiro).
function calcularVendasResumo(p){
  const vendas = parseVendas(p);
  if(!vendas.length) return null;
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : 0;
  let linhas = vendas.map(venda => ({ venda, ...calcularLucroVenda(p, venda, custoRealTotal) }));
  const totalQtd = totalQuantidadeProdutos(p);
  const qtdAlocada = linhas.reduce((s,l)=> s + l.qtdVenda, 0);

  // CorreÃ§Ã£o de arredondamento (maior resto): sÃ³ faz sentido quando o
  // processo estÃ¡ 100% alocado entre as vendas (senÃ£o a soma parcial dos
  // custos rateados Ã o comportamento correto â ver saldoNaoAlocado) e
  // quando hÃ¡ mais de 1 venda (com 1 venda sÃ³ nÃ£o existe erro de soma pra
  // corrigir). Recalcula custoTotal/lucro/pctLucro de cada linha em cima
  // do custoRateado ajustado.
  if(totalQtd > 0 && qtdAlocada === totalQtd && custoRealTotal > 0 && linhas.length > 1){
    const ajustados = arredondarComRestoExato(linhas.map(l=>l.custoRateado), custoRealTotal);
    linhas = linhas.map((l,i) => {
      const custoRateado = ajustados[i];
      const custoTotal = custoRateado + l.custoDireto;
      const lucro = l.temNf ? (l.nfSaida - custoTotal) : null;
      const pctLucro = (l.temNf && lucro != null && l.nfSaida > 0) ? (lucro / l.nfSaida) : null;
      return { ...l, custoRateado, custoTotal, lucro, pctLucro };
    });
  }

  const nfSaidaTotal = linhas.reduce((s,l)=> s + (l.temNf?l.nfSaida:0), 0);
  const todasComNf = linhas.length>0 && linhas.every(l=>l.temNf);
  const lucroTotal = todasComNf ? linhas.reduce((s,l)=> s + l.lucro, 0) : null;
  return {
    linhas, custosReais, custoRealTotal, totalQtd, qtdAlocada,
    saldoNaoAlocado: totalQtd - qtdAlocada,
    nfSaidaTotal, todasComNf, lucroTotal,
  };
}

function calcularFechamento(p){
  const est = p.estimativa_json || null;
  const nfEntrada = parseFloat(p.nf_entrada_valor);

  // Custo real detalhado (aba "Custos Reais") â quando o processo tem pelo
  // menos um item lanÃ§ado ali, ele Ã© MAIS PRECISO que o cÃ¡lculo grosseiro
  // NF SaÃ­da â NF Entrada (que ignora frete, seguro, impostos, comissÃµes e
  // taxas operacionais â cada processo tem uma combinaÃ§Ã£o diferente do que
  // teve ou nÃ£o). Sem nenhum item lanÃ§ado, mantÃ©m o cÃ¡lculo antigo por NF.
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : null;
  // Margem por taxa (compra Ã venda) â sÃ³ existe quando o usuÃ¡rio tambÃ©m
  // lanÃ§ou valores "cobrado do cliente" na aba Custos Reais, nÃ£o Ã©
  // obrigatÃ³rio preencher. Independente do Lucro Real (que usa a NF SaÃ­da
  // inteira); esta Ã© uma visÃ£o Ã  parte, item a item, das taxas especÃ­ficas.
  const receitaReais = calcularReceitaRealTotal(p);
  const margemTaxas = (custosReais && receitaReais)
    ? { total: receitaReais.total - custosReais.total, custoTotal: custosReais.total, receitaTotal: receitaReais.total }
    : null;

  // Vendas multi-cliente (rateio de custo) â quando o processo foi vendido
  // a mais de um cliente (ver calcularVendasResumo acima), o Lucro Real do
  // processo vira a SOMA do lucro de cada venda (NF dela â sua fatia de
  // custo), e a "NF SaÃ­da" do processo vira a soma das NFs de cada venda.
  // Sem nenhuma venda cadastrada, cai exatamente no cÃ¡lculo antigo abaixo.
  const vendasResumo = calcularVendasResumo(p);
  let nfSaida, temReal, lucroReal, pctLucroReal;
  if(vendasResumo){
    nfSaida = vendasResumo.nfSaidaTotal || null;
    temReal = vendasResumo.linhas.some(l=>l.temNf);
    lucroReal = vendasResumo.todasComNf ? vendasResumo.lucroTotal : null;
    pctLucroReal = (lucroReal != null && nfSaida) ? (lucroReal / nfSaida) : null;
  } else {
    const nfSaidaRaw = parseFloat(p.nf_saida_valor);
    temReal = !isNaN(nfSaidaRaw) && nfSaidaRaw > 0;
    nfSaida = isNaN(nfSaidaRaw) ? null : nfSaidaRaw;
    lucroReal = custosReais
      ? (temReal ? (nfSaida - custoRealTotal) : null)
      : (temReal ? (nfSaida - (isNaN(nfEntrada)?0:nfEntrada)) : null);
    pctLucroReal = (temReal && lucroReal != null) ? (lucroReal / nfSaida) : null;
  }

  let custoEstimado = null, faturamentoEstimado = null, lucroEstimado = null, pctLucroEstimado = null;
  if(est){
    custoEstimado = est.custo_total ?? null;
    if(est.cenarios && est.cenarios.com_st && est.cenarios.com_st.faturamento_total != null){
      faturamentoEstimado = est.cenarios.com_st.faturamento_total;
    } else if(est.faturamento != null){
      faturamentoEstimado = est.faturamento; // cotaÃ§Ãµes salvas antes dos 2 cenÃ¡rios
    }
    if(faturamentoEstimado != null && custoEstimado != null){
      lucroEstimado = faturamentoEstimado - custoEstimado;
      pctLucroEstimado = faturamentoEstimado > 0 ? (lucroEstimado / faturamentoEstimado) : null;
    } else if(est.lucro_bruto != null){
      lucroEstimado = est.lucro_bruto;
      pctLucroEstimado = est.pct_lucro ?? null;
    }
  }

  const temComparacao = temReal && lucroEstimado != null;
  const deltaValor = temComparacao ? (lucroReal - lucroEstimado) : null;
  const deltaPct   = (temComparacao && pctLucroReal != null && pctLucroEstimado != null) ? (pctLucroReal - pctLucroEstimado) : null;

  return {
    temEstimativa: !!est, temReal, temComparacao,
    custoEstimado, faturamentoEstimado, lucroEstimado, pctLucroEstimado,
    nfEntrada: isNaN(nfEntrada)?null:nfEntrada, nfSaida,
    lucroReal, pctLucroReal, deltaValor, deltaPct,
    custosReais, custoRealTotal, // detalhamento por item â null se a aba Custos Reais nunca foi preenchida
    receitaReais, margemTaxas, // margem por taxa (compra Ã venda) â null se "cobrado do cliente" nunca foi preenchido
    vendasResumo, // null se o processo nÃ£o foi vendido a mais de um cliente
  };
}

function renderFechamentoInfo(p){
  const f = calcularFechamento(p);
  const r2 = v => v==null ? 'â' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const pct2 = v => v==null ? 'â' : `${(v*100).toFixed(1)}%`;

  // Antes: sem estimativa_json (processo que nÃ£o passou pela cotaÃ§Ã£o do
  // Calculador) a funÃ§Ã£o parava aqui e nunca mostrava nada â nem o lucro
  // real, mesmo com NF Entrada e NF SaÃ­da jÃ¡ preenchidas na aba Documentos.
  // Ou seja, processo criado direto no Controle nunca tinha como saber a
  // margem, mesmo depois de fechado. Agora sÃ³ cai nesse aviso quando NÃO
  // hÃ¡ estimativa E tambÃ©m nÃ£o hÃ¡ NF SaÃ­da ainda â nesse caso nÃ£o tem
  // mesmo nada pra mostrar.
  if(!f.temEstimativa && !f.temReal){
    return `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;color:var(--muted);font-size:12px;">
      Este processo nÃ£o tem um valor estimado (cotaÃ§Ã£o) nem resultado real (NF Entrada/SaÃ­da) vinculado ainda â preencha a NF Entrada e a NF SaÃ­da na aba Documentos assim que possÃ­vel pra ver a margem aqui.
    </div>`;
  }

  // Quando a aba "Custos Reais" tem pelo menos um item lanÃ§ado, o Lucro Real
  // vem de Faturamento (NF SaÃ­da) â Custo Real Total (soma item a item) em
  // vez da conta grosseira NF SaÃ­da â NF Entrada â mais preciso porque conta
  // frete, seguro, impostos, comissÃµes e taxas operacionais reais tambÃ©m.
  const linhaCustoRealDetalhado = f.custosReais
    ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Real Total (${f.custosReais.count} ${f.custosReais.count===1?'item lanÃ§ado':'itens lanÃ§ados'} na aba Custos Reais)</span><strong>${r2(f.custoRealTotal)}</strong></div>`
    : '';
  // Margem das Taxas (compra Ã venda) â sÃ³ aparece quando o usuÃ¡rio tambÃ©m
  // preencheu "Cobrado do Cliente" em pelo menos um item na aba Custos Reais.
  // Ã uma visÃ£o separada do Lucro Real: mostra quanto sobrou/faltou SÃ nas
  // taxas repassadas ao cliente (ex.: taxa que custou R$ 110 e foi cobrada
  // por USD 55) â nÃ£o mexe no cÃ¡lculo do Lucro Real, que continua usando a
  // NF SaÃ­da inteira.
  const linhaMargemTaxas = f.margemTaxas
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Cobrado do Cliente nas Taxas (${f.receitaReais.count} ${f.receitaReais.count===1?'item':'itens'})</span><strong>${r2(f.margemTaxas.receitaTotal)}</strong></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Margem das Taxas (Cobrado â Pago)</span><strong style="color:${f.margemTaxas.total>=0?'var(--ok)':'var(--err)'}">${r2(f.margemTaxas.total)}</strong></div>
      </div>`
    : '';
  // Vendas multi-cliente (rateio) â quando o processo tem a aba Vendas
  // preenchida, mostra um lembrete de que o Lucro Real acima jÃ¡ Ã© a SOMA de
  // todas as vendas, com um mini-detalhamento por cliente. O rateio/lucro
  // por venda em si Ã© editado e recalculado ao vivo na aba Vendas
  // (renderResumoVendas, em controle-campos.js) â aqui Ã© sÃ³ um resumo
  // read-only pra quem estÃ¡ olhando a aba Fechamento.
  const linhaVendas = f.vendasResumo
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">ð§¾ Vendido a ${f.vendasResumo.linhas.length} cliente${f.vendasResumo.linhas.length===1?'':'s'} (ver aba Vendas)</div>
        ${f.vendasResumo.linhas.map(l=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><span style="color:var(--muted);">${esc(l.venda.cliente||'(sem cliente)')}</span><strong style="color:${l.lucro==null?'var(--muted)':l.lucro>=0?'var(--ok)':'var(--err)'}">${l.temNf?r2(l.lucro):'aguardando NF'}</strong></div>`).join('')}
      </div>`
    : '';
  const linhaReal = f.temReal
    ? `${linhaCustoRealDetalhado}<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Lucro Real${f.custosReais?' (NF SaÃ­da â Custo Real Total)':' (NF SaÃ­da â NF Entrada)'}</span><strong>${r2(f.lucroReal)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroReal)})</span></strong></div>`
    : `${linhaCustoRealDetalhado}<div style="color:var(--muted);font-size:12px;">Ainda nÃ£o hÃ¡ NF SaÃ­da lanÃ§ada â preencha NF Entrada e NF SaÃ­da na aba Documentos pra ver o resultado real aqui.</div>`;

  const corDelta = f.deltaValor==null ? 'var(--muted)' : f.deltaValor >= 0 ? 'var(--ok)' : 'var(--err)';
  const linhaDelta = f.temComparacao
    ? `<div style="margin-top:10px;padding:10px 12px;background:${f.deltaValor>=0?'rgba(22,163,74,.08)':'rgba(220,38,38,.08)'};border-radius:8px;font-weight:700;color:${corDelta};display:flex;justify-content:space-between;">
        <span>${f.deltaValor>=0?'ð Rendeu a mais que o cotado':'ð Rendeu a menos que o cotado'}</span>
        <span>${f.deltaValor>=0?'+':''}${r2(f.deltaValor)}</span>
      </div>`
    : '';

  // Bloco "Estimado na cotaÃ§Ã£o" sÃ³ existe se o processo passou pelo
  // Calculador. Sem isso (processo criado direto no Controle), mostra um
  // aviso curto no lugar, mas o "Resultado real" abaixo continua aparecendo
  // normalmente contanto que NF Entrada/SaÃ­da existam.
  const blocoEstimado = f.temEstimativa
    ? `<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">ð Estimado na cotaÃ§Ã£o</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Total estimado</span><strong>${r2(f.custoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Faturamento estimado (Com S.T.)</span><strong>${r2(f.faturamentoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">Lucro estimado</span><strong>${r2(f.lucroEstimado)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroEstimado)})</span></strong></div>
    </div>`
    : `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--muted);margin-bottom:14px;">
      Este processo nÃ£o passou pela cotaÃ§Ã£o do Calculador â sem valor estimado pra comparar, mas o resultado real abaixo jÃ¡ funciona normalmente.
    </div>`;

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
    ${blocoEstimado}
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">â Resultado real</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">NF Entrada</span><strong>${r2(f.nfEntrada)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">NF SaÃ­da${f.vendasResumo?' (soma das vendas)':''}</span><strong>${r2(f.nfSaida)}</strong></div>
      ${linhaReal}
    </div>
    ${linhaMargemTaxas}
    ${linhaVendas}
    ${linhaDelta}
  </div>`;
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// ALERTAS E NOTIFICAÃÃES
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function verificarAlertas(proc, criarNotif){
  const alertas = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Demurrage
  const diasDemur = demurrageDias(proc);
  if(diasDemur !== null && diasDemur <= 5 && diasDemur >= 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage: ${proc.referencia}`, mensagem:`Vence em ${diasDemur} dia(s)! Container ainda nÃ£o devolvido.`});
  }
  if(diasDemur !== null && diasDemur < 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage VENCIDO: ${proc.referencia}`, mensagem:`Venceu hÃ¡ ${Math.abs(diasDemur)} dia(s). Custos em andamento.`});
  }

  // Alerta ETA: ETA passou e processo ainda estÃ¡ Embarcado
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((hoje - eta)/86400000);
    if(diff > 0){
      alertas.push({tipo:'alerta', titulo:`ETA vencido: ${proc.referencia}`, mensagem:`ETA era ${eta.toLocaleDateString('pt-BR')} â processo ainda Embarcado. Verificar chegada.`});
    }
  }

  // Alerta ETA prÃ³ximo (2 dias)
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((eta - hoje)/86400000);
    if(diff >= 0 && diff <= 2){
      alertas.push({tipo:'info', titulo:`ETA em ${diff === 0 ? 'hoje' : diff + 'd'}: ${proc.referencia}`, mensagem:`Navio previsto para ${eta.toLocaleDateString('pt-BR')}.`});
    }
  }

  // Alerta PI vencimento (prazo pagamento nos prÃ³ximos 5 dias)
  if(proc.pi_data_saldo && !proc.pi_pago){
    const venc = parseDataLocal(proc.pi_data_saldo);
    const diff = Math.ceil((venc - hoje)/86400000);
    if(diff <= 5 && diff >= 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI vence em ${diff}d: ${proc.referencia}`, mensagem:`Saldo da PI vence em ${venc.toLocaleDateString('pt-BR')}.`});
    }
    if(diff < 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI VENCIDO: ${proc.referencia}`, mensagem:`Venceu hÃ¡ ${Math.abs(diff)} dia(s).`});
    }
  }

  if(criarNotif && alertas.length){
    alertas.forEach(a => criarNotificacao(proc.id, a.tipo, a.titulo, a.mensagem));
  }
  return alertas;
}

// Cache em memÃ³ria das notificaÃ§Ãµes jÃ¡ carregadas nesta sessÃ£o, usado sÃ³
// para evitar duplicatas â nÃ£o substitui carregarNotificacoes().
let _notifsCache = [];

async function criarNotificacao(processoId, tipo, titulo, mensagem){
  // Evita criar a mesma notificaÃ§Ã£o de novo a cada save do processo: se jÃ¡
  // existe uma notificaÃ§Ã£o idÃªntica (mesmo processo + mesmo tÃ­tulo) criada
  // nas Ãºltimas 24h, nÃ£o cria outra. Sem isso, salvar o processo vÃ¡rias
  // vezes no mesmo dia (comum durante ajustes) gerava um alerta duplicado
  // a cada save, mesmo sem nada relacionado ao alerta ter mudado.
  try{
    if(!_notifsCache.length){
      const r = await fetch('/api/controle/v2/notificacoes');
      const d = await r.json();
      if(d.ok) _notifsCache = d.notificacoes||[];
    }
    const ja_existe = _notifsCache.some(n=>{
      if(n.processo_id!==processoId || n.titulo!==titulo) return false;
      if(!n.created_at) return false;
      const horas = (Date.now()-new Date(n.created_at).getTime())/3600000;
      return horas < 24;
    });
    if(ja_existe) return;
  }catch(e){ /* se a checagem falhar, segue e cria normalmente */ }

  fetch('/api/controle/v2/notificacao', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({processo_id: processoId, tipo, titulo, mensagem})
  }).then(()=>{ _notifsCache=[]; }).catch(()=>{}); // invalida cache apÃ³s criar
}

async function carregarNotificacoes(){
  try{
    const r = await fetch('/api/controle/v2/notificacoes');
    const d = await r.json();
    if(!d.ok) return;
    const notifs = d.notificacoes || [];
    const naoLidas = notifs.filter(n => !n.lida_por || !n.lida_por.includes(_user.usuario));
    const count = naoLidas.length;
    const el = document.getElementById('notif-count');
    if(el){
      el.textContent = count;
      el.style.display = count > 0 ? 'block' : 'none';
    }
    // Renderizar lista
    const list = document.getElementById('notif-list');
    if(!list) return;
    if(!notifs.length){
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma notificaÃ§Ã£o</div>';
      return;
    }
    list.innerHTML = notifs.slice(0,30).map(n => {
      const naoLida = !n.lida_por || !n.lida_por.includes(_user.usuario);
      const cor = n.tipo==='urgente'?'var(--err)':n.tipo==='alerta'?'var(--warn)':'var(--ac)';
      const iniciais = (n.created_by||'?').slice(0,2).toUpperCase();
      const tempo = n.created_at ? tempoRelativo(n.created_at) : '';
      return `<div class="notif-item ${naoLida?'unread':''} ${n.tipo}" onclick="abrirNotificacao(${n.id},'${n.processo_id||''}')">
        <div class="notif-row">
          <div class="notif-avatar" style="background:${cor}">${iniciais}</div>
          <div class="notif-content">
            <div class="notif-title">${esc(n.titulo)}</div>
            <div class="notif-msg">${esc(n.mensagem)}</div>
            <div class="notif-time">${tempo}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }catch(e){}
}

async function marcarLida(id){
  fetch('/api/controle/v2/notificacao/'+id+'/lida', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({usuario: _user.usuario})
  }).then(()=>carregarNotificacoes()).catch(()=>{});
}

// Clicar numa notificaÃ§Ã£o deve marcÃ¡-la como lida E abrir o processo que ela
// se refere â antes sÃ³ marcava como lida, sem nenhuma forma de chegar ao
// processo a partir da notificaÃ§Ã£o (era preciso buscar manualmente na lista).
function abrirNotificacao(id, processoId){
  marcarLida(id);
  toggleNotif(); // fecha o painel de notificaÃ§Ãµes
  if(processoId){
    abrirProcesso(processoId);
  } else {
    showToast('Esta notificaÃ§Ã£o nÃ£o estÃ¡ vinculada a um processo','info');
  }
}

async function marcarTodasLidas(){
  try{
    const r = await fetch('/api/controle/v2/notificacoes');
    const d = await r.json();
    if(!d.ok) return;
    const naoLidas = (d.notificacoes||[]).filter(n=>!n.lida_por||!n.lida_por.includes(_user.usuario));
    await Promise.all(naoLidas.map(n=>
      fetch('/api/controle/v2/notificacao/'+n.id+'/lida',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({usuario:_user.usuario})
      })
    ));
    await carregarNotificacoes();
    showToast('Todas as notificaÃ§Ãµes marcadas como lidas','ok');
  }catch(e){ showToast('Erro ao marcar notificaÃ§Ãµes','err'); }
}

function toggleNotif(){
  _notifAberto = !_notifAberto;
  document.getElementById('notif-panel').classList.toggle('open', _notifAberto);
  if(_notifAberto) carregarNotificacoes();
}

function tempoRelativo(isoDate){
  const diff = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(diff/60000);
  if(min < 1) return 'agora';
  if(min < 60) return `${min}min atrÃ¡s`;
  const h = Math.floor(min/60);
  if(h < 24) return `${h}h atrÃ¡s`;
  const d = Math.floor(h/24);
  return `${d}d atrÃ¡s`;
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// RENDER
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// RÃ³tulos amigÃ¡veis para os filtros financeiros especiais (usados pelos
// cards clicÃ¡veis do Dashboard) â sem isso, o usuÃ¡rio nÃ£o tem como saber
// qual filtro estÃ¡ ativo depois de clicar num card e ir para a tabela.
const FILTRO_FINANCEIRO_LABEL = {
  __chegada_7d:         'ð¢ Chegada prevista (ETA) nos prÃ³ximos 7 dias',
  __pi_vence_30d:       'ð° Saldo a pagar nos prÃ³ximos 30 dias',
  __capital_parado:     'ð¦ Capital parado em estoque/trÃ¢nsito (pago, aguardando finalizar)',
  __pi_aberto:          'ð° Processos com PI em aberto',
  __pi_pago:            'â Processos com PI jÃ¡ paga',
  __pi_vencido:         'ð¨ Pagamentos vencidos',
  __pi_vence_semana:    'â  Pagamentos vencendo em 7 dias',
  __nf_entrada_periodo: 'ð¥ NF Entrada no perÃ­odo selecionado',
  __nf_saida_periodo:   'ð¤ NF SaÃ­da no perÃ­odo selecionado',
  __demur_aberto:       'â± Demurrage em aberto',
  __cambio_periodo:     'ð± CÃ¢mbio a pagar no perÃ­odo selecionado',
};

function renderFiltroFinanceiroAtivo(){
  const el = document.getElementById('filtro-financeiro-ativo');
  if(!el) return;
  const label = FILTRO_FINANCEIRO_LABEL[_faseFilter];
  if(!label){ el.innerHTML=''; return; }
  el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;background:rgba(26,127,212,.06);border:1px solid rgba(26,127,212,.2);border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;font-weight:600;color:var(--ac);">
    <span>${label}</span>
    <button type="button" onclick="setFaseFilter('')" style="margin-left:auto;border:none;background:none;color:var(--ac);font-weight:700;cursor:pointer;font-size:12px;">â Limpar filtro</button>
  </div>`;
}

function renderFaseFilter(){
  const el = document.getElementById('fase-filter');
  if(!el) return;
  el.innerHTML = `<div class="fase-pill ${_faseFilter===''?'active':''}" onclick="setFaseFilter('')">Todos</div>` +
    FASES.map(f=>`<div class="fase-pill ${_faseFilter===f.id?'active':''}" onclick="setFaseFilter('${f.id}')">${f.icon} ${f.label}</div>`).join('');
}

// Fecha todos os dashboards (Executivo, Financeiro, Resultado, NarcÃ©lio,
// Carregamento) e desmarca seus itens no menu lateral. Chamado ao trocar
// de aba/fase ou ao abrir outro dashboard, para a tela trocar de fato em
// vez de empilhar dashboard + tabela (ou dois dashboards ao mesmo tempo).
function fecharTodosDashboards(){
  ['executivo','financeiro','resultado','narcelio','carregamento'].forEach(function(id){
    var el = document.getElementById('dash-'+id);
    if(el) el.style.display = 'none';
    var menu = document.getElementById('menu-'+id);
    if(menu) menu.classList.remove('active');
  });

document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = '');
}

function setFaseFilter(fase){
  fecharTodosDashboards();
  _faseFilter = fase;
  _pagina = 1;
  renderFaseFilter();
  renderFiltroFinanceiroAtivo();
  render();
  // Atualizar sidebar
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  if(fase==='') document.getElementById('menu-todos')?.classList.add('active');
  else if(fase==='__alertas') document.getElementById('menu-alertas')?.classList.add('active');
}

// Usada pelos cards clicÃ¡veis do Dashboard Executivo/Financeiro: fecha o
// dashboard que estiver aberto e mostra a tabela principal jÃ¡ filtrada,
// para o usuÃ¡rio poder ver e agir diretamente nos processos daquele nÃºmero
// (em vez do card ser sÃ³ um nÃºmero estÃ¡tico no topo).
function abrirComFiltro(filtro){
  const dashExec = document.getElementById('dash-executivo');
  const dashFin  = document.getElementById('dash-financeiro');
  if(dashExec) dashExec.style.display = 'none';
  if(dashFin)  dashFin.style.display  = 'none';
  document.getElementById('menu-executivo')?.classList.remove('active');
  document.getElementById('menu-financeiro')?.classList.remove('active');
  setFaseFilter(filtro);
  document.querySelector('.table-wrap')?.scrollIntoView({behavior:'smooth', block:'start'});
}

function renderStats(){
  const el = document.getElementById('stats-grid');
  if(!el) return;
  const total = _processos.length;
  const emAndamento = _processos.filter(p => p.fase !== 'FINALIZADO').length;
  const finalizados = _processos.filter(p => p.fase === 'FINALIZADO').length;
  // Mantido para o badge "Com alertas" da sidebar (o card do topo agora
  // mostra "Chegada em 7d" no lugar, mas o item do menu lateral continua).
  const comAlerta = _processos.filter(p => verificarAlertas(p,false).length > 0).length;
  // Demurrage crÃ­tico
  const demurCrit = _processos.filter(p => { const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }).length;
  const chegando7d = _processos.filter(p => chegandoEmDias(p,7)).length;

  const refsDuplicadas = (() => {
const norm = s => (s||'').toString().trim().toUpperCase().replace(/\s+/g,'');
const cont = {};
_processos.forEach(p => { const r = norm(p.referencia); if(r) cont[r]=(cont[r]||0)+1; });
return _processos.filter(p => cont[norm(p.referencia)] > 1).length;
})();

const stats = [
    {num:total,       label:'Total',          cor:'var(--ac)',  filtro:''},
    {num:emAndamento, label:'Em andamento',    cor:'var(--warn)',filtro:'__andamento'},
    {num:chegando7d,  label:'Chegada em 7d',  cor:'var(--info)',filtro:'__chegada_7d'},
    {num:demurCrit,   label:'Demurrage â¤5d',  cor:'var(--err)', filtro:'__demur'},
    {num:finalizados, label:'Finalizados',     cor:'var(--ok)',  filtro:'FINALIZADO'},
  ];
if (refsDuplicadas > 0) stats.push({num:refsDuplicadas, label:'ReferÃªncia duplicada', cor:'var(--err)', filtro:'__ref_duplicada'});

  // Badges sidebar por fase
  const faseCount = {};
  _processos.forEach(p=>{ faseCount[p.fase] = (faseCount[p.fase]||0)+1; });
  ['PI','AGUARDANDO_EMBARQUE','EMBARCADO','DESEMBARCADO','REGISTRO_DI',
   'PARAMETRIZACAO','CARREGAMENTO','FATURAMENTO','DEVOLUCAO_VAZIO','FINALIZADO'].forEach(f=>{
    const el = document.getElementById('sb-'+f);
    if(!el) return;
    const n = faseCount[f]||0;
    el.textContent = n;
    el.style.display = n > 0 ? 'inline' : 'none';
  });
  const badgeAlerta = document.getElementById('badge-alertas');
  if(badgeAlerta){ badgeAlerta.textContent=comAlerta; badgeAlerta.style.display=comAlerta>0?'block':'none'; }
  document.getElementById('badge-total').textContent = total;

  el.innerHTML = stats.map(s=>`
    <div class="stat-card" onclick="setFaseFilter('${s.filtro}')">
      <div class="stat-num" style="color:${s.cor}">${s.num}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');
}

// Mapa de filtros especiais por "fase" virtual (chaves comeÃ§ando com "__",
// usadas pelos cards clicÃ¡veis dos dashboards Executivo/Financeiro). Cada
// funÃ§Ã£o recebe a lista jÃ¡ filtrada por busca/data e devolve a lista final.
// Antes isso era uma cadeia crescente de if/else (uma comparaÃ§Ã£o de string
// atrÃ¡s da outra) â um mapa deixa mais fÃ¡cil ver todos os filtros disponÃ­veis
// de uma vez, e adicionar um novo sem alterar uma cadeia gigante.
const FILTROS_FASE_ESPECIAIS = {
  __alertas:    lista => lista.filter(p=>verificarAlertas(p,false).length>0),
  __andamento:  lista => lista.filter(p=>p.fase!=='FINALIZADO'),
  __demur:      lista => lista.filter(p=>{ const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }),
  __chegada_7d: lista => lista.filter(p=>chegandoEmDias(p,7)),
__ref_duplicada: lista => {
const norm = s => (s||'').toString().trim().toUpperCase().replace(/\s+/g,'');
const cont = {};
lista.forEach(p => { const r = norm(p.referencia); if(r) cont[r]=(cont[r]||0)+1; });
return lista.filter(p => cont[norm(p.referencia)] > 1);
},
  // Filtros financeiros â usados pelos cards clicÃ¡veis do Dashboard Financeiro/Executivo
  __pi_aberto:  lista => lista.filter(p=>p.fase!=='FINALIZADO' && p.pi_valor_usd && !p.pi_pago),
  __pi_pago:    lista => lista.filter(p=>p.fase!=='FINALIZADO' && p.pi_valor_usd && p.pi_pago),
  __pi_vencido: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_data_saldo) return false;
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    return parseDataLocal(p.pi_data_saldo) < hoje;
  }),
  __pi_vence_semana: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_data_saldo) return false;
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    const semFim=new Date(hoje); semFim.setDate(hoje.getDate()+7);
    const d=parseDataLocal(p.pi_data_saldo);
    return d>=hoje && d<=semFim;
  }),
  __pi_vence_30d: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_valor_usd) return false;
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    const lim=new Date(hoje); lim.setDate(hoje.getDate()+30);
    const dentro = d => { if(!d) return false; const dt=new Date(d+'T00:00:00'); return dt>=hoje && dt<=lim; };
    return dentro(p.pi_data_entrada) || dentro(p.pi_data_saldo);
  }),
  // Capital parado em estoque/trÃ¢nsito â usado pelo card do Dashboard
  // Financeiro (v2): jÃ¡ pago integralmente, mas o processo ainda nÃ£o foi
  // finalizado (mercadoria ainda nÃ£o virou venda concluÃ­da).
  __capital_parado: lista => lista.filter(p=>p.pi_pago && p.fase!=='FINALIZADO'),
  __nf_entrada_periodo: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||!p.nf_entrada_data) return false;
    const {ini,fim} = calcularPeriodo('financeiro');
    const d=parseDataLocal(p.nf_entrada_data);
    return d>=ini && d<=fim;
  }),
  __nf_saida_periodo: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||!p.nf_saida_data) return false;
    const {ini,fim} = calcularPeriodo('financeiro');
    const d=parseDataLocal(p.nf_saida_data);
    return d>=ini && d<=fim;
  }),
  __demur_aberto: lista => lista.filter(p=>!p.data_devolucao_vazio && p.demurrage_vencimento),
  __cambio_periodo: lista => lista.filter(p=>{
    if(p.fase==='FINALIZADO'||p.pi_pago||!p.pi_valor_usd) return false;
    const {ini,fim} = calcularPeriodo('financeiro');
    const checar = data => { if(!data) return false; const d=parseDataLocal(data); return d>=ini && d<=fim; };
    return checar(p.pi_data_saldo) || checar(p.pi_data_entrada);
  }),
};

function filtrarProcessos(ignorarFaseFilter){
  let lista = [..._processos];
  const q = (document.getElementById('search')?.value||'').toLowerCase().trim();

  if(q) lista = lista.filter(p=>
    (p.referencia||'').toLowerCase().includes(q)||
    (p.fornecedor||'').toLowerCase().includes(q)||
    (p.cliente||'').toLowerCase().includes(q)||
    (p.container||'').toLowerCase().includes(q)||
    (p.hbl||'').toLowerCase().includes(q)||
    (p.mbl||'').toLowerCase().includes(q)||
    (p.numero_di||'').toLowerCase().includes(q)||
    (p.navio||'').toLowerCase().includes(q)||
    (p.armador||'').toLowerCase().includes(q)||
    (p.booking_numero||'').toLowerCase().includes(q)||
    (p.brand||'').toLowerCase().includes(q)||
clientesDoProcesso(p).some(cl=>cl.toLowerCase().includes(q))
  );

  // Filtro por data
  const dtDe  = document.getElementById('filtro-data-de')?.value;
  const dtAte = document.getElementById('filtro-data-ate')?.value;
  const dtCampo = document.getElementById('filtro-data-campo')?.value || 'eta';
  if(dtDe || dtAte){
    lista = lista.filter(p=>{
      const val = p[dtCampo];
      if(!val) return false;
      if(dtDe  && val < dtDe)  return false;
      if(dtAte && val > dtAte) return false;
      return true;
    });
  }

  if(_faseFilter && !ignorarFaseFilter){
    const filtroEspecial = FILTROS_FASE_ESPECIAIS[_faseFilter];
    lista = filtroEspecial ? filtroEspecial(lista) : lista.filter(p=>p.fase===_faseFilter);
  }

  // Filtro por cliente
  const filtroCliente = document.getElementById('filtro-cliente')?.value||'';
  if(filtroCliente) lista = lista.filter(p=>clientesDoProcesso(p).includes(filtroCliente));

  // Filtro por finalidade
  const filtroFinalidade = document.getElementById('filtro-finalidade')?.value||'';
  if(filtroFinalidade) lista = lista.filter(p=>p.finalidade === filtroFinalidade);

  // Filtro por pendÃªncia de revisÃ£o
  const filtroPendencia = document.getElementById('filtro-pendencia')?.checked;
  if(filtroPendencia) lista = lista.filter(p=>!!p.pendencia_revisao);

  return lista;
}

function render(){
  const lista = filtrarProcessos();
  const total = lista.length;
  const totalPags = Math.max(1, Math.ceil(total/POR_PAGINA));
  _pagina = Math.min(_pagina, totalPags);
  const inicio = (_pagina-1)*POR_PAGINA;
  const pagina = lista.slice(inicio, inicio+POR_PAGINA);

  const tbody = document.getElementById('table-body');
  if(!tbody) return;

  if(!pagina.length){
    tbody.innerHTML = `<div class="empty"><div class="empty-icon">ð­</div><div class="empty-text">Nenhum processo encontrado</div></div>`;
  } else {
    tbody.innerHTML = pagina.map(p=>{
      const fase = FASES.find(f=>f.id===p.fase)||FASES[0];
      const etaDate = p.eta ? parseDataLocal(p.eta).toLocaleDateString('pt-BR') : 'â';
      const chegadaDate = p.data_chegada ? parseDataLocal(p.data_chegada).toLocaleDateString('pt-BR') : '';
      const dataDisplay = chegadaDate || etaDate;
      const finBadge = p.pi_pagamento ? `<span class="fin-badge fin-${p.pi_pagamento}">${p.pi_pagamento==='ENTRADA_SALDO'?'ENT+SLD':p.pi_pagamento}</span>` : 'â';
      const finalidadeLabel = {IMPORTACAO_DIRETA:'Direto', ENCOMENDA:'Encomenda', CONTA_E_ORDEM:'Conta e Ordem'}[p.finalidade] || '';
      const finalidadeBadge = finalidadeLabel ? `<span style="font-size:9px;font-weight:700;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;margin-left:4px;color:var(--muted);">${finalidadeLabel}</span>` : '';
      const pendenciaBadge = p.pendencia_revisao ? `<span title="${esc(p.pendencia_revisao).replace(/"/g,'&quot;')}" style="font-size:10px;font-weight:700;background:rgba(243,156,18,.15);border:1px solid rgba(243,156,18,.4);border-radius:4px;padding:1px 6px;margin-left:4px;color:#f39c12;">â  Revisar</span>` : '';
      // referencia/fornecedor sÃ£o texto livre (fornecedor Ã s vezes vem de
      // extraÃ§Ã£o por IA de documento externo) â escapar sempre antes de
      // colocar em innerHTML, senÃ£o um valor malicioso/malformado vira HTML
      // executÃ¡vel pra QUALQUER usuÃ¡rio que abrir esta lista (XSS
      // persistente). Ver esc() em controle-campos.js.
      return `<div class="table-row" onclick="abrirProcesso('${p.id}')">
        <div class="td td-ref" data-label="">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;row-gap:2px;">
            <span>${esc(p.referencia)||'â'}</span>${finalidadeBadge}${pendenciaBadge}
          </div>
        </div>
        <div class="td td-forn" data-label="Fornecedor">${esc(p.fornecedor)||'â'}</div>
        <div class="td" data-label="Fase" onclick="event.stopPropagation()" style="min-width:0;">
          <span class="inline-edit" onclick="inlineEditFase('${p.id}',this)" style="display:inline-block;max-width:100%;">
            <span class="fase-badge fase-${p.fase}">${fase.icon} ${fase.label}</span>
          </span>
        </div>
        <div class="td td-date" data-label="ETA / Chegada" onclick="event.stopPropagation()">
          <span class="inline-edit" onclick="inlineEditData('${p.id}','eta',this)" title="Clique para editar ETA">${dataDisplay}</span>
        </div>
        <div class="td" data-label="Demurrage">${demurrageDisplay(p)}</div>
        <div class="td" data-label="Financeiro">${finBadge}</div>
        <div class="td" data-label="AÃ§Ãµes">
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();abrirProcesso('${p.id}')">Abrir</button>
        </div>
      </div>`;
    }).join('');
  }

  // PaginaÃ§Ã£o
  const pag = document.getElementById('paginacao');
  if(pag){
    if(totalPags <= 1){ pag.innerHTML=''; return; }
    let html = `<button class="pag-btn" onclick="_pagina--;render()" ${_pagina<=1?'disabled':''}>â¹</button>`;
    for(let i=1;i<=totalPags;i++){
      if(i===1||i===totalPags||Math.abs(i-_pagina)<=1)
        html+=`<button class="pag-btn ${i===_pagina?'active':''}" onclick="_pagina=${i};render()">${i}</button>`;
      else if(Math.abs(i-_pagina)===2)
        html+=`<span class="pag-info">â¦</span>`;
    }
    html+=`<button class="pag-btn" onclick="_pagina++;render()" ${_pagina>=totalPags?'disabled':''}>âº</button>`;
    html+=`<span class="pag-info">${total} processos</span>`;
    pag.innerHTML = html;
  }
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// MODAL â ABRIR / NOVO
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
