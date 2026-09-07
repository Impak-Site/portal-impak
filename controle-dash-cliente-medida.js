// controle-dash-cliente-medida.js
//
// Dashboard "Por Cliente/Medida" — pedido do Ayslan (06/09/2026), depois de
// mostrar um vídeo de como a Paula hoje descobre "quantos pneus de tal
// medida tem pra tal cliente": ela mantém uma planilha Excel pessoal (fora
// do sistema, alimentada por PROCV de outro arquivo no Dropbox) onde a
// coluna Cliente já vem escrita junto com a medida (ex: "UNICAP 295 LISO")
// e ela usa o Autofiltro do Excel pra isolar as linhas de um cliente.
//
// Aqui a mesma pergunta é respondida direto dos dados que já existem no
// Controle — sem planilha manual: cada processo já tem Cliente
// (proc.cliente, ou por venda em vendas_json quando o processo foi
// vendido pra mais de um cliente) e a lista de Produtos (produtos_json,
// descrição + quantidade — a "medida" é a própria descrição, ex: "PNEU TBR
// 295/80R22.5"). Este painel só soma tudo isso agrupado por Cliente ×
// Medida.
//
// Escopo (confirmado com o Ayslan, 06/09/2026): só processos "em
// andamento" nas fases PI Recebida, Aguardando Embarque, Embarcado,
// Desembarcado e Registro DI — ou seja, o pneu já foi pedido/está a
// caminho/chegou mas ainda não virou estoque disponível (Parametrização
// em diante) nem foi finalizado. Processos cancelados nunca entram.
//
// Colunas por fase (pedido do Ayslan 06/09/2026, depois de ver a 1ª versão
// com uma coluna "Quantidade" só): em vez de somar tudo junto, cada medida
// mostra quantos pneus estão em cada fase — dá pra ver de cara quanto já
// embarcou vs quanto ainda tá esperando embarque, sem precisar abrir a
// lista de processos pra descobrir.
//
// Parte do controle_v2.html, carregado via <script src> — não é ES module.
// Depende de: _processos, calcularFase, FASE_LABEL, parseVendas, esc(),
// fecharTodosDashboards (controle-core.js).

const FASES_CLIENTE_MEDIDA = ['PI','AGUARDANDO_EMBARQUE','EMBARCADO','DESEMBARCADO','REGISTRO_DI'];
const FASES_CLIENTE_MEDIDA_SET = new Set(FASES_CLIENTE_MEDIDA);
// Cabeçalho curto de cada coluna — mais enxuto que o label completo de
// FASE_LABEL ("Ag. Embarque" em vez de repetir "Aguardando Embarque" numa
// coluna estreita).
const FASE_COLUNA_LABEL = {
  PI: 'PI Recebida',
  AGUARDANDO_EMBARQUE: 'Ag. Embarque',
  EMBARCADO: 'Embarcado',
  DESEMBARCADO: 'Desembarcado',
  REGISTRO_DI: 'Registro DI',
};

// Texto do filtro de busca — guardado fora da função pra sobreviver aos
// re-renders disparados a cada tecla digitada (oninput chama
// renderDashClienteMedida() de novo; sem isso o campo "esqueceria" o que
// já tinha sido digitado a cada re-render).
let _cmFiltroTexto = '';

function toggleDashClienteMedida(){
  const el = document.getElementById('dash-clientemedida');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  if(!visivel) renderDashClienteMedida();
  document.getElementById('menu-clientemedida')?.classList.toggle('active', !visivel);
}

function _cmAtualizarFiltro(valor){
  _cmFiltroTexto = valor || '';
  renderDashClienteMedida();
  // Mantém o foco e o cursor no campo depois do re-render (senão cada
  // tecla digitada perde o foco, porque o innerHTML inteiro é recriado).
  const input = document.getElementById('cm-filtro');
  if(input){
    input.focus();
    const pos = input.value.length;
    input.setSelectionRange(pos, pos);
  }
}

function renderDashClienteMedida(){
  const el = document.getElementById('dash-clientemedida-content');
  if(!el) return;

  // ── Agregação: Cliente → Medida → Fase → {qtd, processos[]} ───────
  const porCliente = {}; // chave (CLIENTE em caixa alta) -> {nome, porMedida:{}, total}
  let totalGeral = 0;
  let processosConsiderados = 0;

  function addItem(clienteNomeOriginal, descricaoOriginal, quantidade, p, fase){
    const clienteNome = (clienteNomeOriginal || 'Sem cliente').trim() || 'Sem cliente';
    const chaveCliente = clienteNome.toUpperCase();
    const descricao = (descricaoOriginal || 'Sem medida informada').trim() || 'Sem medida informada';
    const chaveMedida = descricao.toUpperCase();
    const qtd = parseFloat(quantidade) || 0;

    if(!porCliente[chaveCliente]) porCliente[chaveCliente] = { nome: clienteNome, porMedida: {}, total: 0 };
    const cli = porCliente[chaveCliente];
    if(!cli.porMedida[chaveMedida]){
      const porFase = {};
      FASES_CLIENTE_MEDIDA.forEach(f => { porFase[f] = { qtd: 0, processos: [] }; });
      cli.porMedida[chaveMedida] = { label: descricao, qtd: 0, porFase };
    }
    const med = cli.porMedida[chaveMedida];
    med.qtd += qtd;
    cli.total += qtd;
    totalGeral += qtd;
    const bucket = med.porFase[fase];
    bucket.qtd += qtd;
    bucket.processos.push({
      id: p.id,
      referencia: p.referencia,
      fase: FASE_LABEL[fase] || fase,
      eta: p.eta || p.data_prontidao || '',
      qtd,
    });
  }

  _processos.forEach(p => {
    if(p.cancelado) return;
    const fase = calcularFase(p);
    if(!FASES_CLIENTE_MEDIDA_SET.has(fase)) return;
    processosConsiderados++;

    let produtos = [];
    try{ produtos = JSON.parse(p.produtos_json || '[]'); }catch(e){ /* ignora produtos_json inválido */ }
    if(!Array.isArray(produtos) || !produtos.length){
      if(p.produto) produtos = [{ descricao: p.produto, quantidade: null }];
    }

    // Processo vendido pra mais de um cliente (aba Vendas): usa o cliente
    // e os itens de CADA venda, em vez do proc.cliente único — reflete
    // corretamente quem vai ficar com qual medida. Sem venda cadastrada
    // (o normal pra processo ainda em andamento), cai no caso simples:
    // 1 cliente (proc.cliente), a lista de Produtos inteira.
    const vendas = typeof parseVendas === 'function' ? parseVendas(p) : [];
    if(vendas.length){
      vendas.forEach(v => {
        const itens = (v.itens && v.itens.length) ? v.itens : produtos;
        itens.forEach(it => addItem(v.cliente || p.cliente, it.descricao, it.quantidade, p, fase));
      });
    } else {
      produtos.forEach(it => addItem(p.cliente, it.descricao, it.quantidade, p, fase));
    }
  });

  // ── Filtro de busca (cliente OU medida) ────────────────────────────
  const termo = _cmFiltroTexto.trim().toLowerCase();
  let clientesLista = Object.entries(porCliente).map(([chave, dados]) => ({ chave, ...dados }));
  if(termo){
    clientesLista = clientesLista.filter(c =>
      c.nome.toLowerCase().includes(termo) ||
      Object.values(c.porMedida).some(m => m.label.toLowerCase().includes(termo))
    );
  }
  clientesLista.sort((a,b) => b.total - a.total);

  const fmtN = v => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  // Guarda os dados de cada Cliente×Medida×Fase acessíveis pro onclick do
  // modal (mesmo padrão do abrirListaTV em controle-dash-tv.js).
  window._cmListas = {};

  function celulaFase(chaveCliente, chaveMedida, fase, bucket){
    if(!bucket.qtd) return `<td style="padding:6px 8px;text-align:right;color:var(--border);">—</td>`;
    const idLista = chaveCliente + '||' + chaveMedida + '||' + fase;
    window._cmListas[idLista] = { titulo: FASE_COLUNA_LABEL[fase], rows: bucket.processos };
    return `<td onclick="abrirListaCM('${idLista.replace(/'/g,"\\'")}')" title="Clique para ver os processos" style="padding:6px 8px;text-align:right;font-weight:700;cursor:pointer;color:var(--ac);" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${fmtN(bucket.qtd)}</td>`;
  }

  function linhaMedida(chaveCliente, chaveMedida, med){
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:6px 10px;">${esc(med.label)}</td>
      ${FASES_CLIENTE_MEDIDA.map(f => celulaFase(chaveCliente, chaveMedida, f, med.porFase[f])).join('')}
      <td style="padding:6px 10px;text-align:right;font-weight:800;white-space:nowrap;border-left:1px solid var(--border);">${fmtN(med.qtd)}</td>
    </tr>`;
  }

  function blocoCliente(c){
    const medidas = Object.entries(c.porMedida).map(([chave,m]) => [chave,m]).sort((a,b) => b[1].qtd - a[1].qtd);
    return `<details style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden;" ${clientesLista.length===1?'open':''}>
      <summary style="cursor:pointer;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;list-style:none;background:var(--bg);">
        <span style="font-weight:700;font-size:13px;">${esc(c.nome)}</span>
        <span style="font-weight:800;font-size:15px;color:var(--ac);font-family:'DM Sans',sans-serif;">${fmtN(c.total)} <span style="font-size:11px;font-weight:600;color:var(--muted);">pneus</span></span>
      </summary>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px;">
        <thead><tr style="text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.4px;">
          <th style="padding:6px 10px;">Medida</th>
          ${FASES_CLIENTE_MEDIDA.map(f => `<th style="padding:6px 8px;text-align:right;">${FASE_COLUNA_LABEL[f]}</th>`).join('')}
          <th style="padding:6px 10px;text-align:right;border-left:1px solid var(--border);">Total</th>
        </tr></thead>
        <tbody>${medidas.map(([chaveMedida,m]) => linhaMedida(c.chave, chaveMedida, m)).join('')}</tbody>
      </table>
      </div>
    </details>`;
  }

  const corpoHtml = clientesLista.length
    ? clientesLista.map(blocoCliente).join('')
    : `<div style="font-size:13px;color:var(--muted);padding:20px 0;text-align:center;">${termo ? 'Nenhum cliente/medida encontrado para "'+esc(_cmFiltroTexto)+'".' : 'Nenhum processo em andamento no momento.'}</div>`;

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="background:#fff;border:1px solid var(--border);border-left:3px solid var(--ac);border-radius:10px;padding:12px 16px;flex:1;min-width:160px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Total de Pneus</div>
        <div style="font-size:22px;font-weight:800;color:var(--ac);font-family:'DM Sans',sans-serif;">${fmtN(totalGeral)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">PI Recebida até Registro DI, sem cancelados</div>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-left:3px solid #64748b;border-radius:10px;padding:12px 16px;flex:1;min-width:160px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Clientes</div>
        <div style="font-size:22px;font-weight:800;color:var(--text);font-family:'DM Sans',sans-serif;">${Object.keys(porCliente).length}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${processosConsiderados} processo(s) considerados</div>
      </div>
    </div>
    <input id="cm-filtro" class="form-input" placeholder="Filtrar por cliente ou medida (ex: UNICAP, 295/80R22.5)..." value="${esc(_cmFiltroTexto)}"
      oninput="_cmAtualizarFiltro(this.value)" style="width:100%;margin-bottom:14px;">
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Clique num número pra ver os processos por trás dele.</div>
    <div>${corpoHtml}</div>
  `;
}

// ── Modal "quais processos estão nesse Cliente × Medida × Fase" ──────
// Mesmo padrão do abrirListaTV (controle-dash-tv.js): clicar numa célula
// abre a lista dos processos por trás daquele número.
function abrirListaCM(idLista){
  const dados = (window._cmListas || {})[idLista];
  if(!dados) return;
  let modal = document.getElementById('cm-lista-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'cm-lista-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;align-items:center;justify-content:center;';
    modal.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:640px;width:92%;max-height:82vh;overflow:auto;padding:20px 22px;box-shadow:0 12px 40px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<h3 id="cm-lista-titulo" style="margin:0;font-size:16px;"></h3>' +
      '<button onclick="fecharListaCM()" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--muted);">&times;</button>' +
      '</div><div id="cm-lista-corpo"></div></div>';
    modal.addEventListener('click', function(e){ if(e.target === modal) fecharListaCM(); });
    document.body.appendChild(modal);
  }
  document.getElementById('cm-lista-titulo').textContent = dados.titulo + ' — ' + dados.rows.length + ' processo(s)';
  const corpo = document.getElementById('cm-lista-corpo');
  corpo.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
      <th style="padding:6px 8px;">Referência</th>
      <th style="padding:6px 8px;">Fase</th>
      <th style="padding:6px 8px;">ETA/Previsão</th>
      <th style="padding:6px 8px;text-align:right;">Quantidade</th>
    </tr></thead>
    <tbody>
    ${dados.rows.map(r => `<tr style="border-bottom:1px solid var(--border);cursor:pointer;" onclick="fecharListaCM();abrirProcesso('${r.id}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <td style="padding:6px 8px;font-weight:600;">${esc(r.referencia||'—')}</td>
      <td style="padding:6px 8px;">${esc(r.fase||'—')}</td>
      <td style="padding:6px 8px;">${r.eta ? new Date(r.eta+'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
      <td style="padding:6px 8px;text-align:right;">${r.qtd.toLocaleString('pt-BR',{maximumFractionDigits:2})}</td>
    </tr>`).join('')}
    </tbody>
  </table>`;
  modal.style.display = 'flex';
}
function fecharListaCM(){
  const modal = document.getElementById('cm-lista-modal');
  if(modal) modal.style.display = 'none';
}
