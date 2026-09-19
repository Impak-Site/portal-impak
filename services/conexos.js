// services/conexos.js — integração com o Conexos Cloud (ERP de comex da IMPAK)
//
// ESTADO ATUAL (19/09/2026): esqueleto pronto, transporte VAZIO. A
// documentação técnica da API do Conexos só é liberada pra cliente, então a
// parte que de fato fala com eles (autenticação, endpoints, formato) fica
// pra depois da reunião com o Conexos -- ver docs/CONEXOS_INTEGRACAO.md com
// a lista de perguntas. Tudo que NÃO depende deles já está aqui:
//
//   - MAPA_CAMPOS: de-para entre os campos do nosso processo e o "nome
//     genérico" do dado (ex: numero_di ↔ 'di.numero'). Quando a doc chegar,
//     só se preenche a coluna do Conexos.
//   - mapearDoConexos(): transforma o que vier deles no formato do nosso
//     processo, respeitando a regra de precedência (quais campos eles podem
//     sobrescrever direto e quais precisam de confirmação -- item 4 do
//     plano, a decidir com Paula; por enquanto NADA sobrescreve valor já
//     preenchido, só completa vazio).
//   - sincronizarProcesso(): fluxo completo (buscar → mapear → aplicar →
//     registrar em integracao_log), com o passo "buscar" delegado a um
//     transporte injetável -- em produção hoje ele devolve
//     { configurado:false } e nada é alterado.
//
// Nenhuma função aqui toca o banco diretamente: recebe `sb` (client do
// Supabase) por parâmetro, o que permite testar sem rede (testes_conexos.js).

'use strict';

// Campos do nosso processo que a integração pode preencher, com o nome
// genérico do dado. `sobrescreve:true` = o Conexos é fonte oficial desse
// dado e pode trocar um valor já digitado (por padrão NÃO -- ver item 4).
const MAPA_CAMPOS = [
  { nosso: 'numero_di',         dado: 'di.numero',               sobrescreve: false },
  { nosso: 'data_registro_di',  dado: 'di.data_registro',        sobrescreve: false },
  { nosso: 'canal',             dado: 'di.canal',                sobrescreve: false },
  { nosso: 'data_liberacao',    dado: 'di.data_desembaraco',     sobrescreve: false },
  { nosso: 'ci_numero',         dado: 'invoice.numero',          sobrescreve: false },
  { nosso: 'ci_data',           dado: 'invoice.data',            sobrescreve: false },
  { nosso: 'ci_valor_usd',      dado: 'invoice.valor_usd',       sobrescreve: false },
  { nosso: 'hbl',               dado: 'bl.house',                sobrescreve: false },
  { nosso: 'mbl',               dado: 'bl.master',               sobrescreve: false },
  { nosso: 'navio',             dado: 'embarque.navio',          sobrescreve: false },
  { nosso: 'etd',               dado: 'embarque.etd',            sobrescreve: false },
  { nosso: 'eta',               dado: 'embarque.eta',            sobrescreve: false },
  { nosso: 'porto_origem',      dado: 'embarque.porto_origem',   sobrescreve: false },
  { nosso: 'porto_destino',     dado: 'embarque.porto_destino',  sobrescreve: false },
  { nosso: 'ce_master',         dado: 'ce.master',               sobrescreve: false },
  { nosso: 'ce_house',          dado: 'ce.house',                sobrescreve: false },
  { nosso: 'nf_entrada_numero', dado: 'nf_entrada.numero',       sobrescreve: false },
  { nosso: 'nf_entrada_data',   dado: 'nf_entrada.data',         sobrescreve: false },
  { nosso: 'nf_entrada_valor',  dado: 'nf_entrada.valor',        sobrescreve: false },
  { nosso: 'nf_saida_numero',   dado: 'nf_saida.numero',         sobrescreve: false },
  { nosso: 'nf_saida_data',     dado: 'nf_saida.data',           sobrescreve: false },
  { nosso: 'nf_saida_valor',    dado: 'nf_saida.valor',          sobrescreve: false },
];

// Transporte padrão: ainda não configurado. Quando a API do Conexos for
// definida, trocar por uma implementação real (ou injetar via opts.transporte)
// que devolva { configurado:true, dados:{ 'di.numero': ..., ... } }.
function transportePadrao(){
  const cfg = {
    url: process.env.CONEXOS_API_URL || '',
    token: process.env.CONEXOS_API_TOKEN || '',
  };
  return {
    configurado: !!(cfg.url && cfg.token),
    async buscarProcesso(/* conexosId */){
      if (!cfg.url || !cfg.token) return { configurado: false, dados: null };
      // TODO (após reunião com o Conexos): chamada HTTP real aqui.
      throw new Error('Transporte do Conexos ainda não implementado (aguardando documentação da API).');
    },
  };
}

// Pega os dados já no formato genérico { 'di.numero': ..., ... } e devolve
// { campos:{nosso:valor}, ignorados:[{campo, motivo}] } respeitando o que já
// existe no processo. Regra atual: só preenche o que está vazio; campo com
// sobrescreve:true pode trocar valor diferente; valor igual é ignorado.
function mapearDoConexos(dados, processoAtual){
  const campos = {};
  const ignorados = [];
  if (!dados || typeof dados !== 'object') return { campos, ignorados };
  for (const m of MAPA_CAMPOS) {
    if (!(m.dado in dados)) continue;
    const novo = dados[m.dado];
    if (novo === null || novo === undefined || novo === '') continue;
    const atual = processoAtual ? processoAtual[m.nosso] : undefined;
    const vazio = atual === null || atual === undefined || atual === '';
    if (vazio) { campos[m.nosso] = novo; continue; }
    if (String(atual) === String(novo)) { ignorados.push({ campo: m.nosso, motivo: 'igual' }); continue; }
    if (m.sobrescreve) { campos[m.nosso] = novo; continue; }
    ignorados.push({ campo: m.nosso, motivo: 'ja_preenchido', atual, novo });
  }
  return { campos, ignorados };
}

async function registrarLog(sb, entrada){
  const linha = {
    origem: entrada.origem || 'conexos',
    processo_id: entrada.processo_id || null,
    referencia: entrada.referencia || null,
    direcao: entrada.direcao || 'entrada',
    status: entrada.status || 'ok',
    campos_aplicados: entrada.campos_aplicados || null,
    payload: entrada.payload || null,
    erro: entrada.erro || null,
    usuario: entrada.usuario || null,
  };
  const { error } = await sb.from('integracao_log').insert(linha);
  if (error) console.error('integracao_log: falha ao registrar:', error.message);
  return linha;
}

// Fluxo completo pra UM processo. Nunca lança pro chamador: devolve um
// resumo com status e, em caso de erro, registra no log e devolve o texto.
async function sincronizarProcesso(sb, processo, opts = {}){
  const transporte = opts.transporte || transportePadrao();
  const usuario = opts.usuario || null;
  const base = { origem: 'conexos', processo_id: processo.id, referencia: processo.referencia, usuario };

  if (!processo.conexos_id) {
    await registrarLog(sb, { ...base, status: 'ignorado', erro: 'Processo sem conexos_id (vínculo com o Conexos não preenchido)' });
    return { ok: false, status: 'sem_vinculo', mensagem: 'Preencha o ID do Conexos na aba Identificação antes de sincronizar.' };
  }
  if (!transporte.configurado) {
    await registrarLog(sb, { ...base, status: 'pendente', erro: 'Integração com o Conexos ainda não configurada (CONEXOS_API_URL/TOKEN ausentes)' });
    return { ok: false, status: 'nao_configurado', mensagem: 'Integração com o Conexos ainda não está configurada — aguardando documentação da API.' };
  }
  try {
    const resposta = await transporte.buscarProcesso(processo.conexos_id);
    const { campos, ignorados } = mapearDoConexos(resposta.dados, processo);
    if (Object.keys(campos).length) {
      const agora = new Date().toISOString();
      const { error } = await sb.from('controle_processos')
        .update({ ...campos, conexos_ultima_sync: agora, updated_at: agora })
        .eq('id', processo.id);
      if (error) throw new Error('gravar processo: ' + error.message);
    } else {
      const { error } = await sb.from('controle_processos')
        .update({ conexos_ultima_sync: new Date().toISOString() }).eq('id', processo.id);
      if (error) throw new Error('gravar processo: ' + error.message);
    }
    await registrarLog(sb, { ...base, status: 'ok', campos_aplicados: campos, payload: { ignorados } });
    return { ok: true, status: 'ok', campos, ignorados };
  } catch (e) {
    await registrarLog(sb, { ...base, status: 'erro', erro: e.message });
    return { ok: false, status: 'erro', mensagem: e.message };
  }
}

function statusIntegracao(){
  const t = transportePadrao();
  return {
    configurado: t.configurado,
    campos_mapeados: MAPA_CAMPOS.length,
    campos_que_sobrescrevem: MAPA_CAMPOS.filter(m => m.sobrescreve).map(m => m.nosso),
    variaveis_esperadas: ['CONEXOS_API_URL', 'CONEXOS_API_TOKEN'],
  };
}

module.exports = { MAPA_CAMPOS, mapearDoConexos, registrarLog, sincronizarProcesso, statusIntegracao, transportePadrao };
