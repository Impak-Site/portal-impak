// controle-dash-cliente-medida.js
//
// Dashboard "Por Cliente/Medida" — pedido do Ayslan (06/09/2026), depois de
// mostrar um vídeo de como a Paula hoje descobre "quantos pneus de tal
// medida tem pra tal cliente": ela mantém uma planilha Excel pessoal (fora
// do sistema, alimentada por PROCV de outro arquivo no Dropbox) onde a
// coluna Cliente já vem escrita junto com a medida (ex: "UNICAP 295 LISO")
// e ela usa o Autofiltro do Excel pra isolar as linhas de um cliente.
//
// V1 deste painel (06/09/2026) era uma tabela fixa: Cliente → Medida, sem
// jeito de restringir por Fornecedor ou Marca. V2 (mesmo dia) adicionou
// filtros (Cliente, Fornecedor, Marca, Fase) que restringem os dados antes
// de agrupar. V3 (mesmo dia, feedback seguinte do Ayslan: "o melhor seria
// colocar cada linha por um fornecedor/marca com suas quantidades"): além
// de filtrar, cada LINHA da tabela agora é Fornecedor + Marca + Medida —
// dois lotes da mesma medida vindos de fornecedores diferentes aparecem em
// linhas separadas, em vez de somados juntos numa linha só "Medida".
//
// V4 (07/09/2026, pedido do Ayslan: "tem fornecedores que sao o mesmo,
// porem, com escrita um pouco diferente" — ex: "JIMI RUBBER PTE. LTD."
// vs "JIMI RUBBER PTE.LTD.", "SAILUN GROUP (HONGKONG) CO., LIMITED" vs
// "SAILUN GROUP(HONGKONG)CO.,LIMITED"): Fornecedor e Marca agora agrupam
// por uma CHAVE normalizada (_cmChaveEmpresa — maiúsculas sem espaço nem
// pontuação), então pequenas diferenças de espaçamento/pontuação na
// escrita do cadastro não geram mais linhas nem opções de filtro
// duplicadas. O texto exibido continua sendo a grafia original (a
// primeira encontrada), só o agrupamento é que ignora essas diferenças.
//
// Cada processo já tem Cliente (proc.cliente, ou por venda em vendas_json
// quando vendido pra mais de um cliente), Fornecedor (proc.fornecedor) e
// Marca (proc.brand — quando em branco, usa o próprio Fornecedor, mesmo
// fallback do Dashboard TV) e a lista de Produtos (produtos_json,
// descrição + quantidade — a "medida" é a própria descrição, ex: "PNEU TBR
// 295/80R22.5"). Este painel soma tudo isso agrupado por Cliente × Medida
// × Fase, só com o que passar pelos filtros escolhidos.
//
// Escopo de fase (confirmado com o Ayslan, 06/09/2026): só processos "em
// andamento" nas fases PI Recebida, Aguardando Embarque, Embarcado,
// Desembarcado e Registro DI — ou seja, o pneu já foi pedido/está a
// caminho/chegou mas ainda não virou estoque disponível (Parametrização
// em diante) nem foi finalizado. Cada fase pode ser ligada/desligada no
// filtro; processos cancelados nunca entram, filtro nenhum traz eles de
// volta.
//
// Parte do controle_v2.html, carregado via <script src> — não é ES module.
// Depende de: _processos, calcularFase, FASE_LABEL, parseVendas, esc(),
// fecharTodosDashboards (controle-core.js).

// Normaliza nome de Fornecedor/Marca só pra efeito de AGRUPAMENTO —
// maiúsculas, sem acento, sem nenhum espaço ou pontuação — assim
// "JIMI RUBBER PTE. LTD." e "JIMI RUBBER PTE.LTD." caem na mesma chave.
// Nunca usado pra exibir o nome, só pra decidir se duas grafias são a
// mesma empresa.
function _cmChaveEmpresa(nome){
  return (nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
}

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

// Estado dos filtros — guardado fora da função pra sobreviver aos
// re-renders disparados a cada interação (sem isso, cada seleção
// "esqueceria" o que já tinha sido escolhido a cada re-render).
let _cmFiltroTexto = '';       // busca livre (medida)
let _cmFiltroCliente = '';     // '' = todos
let _cmFiltroFornecedor = '';  // '' = todos
let _cmFiltroMarca = '';       // '' = todas
let _cmFasesAtivas = new Set(FASES_CLIENTE_MEDIDA); // fases marcadas nos checkboxes
let _cmIntervaloId = null; // id do setInterval de auto-refresh (null = parado)

function toggleDashClienteMedida(){
  const el = document.getElementById('dash-clientemedida');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  if(!visivel){
    renderDashClienteMedida();
    _cmIniciarAutoRefresh();
  } else {
    _cmPararAutoRefresh();
  }
  document.getElementById('menu-clientemedida')?.classList.toggle('active', !visivel);
}

// Atualiza sozinho a cada 2 min — pedido do Ayslan (07/09/2026), depois de
// perguntar se 2 min "sobrecarrega o sistema": não sobrecarrega, porque o
// _processos já é recarregado do servidor a cada 30s em background (loop
// global que já existe independente deste dashboard) — aqui a gente só
// RE-RENDERIZA a partir do que já está em memória, sem nenhuma requisição
// extra. Para sozinho se o painel for fechado por qualquer caminho
// (inclusive fecharTodosDashboards() de outro dashboard sendo aberto),
// checando a visibilidade a cada tick em vez de depender de um evento
// explícito de "fechou".
function _cmIniciarAutoRefresh(){
  _cmPararAutoRefresh();
  _cmIntervaloId = setInterval(() => {
    const el = document.getElementById('dash-clientemedida');
    if(!el || el.style.display !== 'block'){ _cmPararAutoRefresh(); return; }
    renderDashClienteMedida();
  }, 2 * 60 * 1000);
}
function _cmPararAutoRefresh(){
  if(_cmIntervaloId){ clearInterval(_cmIntervaloId); _cmIntervaloId = null; }
}

function _cmAtualizarFiltroTexto(valor){
  _cmFiltroTexto = valor || '';
  renderDashClienteMedida();
  // Mantém o foco e o cursor no campo depois do re-render (senão cada
  // tecla digitada perde o foco, porque o innerHTML inteiro é recriado).
  const input = document.getElementById('cm-filtro-texto');
  if(input){
    input.focus();
    const pos = input.value.length;
    input.setSelectionRange(pos, pos);
  }
}
function _cmSetFiltroSelect(campo, valor){
  if(campo === 'cliente') _cmFiltroCliente = valor;
  else if(campo === 'fornecedor') _cmFiltroFornecedor = valor;
  else if(campo === 'marca') _cmFiltroMarca = valor;
  renderDashClienteMedida();
}
function _cmToggleFase(fase, marcado){
  if(marcado) _cmFasesAtivas.add(fase);
  else _cmFasesAtivas.delete(fase);
  renderDashClienteMedida();
}
function _cmLimparFiltros(){
  _cmFiltroTexto = '';
  _cmFiltroCliente = '';
  _cmFiltroFornecedor = '';
  _cmFiltroMarca = '';
  _cmFasesAtivas = new Set(FASES_CLIENTE_MEDIDA);
  renderDashClienteMedida();
}

function renderDashClienteMedida(){
  const el = document.getElementById('dash-clientemedida-content');
  if(!el) return;

  // ── Passo 1: opções dos selects (Cliente/Fornecedor/Marca) ─────────
  // Calculadas a partir de TODOS os processos elegíveis (fase certa, não
  // cancelado), ignorando os filtros já escolhidos — assim as opções da
  // lista nunca "somem" quando você já filtrou por outra coisa; só o
  // conteúdo da tabela embaixo é que reage aos filtros.
  // Mapa chave-normalizada -> label exibido (a primeira grafia encontrada
  // "vence" e vira o rótulo do filtro/coluna pra aquela empresa).
  const clientesDisponiveis = new Map();
  const fornecedoresDisponiveis = new Map();
  const marcasDisponiveis = new Map();
  // chaveFn default = identidade (maiúsculas/trim) usada pro Cliente — o
  // Cliente já é comparado assim no resto do código (chaveCliente em
  // addItem). Fornecedor/Marca usam _cmChaveEmpresa (ignora pontuação e
  // espaço) pra agrupar grafias diferentes da mesma empresa.
  function _cmAddOpcao(mapa, nome, chaveFn){
    const label = (nome || '').trim();
    if(!label) return;
    const chave = (chaveFn || (s => s.toUpperCase()))(label);
    if(!mapa.has(chave)) mapa.set(chave, label);
  }
  _processos.forEach(p => {
    if(p.cancelado) return;
    if(!FASES_CLIENTE_MEDIDA_SET.has(calcularFase(p))) return;
    const vendas = typeof parseVendas === 'function' ? parseVendas(p) : [];
    if(vendas.length) vendas.forEach(v => _cmAddOpcao(clientesDisponiveis, v.cliente || p.cliente || 'Sem cliente'));
    else _cmAddOpcao(clientesDisponiveis, p.cliente || 'Sem cliente');
    _cmAddOpcao(fornecedoresDisponiveis, p.fornecedor || 'Sem fornecedor', _cmChaveEmpresa);
    _cmAddOpcao(marcasDisponiveis, p.brand || p.fornecedor || 'Sem marca', _cmChaveEmpresa);
  });

  // ── Passo 2: agregação Cliente → Medida → Fase, já com os filtros ──
  const porCliente = {}; // chave (CLIENTE em caixa alta) -> {nome, porLinha:{}, total} — cada linha e uma combinacao Fornecedor+Marca+Medida
  let totalGeral = 0;
  let processosConsiderados = 0;

  const processosContadosIds = new Set();

  function addItem(clienteNomeOriginal, fornecedorOriginal, marcaOriginal, descricaoOriginal, quantidade, p, fase){
    const clienteNome = (clienteNomeOriginal || 'Sem cliente').trim() || 'Sem cliente';
    if(_cmFiltroCliente && clienteNome.toUpperCase() !== _cmFiltroCliente.toUpperCase()) return;
    const chaveCliente = clienteNome.toUpperCase();
    const fornecedorNome = (fornecedorOriginal || 'Sem fornecedor').trim() || 'Sem fornecedor';
    const marcaNome = (marcaOriginal || 'Sem marca').trim() || 'Sem marca';
    const descricao = (descricaoOriginal || 'Sem medida informada').trim() || 'Sem medida informada';
    // Chave da linha = Fornecedor + Marca + Medida (pedido do Ayslan
    // 06/09/2026: "colocar cada linha por um fornecedor/marca com suas
    // quantidades" — antes a linha era só a Medida, então dois lotes da
    // mesma medida de fornecedores diferentes ficavam somados juntos).
    // Fornecedor/Marca entram pela chave NORMALIZADA (_cmChaveEmpresa), não
    // pelo texto cru — assim "JIMI RUBBER PTE. LTD." e "JIMI RUBBER
    // PTE.LTD." caem na mesma linha (pedido Ayslan 07/09/2026).
    const chaveLinha = _cmChaveEmpresa(fornecedorNome) + '||' + _cmChaveEmpresa(marcaNome) + '||' + descricao.toUpperCase();
    const qtd = parseFloat(quantidade) || 0;

    if(!porCliente[chaveCliente]) porCliente[chaveCliente] = { nome: clienteNome, porLinha: {}, total: 0 };
    const cli = porCliente[chaveCliente];
    if(!cli.porLinha[chaveLinha]){
      const porFase = {};
      FASES_CLIENTE_MEDIDA.forEach(f => { porFase[f] = { qtd: 0, processos: [] }; });
      cli.porLinha[chaveLinha] = { fornecedor: fornecedorNome, marca: marcaNome, medida: descricao, qtd: 0, porFase };
    }
    const linha = cli.porLinha[chaveLinha];
    linha.qtd += qtd;
    cli.total += qtd;
    totalGeral += qtd;
    processosContadosIds.add(p.id);
    const bucket = linha.porFase[fase];
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
    if(!_cmFasesAtivas.has(fase)) return;

    const fornecedor = (p.fornecedor || 'Sem fornecedor').trim() || 'Sem fornecedor';
    if(_cmFiltroFornecedor && _cmChaveEmpresa(fornecedor) !== _cmFiltroFornecedor) return;
    const marca = (p.brand || p.fornecedor || 'Sem marca').trim() || 'Sem marca';
    if(_cmFiltroMarca && _cmChaveEmpresa(marca) !== _cmFiltroMarca) return;

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
        itens.forEach(it => addItem(v.cliente || p.cliente, fornecedor, marca, it.descricao, it.quantidade, p, fase));
      });
    } else {
      produtos.forEach(it => addItem(p.cliente, fornecedor, marca, it.descricao, it.quantidade, p, fase));
    }
  });
  processosConsiderados = processosContadosIds.size;

  // ── Filtro de busca livre (medida) ─────────────────────────────────
  // Bug reportado pelo Ayslan (07/09/2026): digitar uma medida no campo de
  // busca não filtrava nada, a tabela continuava mostrando TODAS as
  // medidas do cliente. Causa: o filtro só decidia se o bloco do CLIENTE
  // inteiro aparecia ou sumia (bastava UMA linha bater com o termo pra
  // manter TODAS as linhas daquele cliente na tela) — nunca filtrava as
  // linhas dentro da tabela. Agora, quando o termo bate no Cliente, mantém
  // todas as linhas dele (comportamento de "buscar por cliente" continua
  // funcionando); quando não bate no Cliente, filtra as LINHAS pelo termo
  // (medida/fornecedor/marca) e descarta o cliente se sobrar zero linha.
  const termo = _cmFiltroTexto.trim().toLowerCase();
  let clientesLista = Object.entries(porCliente).map(([chave, dados]) => ({ chave, ...dados }));
  if(termo){
    clientesLista = clientesLista
      .map(c => {
        const nomeBate = c.nome.toLowerCase().includes(termo);
        if(nomeBate) return c;
        const linhasFiltradas = {};
        let totalFiltrado = 0;
        Object.entries(c.porLinha).forEach(([chaveLinha, l]) => {
          const bate = l.medida.toLowerCase().includes(termo) || l.fornecedor.toLowerCase().includes(termo) || l.marca.toLowerCase().includes(termo);
          if(bate){ linhasFiltradas[chaveLinha] = l; totalFiltrado += l.qtd; }
        });
        return { ...c, porLinha: linhasFiltradas, total: totalFiltrado };
      })
      .filter(c => Object.keys(c.porLinha).length > 0);
  }
  clientesLista.sort((a,b) => b.total - a.total);

  const fmtN = v => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  // Guarda os dados de cada Cliente×Medida×Fase acessíveis pro onclick do
  // modal (mesmo padrão do abrirListaTV em controle-dash-tv.js).
  window._cmListas = {};

  function celulaFase(chaveCliente, chaveLinha, fase, bucket){
    if(!bucket.qtd) return `<td style="padding:6px 14px;text-align:right;color:var(--border);white-space:nowrap;">—</td>`;
    const idLista = chaveCliente + '||' + chaveLinha + '||' + fase;
    window._cmListas[idLista] = { titulo: FASE_COLUNA_LABEL[fase], rows: bucket.processos };
    return `<td onclick="abrirListaCM('${idLista.replace(/'/g,"\\'")}')" title="Clique para ver os processos" style="padding:6px 14px;text-align:right;font-weight:700;cursor:pointer;color:var(--ac);white-space:nowrap;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${fmtN(bucket.qtd)}</td>`;
  }

  function linhaItem(chaveCliente, chaveLinha, linha){
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:6px 10px;white-space:nowrap;">${esc(linha.fornecedor)}</td>
      <td style="padding:6px 10px;white-space:nowrap;">${esc(linha.marca)}</td>
      <td style="padding:6px 10px;white-space:nowrap;">${esc(linha.medida)}</td>
      ${FASES_CLIENTE_MEDIDA.filter(f => _cmFasesAtivas.has(f)).map(f => celulaFase(chaveCliente, chaveLinha, f, linha.porFase[f])).join('')}
      <td style="padding:6px 14px;text-align:right;font-weight:800;white-space:nowrap;border-left:1px solid var(--border);">${fmtN(linha.qtd)}</td>
    </tr>`;
  }

  const fasesColunas = FASES_CLIENTE_MEDIDA.filter(f => _cmFasesAtivas.has(f));

  function blocoCliente(c){
    const linhas = Object.entries(c.porLinha).map(([chave,l]) => [chave,l])
      .sort((a,b) => a[1].fornecedor.localeCompare(b[1].fornecedor,'pt-BR') || a[1].marca.localeCompare(b[1].marca,'pt-BR') || b[1].qtd - a[1].qtd);
    return `<details style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden;" ${clientesLista.length===1?'open':''}>
      <summary style="cursor:pointer;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;list-style:none;background:var(--bg);">
        <span style="font-weight:700;font-size:13px;">${esc(c.nome)}</span>
        <span style="font-weight:800;font-size:15px;color:var(--ac);font-family:'DM Sans',sans-serif;">${fmtN(c.total)} <span style="font-size:11px;font-weight:600;color:var(--muted);">pneus</span></span>
      </summary>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:${420 + fasesColunas.length*130}px;">
        <thead><tr style="text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;">
          <th style="padding:6px 10px;white-space:nowrap;">Fornecedor</th>
          <th style="padding:6px 10px;white-space:nowrap;">Marca</th>
          <th style="padding:6px 10px;white-space:nowrap;">Medida</th>
          ${fasesColunas.map(f => `<th style="padding:6px 14px;text-align:right;white-space:nowrap;">${FASE_COLUNA_LABEL[f]}</th>`).join('')}
          <th style="padding:6px 14px;text-align:right;white-space:nowrap;border-left:1px solid var(--border);">Total</th>
        </tr></thead>
        <tbody>${linhas.map(([chaveLinha,l]) => linhaItem(c.chave, chaveLinha, l)).join('')}</tbody>
      </table>
      </div>
    </details>`;
  }

  const corpoHtml = clientesLista.length
    ? clientesLista.map(blocoCliente).join('')
    : `<div style="font-size:13px;color:var(--muted);padding:20px 0;text-align:center;">${(termo||_cmFiltroCliente||_cmFiltroFornecedor||_cmFiltroMarca) ? 'Nenhum resultado para os filtros escolhidos.' : 'Nenhum processo em andamento no momento.'}</div>`;

  function selectFiltro(campo, label, valorAtual, opcoesMap){
    // opcoesMap: chave normalizada -> label exibido. O <option value> é a
    // chave normalizada (pra bater com o que o filtro compara), o texto é
    // sempre a grafia original.
    const entradas = [...opcoesMap.entries()].sort((a,b) => a[1].localeCompare(b[1],'pt-BR'));
    const opts = ['<option value="">Todos'+(label==='Cliente'?' os clientes':label==='Fornecedor'?' os fornecedores':' as marcas')+'</option>']
      .concat(entradas.map(([chave,lbl]) => `<option value="${esc(chave)}" ${chave===valorAtual?'selected':''}>${esc(lbl)}</option>`));
    return `<select onchange="_cmSetFiltroSelect('${campo}',this.value)" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--text);outline:none;min-width:170px;flex:1;">
      ${opts.join('')}
    </select>`;
  }

  const temFiltroAtivo = _cmFiltroTexto || _cmFiltroCliente || _cmFiltroFornecedor || _cmFiltroMarca || _cmFasesAtivas.size !== FASES_CLIENTE_MEDIDA.length;

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="background:#fff;border:1px solid var(--border);border-left:3px solid var(--ac);border-radius:10px;padding:12px 16px;flex:1;min-width:160px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Total de Pneus</div>
        <div style="font-size:22px;font-weight:800;color:var(--ac);font-family:'DM Sans',sans-serif;">${fmtN(totalGeral)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Considerando os filtros abaixo</div>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-left:3px solid #64748b;border-radius:10px;padding:12px 16px;flex:1;min-width:160px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Clientes</div>
        <div style="font-size:22px;font-weight:800;color:var(--text);font-family:'DM Sans',sans-serif;">${Object.keys(porCliente).length}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${processosConsiderados} processo(s) considerados</div>
      </div>
    </div>

    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        ${selectFiltro('cliente','Cliente',_cmFiltroCliente,clientesDisponiveis)}
        ${selectFiltro('fornecedor','Fornecedor',_cmFiltroFornecedor,fornecedoresDisponiveis)}
        ${selectFiltro('marca','Marca',_cmFiltroMarca,marcasDisponiveis)}
        <input id="cm-filtro-texto" class="form-input" placeholder="Buscar medida (ex: 295/80R22.5)..." value="${esc(_cmFiltroTexto)}"
          oninput="_cmAtualizarFiltroTexto(this.value)" style="flex:2;min-width:200px;">
        ${temFiltroAtivo ? `<button class="btn btn-outline" onclick="_cmLimparFiltros()" style="white-space:nowrap;">✕ Limpar filtros</button>` : ''}
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text);">
        ${FASES_CLIENTE_MEDIDA.map(f => `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" ${_cmFasesAtivas.has(f)?'checked':''} onchange="_cmToggleFase('${f}',this.checked)"> ${FASE_COLUNA_LABEL[f]}
        </label>`).join('')}
      </div>
    </div>

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
