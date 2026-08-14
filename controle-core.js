// controle-core.js
// 
// Estado global, boot (login/DOMContentLoaded), cÃÂ¢mbio, CRUD de processos (API), cÃÂ¡lculo de fase/demurrage/fechamento, notificaÃÂ§ÃÂµes, filtros/stats e a renderizaÃÂ§ÃÂ£o da lista principal.
//
// Parte do controle_v2.html, extraÃÂ­do do <script> ÃÂºnico original pra
// facilitar manutenÃÂ§ÃÂ£o. Carregado via <script src> junto com os outros
// mÃÂ³dulos (ver controle_v2.html) Ã¢ÂÂ nÃÂ£o ÃÂ© um ES module, entÃÂ£o todo
// estado (let/const de topo) e funÃÂ§ÃÂµes aqui continuam visÃÂ­veis pros
// outros arquivos, exatamente como estavam quando tudo era um sÃÂ³
// <script>. controle-core.js precisa carregar ANTES dos demais (ÃÂ©
// quem declara o estado global: _processos, _user, FASES etc.).
//
// Ã¢ÂÂÃ¢ÂÂ SESSÃÂO EXPIRADA: mensagem clara em vez de erro de parse Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Quando a sessÃÂ£o cai (ex.: reinÃÂ­cio do servidor), as rotas protegidas
// redirecionam pra /login (HTML) em vez de responder JSON. O cÃÂ³digo que
// chama fetch(...).then(r=>r.json()) entÃÂ£o quebra com um erro confuso tipo
// "Unexpected token '<' ... is not valid JSON". Este wrapper detecta esse
// redirecionamento e troca por uma mensagem que o usuÃÂ¡rio entende, usando os
// mesmos catch() que jÃÂ¡ existem em cada tela.
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(...args){
    const res = await _fetch(...args);
    if (res.redirected && res.url.startsWith(location.origin) && res.url.includes('/login')) {
      throw new Error('SessÃÂ£o expirada. Abra outra aba, faÃÂ§a login novamente e tente de novo (seus dados nÃÂ£o foram perdidos).');
    }
    return res;
  };
})();

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// UUID Ã¢ÂÂ compatÃÂ­vel com Safari, Chrome, Firefox
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function gerarUUID(){
  // Usar crypto.randomUUID se disponÃÂ­vel (Chrome, Firefox, Edge)
  if(typeof crypto !== 'undefined' && crypto.randomUUID){
    return crypto.randomUUID();
  }
  // Fallback para Safari e browsers mais antigos
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  // ÃÂltimo fallback: Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

// Analisa uma data "sem hora" (ex.: "2026-07-18", vinda de <input type=date>
// ou do banco) SEMPRE no fuso LOCAL do navegador, nunca em UTC.
// `new Date('2026-07-18')` (sem hora) ÃÂ© interpretado pelo JS como meia-noite
// UTC Ã¢ÂÂ em fusos negativos (ex.: Brasil, UTC-3) isso exibe/compara como o
// dia ANTERIOR (17/07) em vez do dia certo. `new Date('2026-07-18T00:00:00')`
// (sem "Z") ÃÂ© interpretado em horÃÂ¡rio LOCAL, entÃÂ£o bate com o que a pessoa
// realmente digitou. Antes deste helper, os dois estilos apareciam
// misturados neste arquivo (e em controle-dashboards.js/controle-export.js)
// pro MESMO tipo de campo Ã¢ÂÂ ex.: renderDemurInfo() lia data_chegada sem
// sufixo (UTC) enquanto calcularFase() lia o mesmo campo com sufixo (local),
// podendo mostrar dias diferentes pro mesmo processo em telas diferentes.
// Use esta funÃÂ§ÃÂ£o pra qualquer campo de data-sÃÂ³ (data_chegada, eta,
// demurrage_vencimento, pi_data_saldo, nf_entrada_data, nf_saida_data etc.).
// Para timestamps completos (created_at/updated_at, que jÃÂ¡ vÃÂªm com hora e
// "Z" de toISOString()), continue usando new Date(...) direto Ã¢ÂÂ nÃÂ£o passar
// por aqui.
function parseDataLocal(str){
  return str ? new Date(str + 'T00:00:00') : null;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// ESTADO
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
let _user = null;
let _processos = [];
let _faseFilter = '';
let _searchText = '';
let _pagina = 1;
const POR_PAGINA = 50;
let _editando = null; // processo sendo editado
// Snapshot do processo exatamente como veio do servidor quando o modal foi
// aberto (ou {} pra um processo novo) Ã¢ÂÂ usado sÃÂ³ pra saber quais campos o
// usuÃÂ¡rio de fato alterou nesta sessÃÂ£o de ediÃÂ§ÃÂ£o (ver coletarESalvar). Nunca
// ÃÂ© mutado depois de setado; existe sÃÂ³ pra comparaÃÂ§ÃÂ£o, nÃÂ£o ÃÂ© enviado ao
// servidor. ConcorrÃÂªncia: com vÃÂ¡rios usuÃÂ¡rios editando processos ao mesmo
// tempo, salvar o processo inteiro sempre que alguÃÂ©m clica em Salvar
// sobrescrevia silenciosamente qualquer campo que outra pessoa tivesse
// alterado nesse meio tempo (quem salvasse por ÃÂºltimo "vencia" em TUDO, nÃÂ£o
// sÃÂ³ no que de fato editou). Agora sÃÂ³ os campos realmente alterados nesta
// sessÃÂ£o sÃÂ£o enviados Ã¢ÂÂ os demais ficam intocados no banco.
let _editandoOriginal = null;
let _notifAberto = false;
let _cambio = { USD: 1, BRL: 1, EUR: 1 };

// Ã¢ÂÂÃ¢ÂÂ URL por processo (task #59) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// _baseUrlPath ÃÂ© a tela "de baixo" (/controle ou /financeiro) Ã¢ÂÂ pra onde
// a URL volta quando o painel lateral do processo fecha. Se a pÃÂ¡gina jÃÂ¡
// carregou num deep link (ex: /controle/UD26-005), guardamos a referÃÂªncia
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

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// INIT
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
window.addEventListener('DOMContentLoaded', function(){
  fetch('/api/me').then(r=>r.json()).then(d=>{
    if(!d.logado){ location.href='/login?destino='+encodeURIComponent(location.pathname); return; }
    _user = d;
    document.getElementById('user-badge').textContent = d.displayName || d.usuario;
    // Link do Dashboard NarcÃÂ©lio sÃÂ³ aparece pro prÃÂ³prio usuÃÂ¡rio narcelio Ã¢ÂÂ
    // cosmÃÂ©tico (a proteÃÂ§ÃÂ£o real ÃÂ© o back-end em GET /narcelio, ver
    // server.js), mas evita mostrar um link "quebrado" (403) pra quem nÃÂ£o
    // tem acesso.
    document.getElementById('menu-narcelio')?.style.setProperty('display', ['narcelio','suporte'].includes(d.usuario) ? '' : 'none');
// BotÃÂ£o "Gerar Follow-up Semanal" (task #327): sÃÂ³ visÃÂ­vel pra usuÃÂ¡rios
// gerente Ã¢ÂÂ mesma role jÃÂ¡ usada pelo back-end em POST /api/admin/
// followup-semanal (ver server.js), cosmÃÂ©tico aqui (a proteÃÂ§ÃÂ£o real ÃÂ©
// o back-end checar req.session.role==='gerente').
document.getElementById('btn-followup-semanal')?.style.setProperty('display', d.role==='gerente' ? '' : 'none');
    carregarCambio();
    carregarProcessos().then(()=>{
      if(location.pathname==='/financeiro') ativarTelaFinanceiroExclusiva();
      if(location.pathname==='/resultado') ativarTelaResultadoExclusiva();
      if(location.pathname==='/narcelio') ativarTelaNarcelioExclusiva();
      // Deep-link ?processo=<id> Ã¢ÂÂ usado pelo Calculador pra abrir direto o
      // processo recÃÂ©m-criado ao aprovar uma cotaÃÂ§ÃÂ£o (ver aprovarCotacao()
      // em calculador.html). SÃÂ³ tenta abrir depois que a lista carregou,
      // senÃÂ£o abrirProcesso() nÃÂ£o acha o processo em _processos ainda.
      const idDeepLink = new URLSearchParams(location.search).get('processo');
      if(idDeepLink){
        const achou = _processos.some(p=>p.id===idDeepLink);
        if(achou) abrirProcesso(idDeepLink);
        else showToast('Processo recÃÂ©m-criado ainda nÃÂ£o apareceu na lista Ã¢ÂÂ atualize a pÃÂ¡gina em alguns segundos', 'err');
      }
    });
    renderFaseFilter();
    // Auto-refresh a cada 30s
    setInterval(function(){ if(!document.getElementById('modal-bg').classList.contains('open')) carregarProcessos(true); }, 30000);
  });
});

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// TELA EXCLUSIVA /financeiro Ã¢ÂÂ mesma pÃÂ¡gina (controle_v2.html) e mesmo
// JS do Controle normal, sÃÂ³ que ao carregar em /financeiro a tela jÃÂ¡ abre
// direto no Dashboard Financeiro, com o que ÃÂ© sobre "lista de processos"
// (busca, filtros de fase, cards de status) escondido Ã¢ÂÂ foco sÃÂ³ no
// financeiro. A TABELA de processos continua existindo mais abaixo (nÃÂ£o ÃÂ©
// removida do DOM), porque os cards e a lista de pagamentos do Dashboard
// Financeiro contam com ela pra "abrir o processo" ao clicar numa linha e
// pro drill-down dos filtros (Saldo a Pagar, ExposiÃÂ§ÃÂ£o, Capital Parado)
// funcionar exatamente como jÃÂ¡ funciona dentro do Controle Ã¢ÂÂ reaproveitar
// em vez de duplicar essa lÃÂ³gica evita ter duas versÃÂµes de "abrir
// processo" pra manter sincronizadas.
function ativarTelaFinanceiroExclusiva(){
  document.title = 'IMPAK Ã¢ÂÂ Dashboard Financeiro';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Financeiro';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  // Sidebar: esconde "VisÃÂ£o" e "Por fase" (nÃÂ£o fazem sentido sem a busca/
  // lista principal em destaque) Ã¢ÂÂ mantÃÂ©m Dashboard Executivo e Cadastros.
  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-financeiro')?.classList.add('active');

  const dashFin = document.getElementById('dash-financeiro');
  if(dashFin) dashFin.style.display = 'block';
  renderDashFinanceiro();
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// TELA EXCLUSIVA /resultado Ã¢ÂÂ mesmo esquema do /financeiro acima: o
// Dashboard Resultado responde "quanto lucramos de verdade" cruzando o
// estimado na cotaÃÂ§ÃÂ£o (estimativa_json, gravado ao aprovar no Calculador)
// com o resultado real de cada processo (calcularFechamento Ã¢ÂÂ NF SaÃÂ­da Ã¢ÂÂ
// Custo Real Total). Reaproveita _processos e calcularFechamento() em vez
// de duplicar essa lÃÂ³gica.
function ativarTelaResultadoExclusiva(){
  document.title = 'IMPAK Ã¢ÂÂ Dashboard Resultado';
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

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// TRAVA DE PROCESSO ("Fechar Processo") Ã¢ÂÂ ver server.js (POST /api/
// controle/v2/processo) pra a validaÃÂ§ÃÂ£o que de fato importa (o front-end
// aqui sÃÂ³ evita o usuÃÂ¡rio clicar sem querer; quem garante que ninguÃÂ©m
// edita um processo fechado ÃÂ© o servidor).
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// TELA EXCLUSIVA /narcelio Ã¢ÂÂ visÃÂ£o do dono da empresa: containers por fase
// (PI recebida/previsÃÂ£o de embarque/embarcado/chegando), faturamento por
// perÃÂ­odo, estoque parado no armazÃÂ©m (NF entrada lanÃÂ§ada + NF saÃÂ­da com
// CFOP 5905 ou ainda nÃÂ£o emitida) e previsÃÂ£o de recurso de numerÃÂ¡rio
// (fluxo de caixa combinando pagamentos de PI com custos reais do
// processo). Acesso jÃÂ¡ ÃÂ© restrito no back-end (ver /narcelio em
// server.js) Ã¢ÂÂ aqui ÃÂ© sÃÂ³ a apresentaÃÂ§ÃÂ£o.
function ativarTelaNarcelioExclusiva(){
  document.title = 'IMPAK Ã¢ÂÂ Dashboard NarcÃÂ©lio';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard NarcÃÂ©lio';

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
  if(!confirm('Fechar este processo? NF, Custos Reais e o resultado (lucro) ficam travados Ã¢ÂÂ sÃÂ³ um gerente pode reabrir depois.')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, fechado:true } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('Ã°ÂÂÂ Processo fechado','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao fechar: '+(d.erro||''),'err');
}

async function reabrirProcesso(id){
  if(!confirm('Reabrir este processo para ediÃÂ§ÃÂ£o?')) return;
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo:{ id, fechado:false } })
  });
  const d = await r.json();
  if(d.ok){
    showToast('Ã°ÂÂÂ Processo reaberto','ok');
    await carregarProcessos(true);
    const p = _processos.find(p=>p.id===id);
    if(p){ _editando = {...p, _camposIA:{}}; _editandoOriginal = {...p}; renderModal(); }
  } else showToast('Erro ao reabrir: '+(d.erro||''),'err');
}

// Dispara na hora o e-mail de follow-up semanal (task #327) Ã¢ÂÂ mesma rota
// usada pelo job automÃÂ¡tico de domingo (ver server.js,
// POST /api/admin/followup-semanal), sÃÂ³ que sob demanda. Restrito a
// gerente no back-end; o botÃÂ£o em si jÃÂ¡ fica escondido no boot (ver
// DOMContentLoaded acima) pra quem nÃÂ£o ÃÂ© gerente.
async function gerarFollowUpManual(){
showToast('Gerando follow-up semanal...','info');
try{
const r = await fetch('/api/admin/followup-semanal', { method:'POST' });
const d = await r.json();
if(d.ok) showToast(`Ã¢ÂÂ Follow-up enviado (${d.processos} processo${d.processos===1?'':'s'})`,'ok');
else showToast('Erro ao gerar follow-up: '+(d.erro||''),'err');
}catch(e){ showToast('Erro de rede ao gerar follow-up: '+e.message,'err'); }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// CÃÂMBIO
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
async function carregarCambio(){
  try{
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,CNY-BRL');
    const d = await r.json();
    // Valor bruto sem arredondar Ã¢ÂÂ DÃÂ³lar Comercial (bid da AwesomeAPI)
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
  }catch(e){ console.warn('CÃÂ¢mbio erro:',e.message); }
  setTimeout(carregarCambio, 5*60*1000);
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// DADOS
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
      // Deep link (task #59) Ã¢ÂÂ se a pÃÂ¡gina abriu direto em /controle/UD26-005,
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

// Abre o painel de um processo pela referÃÂªncia (usado por deep link e pelo
// botÃÂ£o voltar/avanÃÂ§ar do navegador), SEM mexer no histÃÂ³rico Ã¢ÂÂ quem decide
// se pushState/popstate acontece ÃÂ© sempre o chamador (abrirProcesso ou o
// listener de popstate), nunca esta funÃÂ§ÃÂ£o.
function _abrirProcessoPorReferencia(ref){
  const proc = _processos.find(p=>p.referencia===ref);
  if(!proc) return;
  _editando = {...proc, _camposIA: {}};
  _editandoOriginal = {...proc};
  renderModal();
}

// BotÃÂ£o voltar/avanÃÂ§ar do navegador Ã¢ÂÂ mantÃÂ©m o painel lateral sincronizado
// com a URL (ex: abrir processo A, abrir processo B, voltar Ã¢ÂÂ reabre A;
// voltar de novo Ã¢ÂÂ fecha o painel e volta pra lista).
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

  // Registrar cÃÂ¢mbio USD no momento do pedido se nÃÂ£o preenchido
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

  // AvanÃÂ§ar fase automaticamente
  proc.fase = calcularFase(proc);

  // Ã¢ÂÂÃ¢ÂÂ CONCORRÃÂNCIA: enviar sÃÂ³ o que mudou Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  // Se quem chamou informou patchFields (lista de campos de fato alterados
  // nesta sessÃÂ£o de ediÃÂ§ÃÂ£o), manda ao servidor sÃÂ³ esses campos + os
  // metadados/calculados de sempre Ã¢ÂÂ nÃÂ£o o processo inteiro. Isso evita que
  // duas pessoas editando o mesmo processo ao mesmo tempo apaguem uma a
  // mudanÃÂ§a da outra: cada save sÃÂ³ toca nos campos que aquele usuÃÂ¡rio de
  // fato mexeu. Sem patchFields (chamada antiga/desconhecida), mantÃÂ©m o
  // comportamento de sempre Ã¢ÂÂ manda o processo inteiro.
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
    showToast('Ã¢ÂÂ Salvo','ok');
    // Criar notificaÃÂ§ÃÂ£o se houver alerta
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
  if(d.ok){ showToast('Processo excluÃÂ­do','ok'); fecharModal(); carregarProcessos(true); }
  else showToast('Erro ao excluir','err');
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// FASE AUTOMÃÂTICA
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function calcularFase(p){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  // "Data Chegada", "Data PresenÃÂ§a" e "Data de Embarque" sÃÂ³ contam pra
  // avanÃÂ§ar a fase se jÃÂ¡ aconteceram de fato. Se alguÃÂ©m preencher uma data
  // futura ali (comum quando o booking jÃÂ¡ traz uma previsÃÂ£o e a pessoa
  // preenche no campo errado por hÃÂ¡bito), NÃÂO trata como jÃÂ¡ embarcado/
  // desembarcado Ã¢ÂÂ fica na fase anterior atÃÂ© a data realmente chegar. Use
  // os campos de previsÃÂ£o (ETD/ETA/PrevisÃÂ£o ProntidÃÂ£o) pra isso Ã¢ÂÂ e na
  // prÃÂ¡tica o prÃÂ³prio formulÃÂ¡rio jÃÂ¡ move a data automaticamente pro campo
  // de previsÃÂ£o certo quando detecta uma data futura nesses campos (ver
  // moverDataFuturaParaPrevisao) Ã¢ÂÂ isso aqui ÃÂ© sÃÂ³ a segunda camada de
  // proteÃÂ§ÃÂ£o, pro caso de a data chegar aqui por outro caminho (ex: leitura
  // por IA), sem depender sÃÂ³ do que roda no onchange do campo.
  const chegadaPassada  = p.data_chegada  && new Date(p.data_chegada+'T00:00:00')  <= hoje ? p.data_chegada  : null;
  const presencaPassada = p.data_presenca && new Date(p.data_presenca+'T00:00:00') <= hoje ? p.data_presenca : null;
  const embarquePassado = p.data_embarque && new Date(p.data_embarque+'T00:00:00') <= hoje ? p.data_embarque : null;

  if(p.data_devolucao_vazio)                                        return 'FINALIZADO';
  // Quando AMBAS as NFs (entrada e saÃÂ­da) estÃÂ£o emitidas, isso jÃÂ¡ ÃÂ© prova
  // suficiente de que o carregamento aconteceu de fato Ã¢ÂÂ avanÃÂ§a direto para
  // DevoluÃÂ§ÃÂ£o do Vazio, mesmo sem a data_carregamento manual preenchida,
  // para jÃÂ¡ acionar o alerta de demurrage dessa etapa.
  if(p.data_carregamento || (p.nf_entrada_numero && p.nf_saida_numero)) return 'DEVOLUCAO_VAZIO';
  if(p.data_agendamento || p.nf_saida_numero || p.nf_entrada_numero) return 'CARREGAMENTO';
  if(p.data_liberacao || (p.canal==='VERDE' && p.data_parametrizacao)) return 'FATURAMENTO';
  if(p.canal || p.data_parametrizacao)                              return 'PARAMETRIZACAO';
  if(p.numero_di || p.data_registro_di)                             return 'REGISTRO_DI';
  if(presencaPassada || chegadaPassada)                             return 'DESEMBARCADO';
  // Igual ao caso do Booking acima: o NÃÂº HBL costuma ser preenchido antes
  // do embarque acontecer de fato (o armador/agente jÃÂ¡ manda o HBL com
  // antecedÃÂªncia), entÃÂ£o usar sÃÂ³ "p.hbl" aqui fazia o status pular pra
  // "Embarcado" antes da hora Ã¢ÂÂ mesmo com o embarque real ainda previsto
  // pra outro dia. Agora sÃÂ³ a Data de Embarque (Efetiva) Ã¢ÂÂ quando jÃÂ¡
  // passou Ã¢ÂÂ conta como embarque de verdade.
  if(embarquePassado)                                               return 'EMBARCADO';
  // O status avanÃÂ§a pra "Ag. Embarque" sÃÂ³ com a PrevisÃÂ£o de Embarque (ETD)
  // preenchida Ã¢ÂÂ NÃÂO mais com o NÃÂº Booking. Motivo: como o booking real
  // muitas vezes nÃÂ£o chega a tempo, o time preenche esse campo com a
  // referÃÂªncia da Royal (nÃÂ£o o booking de verdade), e o status mudava
  // prematuramente/erradamente por causa disso. O ETD ÃÂ© um dado mais
  // confiÃÂ¡vel desse ponto do processo.
  if(p.etd)                                                         return 'AGUARDANDO_EMBARQUE';
  return 'PI';
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// DEMURRAGE
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function demurrageDias(proc){
  if(!proc.demurrage_vencimento) return null;
  const venc = parseDataLocal(proc.demurrage_vencimento);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((venc-hoje)/86400000);
}

// Processo com chegada prevista (ETA) nos prÃÂ³ximos N dias e que ainda nÃÂ£o
// desembarcou de fato (sem data_chegada preenchida Ã¢ÂÂ assim que a chegada
// efetiva ÃÂ© registrada, o processo sai naturalmente deste card). Usado
// pelo card "Chegada em 7 dias" do Dashboard e pelo filtro correspondente
// na tabela Ã¢ÂÂ mesma regra nos dois lugares, pra nÃÂ£o desalinhar contagem e
// lista exibida ao clicar no card.
function chegandoEmDias(proc, dias){
  if(proc.data_chegada || proc.fase==='FINALIZADO' || !proc.eta) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(hoje); limite.setDate(hoje.getDate()+dias);
  const eta = new Date(proc.eta+'T00:00:00');
  return eta>=hoje && eta<=limite;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// PAGAMENTOS DE PI Ã¢ÂÂ fonte ÃÂºnica pro Dashboard Financeiro
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Um processo com forma "Entrada+Saldo" na verdade tem DUAS datas de
// vencimento e DOIS cÃÂ¢mbios diferentes Ã¢ÂÂ tratar isso como "um pagamento sÃÂ³"
// (como o resto do sistema faz) esconde a parcela de Entrada inteira do
// fluxo de caixa e do controle cambial. Essa funÃÂ§ÃÂ£o "achata" cada processo
// em 1 ou 2 parcelas de pagamento individuais, cada uma jÃÂ¡ com fornecedor,
// paÃÂ­s (via porto de origem), valor, vencimento, cÃÂ¢mbio previsto/fechado e
// se jÃÂ¡ foi paga Ã¢ÂÂ pra nÃÂ£o reimplementar essa lÃÂ³gica 3x (KPIs, calendÃÂ¡rio,
// cÃÂ¢mbio) de formas ligeiramente diferentes e desalinhadas entre si.
//
// "Pago" por parcela (nÃÂ£o usa sÃÂ³ o pi_pago geral do processo, que sÃÂ³ vira
// true quando TUDO foi pago):
//  - ÃÂºnica (Vista/Prazo): usa pi_pago mesmo Ã¢ÂÂ ÃÂ© o ÃÂºnico pagamento do processo.
//  - entrada: considera paga se jÃÂ¡ tem cÃÂ¢mbio de entrada fechado registrado.
//  - saldo: usa pi_pago Ã¢ÂÂ ÃÂ© a parcela que fecha o processo (ver confirmarCambioComo).
function listarPagamentosPI(processos){
  const pagamentos = [];
  (processos||[]).forEach(p=>{
    const valorTotal = parseFloat(p.pi_valor_usd)||0;
    if(!valorTotal || p.fase==='FINALIZADO') return;
    const base = { referencia:p.referencia, processoId:p.id, fornecedor:p.fornecedor||'Ã¢ÂÂ', pais:paisDoProcesso(p), moeda:'USD', cliente:p.cliente||'Ã¢ÂÂ' };
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
      // "Parcelado" (N cÃÂ¢mbios, valor fixo em USD cada) Ã¢ÂÂ achata cada linha
      // de pi_parcelas_json num pagamento prÃÂ³prio, mesmo espÃÂ­rito de
      // Entrada+Saldo acima, sÃÂ³ que sem limite de 2. "Paga" por parcela usa
      // a presenÃÂ§a de cÃÂ¢mbio fechado (mesma regra da parcela "entrada"), jÃÂ¡
      // que aqui nÃÂ£o existe um pi_pago ÃÂºnico cobrindo "a ÃÂºltima parcela".
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
    // Sem pi_pagamento definido ainda (processo recÃÂ©m-criado, sÃÂ³ com valor
    // da PI preenchido): nÃÂ£o dÃÂ¡ pra saber vencimento nem parcelas, mas ainda
    // conta pra ExposiÃÂ§ÃÂ£o em USD Ã¢ÂÂ entra como pagamento "sem forma definida".
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
  if(proc.fase === 'FINALIZADO' || proc.data_devolucao_vazio) return '<span style="color:var(--ok)">Ã¢ÂÂ Devolvido</span>';
  const dias = demurrageDias(proc);
  if(dias === null) return '<span style="color:var(--dim)">Ã¢ÂÂ</span>';
  if(dias < 0) return `<span class="demur-err">Vencido hÃÂ¡ ${Math.abs(dias)}d</span>`;
  if(dias <= 5) return `<span class="demur-warn">Ã¢ÂÂ  ${dias}d</span>`;
  return `<span class="demur-ok">${dias}d</span>`;
}

// Gera o bloco "CÃÂ¡lculo do Demurrage" (aba LogÃÂ­stica). ExtraÃÂ­da como funÃÂ§ÃÂ£o prÃÂ³pria
// para poder ser recalculada em tempo real conforme o usuÃÂ¡rio digita (ver
// atualizarFaseEmTempoReal), e nÃÂ£o apenas uma vez quando o modal abre.
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
    statusIcon = 'Ã¢ÂÂ'; statusTxt = `Container devolvido em ${parseDataLocal(p.data_devolucao_vazio).toLocaleDateString('pt-BR')}`;
  } else if(dias !== null && dias < 0){
    statusIcon = 'Ã°ÂÂÂ´'; statusTxt = `VENCIDO hÃÂ¡ ${Math.abs(dias)} dia(s) Ã¢ÂÂ custos acumulando!`;
  } else if(dias !== null && dias <= 5){
    statusIcon = 'Ã¢ÂÂ Ã¯Â¸Â'; statusTxt = `AtenÃÂ§ÃÂ£o: vence em ${dias} dia(s)`;
  } else if(dias !== null){
    statusIcon = 'Ã°ÂÂÂ¢'; statusTxt = `${dias} dias restantes`;
  }

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:10px;">
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">Ã°ÂÂÂ CÃÂ¡lculo do Demurrage</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      ${chegada ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Ã°ÂÂÂ Data de chegada</span><strong>${chegada.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Ã¢ÂÂ± Free time</span><strong>${freeTime} dias</strong></div>
      ${vencReal ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">Ã°ÂÂÂ Vencimento</span><strong style="color:${cor}">${vencReal.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      ${statusTxt ? `<div style="margin-top:4px;padding:8px 12px;background:${dias!==null&&dias<0?'rgba(220,38,38,.08)':dias!==null&&dias<=5?'rgba(217,119,6,.08)':'rgba(22,163,74,.08)'};border-radius:6px;font-weight:600;color:${cor};">${statusIcon} ${statusTxt}</div>` : ''}
      ${p.demurrage_valor ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">Ã°ÂÂÂ¸ Valor registrado</span><strong>R$ ${parseFloat(p.demurrage_valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>` : ''}
    </div>
  </div>`;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// FECHAMENTO Ã¢ÂÂ estimado (da cotaÃÂ§ÃÂ£o aprovada) ÃÂ real (NF Entrada/SaÃÂ­da)
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// FunÃÂ§ÃÂ£o pura (sem DOM) que compara o que foi cotado no Calculador
// (p.estimativa_json, gravado em POST /api/calculador/cotacoes/:id/aprovar)
// com o resultado real do processo (NF SaÃÂ­da Ã¢ÂÂ NF Entrada, jÃÂ¡ preenchidos
// na aba Documentos). Compara sempre contra o cenÃÂ¡rio Com S.T. (ÃÂ© o mais
// comum na prÃÂ¡tica Ã¢ÂÂ resumo antigo, salvo antes dos dois cenÃÂ¡rios existirem,
// cai no faturamento genÃÂ©rico que tinha na ÃÂ©poca).
// Ã¢ÂÂÃ¢ÂÂ CUSTOS REAIS Ã¢ÂÂ apuraÃÂ§ÃÂ£o de lucro por processo, item a item Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Mesmos grupos/campos usados no Calculador (TAXAS_CONFIG + FOB/Frete/
// Seguro/Taxa C.E. + Impostos + ComissÃÂµes) Ã¢ÂÂ pra dar pra apurar o lucro
// real de QUALQUER processo, com ou sem cotaÃÂ§ÃÂ£o aprovada. `cotado(c)` lÃÂª o
// valor cotado de dentro de p.estimativa_json.custos_cotados_json (gravado
// por resumoParaLista() no calculador.html, ao salvar a cotaÃÂ§ÃÂ£o) Ã¢ÂÂ usado sÃÂ³
// como REFERÃÂNCIA/ponto de partida na aba Custos Reais; o cÃÂ¡lculo do lucro
// real (ver calcularCustoRealTotal) usa exclusivamente o que estÃÂ¡ em
// p.real_json/p.real_cambio, preenchido pelo usuÃÂ¡rio no Controle.
//
// p.real_json e p.real_cambio jÃÂ¡ existem no banco (migration
// 0004_add_custos_reais_processo.sql, aplicada em produÃÂ§ÃÂ£o e no lab em
// 2026-07-19) Ã¢ÂÂ a coluna foi criada antes pra essa mesma finalidade, mas o
// cÃÂ³digo que a usava nunca chegou a ser commitado. Reaproveitada aqui em vez
// de criar coluna nova. real_json guarda um valor TOTAL (jÃÂ¡ em R$ ou US$,
// conforme a unidade do item) por chave de item (ver custosReaisItensFlat) Ã¢ÂÂ
// mais simples que o { fixas, usd } por-container original documentado na
// migration, e cobre tambÃÂ©m Compra/Impostos/ComissÃÂµes, nÃÂ£o sÃÂ³ as 21 taxas.
// FIX (a pedido do usuÃÂ¡rio): FOB/Frete/Seguro/Taxa C.E. e as Taxas em USD
// (destino) eram unidade:'USD' aqui Ã¢ÂÂ exigia conversÃÂ£o manual toda vez que
// alguÃÂ©m abria a aba, mesmo o Calculador jÃÂ¡ parametrizando um cÃÂ¢mbio
// especÃÂ­fico pra cada um desses itens (cÃÂ¢mbio ponderado pelas parcelas pro
// FOB, cÃÂ¢mbio de abertura+2% pro Frete/Seguro/Taxas em USD, cÃÂ¢mbio ÃÂºnico da
// simulaÃÂ§ÃÂ£o pra Taxa C.E Ã¢ÂÂ ver resumoParaLista() em calculador.html). Agora
// unidade:'BRL' em todos Ã¢ÂÂ os valores que chegam em custos_cotados_json jÃÂ¡
// vÃÂªm convertidos pelo cÃÂ¢mbio correto de cada item, nÃÂ£o mais em dÃÂ³lar puro.
const CUSTOS_REAIS_CONFIG = [
  { grupo:'Compra e Frete', itens:[
    { id:'fob',      label:'Custo da mercadoria', unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.fob },
    { id:'frete',    label:'Frete Internacional',  unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.frete },
    { id:'seguro',   label:'Seguro',               unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.seguro_usd },
    { id:'taxa_ce',  label:'Taxa C.E.',            unidade:'BRL', unidadeLegado:'USD', cotado:c=>c?.compra?.taxa_ce },
  ]},
  // apenasPago:true = imposto nÃÂ£o tem "compra ÃÂ venda" Ã¢ÂÂ ÃÂ© sÃÂ³ um valor a
  // pagar pro governo, sempre em R$, sem contrapartida cobrada do cliente
  // (diferente das taxas operacionais, que podem ter margem). A aba mostra
  // sÃÂ³ um campo "Valor a pagar", sem Cobrado/Margem nem seletor de moeda.
  { grupo:'Impostos de ImportaÃÂ§ÃÂ£o', itens:[
    { id:'ii',     label:'II',     unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.ii },
    { id:'ipi',    label:'IPI',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.ipi },
    { id:'pis',    label:'PIS',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.pis },
    { id:'cofins', label:'COFINS', unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.cofins },
    { id:'icms',   label:'ICMS',   unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.icms },
    { id:'ibs',    label:'IBS',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.ibs },
    { id:'cbs',    label:'CBS',    unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.cbs },
    // Antidumping: direito antidumping (encargo governamental cobrado quando o
    // toggle "dump" estÃÂ¡ SIM no Calculador) Ã¢ÂÂ igual aos demais impostos, sem
    // compraÃÂvenda, sÃÂ³ existe quando a cotaÃÂ§ÃÂ£o de origem teve o toggle ativo.
    { id:'antidumping', label:'Antidumping', unidade:'BRL', apenasPago:true, cotado:c=>c?.impostos?.antidumping },
  ]},
  { grupo:'ComissÃÂµes', itens:[
    { id:'comissao_br',    label:'ComissÃÂ£o BR (Representante)', unidade:'BRL', cotado:c=>c?.comissoes?.br },
    { id:'comissao_china', label:'ComissÃÂ£o China',              unidade:'BRL', cotado:c=>c?.comissoes?.china },
    { id:'comissao_boss',  label:'ComissÃÂ£o Boss/Lopes',         unidade:'BRL', cotado:c=>c?.comissoes?.boss },
  ]},
  // porContainer:true = no Calculador esse valor ÃÂ© POR container (r.txOp);
  // usado sÃÂ³ pra multiplicar corretamente ao calcular o "Cotado" total abaixo
  // (calcularCustoCotadoItem). Os valores REAIS lanÃÂ§ados na aba sÃÂ£o sempre o
  // TOTAL do item pro processo inteiro Ã¢ÂÂ o usuÃÂ¡rio nÃÂ£o precisa multiplicar.
  { grupo:'Taxas Operacionais', itens:[
    { id:'siscomex',         label:'Siscomex',                unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.siscomex },
    { id:'marinha',          label:'Marinha/AFRMM',           unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.marinha },
    { id:'armazenagem',      label:'Armazenagem',             unidade:'BRL', porContainer:false, cotado:c=>c?.taxas_fixas?.armazenagem },
    { id:'emissao_li',       label:'EmissÃÂ£o L.I.',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.emissao_li },
    { id:'baixa_patio',      label:'Baixa PÃÂ¡tio',             unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.baixa_patio },
    { id:'capatazia',        label:'Capatazia/THC',           unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.capatazia },
    { id:'liberacao_bl',     label:'LiberaÃÂ§ÃÂ£o BL',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.liberacao_bl },
    { id:'despachante',      label:'Despachante',             unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.despachante },
    { id:'sda',              label:'SDA',                     unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.sda },
    { id:'lavacao',          label:'LavaÃÂ§ÃÂ£o Container',       unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.lavacao },
    { id:'administrativo',   label:'Administrativo',          unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.administrativo },
    { id:'agente',           label:'Agente Carga',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.agente },
    { id:'custos_diversos',  label:'Custos Diversos',         unidade:'BRL', porContainer:false, cotado:c=>c?.custos_diversos },
    // Seguro de Venda: distinto do Seguro (Compra e Frete acima, custo interno
    // da importaÃÂ§ÃÂ£o) Ã¢ÂÂ ÃÂ© a taxa de seguro cobrada na proposta ao cliente, que
    // compÃÂµe total_taxas/custo_total no Calculador (ver comentÃÂ¡rio em
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
    { id:'desconsolidacao',  label:'DesconsolidaÃÂ§ÃÂ£o',         unidade:'BRL', unidadeLegado:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.desconsolidacao },
  ]},
];

function custosReaisItensFlat(){
  return CUSTOS_REAIS_CONFIG.flatMap(g => g.itens.map(it => ({...it, grupo:g.grupo})));
}

// Ã¢ÂÂÃ¢ÂÂ MULTI-MOEDA + QUEBRA POR CONTAINER (Pago ÃÂ Cobrado por taxa) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Igual ÃÂ  tela de Taxas do Conexos: cada taxa pode ter Pago e Cobrado em
// moedas diferentes (BRL/USD/EUR, cada lado com sua prÃÂ³pria moeda Ã¢ÂÂ ex.:
// paga o representante em BRL, recebe do importador em USD), e quando o
// processo tem mais de um container, cada taxa "porContainer" pode ser
// detalhada container a container em vez de um valor ÃÂºnico pro processo
// inteiro. Formato salvo em real_json[item.id] (e o mesmo com sufixo
// "_cobrado"), aceita 3 formatos pra manter compatibilidade com dados jÃÂ¡
// salvos antes dessa mudanÃÂ§a:
//   nÃÂºmero puro            Ã¢ÂÂ legado: valor na moeda padrÃÂ£o do item (unidade)
//   { valor, moeda }       Ã¢ÂÂ valor ÃÂºnico, moeda escolhida pelo usuÃÂ¡rio
//   { porContainer:{ 'CONTAINER1':{valor,moeda}, ... } } Ã¢ÂÂ detalhado
const MOEDAS_REAIS = [
  { code:'BRL', simbolo:'R$' },
  { code:'USD', simbolo:'US$' },
  { code:'EUR', simbolo:'Ã¢ÂÂ¬' },
];

// CÃÂ¢mbio de uma moeda em relaÃÂ§ÃÂ£o a R$ pra este processo. USD usa a mesma
// coluna jÃÂ¡ existente (p.real_cambio, com fallback pro cÃÂ¢mbio da PI); EUR
// nÃÂ£o tem coluna prÃÂ³pria Ã¢ÂÂ pra nÃÂ£o precisar de migration nova, fica salvo
// dentro do prÃÂ³prio real_json (_cambio_eur), com fallback pro cÃÂ¢mbio do dia
// (_cambio.EUR, jÃÂ¡ buscado no boot pra barra do topo).
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

// Lista de containers do processo Ã¢ÂÂ usada sÃÂ³ pra oferecer o detalhamento
// por container nas taxas "porContainer". Sem containers cadastrados (ou sÃÂ³
// 1), a taxa fica como valor ÃÂºnico, sem opÃÂ§ÃÂ£o de detalhar.
//
// Fonte da verdade: p.containers_json, o MESMO campo preenchido na tela
// "+ Adicionar Container" da aba Documentos (ver controle-campos.js,
// renderMultiContainers/sincronizarContainerLegado) Ã¢ÂÂ array de
// {numero, tipo, lacre}. Antes esta funÃÂ§ÃÂ£o lia p.container (o campo texto
// legado, que sÃÂ³ guarda o nÃÂºmero do PRIMEIRO container, sincronizado
// automaticamente a partir de containers_json) Ã¢ÂÂ por isso processos com
// mais de um container apareciam com sÃÂ³ 1 na aba Custos Reais. MantÃÂ©m
// fallback pro campo legado sÃÂ³ pra processos antigos que nunca chegaram a
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
    }catch(e){ /* containers_json invÃÂ¡lido Ã¢ÂÂ cai no fallback abaixo */ }
  }
  if(!p.container) return [];
  return String(p.container).split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
}

// Converte o valor bruto salvo em real_json[item.id] (nos 3 formatos
// possÃÂ­veis, ver comentÃÂ¡rio acima) pro total em R$ desse item. Retorna
// null quando nÃÂ£o hÃÂ¡ nada lanÃÂ§ado.
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
  // legado: nÃÂºmero (ou string numÃÂ©rica) puro, sem objeto {valor,moeda} Ã¢ÂÂ sÃÂ³
  // existe em processos criados ANTES do multi-moeda (task #159). Usa
  // unidadeLegado quando existe (itens que mudaram de padrÃÂ£o USD->BRL nesta
  // correÃÂ§ÃÂ£o Ã¢ÂÂ ver comentÃÂ¡rio no topo de CUSTOS_REAIS_CONFIG) pra nÃÂ£o
  // reinterpretar retroativamente valores antigos que foram salvos em USD
  // como se jÃÂ¡ fossem BRL. Itens que sempre foram BRL nÃÂ£o tÃÂªm
  // unidadeLegado, entÃÂ£o caem direto em item.unidade (sem mudanÃÂ§a).
  const unidadeParaLegado = item.unidadeLegado || item.unidade;
  const valor = parseFloat(raw);
  if(isNaN(valor)) return null;
  const cambio = taxaCambioMoedaReal(unidadeParaLegado, p);
  return { totalBrl: unidadeParaLegado === 'BRL' ? valor : valor * (cambio || 0), count:1, moeda:unidadeParaLegado };
}

// Valor COTADO de um item, jÃÂ¡ no TOTAL do processo (multiplicado pelos
// containers quando for porContainer) Ã¢ÂÂ usado sÃÂ³ pra prÃÂ©-preencher/mostrar
// como referÃÂªncia na aba Custos Reais, nunca entra direto no cÃÂ¡lculo do
// lucro real (ver calcularCustoRealTotal, que sÃÂ³ olha p.real_json).
function calcularCustoCotadoItem(item, cotado){
  if(!cotado) return null;
  const base = item.cotado(cotado);
  if(base == null) return null;
  return item.porContainer ? base * (cotado.containers || 1) : base;
}

// Soma tudo que estiver preenchido em p.real_json (valores TOTAIS, jÃÂ¡
// digitados pelo usuÃÂ¡rio na aba Custos Reais Ã¢ÂÂ sem fallback automÃÂ¡tico pro
// cotado aqui; o fallback acontece sÃÂ³ visualmente, prÃÂ©-preenchendo o campo
// quando a aba abre). Itens em USD convertem pelo cÃÂ¢mbio salvo em
// p.real_cambio ou, na falta dele, pelo cÃÂ¢mbio da PI do processo. Retorna
// null quando nÃÂ£o hÃÂ¡ NENHUM custo real lanÃÂ§ado ainda Ã¢ÂÂ nesse caso
// calcularFechamento() cai no cÃÂ¡lculo antigo (NF SaÃÂ­da Ã¢ÂÂ NF Entrada),
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
// item (nÃÂ£o o que foi pago ao fornecedor/agente) Ã¢ÂÂ guardado nas mesmas
// chaves de real_json, com sufixo "_cobrado" (ex.: reais.siscomex = pago,
// reais.siscomex_cobrado = cobrado). Isso dÃÂ¡ pra ver a margem de CADA taxa
// individualmente (compra ÃÂ venda), igual ao Conexos mostra na aba Taxas Ã¢ÂÂ
// nÃÂ£o sÃÂ³ o total do processo (NF SaÃÂ­da Ã¢ÂÂ Custo Real Total).
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

// Ã¢ÂÂÃ¢ÂÂ VENDAS MULTI-CLIENTE (rateio de custo) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Um processo (de qualquer finalidade) pode ser vendido a mais de um
// cliente Ã¢ÂÂ ex.: meio contÃÂªiner pra um, meio pra outro. p.vendas_json guarda
// um array de vendas, cada uma com seu prÃÂ³prio cliente, NF SaÃÂ­da e a
// quantidade que levou de cada item. Quando existe pelo menos uma venda
// cadastrada, o Lucro Real deixa de ser um nÃÂºmero ÃÂºnico do processo (NF
// SaÃÂ­da Ã¢ÂÂ Custo Real Total) e passa a ser calculado VENDA A VENDA: cada
// custo real lanÃÂ§ado na aba Custos Reais ÃÂ© rateado proporcionalmente ÃÂ 
// quantidade que aquela venda levou (sobre a quantidade total de produtos do
// processo, ver totalQuantidadeProdutos), e alguns custos podem ser
// lanÃÂ§ados DIRETO numa venda especÃÂ­fica (custos_diretos), sem entrar no
// rateio Ã¢ÂÂ ex.: um frete rodoviÃÂ¡rio que sÃÂ³ existiu porque aquele cliente
// pediu entrega em outra cidade.
// Sem nenhuma venda cadastrada (vendas_json vazio/null), calcularFechamento
// continua exatamente como antes Ã¢ÂÂ 100% retrocompatÃÂ­vel com todo processo
// jÃÂ¡ cadastrado.

// Soma a quantidade de todos os itens em produtos_json Ã¢ÂÂ ÃÂ© o "tamanho
// total" do processo (ex.: 1400 pneus), denominador do rateio.
function totalQuantidadeProdutos(p){
  if(!p || !p.produtos_json) return 0;
  try{
    const produtos = JSON.parse(p.produtos_json);
    if(!Array.isArray(produtos)) return 0;
    return produtos.reduce((s,it)=> s + (parseFloat(it.quantidade)||0), 0);
  }catch(e){ return 0; }
}

// LÃÂª e normaliza p.vendas_json Ã¢ÂÂ nunca lanÃÂ§a, sempre devolve array (vazio
// se nÃÂ£o houver nada salvo ou o JSON estiver corrompido).
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

// Soma dos custos diretos (nÃÂ£o-rateados) de uma venda Ã¢ÂÂ cada um jÃÂ¡ ÃÂ© um
// valor TOTAL em R$, lanÃÂ§ado manualmente (ex.: "Frete RodoviÃÂ¡rio Extra").
function custosDiretosVenda(venda){
  return (venda.custos_diretos||[]).reduce((s,c)=> s + (parseFloat(c.valor)||0), 0);
}

// Rateia o Custo Real Total do processo por uma venda especÃÂ­fica,
// proporcional ÃÂ  quantidade que ela levou, e soma os custos diretos dela
// por cima (esses nÃÂ£o sÃÂ£o rateados Ã¢ÂÂ sÃÂ£o sÃÂ³ dessa venda).
function calcularRateioVenda(p, venda, custoRealTotal){
  const totalQtd = totalQuantidadeProdutos(p);
  const qtdVenda = quantidadeVenda(venda);
  const fracao = totalQtd > 0 ? (qtdVenda / totalQtd) : 0;
  const custoRateado = (custoRealTotal||0) * fracao;
  const custoDireto = custosDiretosVenda(venda);
  return { totalQtd, qtdVenda, fracao, custoRateado, custoDireto, custoTotal: custoRateado + custoDireto };
}

// Lucro de uma venda especÃÂ­fica: NF SaÃÂ­da DELA (nÃÂ£o do processo) Ã¢ÂÂ a fatia
// de custo que lhe cabe (rateado + direto). null quando a venda ainda nÃÂ£o
// tem NF SaÃÂ­da lanÃÂ§ada (mesma convenÃÂ§ÃÂ£o do Lucro Real do processo inteiro).
function calcularLucroVenda(p, venda, custoRealTotal){
  const rateio = calcularRateioVenda(p, venda, custoRealTotal);
  const nfSaida = parseFloat(venda.nf_saida_valor);
  const temNf = !isNaN(nfSaida) && nfSaida > 0;
  const lucro = temNf ? (nfSaida - rateio.custoTotal) : null;
  const pctLucro = (temNf && lucro != null && nfSaida > 0) ? (lucro / nfSaida) : null;
  return { ...rateio, nfSaida: temNf?nfSaida:null, temNf, lucro, pctLucro };
}

// Ajusta uma lista de valores fracionÃÂ¡rios (em R$) que deveriam somar
// "totalAlvo" pra somarem EXATAMENTE isso atÃÂ© o centavo Ã¢ÂÂ mÃÂ©todo do maior
// resto (largest remainder / Hamilton), o mesmo usado pra distribuir
// cadeiras em sistemas proporcionais. Sem isso, ratear R$100.000,00 em 3
// partes de 33.333,33... e converter cada uma pra centavos pode deixar 1-2
// centavos "perdidos" ou "sobrando" que nunca aparecem em lugar nenhum Ã¢ÂÂ
// pequeno, mas incomoda numa tela financeira onde a soma devia bater exato.
function arredondarComRestoExato(valores, totalAlvo){
  const totalCentavosAlvo = Math.round((totalAlvo||0) * 100);
  const centavosBase = valores.map(v => Math.floor((v||0) * 100));
  const somaBase = centavosBase.reduce((s,c)=> s+c, 0);
  let restante = totalCentavosAlvo - somaBase;
  // Distribui o restante (positivo ou negativo) 1 centavo de cada vez,
  // priorizando quem tem a maior parte fracionÃÂ¡ria "perdida" no floor.
  const ordem = valores
    .map((v,i)=>({ i, frac: (v||0)*100 - Math.floor((v||0)*100) }))
    .sort((a,b)=> b.frac - a.frac);
  const resultado = [...centavosBase];
  for(let k=0; k<ordem.length && restante>0; k++){ resultado[ordem[k].i] += 1; restante--; }
  for(let k=ordem.length-1; k>=0 && restante<0; k--){ resultado[ordem[k].i] -= 1; restante++; }
  return resultado.map(c => c/100);
}

// Resumo agregado de todas as vendas de um processo Ã¢ÂÂ null quando nÃÂ£o hÃÂ¡
// nenhuma venda cadastrada (processo continua no modelo antigo, 1 NF SaÃÂ­da
// ÃÂºnica pro processo inteiro).
function calcularVendasResumo(p){
  const vendas = parseVendas(p);
  if(!vendas.length) return null;
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : 0;
  let linhas = vendas.map(venda => ({ venda, ...calcularLucroVenda(p, venda, custoRealTotal) }));
  const totalQtd = totalQuantidadeProdutos(p);
  const qtdAlocada = linhas.reduce((s,l)=> s + l.qtdVenda, 0);

  // CorreÃÂ§ÃÂ£o de arredondamento (maior resto): sÃÂ³ faz sentido quando o
  // processo estÃÂ¡ 100% alocado entre as vendas (senÃÂ£o a soma parcial dos
  // custos rateados ÃÂ o comportamento correto Ã¢ÂÂ ver saldoNaoAlocado) e
  // quando hÃÂ¡ mais de 1 venda (com 1 venda sÃÂ³ nÃÂ£o existe erro de soma pra
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

  // Custo real detalhado (aba "Custos Reais") Ã¢ÂÂ quando o processo tem pelo
  // menos um item lanÃÂ§ado ali, ele ÃÂ© MAIS PRECISO que o cÃÂ¡lculo grosseiro
  // NF SaÃÂ­da Ã¢ÂÂ NF Entrada (que ignora frete, seguro, impostos, comissÃÂµes e
  // taxas operacionais Ã¢ÂÂ cada processo tem uma combinaÃÂ§ÃÂ£o diferente do que
  // teve ou nÃÂ£o). Sem nenhum item lanÃÂ§ado, mantÃÂ©m o cÃÂ¡lculo antigo por NF.
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : null;
  // Margem por taxa (compra ÃÂ venda) Ã¢ÂÂ sÃÂ³ existe quando o usuÃÂ¡rio tambÃÂ©m
  // lanÃÂ§ou valores "cobrado do cliente" na aba Custos Reais, nÃÂ£o ÃÂ©
  // obrigatÃÂ³rio preencher. Independente do Lucro Real (que usa a NF SaÃÂ­da
  // inteira); esta ÃÂ© uma visÃÂ£o ÃÂ  parte, item a item, das taxas especÃÂ­ficas.
  const receitaReais = calcularReceitaRealTotal(p);
  const margemTaxas = (custosReais && receitaReais)
    ? { total: receitaReais.total - custosReais.total, custoTotal: custosReais.total, receitaTotal: receitaReais.total }
    : null;

  // Vendas multi-cliente (rateio de custo) Ã¢ÂÂ quando o processo foi vendido
  // a mais de um cliente (ver calcularVendasResumo acima), o Lucro Real do
  // processo vira a SOMA do lucro de cada venda (NF dela Ã¢ÂÂ sua fatia de
  // custo), e a "NF SaÃÂ­da" do processo vira a soma das NFs de cada venda.
  // Sem nenhuma venda cadastrada, cai exatamente no cÃÂ¡lculo antigo abaixo.
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
      faturamentoEstimado = est.faturamento; // cotaÃÂ§ÃÂµes salvas antes dos 2 cenÃÂ¡rios
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
    custosReais, custoRealTotal, // detalhamento por item Ã¢ÂÂ null se a aba Custos Reais nunca foi preenchida
    receitaReais, margemTaxas, // margem por taxa (compra ÃÂ venda) Ã¢ÂÂ null se "cobrado do cliente" nunca foi preenchido
    vendasResumo, // null se o processo nÃÂ£o foi vendido a mais de um cliente
  };
}

function renderFechamentoInfo(p){
  const f = calcularFechamento(p);
  const r2 = v => v==null ? 'Ã¢ÂÂ' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const pct2 = v => v==null ? 'Ã¢ÂÂ' : `${(v*100).toFixed(1)}%`;

  // Antes: sem estimativa_json (processo que nÃÂ£o passou pela cotaÃÂ§ÃÂ£o do
  // Calculador) a funÃÂ§ÃÂ£o parava aqui e nunca mostrava nada Ã¢ÂÂ nem o lucro
  // real, mesmo com NF Entrada e NF SaÃÂ­da jÃÂ¡ preenchidas na aba Documentos.
  // Ou seja, processo criado direto no Controle nunca tinha como saber a
  // margem, mesmo depois de fechado. Agora sÃÂ³ cai nesse aviso quando NÃÂO
  // hÃÂ¡ estimativa E tambÃÂ©m nÃÂ£o hÃÂ¡ NF SaÃÂ­da ainda Ã¢ÂÂ nesse caso nÃÂ£o tem
  // mesmo nada pra mostrar.
  if(!f.temEstimativa && !f.temReal){
    return `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;color:var(--muted);font-size:12px;">
      Este processo nÃÂ£o tem um valor estimado (cotaÃÂ§ÃÂ£o) nem resultado real (NF Entrada/SaÃÂ­da) vinculado ainda Ã¢ÂÂ preencha a NF Entrada e a NF SaÃÂ­da na aba Documentos assim que possÃÂ­vel pra ver a margem aqui.
    </div>`;
  }

  // Quando a aba "Custos Reais" tem pelo menos um item lanÃÂ§ado, o Lucro Real
  // vem de Faturamento (NF SaÃÂ­da) Ã¢ÂÂ Custo Real Total (soma item a item) em
  // vez da conta grosseira NF SaÃÂ­da Ã¢ÂÂ NF Entrada Ã¢ÂÂ mais preciso porque conta
  // frete, seguro, impostos, comissÃÂµes e taxas operacionais reais tambÃÂ©m.
  const linhaCustoRealDetalhado = f.custosReais
    ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Real Total (${f.custosReais.count} ${f.custosReais.count===1?'item lanÃÂ§ado':'itens lanÃÂ§ados'} na aba Custos Reais)</span><strong>${r2(f.custoRealTotal)}</strong></div>`
    : '';
  // Margem das Taxas (compra ÃÂ venda) Ã¢ÂÂ sÃÂ³ aparece quando o usuÃÂ¡rio tambÃÂ©m
  // preencheu "Cobrado do Cliente" em pelo menos um item na aba Custos Reais.
  // ÃÂ uma visÃÂ£o separada do Lucro Real: mostra quanto sobrou/faltou SÃÂ nas
  // taxas repassadas ao cliente (ex.: taxa que custou R$ 110 e foi cobrada
  // por USD 55) Ã¢ÂÂ nÃÂ£o mexe no cÃÂ¡lculo do Lucro Real, que continua usando a
  // NF SaÃÂ­da inteira.
  const linhaMargemTaxas = f.margemTaxas
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Cobrado do Cliente nas Taxas (${f.receitaReais.count} ${f.receitaReais.count===1?'item':'itens'})</span><strong>${r2(f.margemTaxas.receitaTotal)}</strong></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Margem das Taxas (Cobrado Ã¢ÂÂ Pago)</span><strong style="color:${f.margemTaxas.total>=0?'var(--ok)':'var(--err)'}">${r2(f.margemTaxas.total)}</strong></div>
      </div>`
    : '';
  // Vendas multi-cliente (rateio) Ã¢ÂÂ quando o processo tem a aba Vendas
  // preenchida, mostra um lembrete de que o Lucro Real acima jÃÂ¡ ÃÂ© a SOMA de
  // todas as vendas, com um mini-detalhamento por cliente. O rateio/lucro
  // por venda em si ÃÂ© editado e recalculado ao vivo na aba Vendas
  // (renderResumoVendas, em controle-campos.js) Ã¢ÂÂ aqui ÃÂ© sÃÂ³ um resumo
  // read-only pra quem estÃÂ¡ olhando a aba Fechamento.
  const linhaVendas = f.vendasResumo
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">Ã°ÂÂ§Â¾ Vendido a ${f.vendasResumo.linhas.length} cliente${f.vendasResumo.linhas.length===1?'':'s'} (ver aba Vendas)</div>
        ${f.vendasResumo.linhas.map(l=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><span style="color:var(--muted);">${esc(l.venda.cliente||'(sem cliente)')}</span><strong style="color:${l.lucro==null?'var(--muted)':l.lucro>=0?'var(--ok)':'var(--err)'}">${l.temNf?r2(l.lucro):'aguardando NF'}</strong></div>`).join('')}
      </div>`
    : '';
  const linhaReal = f.temReal
    ? `${linhaCustoRealDetalhado}<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Lucro Real${f.custosReais?' (NF SaÃÂ­da Ã¢ÂÂ Custo Real Total)':' (NF SaÃÂ­da Ã¢ÂÂ NF Entrada)'}</span><strong>${r2(f.lucroReal)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroReal)})</span></strong></div>`
    : `${linhaCustoRealDetalhado}<div style="color:var(--muted);font-size:12px;">Ainda nÃÂ£o hÃÂ¡ NF SaÃÂ­da lanÃÂ§ada Ã¢ÂÂ preencha NF Entrada e NF SaÃÂ­da na aba Documentos pra ver o resultado real aqui.</div>`;

  const corDelta = f.deltaValor==null ? 'var(--muted)' : f.deltaValor >= 0 ? 'var(--ok)' : 'var(--err)';
  const linhaDelta = f.temComparacao
    ? `<div style="margin-top:10px;padding:10px 12px;background:${f.deltaValor>=0?'rgba(22,163,74,.08)':'rgba(220,38,38,.08)'};border-radius:8px;font-weight:700;color:${corDelta};display:flex;justify-content:space-between;">
        <span>${f.deltaValor>=0?'Ã°ÂÂÂ Rendeu a mais que o cotado':'Ã°ÂÂÂ Rendeu a menos que o cotado'}</span>
        <span>${f.deltaValor>=0?'+':''}${r2(f.deltaValor)}</span>
      </div>`
    : '';

  // Bloco "Estimado na cotaÃÂ§ÃÂ£o" sÃÂ³ existe se o processo passou pelo
  // Calculador. Sem isso (processo criado direto no Controle), mostra um
  // aviso curto no lugar, mas o "Resultado real" abaixo continua aparecendo
  // normalmente contanto que NF Entrada/SaÃÂ­da existam.
  const blocoEstimado = f.temEstimativa
    ? `<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">Ã°ÂÂÂ Estimado na cotaÃÂ§ÃÂ£o</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Total estimado</span><strong>${r2(f.custoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Faturamento estimado (Com S.T.)</span><strong>${r2(f.faturamentoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">Lucro estimado</span><strong>${r2(f.lucroEstimado)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroEstimado)})</span></strong></div>
    </div>`
    : `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--muted);margin-bottom:14px;">
      Este processo nÃÂ£o passou pela cotaÃÂ§ÃÂ£o do Calculador Ã¢ÂÂ sem valor estimado pra comparar, mas o resultado real abaixo jÃÂ¡ funciona normalmente.
    </div>`;

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
    ${blocoEstimado}
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">Ã¢ÂÂ Resultado real</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">NF Entrada</span><strong>${r2(f.nfEntrada)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">NF SaÃÂ­da${f.vendasResumo?' (soma das vendas)':''}</span><strong>${r2(f.nfSaida)}</strong></div>
      ${linhaReal}
    </div>
    ${linhaMargemTaxas}
    ${linhaVendas}
    ${linhaDelta}
  </div>`;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// ALERTAS E NOTIFICAÃÂÃÂES
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function verificarAlertas(proc, criarNotif){
  const alertas = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Demurrage
  const diasDemur = demurrageDias(proc);
  if(diasDemur !== null && diasDemur <= 5 && diasDemur >= 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage: ${proc.referencia}`, mensagem:`Vence em ${diasDemur} dia(s)! Container ainda nÃÂ£o devolvido.`});
  }
  if(diasDemur !== null && diasDemur < 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage VENCIDO: ${proc.referencia}`, mensagem:`Venceu hÃÂ¡ ${Math.abs(diasDemur)} dia(s). Custos em andamento.`});
  }

  // Alerta ETA: ETA passou e processo ainda estÃÂ¡ Embarcado
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((hoje - eta)/86400000);
    if(diff > 0){
      alertas.push({tipo:'alerta', titulo:`ETA vencido: ${proc.referencia}`, mensagem:`ETA era ${eta.toLocaleDateString('pt-BR')} Ã¢ÂÂ processo ainda Embarcado. Verificar chegada.`});
    }
  }

  // Alerta ETA prÃÂ³ximo (2 dias)
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((eta - hoje)/86400000);
    if(diff >= 0 && diff <= 2){
      alertas.push({tipo:'info', titulo:`ETA em ${diff === 0 ? 'hoje' : diff + 'd'}: ${proc.referencia}`, mensagem:`Navio previsto para ${eta.toLocaleDateString('pt-BR')}.`});
    }
  }

  // Alerta PI vencimento (prazo pagamento nos prÃÂ³ximos 5 dias)
  if(proc.pi_data_saldo && !proc.pi_pago){
    const venc = parseDataLocal(proc.pi_data_saldo);
    const diff = Math.ceil((venc - hoje)/86400000);
    if(diff <= 5 && diff >= 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI vence em ${diff}d: ${proc.referencia}`, mensagem:`Saldo da PI vence em ${venc.toLocaleDateString('pt-BR')}.`});
    }
    if(diff < 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI VENCIDO: ${proc.referencia}`, mensagem:`Venceu hÃÂ¡ ${Math.abs(diff)} dia(s).`});
    }
  }

  if(criarNotif && alertas.length){
    alertas.forEach(a => criarNotificacao(proc.id, a.tipo, a.titulo, a.mensagem));
  }
  return alertas;
}

// Cache em memÃÂ³ria das notificaÃÂ§ÃÂµes jÃÂ¡ carregadas nesta sessÃÂ£o, usado sÃÂ³
// para evitar duplicatas Ã¢ÂÂ nÃÂ£o substitui carregarNotificacoes().
let _notifsCache = [];

async function criarNotificacao(processoId, tipo, titulo, mensagem){
  // Evita criar a mesma notificaÃÂ§ÃÂ£o de novo a cada save do processo: se jÃÂ¡
  // existe uma notificaÃÂ§ÃÂ£o idÃÂªntica (mesmo processo + mesmo tÃÂ­tulo) criada
  // nas ÃÂºltimas 24h, nÃÂ£o cria outra. Sem isso, salvar o processo vÃÂ¡rias
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
  }).then(()=>{ _notifsCache=[]; }).catch(()=>{}); // invalida cache apÃÂ³s criar
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
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma notificaÃÂ§ÃÂ£o</div>';
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

// Clicar numa notificaÃÂ§ÃÂ£o deve marcÃÂ¡-la como lida E abrir o processo que ela
// se refere Ã¢ÂÂ antes sÃÂ³ marcava como lida, sem nenhuma forma de chegar ao
// processo a partir da notificaÃÂ§ÃÂ£o (era preciso buscar manualmente na lista).
function abrirNotificacao(id, processoId){
  marcarLida(id);
  toggleNotif(); // fecha o painel de notificaÃÂ§ÃÂµes
  if(processoId){
    abrirProcesso(processoId);
  } else {
    showToast('Esta notificaÃÂ§ÃÂ£o nÃÂ£o estÃÂ¡ vinculada a um processo','info');
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
    showToast('Todas as notificaÃÂ§ÃÂµes marcadas como lidas','ok');
  }catch(e){ showToast('Erro ao marcar notificaÃÂ§ÃÂµes','err'); }
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
  if(min < 60) return `${min}min atrÃÂ¡s`;
  const h = Math.floor(min/60);
  if(h < 24) return `${h}h atrÃÂ¡s`;
  const d = Math.floor(h/24);
  return `${d}d atrÃÂ¡s`;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// RENDER
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// RÃÂ³tulos amigÃÂ¡veis para os filtros financeiros especiais (usados pelos
// cards clicÃÂ¡veis do Dashboard) Ã¢ÂÂ sem isso, o usuÃÂ¡rio nÃÂ£o tem como saber
// qual filtro estÃÂ¡ ativo depois de clicar num card e ir para a tabela.
const FILTRO_FINANCEIRO_LABEL = {
  __chegada_7d:         'Ã°ÂÂÂ¢ Chegada prevista (ETA) nos prÃÂ³ximos 7 dias',
  __pi_vence_30d:       'Ã°ÂÂÂ° Saldo a pagar nos prÃÂ³ximos 30 dias',
  __capital_parado:     'Ã°ÂÂÂ¦ Capital parado em estoque/trÃÂ¢nsito (pago, aguardando finalizar)',
  __pi_aberto:          'Ã°ÂÂÂ° Processos com PI em aberto',
  __pi_pago:            'Ã¢ÂÂ Processos com PI jÃÂ¡ paga',
  __pi_vencido:         'Ã°ÂÂÂ¨ Pagamentos vencidos',
  __pi_vence_semana:    'Ã¢ÂÂ  Pagamentos vencendo em 7 dias',
  __nf_entrada_periodo: 'Ã°ÂÂÂ¥ NF Entrada no perÃÂ­odo selecionado',
  __nf_saida_periodo:   'Ã°ÂÂÂ¤ NF SaÃÂ­da no perÃÂ­odo selecionado',
  __demur_aberto:       'Ã¢ÂÂ± Demurrage em aberto',
  __cambio_periodo:     'Ã°ÂÂÂ± CÃÂ¢mbio a pagar no perÃÂ­odo selecionado',
};

function renderFiltroFinanceiroAtivo(){
  const el = document.getElementById('filtro-financeiro-ativo');
  if(!el) return;
  const label = FILTRO_FINANCEIRO_LABEL[_faseFilter];
  if(!label){ el.innerHTML=''; return; }
  el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;background:rgba(26,127,212,.06);border:1px solid rgba(26,127,212,.2);border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;font-weight:600;color:var(--ac);">
    <span>${label}</span>
    <button type="button" onclick="setFaseFilter('')" style="margin-left:auto;border:none;background:none;color:var(--ac);font-weight:700;cursor:pointer;font-size:12px;">Ã¢ÂÂ Limpar filtro</button>
  </div>`;
}

function renderFaseFilter(){
  const el = document.getElementById('fase-filter');
  if(!el) return;
  el.innerHTML = `<div class="fase-pill ${_faseFilter===''?'active':''}" onclick="setFaseFilter('')">Todos</div>` +
    FASES.map(f=>`<div class="fase-pill ${_faseFilter===f.id?'active':''}" onclick="setFaseFilter('${f.id}')">${f.icon} ${f.label}</div>`).join('');
}

// Fecha todos os dashboards (Executivo, Financeiro, Resultado, NarcÃÂ©lio,
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

// Usada pelos cards clicÃÂ¡veis do Dashboard Executivo/Financeiro: fecha o
// dashboard que estiver aberto e mostra a tabela principal jÃÂ¡ filtrada,
// para o usuÃÂ¡rio poder ver e agir diretamente nos processos daquele nÃÂºmero
// (em vez do card ser sÃÂ³ um nÃÂºmero estÃÂ¡tico no topo).
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
  // Demurrage crÃÂ­tico
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
    {num:demurCrit,   label:'Demurrage Ã¢ÂÂ¤5d',  cor:'var(--err)', filtro:'__demur'},
    {num:finalizados, label:'Finalizados',     cor:'var(--ok)',  filtro:'FINALIZADO'},
  ];
if (refsDuplicadas > 0) stats.push({num:refsDuplicadas, label:'ReferÃÂªncia duplicada', cor:'var(--err)', filtro:'__ref_duplicada'});

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

// Mapa de filtros especiais por "fase" virtual (chaves comeÃÂ§ando com "__",
// usadas pelos cards clicÃÂ¡veis dos dashboards Executivo/Financeiro). Cada
// funÃÂ§ÃÂ£o recebe a lista jÃÂ¡ filtrada por busca/data e devolve a lista final.
// Antes isso era uma cadeia crescente de if/else (uma comparaÃÂ§ÃÂ£o de string
// atrÃÂ¡s da outra) Ã¢ÂÂ um mapa deixa mais fÃÂ¡cil ver todos os filtros disponÃÂ­veis
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
  // Filtros financeiros Ã¢ÂÂ usados pelos cards clicÃÂ¡veis do Dashboard Financeiro/Executivo
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
  // Capital parado em estoque/trÃÂ¢nsito Ã¢ÂÂ usado pelo card do Dashboard
  // Financeiro (v2): jÃÂ¡ pago integralmente, mas o processo ainda nÃÂ£o foi
  // finalizado (mercadoria ainda nÃÂ£o virou venda concluÃÂ­da).
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

  // Filtro por pendÃÂªncia de revisÃÂ£o
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
    tbody.innerHTML = `<div class="empty"><div class="empty-icon">Ã°ÂÂÂ­</div><div class="empty-text">Nenhum processo encontrado</div></div>`;
  } else {
    tbody.innerHTML = pagina.map(p=>{
      const fase = FASES.find(f=>f.id===p.fase)||FASES[0];
      const etaDate = p.eta ? parseDataLocal(p.eta).toLocaleDateString('pt-BR') : 'Ã¢ÂÂ';
      const chegadaDate = p.data_chegada ? parseDataLocal(p.data_chegada).toLocaleDateString('pt-BR') : '';
      const dataDisplay = chegadaDate || etaDate;
      const finBadge = p.pi_pagamento ? `<span class="fin-badge fin-${p.pi_pagamento}">${p.pi_pagamento==='ENTRADA_SALDO'?'ENT+SLD':p.pi_pagamento}</span>` : 'Ã¢ÂÂ';
      const finalidadeLabel = {IMPORTACAO_DIRETA:'Direto', ENCOMENDA:'Encomenda', CONTA_E_ORDEM:'Conta e Ordem'}[p.finalidade] || '';
      const finalidadeBadge = finalidadeLabel ? `<span style="font-size:9px;font-weight:700;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;margin-left:4px;color:var(--muted);">${finalidadeLabel}</span>` : '';
      const pendenciaBadge = p.pendencia_revisao ? `<span title="${esc(p.pendencia_revisao).replace(/"/g,'&quot;')}" style="font-size:10px;font-weight:700;background:rgba(243,156,18,.15);border:1px solid rgba(243,156,18,.4);border-radius:4px;padding:1px 6px;margin-left:4px;color:#f39c12;">Ã¢ÂÂ  Revisar</span>` : '';
      // referencia/fornecedor sÃÂ£o texto livre (fornecedor ÃÂ s vezes vem de
      // extraÃÂ§ÃÂ£o por IA de documento externo) Ã¢ÂÂ escapar sempre antes de
      // colocar em innerHTML, senÃÂ£o um valor malicioso/malformado vira HTML
      // executÃÂ¡vel pra QUALQUER usuÃÂ¡rio que abrir esta lista (XSS
      // persistente). Ver esc() em controle-campos.js.
      return `<div class="table-row" onclick="abrirProcesso('${p.id}')">
        <div class="td td-ref" data-label="">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;row-gap:2px;">
            <span>${esc(p.referencia)||'Ã¢ÂÂ'}</span>${finalidadeBadge}${pendenciaBadge}
          </div>
        </div>
        <div class="td td-forn" data-label="Fornecedor">${esc(p.fornecedor)||'Ã¢ÂÂ'}</div>
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
        <div class="td" data-label="AÃÂ§ÃÂµes">
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();abrirProcesso('${p.id}')">Abrir</button>
        </div>
      </div>`;
    }).join('');
  }

  // PaginaÃÂ§ÃÂ£o
  const pag = document.getElementById('paginacao');
  if(pag){
    if(totalPags <= 1){ pag.innerHTML=''; return; }
    let html = `<button class="pag-btn" onclick="_pagina--;render()" ${_pagina<=1?'disabled':''}>Ã¢ÂÂ¹</button>`;
    for(let i=1;i<=totalPags;i++){
      if(i===1||i===totalPags||Math.abs(i-_pagina)<=1)
        html+=`<button class="pag-btn ${i===_pagina?'active':''}" onclick="_pagina=${i};render()">${i}</button>`;
      else if(Math.abs(i-_pagina)===2)
        html+=`<span class="pag-info">Ã¢ÂÂ¦</span>`;
    }
    html+=`<button class="pag-btn" onclick="_pagina++;render()" ${_pagina>=totalPags?'disabled':''}>Ã¢ÂÂº</button>`;
    html+=`<span class="pag-info">${total} processos</span>`;
    pag.innerHTML = html;
  }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// MODAL Ã¢ÂÂ ABRIR / NOVO
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
