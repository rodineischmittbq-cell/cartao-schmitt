// Cartão Schmitt no Google Wallet (cartão de fidelidade)
// Precisa dos segredos GOOGLE_WALLET_ISSUER_ID e GOOGLE_WALLET_SA (JSON da conta de serviço).
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const SITE = "https://fidelidade.schmittbuffet.com.br";
const BASE = "https://walletobjects.googleapis.com/walletobjects/v1";

type Conta = { client_email: string; private_key: string };
let cache: { issuer: string; sa: Conta } | null | undefined;
function conf() {
  if (cache !== undefined) return cache;
  const issuer = Deno.env.get("GOOGLE_WALLET_ISSUER_ID")?.trim();
  const raw = Deno.env.get("GOOGLE_WALLET_SA");
  try { cache = issuer && raw ? { issuer, sa: JSON.parse(raw) } : null; } catch { cache = null; }
  return cache;
}
export const googleAtivo = () => !!conf();

let chave: CryptoKey | null = null;
const chavePrivada = async () => (chave ??= await importPKCS8(conf()!.sa.private_key, "RS256"));

let token: { t: string; exp: number } | null = null;
async function acesso() {
  if (token && token.exp > Date.now() + 60e3) return token.t;
  const sa = conf()!.sa, agora = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/wallet_object.issuer" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(agora).setExpirationTime(agora + 3600).sign(await chavePrivada());
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("google_token " + JSON.stringify(j));
  token = { t: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.t;
}

async function g(method: string, caminho: string, corpo?: unknown) {
  const r = await fetch(BASE + caminho, {
    method,
    headers: { Authorization: `Bearer ${await acesso()}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  let json: any = {};
  try { json = txt ? JSON.parse(txt) : {}; } catch { json = { txt }; }
  return { status: r.status, json };
}

const idClasse = () => `${conf()!.issuer}.cartao_schmitt`;
const idObjeto = (codigo: string) => `${conf()!.issuer}.${codigo.replace(/[^A-Za-z0-9._-]/g, "_")}`;
const pt = (v: string) => ({ defaultValue: { language: "pt-BR", value: v } });
const dataBR = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

const REGRAS =
  "• 1 carimbo por almoço pago, no máximo 1 por dia. Encoste o celular no totem do caixa ou mostre este QR.\n" +
  "• Com 12 carimbos, 1 almoço grátis, de segunda a quinta, em até 60 dias. Bebidas não inclusas.\n" +
  "• Toda segunda-feira o carimbo vale em dobro.\n" +
  "• Aniversário: na semana do seu aniversário, venha com 4 amigos pagantes e o seu almoço é por nossa conta.";

function classe() {
  return {
    id: idClasse(),
    issuerName: "Schmitt Buffet e Eventos",
    programName: "Cartão Schmitt",
    programLogo: { sourceUri: { uri: `${SITE}/wallet/logo.png` }, contentDescription: pt("Schmitt Buffet e Eventos") },
    heroImage: { sourceUri: { uri: `${SITE}/wallet/hero-0.png` }, contentDescription: pt("Cartela do Cartão Schmitt") },
    hexBackgroundColor: "#0a5f86",
    countryCode: "BR",
    reviewStatus: "UNDER_REVIEW",
    multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES",
    linksModuleData: { uris: [
      { uri: `${SITE}/`, description: "Ver meu cartão no site", id: "site" },
      { uri: `${SITE}/regulamento.html`, description: "Regulamento", id: "regulamento" },
    ] },
  };
}

// e = resultado de estado_cliente
function objeto(e: any) {
  const p = e.premio, n = e.aniversario;
  const hero = p ? "hero-premio.png" : `hero-${Math.max(0, Math.min(12, e.carimbos))}.png`;
  const destaque = p
    ? { id: "premio", header: "Seu almoço grátis está liberado", body: `Use de segunda a quinta até ${dataBR(p.vence_em)}. Encoste o celular no totem do caixa e avise que quer usar.` }
    : { id: "premio", header: `Faltam ${e.faltam} para o almoço grátis`, body: "A cada 12 almoços, o próximo é por nossa conta. Depois de pagar, encoste o celular no totem do caixa." };
  const mods = [destaque];
  if (n && n.disponivel) mods.push({ id: "aniversario", header: "Feliz aniversário!", body: `Venha com ${n.acompanhantes} amigos pagantes até ${dataBR(n.ate)} e o seu almoço é por nossa conta.` });
  mods.push({ id: "regras", header: "Como funciona", body: REGRAS });
  return {
    id: idObjeto(e.codigo),
    classId: idClasse(),
    state: "ACTIVE",
    accountId: e.codigo,
    accountName: e.nome,
    loyaltyPoints: { label: "Carimbos", balance: { string: `${e.carimbos}/${e.meta}` } },
    secondaryLoyaltyPoints: p
      ? { label: "Prêmio", balance: { string: "Almoço grátis" } }
      : { label: "Faltam", balance: { int: e.faltam } },
    barcode: { type: "QR_CODE", value: e.codigo, alternateText: e.codigo },
    heroImage: { sourceUri: { uri: `${SITE}/wallet/${hero}` }, contentDescription: pt(`${e.carimbos} de ${e.meta} carimbos`) },
    textModulesData: mods,
  };
}

let classeOk = false;
async function garantirClasse() {
  if (classeOk) return;
  const atual = await g("GET", `/loyaltyClass/${idClasse()}`);
  if (atual.status === 404) {
    const r = await g("POST", "/loyaltyClass", classe());
    if (r.status >= 300) throw new Error("google_classe " + JSON.stringify(r.json));
  } else if (atual.status < 300) {
    const r = await g("PUT", `/loyaltyClass/${idClasse()}`, classe());
    if (r.status >= 300) throw new Error("google_classe_put " + JSON.stringify(r.json));
  } else throw new Error("google_classe_get " + JSON.stringify(atual.json));
  classeOk = true;
}

async function gravarObjeto(e: any) {
  const o = objeto(e);
  const r = await g("PUT", `/loyaltyObject/${o.id}`, o);
  if (r.status === 404) {
    const x = await g("POST", "/loyaltyObject", o);
    if (x.status >= 300) throw new Error("google_objeto " + JSON.stringify(x.json));
  } else if (r.status >= 300) throw new Error("google_objeto_put " + JSON.stringify(r.json));
  return o.id;
}

// Link "Adicionar ao Google Wallet" para o cliente
export async function googleLinkSalvar(e: any) {
  await garantirClasse();
  const id = await gravarObjeto(e);
  const sa = conf()!.sa;
  const jwt = await new SignJWT({
    iss: sa.client_email, aud: "google", typ: "savetowallet",
    origins: [SITE],
    payload: { loyaltyObjects: [{ id }] },
  }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuedAt().sign(await chavePrivada());
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

// Atualiza o cartão na carteira; com aviso, aparece notificação no celular (o Google limita a 3 por dia)
export async function googleAtualizar(e: any, aviso?: string) {
  if (!conf()) return;
  try {
    await garantirClasse();
    const id = await gravarObjeto(e);
    if (aviso) {
      await g("POST", `/loyaltyObject/${id}/addMessage`, {
        message: { id: `m${Date.now()}`, header: "Cartão Schmitt", body: aviso, messageType: "TEXT_AND_NOTIFY" },
      });
    }
  } catch (err) {
    console.error("google_wallet", err);
  }
}
