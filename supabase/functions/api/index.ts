// Cartão Schmitt — API do programa de fidelidade
// Autenticação própria: token do celular do cliente, sessão do caixa por PIN e sessão do painel por senha.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { googleAtivo, googleAtualizar, googleLinkSalvar } from "./google.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const erro = (codigo: string, status = 400) => json({ erro: codigo }, status);

const novoToken = () => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};
const semId = (e: Record<string, unknown> | null) => {
  if (!e) return e;
  const { id: _id, ...r } = e;
  return r;
};
async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
const dataOk = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const hojeSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

async function sessao(token: unknown) {
  if (typeof token !== "string" || token.length < 32) return null;
  const rows = await rpc<any[]>("sessao_caixa", { p_token: token });
  return rows?.[0] ?? null;
}

async function logarCliente(cid: string) {
  const token = novoToken();
  await rpc("registrar_dispositivo", { p_cliente: cid, p_token: token });
  const estado = await rpc("estado_cliente", { p_cliente: cid });
  return { token, cartao: semId(estado) };
}

// Atualiza o cartão na carteira do celular (sem atrasar a resposta)
const MUDOU = ["carimbado", "cartela_completa", "premio_entregue", "aniversario_liberado"];
function sincronizar(cid: string | null | undefined, status?: string) {
  if (!cid || (status && !MUDOU.includes(status)) || !googleAtivo()) return;
  const tarefa = (async () => {
    const { data } = await sb.from("clientes").select("google_em").eq("id", cid).single();
    if (!data?.google_em) return;
    const e = await rpc<any>("estado_cliente", { p_cliente: cid });
    const aviso = status === "cartela_completa"
      ? `Parabéns, ${String(e.nome).split(" ")[0]}! Seu próximo almoço é por nossa conta. Use de segunda a quinta.`
      : undefined;
    await googleAtualizar(e, aviso);
  })().catch((err) => console.error("sincronizar", err));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(tarefa);
}

// Mensagens de exceção do banco que viram código de erro para a tela
const ERROS_BANCO = ["pin_invalido", "pin_em_uso", "regra_invalida", "texto_vazio", "senha_curta"];
const erroBanco = (e: unknown) => {
  const m = String((e as Error)?.message ?? "");
  return ERROS_BANCO.find((k) => m.includes(k)) ?? null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return erro("metodo_invalido", 405);

  const rota = new URL(req.url).pathname.replace(/^.*\/api/, "") || "/";
  let b: any = {};
  try { b = await req.json(); } catch { return erro("json_invalido"); }

  try {
    switch (rota) {
      // ---------- Cliente ----------
      case "/cadastro": {
        if (b.lgpd !== true) return erro("aceite_obrigatorio");
        if (!dataOk(b.nascimento)) return erro("nascimento_invalido");
        const existente = await rpc<string | null>("entrar_cliente", { p_whatsapp: b.whatsapp, p_nascimento: b.nascimento });
        if (existente) return json({ novo: false, ...(await logarCliente(existente)) });
        const r = await rpc<any>("cadastrar_cliente", { p_nome: b.nome, p_whatsapp: b.whatsapp, p_nascimento: b.nascimento });
        if (r.erro) return erro(r.erro);
        if (!r.novo) return erro("whatsapp_ja_cadastrado");
        return json({ novo: true, ...(await logarCliente(r.id)) });
      }
      case "/entrar": {
        if (!dataOk(b.nascimento)) return erro("nascimento_invalido");
        const cid = await rpc<string | null>("entrar_cliente", { p_whatsapp: b.whatsapp, p_nascimento: b.nascimento });
        if (!cid) return erro("nao_encontrado", 404);
        return json(await logarCliente(cid));
      }
      case "/cartao": {
        const cid = await rpc<string | null>("cliente_por_token", { p_token: String(b.token ?? "") });
        if (!cid) return erro("sem_cartao", 401);
        return json({ cartao: semId(await rpc("estado_cliente", { p_cliente: cid })), wallet: { google: googleAtivo(), apple: false } });
      }
      case "/wallet/google": {
        const cid = await rpc<string | null>("cliente_por_token", { p_token: String(b.token ?? "") });
        if (!cid) return erro("sem_cartao", 401);
        if (!googleAtivo()) return erro("wallet_indisponivel", 503);
        const e = await rpc<any>("estado_cliente", { p_cliente: cid });
        const url = await googleLinkSalvar(e);
        await rpc("marcar_google", { p_cliente: cid });
        return json({ url });
      }
      case "/toque": {
        const cid = await rpc<string | null>("cliente_por_token", { p_token: String(b.token ?? "") });
        if (!cid) return json({ status: "sem_cartao" });
        const via = b.via === "QR" ? "QR" : "NFC";
        const r = await rpc<any>("toque_por_tag", { p_tag: String(b.tag ?? ""), p_cliente: cid, p_via: via });
        sincronizar(cid, r.status);
        if (r.cliente) r.cliente = semId(r.cliente);
        return json(r);
      }

      // ---------- Caixa ----------
      case "/caixa/login": {
        const token = novoToken();
        const r = await rpc<any>("login_caixa", { p_caixa: String(b.caixa ?? ""), p_pin: String(b.pin ?? ""), p_token: token });
        if (r.erro) return erro(r.erro, 401);
        return json({ sessao: token, ...r });
      }
      case "/caixa/feed":
      case "/caixa/entregar":
      case "/caixa/aniversario":
      case "/caixa/buscar":
      case "/caixa/carimbar":
      case "/caixa/qr":
      case "/caixa/sair": {
        const s = await sessao(b.sessao);
        if (!s) return erro("sessao_expirada", 401);
        if (rota === "/caixa/feed") {
          return json({ caixa: s.caixa_id, atendente: s.atendente, toques: await rpc("feed_caixa", { p_caixa: s.caixa_id, p_desde: Number(b.desde) || 0 }) });
        }
        if (rota === "/caixa/entregar") {
          const r = await rpc<any>("entregar_premio", { p_cliente: b.cliente_id, p_caixa: s.caixa_id, p_atendente: s.atendente_id, p_via: "MANUAL" });
          sincronizar(b.cliente_id, r.status);
          return json(r);
        }
        if (rota === "/caixa/aniversario") {
          const r = await rpc<any>("liberar_aniversario", { p_cliente: b.cliente_id, p_caixa: s.caixa_id, p_atendente: s.atendente_id, p_acompanhantes: Number(b.acompanhantes) || 0, p_via: "MANUAL" });
          sincronizar(b.cliente_id, r.status);
          return json(r);
        }
        if (rota === "/caixa/buscar") {
          return json({ clientes: await rpc("buscar_clientes", { p_q: String(b.q ?? "") }) });
        }
        if (rota === "/caixa/carimbar") {
          const r = await rpc<any>("toque_caixa", { p_caixa: s.caixa_id, p_atendente: s.atendente_id, p_cliente: b.cliente_id, p_via: "MANUAL" });
          sincronizar(b.cliente_id, r.status);
          return json(r);
        }
        if (rota === "/caixa/qr") {
          const cid = await rpc<string | null>("cliente_por_codigo", { p_codigo: String(b.codigo ?? "") });
          if (!cid) return erro("cartao_nao_encontrado", 404);
          const r = await rpc<any>("toque_caixa", { p_caixa: s.caixa_id, p_atendente: s.atendente_id, p_cliente: cid, p_via: "QR" });
          sincronizar(cid, r.status);
          return json(r);
        }
        await sb.from("sessoes").delete().eq("token_hash", await rpc("_hash", { p: b.sessao }));
        return json({ ok: true });
      }

      // ---------- Painel do dono ----------
      case "/admin/login": {
        const token = novoToken();
        const r = await rpc<any>("login_admin", { p_senha: String(b.senha ?? ""), p_token: token });
        if (r.erro) return erro(r.erro, 401);
        return json({ sessao: token });
      }
      default: {
        if (!rota.startsWith("/admin/")) return erro("rota_inexistente", 404);
        const ok = typeof b.sessao === "string" && b.sessao.length >= 32 && await rpc<boolean>("sessao_admin", { p_token: b.sessao });
        if (!ok) return erro("sessao_expirada", 401);
        try {
          switch (rota) {
            case "/admin/resumo": {
              const ate = dataOk(b.ate) ? b.ate : hojeSP();
              const de = dataOk(b.de) ? b.de : new Date(Date.parse(ate) - 29 * 864e5).toISOString().slice(0, 10);
              return json({ de, ate, resumo: await rpc("painel_resumo", { p_de: de, p_ate: ate }) });
            }
            case "/admin/beneficios":
              return json({ beneficios: await rpc("painel_beneficios", { p_dia: dataOk(b.dia) ? b.dia : hojeSP() }) });
            case "/admin/lista":
              return json({ lista: await rpc("painel_lista", { p_tipo: String(b.tipo ?? "") }) });
            case "/admin/buscar":
              return json({ clientes: await rpc("painel_buscar", { p_q: String(b.q ?? "") }) });
            case "/admin/excluir-cliente":
              return json({ ok: await rpc("excluir_cliente", { p_codigo: String(b.codigo ?? "") }) });
            case "/admin/atendentes":
              return json({ atendentes: await rpc("painel_atendentes", {}) });
            case "/admin/atendente-novo":
              return json({ id: await rpc("criar_atendente", { p_nome: String(b.nome ?? ""), p_pin: String(b.pin ?? "") }) });
            case "/admin/atendente-status":
              await rpc("atendente_status", { p_id: b.id, p_ativo: !!b.ativo });
              return json({ ok: true });
            case "/admin/atendente-pin":
              await rpc("atendente_pin", { p_id: b.id, p_pin: String(b.pin ?? "") });
              return json({ ok: true });
            case "/admin/config":
              return json(await rpc("painel_config", {}));
            case "/admin/regras":
              await rpc("salvar_regras", { p: b.regras ?? {} });
              return json({ ok: true });
            case "/admin/aviso":
              await rpc("salvar_aviso", { p_tipo: String(b.tipo ?? ""), p_ativo: !!b.ativo, p_texto: String(b.texto ?? "") });
              return json({ ok: true });
            case "/admin/mensagem":
              return json(await rpc("criar_mensagem", { p_segmento: String(b.segmento ?? ""), p_texto: String(b.texto ?? ""), p_agendada: b.agendada_para || null }));
            case "/admin/senha":
              await rpc("definir_senha_admin", { p_senha: String(b.nova ?? "") });
              return json({ ok: true });
            case "/admin/sair":
              await sb.from("sessoes").delete().eq("token_hash", await rpc("_hash", { p: b.sessao }));
              return json({ ok: true });
            default:
              return erro("rota_inexistente", 404);
          }
        } catch (e) {
          const c = erroBanco(e);
          if (c) return erro(c);
          throw e;
        }
      }
    }
  } catch (e) {
    console.error(rota, e);
    return erro("erro_interno", 500);
  }
});
