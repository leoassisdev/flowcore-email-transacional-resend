// email-resend.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
// Envio de e-mail transacional (boas-vindas, recuperação de senha, nota
// fiscal, confirmação de pedido) pela API REST da Resend, sem SDK: retry com
// backoff em 429/5xx respeitando Retry-After, Idempotency-Key pra não mandar
// duplicado, timeout, e templates {{variavel}} com escape de HTML (anti-XSS).
// Roda em Node 18+, Cloudflare Workers, Deno e Bun (server-side).
// Zero dependências.
//
// Referência: Resend API Reference, "Send Email" (POST /emails) e
// "Idempotency Keys".

export const CRIADO_POR = "Criado por FlowCore Soluções LTDA";
export const USER_AGENT_PADRAO = "FlowCore-Codigos/1.0 (Criado por FlowCore Soluções LTDA)";

export type RespostaHttp = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: { get(nome: string): string | null };
};
export type FetchLike = (url: string, init?: RequestInit) => Promise<RespostaHttp>;

export type Email = {
  /** "Empresa <nao-responda@empresa.com.br>" (domínio verificado na Resend). */
  de: string;
  para: string | string[];
  assunto: string;
  html?: string;
  texto?: string;
  responderPara?: string | string[];
  cc?: string | string[];
  cco?: string | string[];
  tags?: Record<string, string>;
  headers?: Record<string, string>;
  /** ISO 8601 ou linguagem natural aceita pela Resend ("in 1 hour"). */
  agendarPara?: string;
};

export type OpcoesResend = {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Tentativas totais (inclui a primeira). Padrão 3. */
  tentativas?: number;
  baseEsperaMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** A Resend exige User-Agent; padrão identifica a biblioteca. */
  userAgent?: string;
};

export class ErroResend extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly tipo?: string,
  ) {
    super(message);
    this.name = "ErroResend";
  }
}

const MAPA_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escaparHtml = (s: string) => s.replace(/[&<>"']/g, (c) => MAPA_ESCAPE[c]);

function resolver(vars: Record<string, unknown>, caminho: string): unknown {
  let atual: unknown = vars;
  for (const parte of caminho.split(".")) {
    if (atual === null || typeof atual !== "object" || !Object.prototype.hasOwnProperty.call(atual, parte)) return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

/**
 * Troca {{nome}} e {{cliente.nome}} pelos valores. Com html: true (padrão),
 * escapa o valor; use {{{campo}}} pra inserir HTML confiável sem escape.
 * Variável ausente lança erro (estrito: true) ou vira "" (estrito: false).
 */
export function renderizarTemplate(
  template: string,
  variaveis: Record<string, unknown>,
  opcoes: { html?: boolean; estrito?: boolean } = {},
): string {
  const html = opcoes.html ?? true;
  const estrito = opcoes.estrito ?? true;
  return template.replace(/\{\{(\{)?\s*([\w.]+)\s*\}?\}\}/g, (bruto, triplo: string | undefined, caminho: string) => {
    const valor = resolver(variaveis, caminho);
    if (valor === undefined || valor === null) {
      if (estrito) throw new Error(`Variável "${caminho}" não informada no template`);
      return "";
    }
    const texto = String(valor);
    return html && !triplo ? escaparHtml(texto) : texto;
  });
}

/** Renderiza assunto (texto), html (escapado) e texto puro de uma vez. */
export function renderizarEmail(
  t: { assunto: string; html?: string; texto?: string },
  variaveis: Record<string, unknown>,
): { assunto: string; html?: string; texto?: string } {
  return {
    assunto: renderizarTemplate(t.assunto, variaveis, { html: false }),
    ...(t.html !== undefined ? { html: renderizarTemplate(t.html, variaveis) } : {}),
    ...(t.texto !== undefined ? { texto: renderizarTemplate(t.texto, variaveis, { html: false }) } : {}),
  };
}

const lista = (v?: string | string[]) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export function criarClienteResend(opcoes: OpcoesResend) {
  if (!opcoes.apiKey) throw new Error("API key da Resend não configurada");
  const f: FetchLike = opcoes.fetch ?? ((u, i) => fetch(u, i));
  const base = (opcoes.baseUrl ?? "https://api.resend.com").replace(/\/$/, "");
  const tentativas = opcoes.tentativas ?? 3;
  const baseEspera = opcoes.baseEsperaMs ?? 500;
  const timeoutMs = opcoes.timeoutMs ?? 15_000;
  const sleep = opcoes.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    /**
     * Envia e devolve o id da Resend. Passe idempotencyKey (ex.: "boas-vindas/usuario_123")
     * pra que um retry do seu lado nunca mande o e-mail duas vezes.
     */
    async enviar(email: Email, extra: { idempotencyKey?: string } = {}): Promise<{ id: string }> {
      const para = lista(email.para) ?? [];
      if (para.length === 0 || para.length > 50) throw new Error("Informe de 1 a 50 destinatários");
      if (para.some((p) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p.replace(/^.*<(.+)>$/, "$1"))))
        throw new Error("E-mail de destinatário inválido");
      if (!email.html && !email.texto) throw new Error("Informe html ou texto");
      if (!email.assunto.trim()) throw new Error("Assunto vazio");

      const corpo = JSON.stringify({
        from: email.de,
        to: para,
        subject: email.assunto,
        html: email.html,
        text: email.texto,
        reply_to: lista(email.responderPara),
        cc: lista(email.cc),
        bcc: lista(email.cco),
        headers: email.headers,
        scheduled_at: email.agendarPara,
        tags: email.tags ? Object.entries(email.tags).map(([name, value]) => ({ name, value })) : undefined,
      });
      const headers: Record<string, string> = {
        Authorization: `Bearer ${opcoes.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": opcoes.userAgent ?? USER_AGENT_PADRAO,
      };
      if (extra.idempotencyKey) {
        if (extra.idempotencyKey.length > 256) throw new Error("Idempotency-Key passa de 256 caracteres");
        headers["Idempotency-Key"] = extra.idempotencyKey;
      }

      let ultimoErro: ErroResend | null = null;
      for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        let resp: RespostaHttp | null = null;
        try {
          resp = await f(`${base}/emails`, { method: "POST", headers, body: corpo, signal: ctrl.signal });
        } catch (e) {
          ultimoErro = new ErroResend(ctrl.signal.aborted ? `Tempo esgotado (${timeoutMs} ms) na Resend` : `Falha de rede: ${(e as Error).message}`, 0);
        } finally {
          clearTimeout(timer);
        }

        let retryAfterMs: number | undefined;
        if (resp) {
          const json = ((await resp.json().catch(() => ({}))) ?? {}) as { id?: string; message?: string; name?: string };
          if (resp.ok && json.id) return { id: json.id };
          ultimoErro = new ErroResend(`Resend: ${json.message ?? `HTTP ${resp.status}`}`, resp.status, json.name);
          const ra = resp.headers.get("retry-after");
          if (ra && /^\d+$/.test(ra)) retryAfterMs = Number(ra) * 1000;
          if (resp.ok || !(resp.status === 429 || resp.status >= 500)) throw ultimoErro;
        }
        if (tentativa < tentativas) await sleep(Math.max(retryAfterMs ?? 0, baseEspera * 2 ** (tentativa - 1)));
      }
      throw ultimoErro as ErroResend;
    },
  };
}
