// Cartão Schmitt na Carteira da Apple (storeCard .pkpass) + serviço de atualização
// Certificado e chave ficam na tabela apple_conf (só o service role lê).
import forge from "npm:node-forge@1.3.1";
import { zipSync } from "npm:fflate@0.8.2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const APPLE_TIPO = "pass.br.com.schmittbuffet.fidelidade";
const TIME = "BBQQPVAK29";
const SITE = "https://fidelidade.schmittbuffet.com.br";
export const APPLE_WS = "https://mmscztzgsckxbjjnewup.supabase.co/functions/v1/api/apple";
const WWDR_URL = "https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer";

type Conf = { cert_pem: string; key_pem: string; wwdr_pem: string | null; segredo: string };
let conf: Conf | null = null;

async function carregar(sb: SupabaseClient): Promise<Conf | null> {
  if (conf) return conf;
  const { data } = await sb.from("apple_conf").select("cert_pem,key_pem,wwdr_pem,segredo").eq("id", true).maybeSingle();
  if (!data?.cert_pem || !data?.key_pem) return null;
  if (!data.wwdr_pem) {
    const r = await fetch(WWDR_URL);
    if (!r.ok) throw new Error("wwdr " + r.status);
    const der = new Uint8Array(await r.arrayBuffer());
    let bin = ""; der.forEach((b) => (bin += String.fromCharCode(b)));
    const pem = forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(bin)));
    await sb.from("apple_conf").update({ wwdr_pem: pem }).eq("id", true);
    data.wwdr_pem = pem;
  }
  conf = data as Conf;
  return conf;
}
export async function appleAtivo(sb: SupabaseClient) {
  try { return !!(await carregar(sb)); } catch { return false; }
}

// Token que vai dentro do cartão (Apple manda de volta no cabeçalho)
export async function appleToken(sb: SupabaseClient, codigo: string) {
  const c = await carregar(sb); if (!c) throw new Error("apple_off");
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(c.segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("pass:" + codigo)));
  return Array.from(s.slice(0, 20), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Imagens publicadas no site (cache na memória da função)
const imgs = new Map<string, Uint8Array>();
async function img(nome: string) {
  if (imgs.has(nome)) return imgs.get(nome)!;
  const r = await fetch(`${SITE}/wallet/apple/${nome}`);
  if (!r.ok) throw new Error("img " + nome + " " + r.status);
  const b = new Uint8Array(await r.arrayBuffer());
  imgs.set(nome, b);
  return b;
}

const dataBR = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

function passJson(e: any, token: string, aviso?: string) {
  const p = e.premio, n = e.aniversario;
  const back: any[] = [];
  if (aviso) back.push({ key: "aviso", label: "Último aviso", value: aviso, changeMessage: "%@" });
  if (p) back.push({ key: "premio", label: "Seu almoço grátis", value: `Liberado! Use de segunda a quinta até ${dataBR(p.vence_em)}. Encoste o celular no totem do caixa e avise que quer usar.` });
  if (n && n.disponivel) back.push({ key: "niver", label: "Feliz aniversário!", value: `Venha com ${n.acompanhantes} amigos pagantes até ${dataBR(n.ate)} e o seu almoço é por nossa conta.` });
  back.push(
    { key: "como", label: "Como funciona", value: "A cada 12 almoços, o próximo é por nossa conta. Depois de pagar, encoste o celular no totem do caixa ou mostre o QR Code. 1 carimbo por almoço pago, no máximo 1 por dia. Toda segunda-feira o carimbo vale em dobro." },
    { key: "regras", label: "Prêmio", value: "Almoço grátis de segunda a quinta, em até 60 dias. Bebidas não inclusas. O almoço do prêmio não gera carimbo." },
    { key: "niverRegra", label: "Aniversário", value: "Na semana do seu aniversário, venha com 4 amigos pagantes e o seu almoço é por nossa conta (com documento com foto)." },
    { key: "site", label: "Meu cartão e regulamento", value: `${SITE}`, attributedValue: `<a href="${SITE}">fidelidade.schmittbuffet.com.br</a>` },
  );
  return {
    formatVersion: 1,
    passTypeIdentifier: APPLE_TIPO,
    teamIdentifier: TIME,
    serialNumber: e.codigo,
    authenticationToken: token,
    webServiceURL: APPLE_WS,
    organizationName: "Schmitt Buffet e Eventos",
    description: "Cartão Schmitt",
    logoText: "Cartão Schmitt",
    backgroundColor: "rgb(10,95,134)",
    foregroundColor: "rgb(255,255,255)",
    labelColor: "rgb(198,226,240)",
    sharingProhibited: true,
    barcodes: [{ format: "PKBarcodeFormatQR", message: e.codigo, messageEncoding: "iso-8859-1", altText: e.codigo }],
    storeCard: {
      headerFields: [{ key: "carimbos", label: "CARIMBOS", value: `${e.carimbos}/${e.meta}`, changeMessage: "Carimbo registrado! Agora você tem %@." }],
      secondaryFields: [
        { key: "nome", label: "CLIENTE", value: e.nome },
        p
          ? { key: "faltam", label: "PRÊMIO", value: "Almoço grátis", textAlignment: "PKTextAlignmentRight", changeMessage: "Parabéns! Seu próximo almoço é por nossa conta." }
          : { key: "faltam", label: "FALTAM", value: e.faltam, textAlignment: "PKTextAlignmentRight" },
      ],
      auxiliaryFields: p ? [{ key: "validade", label: "USE ATÉ", value: dataBR(p.vence_em) }] : [],
      backFields: back,
    },
  };
}

function sha1(bytes: Uint8Array) {
  const md = forge.md.sha1.create();
  let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  md.update(s); return md.digest().toHex();
}

// Gera o arquivo .pkpass do cliente (e = estado_cliente)
export async function applePass(sb: SupabaseClient, e: any, aviso?: string): Promise<Uint8Array> {
  const c = await carregar(sb); if (!c) throw new Error("apple_off");
  const tok = await appleToken(sb, e.codigo);
  const strip = e.premio ? "premio" : String(Math.max(0, Math.min(12, e.carimbos)));
  const arquivos: Record<string, Uint8Array> = {
    "pass.json": new TextEncoder().encode(JSON.stringify(passJson(e, tok, aviso))),
    "icon.png": await img("icon.png"), "icon@2x.png": await img("icon@2x.png"), "icon@3x.png": await img("icon@3x.png"),
    "logo.png": await img("logo.png"), "logo@2x.png": await img("logo@2x.png"), "logo@3x.png": await img("logo@3x.png"),
    "strip.png": await img(`strip-${strip}.png`), "strip@2x.png": await img(`strip-${strip}@2x.png`), "strip@3x.png": await img(`strip-${strip}@3x.png`),
  };
  const manifest: Record<string, string> = {};
  for (const [k, v] of Object.entries(arquivos)) manifest[k] = sha1(v);
  const manifestTxt = JSON.stringify(manifest);

  const cert = forge.pki.certificateFromPem(c.cert_pem);
  const wwdr = forge.pki.certificateFromPem(c.wwdr_pem!);
  const key = forge.pki.privateKeyFromPem(c.key_pem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestTxt, "utf8");
  p7.addCertificate(cert);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as any },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const sig = new Uint8Array(der.length); for (let i = 0; i < der.length; i++) sig[i] = der.charCodeAt(i);

  return zipSync({ ...arquivos, "manifest.json": new TextEncoder().encode(manifestTxt), "signature": sig }, { level: 6 });
}

// Avisa os iPhones que o cartão mudou (Apple Push com o certificado do cartão)
let cliente: any = null;
export async function appleAvisarMudanca(sb: SupabaseClient, clienteId: string) {
  const { data: regs } = await sb.from("apple_registros").select("device_id,push_token").eq("cliente_id", clienteId);
  if (!regs?.length) return;
  const c = await carregar(sb); if (!c) return;
  // deno-lint-ignore no-explicit-any
  const D = Deno as any;
  if (!cliente) cliente = D.createHttpClient({ cert: c.cert_pem, key: c.key_pem, http2: true });
  for (const r of regs) {
    try {
      const resp = await fetch(`https://api.push.apple.com/3/device/${r.push_token}`, {
        method: "POST", body: "{}",
        headers: { "apns-topic": APPLE_TIPO, "apns-push-type": "alert", "apns-priority": "10" },
        // deno-lint-ignore no-explicit-any
        client: cliente,
      } as any);
      if (resp.status === 410) await sb.from("apple_registros").delete().eq("device_id", r.device_id).eq("cliente_id", clienteId);
      else if (resp.status >= 300) console.error("apns", resp.status, await resp.text());
      else await resp.body?.cancel();
    } catch (err) { console.error("apns_falha", err); }
  }
}
