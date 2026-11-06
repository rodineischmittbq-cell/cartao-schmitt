// Endereço do servidor do Cartão Schmitt (Supabase)
window.CS_API = "https://mmscztzgsckxbjjnewup.supabase.co/functions/v1/api";
// Botões da Apple Wallet e do Google Wallet: ligar quando as contas estiverem prontas
window.CS_WALLET = { apple: false, google: false };
window.CS_ICONE_PRATO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2.5 5-2.5 7.5 0 1 .8 1.5 2.5 1.5V21"/></svg>';
window.CS_ICONE_PRESENTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11h16v9H4zM12 11v9M3 8h18v3H3zM12 8c-1.5-3-5-3.5-5-1s3 1 5 1zm0 0c1.5-3 5-3.5 5-1s-3 1-5 1z"/></svg>';

window.csApi = async function (rota, corpo) {
  const r = await fetch(window.CS_API + rota, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo || {}),
  });
  let dados = {};
  try { dados = await r.json(); } catch (_) {}
  if (!r.ok && !dados.erro) dados.erro = "falha_conexao";
  return dados;
};

window.csStore = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

window.csEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
window.csData = (iso) => { if (!iso) return ""; const [a, m, d] = iso.split("-"); return d + "/" + m; };
window.csMoeda = (v) => "R$ " + Number(v).toFixed(2).replace(".", ",");
window.csPrimeiro = (n) => String(n || "").split(" ")[0];

window.CS_ERROS = {
  aceite_obrigatorio: "Marque o aceite do regulamento para criar o cartão.",
  nascimento_invalido: "Informe a data de aniversário.",
  whatsapp_invalido: "Confira o WhatsApp com DDD.",
  nome_invalido: "Informe o seu nome.",
  whatsapp_ja_cadastrado: "Este WhatsApp já tem cartão. Use “Já tenho cartão” e confirme a data de aniversário.",
  nao_encontrado: "Não encontramos um cartão com esse WhatsApp e essa data de aniversário.",
  falha_conexao: "Sem conexão com o servidor. Confira a internet e tente de novo.",
  erro_interno: "Algo deu errado do nosso lado. Tente de novo em instantes.",
};
// Data digitada: DD/MM/AAAA com as barras automáticas
window.csMascaraData = function (el) {
  el.addEventListener("input", () => {
    const d = el.value.replace(/\D/g, "").slice(0, 8);
    el.value = d.length > 4 ? d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4)
             : d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
  });
};
// Converte DD/MM/AAAA para AAAA-MM-DD; devolve "" se a data não existir
window.csDataIso = function (s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const dia = +m[1], mes = +m[2], ano = +m[3], hoje = new Date();
  const dt = new Date(ano, mes - 1, dia);
  if (dt.getFullYear() !== ano || dt.getMonth() !== mes - 1 || dt.getDate() !== dia) return "";
  if (ano < 1900 || dt > hoje) return "";
  return m[3] + "-" + m[2] + "-" + m[1];
};

window.csMsgErro =(e) => window.CS_ERROS[e] || "Não foi possível concluir. Tente de novo.";
