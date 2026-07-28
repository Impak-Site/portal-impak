// controle-core.js
//
// Estado global, boot (login/DOMContentLoaded), câmbio, CRUD de processos (API), cálculo de fase/demurrage/fechamento, notificações, filtros/stats e a renderização da lista principal.
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
// ── SESSÃO EXPIRADA: mensagem clara em vez de erro de parse ──────
// Quando a sessão cai (ex.: reinício do servidor), as rotas protegidas
// redirecionam pra /login (HTML) em vez de responder JSON. O código que
// chama fetch(...).then(r=>r.json()) então quebra com um erro confuso tipo
// "Unexpected token '<' ... is not valid JSON". Este wrapper detecta esse
// redirecionamento e troca por uma mensagem que o usuário entende, usando os
// mesmos catch() que já existem em cada tela.
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(...args){
    const res = await _fetch(...args);
    if (res.redirected && res.url.startsWith(location.origin) && res.url.includes('/login')) {
      throw new Error('Sessão expirada. Abra outra aba, faça login novamente e tente de novo (seus dados não foram perdidos).');
    }
    return res;
  };
})();

// ════════════════════════════════════════════════════════════════
// UUID — compatível com Safari, Chrome, Firefox
// ════════════════════════════════════════════════════════════════
function gerarUUID(){
  // Usar crypto.randomUUID se disponível (Chrome, Firefox, Edge)
  if(typeof crypto !== 'undefined' && crypto.randomUUID){
    return crypto.randomUUID();
  }
  // Fallback para Safari e browsers mais antigos
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  // Último fallback: Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

// Analisa uma data "sem hora" (ex.: "2026-07-18", vinda de <input type=date>
// ou do banco) SEMPRE no fuso LOCAL do navegador, nunca em UTC.
// `new Date('2026-07-18')` (sem hora) é interpretado pelo JS como meia-noite
// UTC — em fusos negativos (ex.: Brasil, UTC-3) isso exibe/compara como o
// dia ANTERIOR (17/07) em vez do dia certo. `new Date('2026-07-18T00:00:00')`
// (sem "Z") é interpretado em horário LOCAL, então bate com o que a pessoa
// realmente digitou. Antes deste helper, os dois estilos apareciam
// misturados neste arquivo (e em controle-dashboards.js/controle-export.js)
// pro MESMO tipo de campo — ex.: renderDemurInfo() lia data_chegada sem
// sufixo (UTC) enquanto calcularFase() lia o mesmo campo com sufixo (local),
// podendo mostrar dias diferentes pro mesmo processo em telas diferentes.
// Use esta função pra qualquer campo de data-só (data_chegada, eta,
// demurrage_vencimento, pi_data_saldo, nf_entrada_data, nf_saida_data etc.).
// Para timestamps completos (created_at/updated_at, que já vêm com hora e
// "Z" de toISOString()), continue usando new Date(...) direto — não passar
// por aqui.
function parseDataLocal(str){
  return str ? new Date(str + 'T00:00:00') : null;
}

// ════════════════════════════════════════════════════════════════
// ESTADO
// ════════════════════════════════════════════════════════════════
let _user = null;
let _processos = [];
let _faseFilter = '';
let _searchText = '';
let _pagina = 1;
const POR_PAGINA = 50;
let _editando = null; // processo sendo editado
// Snapshot do processo exatamente como veio do servidor quando o modal foi
// aberto (ou {} pra um processo novo) — usado só pra saber quais campos o
// usuário de fato alterou nesta sessão de edição (ver coletarESalvar). Nunca
// é mutado depois de setado; existe só pra comparação, não é enviado ao
// servidor. Concorrência: com vários usuários editando processos ao mesmo
// tempo, salvar o processo inteiro sempre que alguém clica em Salvar
// sobrescrevia silenciosamente qualquer campo que outra pessoa tivesse
// alterado nesse meio tempo (quem salvasse por último "vencia" em TUDO, não
// só no que de fato editou). Agora só os campos realmente alterados nesta
// sessão são enviados — os demais ficam intocados no banco.
let _editandoOriginal = null;
let _notifAberto = false;
let _cambio = { USD: 1, BRL: 1, EUR: 1 };

// ── URL por processo (task #59) ──────────────────────────────────
// _baseUrlPath é a tela "de baixo" (/controle ou /financeiro) — pra onde
// a URL volta quando o painel lateral do processo fecha. Se a página já
// carregou num deep link (ex: /controle/UD26-005), guardamos a referência
// pedida em _refPendenteDeepLink pra abrir o painel assim que a lista de
// processos terminar de carregar (ver carregarProcessos).
const _pathPartsInicial = location.pathname.split('/').filter(Boolean);
let _baseUrlPath = '/' + (_pathPartsInicial[0] || 'controle');
let _refPendenteDeepLink = _pathPartsInicial[1] ? decodeURIComponent(_pathPartsInicial[1]) : null;

const FASES = [
  { id:'PI',                label:'PI Recebida',       icon:'📄' },
  { id:'AGUARDANDO_EMBARQUE',label:'Ag. Embarque',      icon:'⏳' },
  { id:'EMBARCADO',          label:'Embarcado',          icon:'🚢' },
  { id:'DESEMBARCADO',       label:'Desembarcado',       icon:'⚓' },
  { id:'REGISTRO_DI',        label:'Registro DI',        icon:'📋' },
  { id:'PARAMETRIZACAO',     label:'Parametrização',     icon:'🔍' },
  { id:'CARREGAMENTO',       label:'Carregamento',       icon:'🚛' },
  { id:'FATURAMENTO',        label:'Faturamento',        icon:'💰' },
  { id:'DEVOLUCAO_VAZIO',    label:'Dev. Vazio',         icon:'📦' },
  { id:'FINALIZADO',         label:'Finalizado',         icon:'✅' },
];

const FASE_LABEL = Object.fromEntries(FASES.map(f=>[f.id, f.label]));
const FASE_ICON  = Object.fromEntries(FASES.map(f=>[f.id, f.icon]));

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', function(){
  fetch('/api/me').then(r=>r.json()).then(d=>{
    if(!d.logado){ location.href='/login?destino='+encodeURIComponent(location.pathname); return; }
    _user = d;
    document.getElementById('user-badge').textContent = d.displayName || d.usuario;
    carregarCambio();
    carregarProcessos().then(()=>{
      if(location.pathname==='/financeiro') ativarTelaFinanceiroExclusiva();
      // Deep-link ?processo=<id> — usado pelo Calculador pra abrir direto o
      // processo recém-criado ao aprovar uma cotação (ver aprovarCotacao()
      // em calculador.html). Só tenta abrir depois que a lista carregou,
      // senão abrirProcesso() não acha o processo em _processos ainda.
      const idDeepLink = new URLSearchParams(location.search).get('processo');
      if(idDeepLink){
        const achou = _processos.some(p=>p.id===idDeepLink);
        if(achou) abrirProcesso(idDeepLink);
        else showToast('Processo recém-criado ainda não apareceu na lista — atualize a página em alguns segundos', 'err');
      }
    });
    renderFaseFilter();
    // Auto-refresh a cada 30s
    setInterval(function(){ if(!document.getElementById('modal-bg').classList.contains('open')) carregarProcessos(true); }, 30000);
  });
});

// ════════════════════════════════════════════════════════════════
// TELA EXCLUSIVA /financeiro — mesma página (controle_v2.html) e mesmo
// JS do Controle normal, só que ao carregar em /financeiro a tela já abre
// direto no Dashboard Financeiro, com o que é sobre "lista de processos"
// (busca, filtros de fase, cards de status) escondido — foco só no
// financeiro. A TABELA de processos continua existindo mais abaixo (não é
// removida do DOM), porque os cards e a lista de pagamentos do Dashboard
// Financeiro contam com ela pra "abrir o processo" ao clicar numa linha e
// pro drill-down dos filtros (Saldo a Pagar, Exposição, Capital Parado)
// funcionar exatamente como já funciona dentro do Controle — reaproveitar
// em vez de duplicar essa lógica evita ter duas versões de "abrir
// processo" pra manter sincronizadas.
function ativarTelaFinanceiroExclusiva(){
  document.title = 'IMPAK — Dashboard Financeiro';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Dashboard Financeiro';

  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display='none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = 'none';

  // Sidebar: esconde "Visão" e "Por fase" (não fazem sentido sem a busca/
  // lista principal em destaque) — mantém Dashboard Executivo e Cadastros.
  document.querySelectorAll('.sidebar-section[data-secao="processos"]').forEach(el=>{
    el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.remove('active'));
  document.getElementById('menu-financeiro')?.classList.add('active');

  const dashFin = document.getElementById('dash-financeiro');
  if(dashFin) dashFin.style.display = 'block';
  renderDashFinanceiro();
}

// ════════════════════════════════════════════════════════════════
// CÂMBIO
// ════════════════════════════════════════════════════════════════
async function carregarCambio(){
  try{
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,CNY-BRL');
    const d = await r.json();
    // Valor bruto sem arredondar — Dólar Comercial (bid da AwesomeAPI)
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
  }catch(e){ console.warn('Câmbio erro:',e.message); }
  setTimeout(carregarCambio, 5*60*1000);
}

// ════════════════════════════════════════════════════════════════
// DADOS
// ════════════════════════════════════════════════════════════════
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
        const clientesUnicos = [...new Set(_processos.map(p=>p.cliente||'').filter(Boolean))].sort();
        const valAtual = selCliente.value;
        selCliente.innerHTML = '<option value="">👤 Todos os clientes</option>' +
          clientesUnicos.map(c=>`<option value="${c}" ${c===valAtual?'selected':''}>${c}</option>`).join('');
      }
      render();
      renderStats();
      renderFaseFilter();
      carregarNotificacoes();
      if(!silencioso) showToast(`${_processos.length} processos carregados`,'ok');
      // Deep link (task #59) — se a página abriu direto em /controle/UD26-005,
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

// Abre o painel de um processo pela referência (usado por deep link e pelo
// botão voltar/avançar do navegador), SEM mexer no histórico — quem decide
// se pushState/popstate acontece é sempre o chamador (abrirProcesso ou o
// listener de popstate), nunca esta função.
function _abrirProcessoPorReferencia(ref){
  const proc = _processos.find(p=>p.referencia===ref);
  if(!proc) return;
  _editando = {...proc, _camposIA: {}};
  _editandoOriginal = {...proc};
  renderModal();
}

// Botão voltar/avançar do navegador — mantém o painel lateral sincronizado
// com a URL (ex: abrir processo A, abrir processo B, voltar → reabre A;
// voltar de novo → fecha o painel e volta pra lista).
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

  // Registrar câmbio USD no momento do pedido se não preenchido
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

  // Avançar fase automaticamente
  proc.fase = calcularFase(proc);

  // ── CONCORRÊNCIA: enviar só o que mudou ──────────────────────────
  // Se quem chamou informou patchFields (lista de campos de fato alterados
  // nesta sessão de edição), manda ao servidor só esses campos + os
  // metadados/calculados de sempre — não o processo inteiro. Isso evita que
  // duas pessoas editando o mesmo processo ao mesmo tempo apaguem uma a
  // mudança da outra: cada save só toca nos campos que aquele usuário de
  // fato mexeu. Sem patchFields (chamada antiga/desconhecida), mantém o
  // comportamento de sempre — manda o processo inteiro.
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
    showToast('✓ Salvo','ok');
    // Criar notificação se houver alerta
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
  if(d.ok){ showToast('Processo excluído','ok'); fecharModal(); carregarProcessos(true); }
  else showToast('Erro ao excluir','err');
}

// ════════════════════════════════════════════════════════════════
// FASE AUTOMÁTICA
// ════════════════════════════════════════════════════════════════
function calcularFase(p){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  // "Data Chegada", "Data Presença" e "Data de Embarque" só contam pra
  // avançar a fase se já aconteceram de fato. Se alguém preencher uma data
  // futura ali (comum quando o booking já traz uma previsão e a pessoa
  // preenche no campo errado por hábito), NÃO trata como já embarcado/
  // desembarcado — fica na fase anterior até a data realmente chegar. Use
  // os campos de previsão (ETD/ETA/Previsão Prontidão) pra isso — e na
  // prática o próprio formulário já move a data automaticamente pro campo
  // de previsão certo quando detecta uma data futura nesses campos (ver
  // moverDataFuturaParaPrevisao) — isso aqui é só a segunda camada de
  // proteção, pro caso de a data chegar aqui por outro caminho (ex: leitura
  // por IA), sem depender só do que roda no onchange do campo.
  const chegadaPassada  = p.data_chegada  && new Date(p.data_chegada+'T00:00:00')  <= hoje ? p.data_chegada  : null;
  const presencaPassada = p.data_presenca && new Date(p.data_presenca+'T00:00:00') <= hoje ? p.data_presenca : null;
  const embarquePassado = p.data_embarque && new Date(p.data_embarque+'T00:00:00') <= hoje ? p.data_embarque : null;

  if(p.data_devolucao_vazio)                                        return 'FINALIZADO';
  // Quando AMBAS as NFs (entrada e saída) estão emitidas, isso já é prova
  // suficiente de que o carregamento aconteceu de fato — avança direto para
  // Devolução do Vazio, mesmo sem a data_carregamento manual preenchida,
  // para já acionar o alerta de demurrage dessa etapa.
  if(p.data_carregamento || (p.nf_entrada_numero && p.nf_saida_numero)) return 'DEVOLUCAO_VAZIO';
  if(p.data_agendamento || p.nf_saida_numero || p.nf_entrada_numero) return 'CARREGAMENTO';
  if(p.data_liberacao || (p.canal==='VERDE' && p.data_parametrizacao)) return 'FATURAMENTO';
  if(p.canal || p.data_parametrizacao)                              return 'PARAMETRIZACAO';
  if(p.numero_di || p.data_registro_di)                             return 'REGISTRO_DI';
  if(presencaPassada || chegadaPassada)                             return 'DESEMBARCADO';
  // Igual ao caso do Booking acima: o Nº HBL costuma ser preenchido antes
  // do embarque acontecer de fato (o armador/agente já manda o HBL com
  // antecedência), então usar só "p.hbl" aqui fazia o status pular pra
  // "Embarcado" antes da hora — mesmo com o embarque real ainda previsto
  // pra outro dia. Agora só a Data de Embarque (Efetiva) — quando já
  // passou — conta como embarque de verdade.
  if(embarquePassado)                                               return 'EMBARCADO';
  // O status avança pra "Ag. Embarque" só com a Previsão de Embarque (ETD)
  // preenchida — NÃO mais com o Nº Booking. Motivo: como o booking real
  // muitas vezes não chega a tempo, o time preenche esse campo com a
  // referência da Royal (não o booking de verdade), e o status mudava
  // prematuramente/erradamente por causa disso. O ETD é um dado mais
  // confiável desse ponto do processo.
  if(p.etd)                                                         return 'AGUARDANDO_EMBARQUE';
  return 'PI';
}

// ════════════════════════════════════════════════════════════════
// DEMURRAGE
// ════════════════════════════════════════════════════════════════
function demurrageDias(proc){
  if(!proc.demurrage_vencimento) return null;
  const venc = parseDataLocal(proc.demurrage_vencimento);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((venc-hoje)/86400000);
}

// Processo com chegada prevista (ETA) nos próximos N dias e que ainda não
// desembarcou de fato (sem data_chegada preenchida — assim que a chegada
// efetiva é registrada, o processo sai naturalmente deste card). Usado
// pelo card "Chegada em 7 dias" do Dashboard e pelo filtro correspondente
// na tabela — mesma regra nos dois lugares, pra não desalinhar contagem e
// lista exibida ao clicar no card.
function chegandoEmDias(proc, dias){
  if(proc.data_chegada || proc.fase==='FINALIZADO' || !proc.eta) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(hoje); limite.setDate(hoje.getDate()+dias);
  const eta = new Date(proc.eta+'T00:00:00');
  return eta>=hoje && eta<=limite;
}

// ════════════════════════════════════════════════════════════════
// PAGAMENTOS DE PI — fonte única pro Dashboard Financeiro
// ════════════════════════════════════════════════════════════════
// Um processo com forma "Entrada+Saldo" na verdade tem DUAS datas de
// vencimento e DOIS câmbios diferentes — tratar isso como "um pagamento só"
// (como o resto do sistema faz) esconde a parcela de Entrada inteira do
// fluxo de caixa e do controle cambial. Essa função "achata" cada processo
// em 1 ou 2 parcelas de pagamento individuais, cada uma já com fornecedor,
// país (via porto de origem), valor, vencimento, câmbio previsto/fechado e
// se já foi paga — pra não reimplementar essa lógica 3x (KPIs, calendário,
// câmbio) de formas ligeiramente diferentes e desalinhadas entre si.
//
// "Pago" por parcela (não usa só o pi_pago geral do processo, que só vira
// true quando TUDO foi pago):
//  - única (Vista/Prazo): usa pi_pago mesmo — é o único pagamento do processo.
//  - entrada: considera paga se já tem câmbio de entrada fechado registrado.
//  - saldo: usa pi_pago — é a parcela que fecha o processo (ver confirmarCambioComo).
function listarPagamentosPI(processos){
  const pagamentos = [];
  (processos||[]).forEach(p=>{
    const valorTotal = parseFloat(p.pi_valor_usd)||0;
    if(!valorTotal || p.fase==='FINALIZADO') return;
    const base = { referencia:p.referencia, processoId:p.id, fornecedor:p.fornecedor||'—', pais:paisDoProcesso(p), moeda:'USD', cliente:p.cliente||'—' };
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
    } else if(p.pi_pagamento==='VISTA' || p.pi_pagamento==='PRAZO'){
      const vencimento = p.pi_pagamento==='PRAZO' ? p.pi_data_saldo : p.pi_data_entrada;
      pagamentos.push({...base, parcela:'unico',
        valorUsd: valorTotal, vencimento: vencimento||null,
        cambioPrevisto: parseFloat(p.pi_cambio)||null, cambioFechado: parseFloat(p.pi_cambio_fechado)||null,
        pago: !!p.pi_pago });
    }
    // Sem pi_pagamento definido ainda (processo recém-criado, só com valor
    // da PI preenchido): não dá pra saber vencimento nem parcelas, mas ainda
    // conta pra Exposição em USD — entra como pagamento "sem forma definida".
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
  if(proc.fase === 'FINALIZADO' || proc.data_devolucao_vazio) return '<span style="color:var(--ok)">✓ Devolvido</span>';
  const dias = demurrageDias(proc);
  if(dias === null) return '<span style="color:var(--dim)">—</span>';
  if(dias < 0) return `<span class="demur-err">Vencido há ${Math.abs(dias)}d</span>`;
  if(dias <= 5) return `<span class="demur-warn">⚠ ${dias}d</span>`;
  return `<span class="demur-ok">${dias}d</span>`;
}

// Gera o bloco "Cálculo do Demurrage" (aba Logística). Extraída como função própria
// para poder ser recalculada em tempo real conforme o usuário digita (ver
// atualizarFaseEmTempoReal), e não apenas uma vez quando o modal abre.
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
    statusIcon = '✅'; statusTxt = `Container devolvido em ${parseDataLocal(p.data_devolucao_vazio).toLocaleDateString('pt-BR')}`;
  } else if(dias !== null && dias < 0){
    statusIcon = '🔴'; statusTxt = `VENCIDO há ${Math.abs(dias)} dia(s) — custos acumulando!`;
  } else if(dias !== null && dias <= 5){
    statusIcon = '⚠️'; statusTxt = `Atenção: vence em ${dias} dia(s)`;
  } else if(dias !== null){
    statusIcon = '🟢'; statusTxt = `${dias} dias restantes`;
  }

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:10px;">
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">📊 Cálculo do Demurrage</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      ${chegada ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">📅 Data de chegada</span><strong>${chegada.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">⏱ Free time</span><strong>${freeTime} dias</strong></div>
      ${vencReal ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">📌 Vencimento</span><strong style="color:${cor}">${vencReal.toLocaleDateString('pt-BR')}</strong></div>` : ''}
      ${statusTxt ? `<div style="margin-top:4px;padding:8px 12px;background:${dias!==null&&dias<0?'rgba(220,38,38,.08)':dias!==null&&dias<=5?'rgba(217,119,6,.08)':'rgba(22,163,74,.08)'};border-radius:6px;font-weight:600;color:${cor};">${statusIcon} ${statusTxt}</div>` : ''}
      ${p.demurrage_valor ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">💸 Valor registrado</span><strong>R$ ${parseFloat(p.demurrage_valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></div>` : ''}
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// FECHAMENTO — estimado (da cotação aprovada) × real (NF Entrada/Saída)
// ════════════════════════════════════════════════════════════════
// Função pura (sem DOM) que compara o que foi cotado no Calculador
// (p.estimativa_json, gravado em POST /api/calculador/cotacoes/:id/aprovar)
// com o resultado real do processo (NF Saída − NF Entrada, já preenchidos
// na aba Documentos). Compara sempre contra o cenário Com S.T. (é o mais
// comum na prática — resumo antigo, salvo antes dos dois cenários existirem,
// cai no faturamento genérico que tinha na época).
// ── CUSTOS REAIS — apuração de lucro por processo, item a item ────
// Mesmos grupos/campos usados no Calculador (TAXAS_CONFIG + FOB/Frete/
// Seguro/Taxa C.E. + Impostos + Comissões) — pra dar pra apurar o lucro
// real de QUALQUER processo, com ou sem cotação aprovada. `cotado(c)` lê o
// valor cotado de dentro de p.estimativa_json.custos_cotados_json (gravado
// por resumoParaLista() no calculador.html, ao salvar a cotação) — usado só
// como REFERÊNCIA/ponto de partida na aba Custos Reais; o cálculo do lucro
// real (ver calcularCustoRealTotal) usa exclusivamente o que está em
// p.real_json/p.real_cambio, preenchido pelo usuário no Controle.
//
// p.real_json e p.real_cambio já existem no banco (migration
// 0004_add_custos_reais_processo.sql, aplicada em produção e no lab em
// 2026-07-19) — a coluna foi criada antes pra essa mesma finalidade, mas o
// código que a usava nunca chegou a ser commitado. Reaproveitada aqui em vez
// de criar coluna nova. real_json guarda um valor TOTAL (já em R$ ou US$,
// conforme a unidade do item) por chave de item (ver custosReaisItensFlat) —
// mais simples que o { fixas, usd } por-container original documentado na
// migration, e cobre também Compra/Impostos/Comissões, não só as 21 taxas.
const CUSTOS_REAIS_CONFIG = [
  { grupo:'Compra e Frete', itens:[
    { id:'fob',      label:'FOB',                 unidade:'USD', cotado:c=>c?.compra?.fob },
    { id:'frete',    label:'Frete Internacional',  unidade:'USD', cotado:c=>c?.compra?.frete },
    { id:'seguro',   label:'Seguro',               unidade:'USD', cotado:c=>c?.compra?.seguro_usd },
    { id:'taxa_ce',  label:'Taxa C.E.',            unidade:'USD', cotado:c=>c?.compra?.taxa_ce },
  ]},
  { grupo:'Impostos de Importação', itens:[
    { id:'ii',     label:'II',     unidade:'BRL', cotado:c=>c?.impostos?.ii },
    { id:'ipi',    label:'IPI',    unidade:'BRL', cotado:c=>c?.impostos?.ipi },
    { id:'pis',    label:'PIS',    unidade:'BRL', cotado:c=>c?.impostos?.pis },
    { id:'cofins', label:'COFINS', unidade:'BRL', cotado:c=>c?.impostos?.cofins },
    { id:'icms',   label:'ICMS',   unidade:'BRL', cotado:c=>c?.impostos?.icms },
    { id:'ibs',    label:'IBS',    unidade:'BRL', cotado:c=>c?.impostos?.ibs },
    { id:'cbs',    label:'CBS',    unidade:'BRL', cotado:c=>c?.impostos?.cbs },
  ]},
  { grupo:'Comissões', itens:[
    { id:'comissao_br',    label:'Comissão BR (Representante)', unidade:'BRL', cotado:c=>c?.comissoes?.br },
    { id:'comissao_china', label:'Comissão China',              unidade:'BRL', cotado:c=>c?.comissoes?.china },
    { id:'comissao_boss',  label:'Comissão Boss/Lopes',         unidade:'BRL', cotado:c=>c?.comissoes?.boss },
  ]},
  // porContainer:true = no Calculador esse valor é POR container (r.txOp);
  // usado só pra multiplicar corretamente ao calcular o "Cotado" total abaixo
  // (calcularCustoCotadoItem). Os valores REAIS lançados na aba são sempre o
  // TOTAL do item pro processo inteiro — o usuário não precisa multiplicar.
  { grupo:'Taxas Operacionais', itens:[
    { id:'siscomex',         label:'Siscomex',                unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.siscomex },
    { id:'marinha',          label:'Marinha/AFRMM',           unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.marinha },
    { id:'armazenagem',      label:'Armazenagem',             unidade:'BRL', porContainer:false, cotado:c=>c?.taxas_fixas?.armazenagem },
    { id:'emissao_li',       label:'Emissão L.I.',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.emissao_li },
    { id:'baixa_patio',      label:'Baixa Pátio',             unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.baixa_patio },
    { id:'capatazia',        label:'Capatazia/THC',           unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.capatazia },
    { id:'liberacao_bl',     label:'Liberação BL',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.liberacao_bl },
    { id:'despachante',      label:'Despachante',             unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.despachante },
    { id:'sda',              label:'SDA',                     unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.sda },
    { id:'lavacao',          label:'Lavação Container',       unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.lavacao },
    { id:'administrativo',   label:'Administrativo',          unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.administrativo },
    { id:'agente',           label:'Agente Carga',            unidade:'BRL', porContainer:true,  cotado:c=>c?.taxas_fixas?.agente },
    { id:'custos_diversos',  label:'Custos Diversos',         unidade:'BRL', porContainer:false, cotado:c=>c?.custos_diversos },
    { id:'handling',         label:'Handling at Destination', unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.handling },
    { id:'additional_costs', label:'Additional Costs',        unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.additional_costs },
    { id:'import_logistics', label:'Import Logistics',        unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.import_logistics },
    { id:'trs',              label:'TRS',                     unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.trs },
    { id:'tsc',              label:'TSC',                     unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.tsc },
    { id:'drop_off',         label:'Drop Off',                unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.drop_off },
    { id:'isps',             label:'ISPS',                    unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.isps },
    { id:'iof',              label:'IOF',                     unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.iof },
    { id:'desconsolidacao',  label:'Desconsolidação',         unidade:'USD', porContainer:true,  cotado:c=>c?.taxas_usd?.desconsolidacao },
  ]},
];

function custosReaisItensFlat(){
  return CUSTOS_REAIS_CONFIG.flatMap(g => g.itens.map(it => ({...it, grupo:g.grupo})));
}

// ── MULTI-MOEDA + QUEBRA POR CONTAINER (Pago × Cobrado por taxa) ──────
// Igual à tela de Taxas do Conexos: cada taxa pode ter Pago e Cobrado em
// moedas diferentes (BRL/USD/EUR, cada lado com sua própria moeda — ex.:
// paga o representante em BRL, recebe do importador em USD), e quando o
// processo tem mais de um container, cada taxa "porContainer" pode ser
// detalhada container a container em vez de um valor único pro processo
// inteiro. Formato salvo em real_json[item.id] (e o mesmo com sufixo
// "_cobrado"), aceita 3 formatos pra manter compatibilidade com dados já
// salvos antes dessa mudança:
//   número puro            → legado: valor na moeda padrão do item (unidade)
//   { valor, moeda }       → valor único, moeda escolhida pelo usuário
//   { porContainer:{ 'CONTAINER1':{valor,moeda}, ... } } → detalhado
const MOEDAS_REAIS = [
  { code:'BRL', simbolo:'R$' },
  { code:'USD', simbolo:'US$' },
  { code:'EUR', simbolo:'€' },
];

// Câmbio de uma moeda em relação a R$ pra este processo. USD usa a mesma
// coluna já existente (p.real_cambio, com fallback pro câmbio da PI); EUR
// não tem coluna própria — pra não precisar de migration nova, fica salvo
// dentro do próprio real_json (_cambio_eur), com fallback pro câmbio do dia
// (_cambio.EUR, já buscado no boot pra barra do topo).
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

// Lista de containers do processo (campo texto livre, separado por vírgula/
// ponto-e-vírgula/quebra de linha) — usada só pra oferecer o detalhamento
// por container nas taxas "porContainer". Sem containers cadastrados (ou só
// 1), a taxa fica como valor único, sem opção de detalhar.
function containersDoProcesso(p){
  if(!p || !p.container) return [];
  return String(p.container).split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
}

// Converte o valor bruto salvo em real_json[item.id] (nos 3 formatos
// possíveis, ver comentário acima) pro total em R$ desse item. Retorna
// null quando não há nada lançado.
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
  // legado: número (ou string numérica) puro, na moeda padrão do item
  const valor = parseFloat(raw);
  if(isNaN(valor)) return null;
  const cambio = taxaCambioMoedaReal(item.unidade, p);
  return { totalBrl: item.unidade === 'BRL' ? valor : valor * (cambio || 0), count:1, moeda:item.unidade };
}

// Valor COTADO de um item, já no TOTAL do processo (multiplicado pelos
// containers quando for porContainer) — usado só pra pré-preencher/mostrar
// como referência na aba Custos Reais, nunca entra direto no cálculo do
// lucro real (ver calcularCustoRealTotal, que só olha p.real_json).
function calcularCustoCotadoItem(item, cotado){
  if(!cotado) return null;
  const base = item.cotado(cotado);
  if(base == null) return null;
  return item.porContainer ? base * (cotado.containers || 1) : base;
}

// Soma tudo que estiver preenchido em p.real_json (valores TOTAIS, já
// digitados pelo usuário na aba Custos Reais — sem fallback automático pro
// cotado aqui; o fallback acontece só visualmente, pré-preenchendo o campo
// quando a aba abre). Itens em USD convertem pelo câmbio salvo em
// p.real_cambio ou, na falta dele, pelo câmbio da PI do processo. Retorna
// null quando não há NENHUM custo real lançado ainda — nesse caso
// calcularFechamento() cai no cálculo antigo (NF Saída − NF Entrada),
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
// item (não o que foi pago ao fornecedor/agente) — guardado nas mesmas
// chaves de real_json, com sufixo "_cobrado" (ex.: reais.siscomex = pago,
// reais.siscomex_cobrado = cobrado). Isso dá pra ver a margem de CADA taxa
// individualmente (compra × venda), igual ao Conexos mostra na aba Taxas —
// não só o total do processo (NF Saída − Custo Real Total).
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

function calcularFechamento(p){
  const est = p.estimativa_json || null;
  const nfEntrada = parseFloat(p.nf_entrada_valor);
  const nfSaida   = parseFloat(p.nf_saida_valor);
  const temReal   = !isNaN(nfSaida) && nfSaida > 0;

  // Custo real detalhado (aba "Custos Reais") — quando o processo tem pelo
  // menos um item lançado ali, ele é MAIS PRECISO que o cálculo grosseiro
  // NF Saída − NF Entrada (que ignora frete, seguro, impostos, comissões e
  // taxas operacionais — cada processo tem uma combinação diferente do que
  // teve ou não). Sem nenhum item lançado, mantém o cálculo antigo por NF.
  const custosReais = calcularCustoRealTotal(p);
  const custoRealTotal = custosReais ? custosReais.total : null;
  // Margem por taxa (compra × venda) — só existe quando o usuário também
  // lançou valores "cobrado do cliente" na aba Custos Reais, não é
  // obrigatório preencher. Independente do Lucro Real (que usa a NF Saída
  // inteira); esta é uma visão à parte, item a item, das taxas específicas.
  const receitaReais = calcularReceitaRealTotal(p);
  const margemTaxas = (custosReais && receitaReais)
    ? { total: receitaReais.total - custosReais.total, custoTotal: custosReais.total, receitaTotal: receitaReais.total }
    : null;
  const lucroReal = custosReais
    ? (temReal ? (nfSaida - custoRealTotal) : null)
    : (temReal ? (nfSaida - (isNaN(nfEntrada)?0:nfEntrada)) : null);
  const pctLucroReal = (temReal && lucroReal != null) ? (lucroReal / nfSaida) : null;

  let custoEstimado = null, faturamentoEstimado = null, lucroEstimado = null, pctLucroEstimado = null;
  if(est){
    custoEstimado = est.custo_total ?? null;
    if(est.cenarios && est.cenarios.com_st && est.cenarios.com_st.faturamento_total != null){
      faturamentoEstimado = est.cenarios.com_st.faturamento_total;
    } else if(est.faturamento != null){
      faturamentoEstimado = est.faturamento; // cotações salvas antes dos 2 cenários
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
    nfEntrada: isNaN(nfEntrada)?null:nfEntrada, nfSaida: isNaN(nfSaida)?null:nfSaida,
    lucroReal, pctLucroReal, deltaValor, deltaPct,
    custosReais, custoRealTotal, // detalhamento por item — null se a aba Custos Reais nunca foi preenchida
    receitaReais, margemTaxas, // margem por taxa (compra × venda) — null se "cobrado do cliente" nunca foi preenchido
  };
}

function renderFechamentoInfo(p){
  const f = calcularFechamento(p);
  const r2 = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const pct2 = v => v==null ? '—' : `${(v*100).toFixed(1)}%`;

  // Antes: sem estimativa_json (processo que não passou pela cotação do
  // Calculador) a função parava aqui e nunca mostrava nada — nem o lucro
  // real, mesmo com NF Entrada e NF Saída já preenchidas na aba Documentos.
  // Ou seja, processo criado direto no Controle nunca tinha como saber a
  // margem, mesmo depois de fechado. Agora só cai nesse aviso quando NÃO
  // há estimativa E também não há NF Saída ainda — nesse caso não tem
  // mesmo nada pra mostrar.
  if(!f.temEstimativa && !f.temReal){
    return `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;color:var(--muted);font-size:12px;">
      Este processo não tem um valor estimado (cotação) nem resultado real (NF Entrada/Saída) vinculado ainda — preencha a NF Entrada e a NF Saída na aba Documentos assim que possível pra ver a margem aqui.
    </div>`;
  }

  // Quando a aba "Custos Reais" tem pelo menos um item lançado, o Lucro Real
  // vem de Faturamento (NF Saída) − Custo Real Total (soma item a item) em
  // vez da conta grosseira NF Saída − NF Entrada — mais preciso porque conta
  // frete, seguro, impostos, comissões e taxas operacionais reais também.
  const linhaCustoRealDetalhado = f.custosReais
    ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Real Total (${f.custosReais.count} ${f.custosReais.count===1?'item lançado':'itens lançados'} na aba Custos Reais)</span><strong>${r2(f.custoRealTotal)}</strong></div>`
    : '';
  // Margem das Taxas (compra × venda) — só aparece quando o usuário também
  // preencheu "Cobrado do Cliente" em pelo menos um item na aba Custos Reais.
  // É uma visão separada do Lucro Real: mostra quanto sobrou/faltou SÓ nas
  // taxas repassadas ao cliente (ex.: taxa que custou R$ 110 e foi cobrada
  // por USD 55) — não mexe no cálculo do Lucro Real, que continua usando a
  // NF Saída inteira.
  const linhaMargemTaxas = f.margemTaxas
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Cobrado do Cliente nas Taxas (${f.receitaReais.count} ${f.receitaReais.count===1?'item':'itens'})</span><strong>${r2(f.margemTaxas.receitaTotal)}</strong></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Margem das Taxas (Cobrado − Pago)</span><strong style="color:${f.margemTaxas.total>=0?'var(--ok)':'var(--err)'}">${r2(f.margemTaxas.total)}</strong></div>
      </div>`
    : '';
  const linhaReal = f.temReal
    ? `${linhaCustoRealDetalhado}<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Lucro Real${f.custosReais?' (NF Saída − Custo Real Total)':' (NF Saída − NF Entrada)'}</span><strong>${r2(f.lucroReal)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroReal)})</span></strong></div>`
    : `${linhaCustoRealDetalhado}<div style="color:var(--muted);font-size:12px;">Ainda não há NF Saída lançada — preencha NF Entrada e NF Saída na aba Documentos pra ver o resultado real aqui.</div>`;

  const corDelta = f.deltaValor==null ? 'var(--muted)' : f.deltaValor >= 0 ? 'var(--ok)' : 'var(--err)';
  const linhaDelta = f.temComparacao
    ? `<div style="margin-top:10px;padding:10px 12px;background:${f.deltaValor>=0?'rgba(22,163,74,.08)':'rgba(220,38,38,.08)'};border-radius:8px;font-weight:700;color:${corDelta};display:flex;justify-content:space-between;">
        <span>${f.deltaValor>=0?'📈 Rendeu a mais que o cotado':'📉 Rendeu a menos que o cotado'}</span>
        <span>${f.deltaValor>=0?'+':''}${r2(f.deltaValor)}</span>
      </div>`
    : '';

  // Bloco "Estimado na cotação" só existe se o processo passou pelo
  // Calculador. Sem isso (processo criado direto no Controle), mostra um
  // aviso curto no lugar, mas o "Resultado real" abaixo continua aparecendo
  // normalmente contanto que NF Entrada/Saída existam.
  const blocoEstimado = f.temEstimativa
    ? `<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">📐 Estimado na cotação</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Total estimado</span><strong>${r2(f.custoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Faturamento estimado (Com S.T.)</span><strong>${r2(f.faturamentoEstimado)}</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">Lucro estimado</span><strong>${r2(f.lucroEstimado)} <span style="color:var(--muted);font-weight:400;">(${pct2(f.pctLucroEstimado)})</span></strong></div>
    </div>`
    : `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--muted);margin-bottom:14px;">
      Este processo não passou pela cotação do Calculador — sem valor estimado pra comparar, mas o resultado real abaixo já funciona normalmente.
    </div>`;

  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
    ${blocoEstimado}
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">✅ Resultado real</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">NF Entrada</span><strong>${r2(f.nfEntrada)}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">NF Saída</span><strong>${r2(f.nfSaida)}</strong></div>
      ${linhaReal}
    </div>
    ${linhaMargemTaxas}
    ${linhaDelta}
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// ALERTAS E NOTIFICAÇÕES
// ════════════════════════════════════════════════════════════════
function verificarAlertas(proc, criarNotif){
  const alertas = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Demurrage
  const diasDemur = demurrageDias(proc);
  if(diasDemur !== null && diasDemur <= 5 && diasDemur >= 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage: ${proc.referencia}`, mensagem:`Vence em ${diasDemur} dia(s)! Container ainda não devolvido.`});
  }
  if(diasDemur !== null && diasDemur < 0 && !proc.data_devolucao_vazio){
    alertas.push({tipo:'urgente', titulo:`Demurrage VENCIDO: ${proc.referencia}`, mensagem:`Venceu há ${Math.abs(diasDemur)} dia(s). Custos em andamento.`});
  }

  // Alerta ETA: ETA passou e processo ainda está Embarcado
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((hoje - eta)/86400000);
    if(diff > 0){
      alertas.push({tipo:'alerta', titulo:`ETA vencido: ${proc.referencia}`, mensagem:`ETA era ${eta.toLocaleDateString('pt-BR')} — processo ainda Embarcado. Verificar chegada.`});
    }
  }

  // Alerta ETA próximo (2 dias)
  if(proc.eta && proc.fase === 'EMBARCADO'){
    const eta = parseDataLocal(proc.eta);
    const diff = Math.ceil((eta - hoje)/86400000);
    if(diff >= 0 && diff <= 2){
      alertas.push({tipo:'info', titulo:`ETA em ${diff === 0 ? 'hoje' : diff + 'd'}: ${proc.referencia}`, mensagem:`Navio previsto para ${eta.toLocaleDateString('pt-BR')}.`});
    }
  }

  // Alerta PI vencimento (prazo pagamento nos próximos 5 dias)
  if(proc.pi_data_saldo && !proc.pi_pago){
    const venc = parseDataLocal(proc.pi_data_saldo);
    const diff = Math.ceil((venc - hoje)/86400000);
    if(diff <= 5 && diff >= 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI vence em ${diff}d: ${proc.referencia}`, mensagem:`Saldo da PI vence em ${venc.toLocaleDateString('pt-BR')}.`});
    }
    if(diff < 0){
      alertas.push({tipo:'urgente', titulo:`Pagamento PI VENCIDO: ${proc.referencia}`, mensagem:`Venceu há ${Math.abs(diff)} dia(s).`});
    }
  }

  if(criarNotif && alertas.length){
    alertas.forEach(a => criarNotificacao(proc.id, a.tipo, a.titulo, a.mensagem));
  }
  return alertas;
}

// Cache em memória das notificações já carregadas nesta sessão, usado só
// para evitar duplicatas — não substitui carregarNotificacoes().
let _notifsCache = [];

async function criarNotificacao(processoId, tipo, titulo, mensagem){
  // Evita criar a mesma notificação de novo a cada save do processo: se já
  // existe uma notificação idêntica (mesmo processo + mesmo título) criada
  // nas últimas 24h, não cria outra. Sem isso, salvar o processo várias
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
  }).then(()=>{ _notifsCache=[]; }).catch(()=>{}); // invalida cache após criar
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
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma notificação</div>';
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

// Clicar numa notificação deve marcá-la como lida E abrir o processo que ela
// se refere — antes só marcava como lida, sem nenhuma forma de chegar ao
// processo a partir da notificação (era preciso buscar manualmente na lista).
function abrirNotificacao(id, processoId){
  marcarLida(id);
  toggleNotif(); // fecha o painel de notificações
  if(processoId){
    abrirProcesso(processoId);
  } else {
    showToast('Esta notificação não está vinculada a um processo','info');
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
    showToast('Todas as notificações marcadas como lidas','ok');
  }catch(e){ showToast('Erro ao marcar notificações','err'); }
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
  if(min < 60) return `${min}min atrás`;
  const h = Math.floor(min/60);
  if(h < 24) return `${h}h atrás`;
  const d = Math.floor(h/24);
  return `${d}d atrás`;
}

// ════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════
// Rótulos amigáveis para os filtros financeiros especiais (usados pelos
// cards clicáveis do Dashboard) — sem isso, o usuário não tem como saber
// qual filtro está ativo depois de clicar num card e ir para a tabela.
const FILTRO_FINANCEIRO_LABEL = {
  __chegada_7d:         '🚢 Chegada prevista (ETA) nos próximos 7 dias',
  __pi_vence_30d:       '💰 Saldo a pagar nos próximos 30 dias',
  __capital_parado:     '📦 Capital parado em estoque/trânsito (pago, aguardando finalizar)',
  __pi_aberto:          '💰 Processos com PI em aberto',
  __pi_pago:            '✓ Processos com PI já paga',
  __pi_vencido:         '🚨 Pagamentos vencidos',
  __pi_vence_semana:    '⚠ Pagamentos vencendo em 7 dias',
  __nf_entrada_periodo: '📥 NF Entrada no período selecionado',
  __nf_saida_periodo:   '📤 NF Saída no período selecionado',
  __demur_aberto:       '⏱ Demurrage em aberto',
  __cambio_periodo:     '💱 Câmbio a pagar no período selecionado',
};

function renderFiltroFinanceiroAtivo(){
  const el = document.getElementById('filtro-financeiro-ativo');
  if(!el) return;
  const label = FILTRO_FINANCEIRO_LABEL[_faseFilter];
  if(!label){ el.innerHTML=''; return; }
  el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;background:rgba(26,127,212,.06);border:1px solid rgba(26,127,212,.2);border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;font-weight:600;color:var(--ac);">
    <span>${label}</span>
    <button type="button" onclick="setFaseFilter('')" style="margin-left:auto;border:none;background:none;color:var(--ac);font-weight:700;cursor:pointer;font-size:12px;">✕ Limpar filtro</button>
  </div>`;
}

function renderFaseFilter(){
  const el = document.getElementById('fase-filter');
  if(!el) return;
  el.innerHTML = `<div class="fase-pill ${_faseFilter===''?'active':''}" onclick="setFaseFilter('')">Todos</div>` +
    FASES.map(f=>`<div class="fase-pill ${_faseFilter===f.id?'active':''}" onclick="setFaseFilter('${f.id}')">${f.icon} ${f.label}</div>`).join('');
}

function setFaseFilter(fase){
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

// Usada pelos cards clicáveis do Dashboard Executivo/Financeiro: fecha o
// dashboard que estiver aberto e mostra a tabela principal já filtrada,
// para o usuário poder ver e agir diretamente nos processos daquele número
// (em vez do card ser só um número estático no topo).
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
  // Demurrage crítico
  const demurCrit = _processos.filter(p => { const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }).length;
  const chegando7d = _processos.filter(p => chegandoEmDias(p,7)).length;

  const stats = [
    {num:total,       label:'Total',          cor:'var(--ac)',  filtro:''},
    {num:emAndamento, label:'Em andamento',    cor:'var(--warn)',filtro:'__andamento'},
    {num:chegando7d,  label:'Chegada em 7d',  cor:'var(--info)',filtro:'__chegada_7d'},
    {num:demurCrit,   label:'Demurrage ≤5d',  cor:'var(--err)', filtro:'__demur'},
    {num:finalizados, label:'Finalizados',     cor:'var(--ok)',  filtro:'FINALIZADO'},
  ];

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

// Mapa de filtros especiais por "fase" virtual (chaves começando com "__",
// usadas pelos cards clicáveis dos dashboards Executivo/Financeiro). Cada
// função recebe a lista já filtrada por busca/data e devolve a lista final.
// Antes isso era uma cadeia crescente de if/else (uma comparação de string
// atrás da outra) — um mapa deixa mais fácil ver todos os filtros disponíveis
// de uma vez, e adicionar um novo sem alterar uma cadeia gigante.
const FILTROS_FASE_ESPECIAIS = {
  __alertas:    lista => lista.filter(p=>verificarAlertas(p,false).length>0),
  __andamento:  lista => lista.filter(p=>p.fase!=='FINALIZADO'),
  __demur:      lista => lista.filter(p=>{ const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; }),
  __chegada_7d: lista => lista.filter(p=>chegandoEmDias(p,7)),
  // Filtros financeiros — usados pelos cards clicáveis do Dashboard Financeiro/Executivo
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
  // Capital parado em estoque/trânsito — usado pelo card do Dashboard
  // Financeiro (v2): já pago integralmente, mas o processo ainda não foi
  // finalizado (mercadoria ainda não virou venda concluída).
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

function filtrarProcessos(){
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
    (p.booking_numero||'').toLowerCase().includes(q)
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

  if(_faseFilter){
    const filtroEspecial = FILTROS_FASE_ESPECIAIS[_faseFilter];
    lista = filtroEspecial ? filtroEspecial(lista) : lista.filter(p=>p.fase===_faseFilter);
  }

  // Filtro por cliente
  const filtroCliente = document.getElementById('filtro-cliente')?.value||'';
  if(filtroCliente) lista = lista.filter(p=>(p.cliente||'')=== filtroCliente);

  // Filtro por finalidade
  const filtroFinalidade = document.getElementById('filtro-finalidade')?.value||'';
  if(filtroFinalidade) lista = lista.filter(p=>p.finalidade === filtroFinalidade);

  // Filtro por pendência de revisão
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
    tbody.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">Nenhum processo encontrado</div></div>`;
  } else {
    tbody.innerHTML = pagina.map(p=>{
      const fase = FASES.find(f=>f.id===p.fase)||FASES[0];
      const etaDate = p.eta ? parseDataLocal(p.eta).toLocaleDateString('pt-BR') : '—';
      const chegadaDate = p.data_chegada ? parseDataLocal(p.data_chegada).toLocaleDateString('pt-BR') : '';
      const dataDisplay = chegadaDate || etaDate;
      const finBadge = p.pi_pagamento ? `<span class="fin-badge fin-${p.pi_pagamento}">${p.pi_pagamento==='ENTRADA_SALDO'?'ENT+SLD':p.pi_pagamento}</span>` : '—';
      const finalidadeLabel = {IMPORTACAO_DIRETA:'Direto', ENCOMENDA:'Encomenda', CONTA_E_ORDEM:'Conta e Ordem'}[p.finalidade] || '';
      const finalidadeBadge = finalidadeLabel ? `<span style="font-size:9px;font-weight:700;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;margin-left:4px;color:var(--muted);">${finalidadeLabel}</span>` : '';
      const pendenciaBadge = p.pendencia_revisao ? `<span title="${esc(p.pendencia_revisao).replace(/"/g,'&quot;')}" style="font-size:10px;font-weight:700;background:rgba(243,156,18,.15);border:1px solid rgba(243,156,18,.4);border-radius:4px;padding:1px 6px;margin-left:4px;color:#f39c12;">⚠ Revisar</span>` : '';
      // referencia/fornecedor são texto livre (fornecedor às vezes vem de
      // extração por IA de documento externo) — escapar sempre antes de
      // colocar em innerHTML, senão um valor malicioso/malformado vira HTML
      // executável pra QUALQUER usuário que abrir esta lista (XSS
      // persistente). Ver esc() em controle-campos.js.
      return `<div class="table-row" onclick="abrirProcesso('${p.id}')">
        <div class="td td-ref" data-label="">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;row-gap:2px;">
            <span>${esc(p.referencia)||'—'}</span>${finalidadeBadge}${pendenciaBadge}
          </div>
        </div>
        <div class="td td-forn" data-label="Fornecedor">${esc(p.fornecedor)||'—'}</div>
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
        <div class="td" data-label="Ações">
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();abrirProcesso('${p.id}')">Abrir</button>
        </div>
      </div>`;
    }).join('');
  }

  // Paginação
  const pag = document.getElementById('paginacao');
  if(pag){
    if(totalPags <= 1){ pag.innerHTML=''; return; }
    let html = `<button class="pag-btn" onclick="_pagina--;render()" ${_pagina<=1?'disabled':''}>‹</button>`;
    for(let i=1;i<=totalPags;i++){
      if(i===1||i===totalPags||Math.abs(i-_pagina)<=1)
        html+=`<button class="pag-btn ${i===_pagina?'active':''}" onclick="_pagina=${i};render()">${i}</button>`;
      else if(Math.abs(i-_pagina)===2)
        html+=`<span class="pag-info">…</span>`;
    }
    html+=`<button class="pag-btn" onclick="_pagina++;render()" ${_pagina>=totalPags?'disabled':''}>›</button>`;
    html+=`<span class="pag-info">${total} processos</span>`;
    pag.innerHTML = html;
  }
}

// ════════════════════════════════════════════════════════════════
// MODAL — ABRIR / NOVO
// ════════════════════════════════════════════════════════════════
