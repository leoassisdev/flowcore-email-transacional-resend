// email-resend.test.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
import { describe, expect, it, vi } from "vitest";
import { criarClienteResend, ErroResend, escaparHtml, renderizarEmail, renderizarTemplate, type FetchLike } from "./email-resend";

const resp = (status: number, corpo: unknown, headers: Record<string, string> = {}) => ({
  ok: status < 400,
  status,
  json: async () => corpo,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
});

const EMAIL = { de: "FlowCore <nao-responda@flowcore.com.br>", para: "ana@cliente.com.br", assunto: "Bem-vinda", html: "<p>Oi</p>" };

describe("email-resend", () => {
  it("envia com URL, headers e corpo no formato da Resend", async () => {
    const f = vi.fn<FetchLike>(async () => resp(200, { id: "re_123" }));
    const resend = criarClienteResend({ apiKey: "re_key", fetch: f });
    expect(await resend.enviar({ ...EMAIL, cco: "auditoria@flowcore.com.br", tags: { tipo: "boas_vindas" } }, { idempotencyKey: "boas-vindas/u_1" })).toEqual({ id: "re_123" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer re_key", "Idempotency-Key": "boas-vindas/u_1", "User-Agent": expect.stringContaining("FlowCore") });
    expect(JSON.parse(init?.body as string)).toEqual({
      from: EMAIL.de,
      to: ["ana@cliente.com.br"],
      subject: "Bem-vinda",
      html: "<p>Oi</p>",
      bcc: ["auditoria@flowcore.com.br"],
      tags: [{ name: "tipo", value: "boas_vindas" }],
    });
  });

  it("repete em 429 respeitando Retry-After e em 5xx com backoff", async () => {
    const esperas: number[] = [];
    const respostas = [resp(429, { message: "Too many requests" }, { "retry-after": "2" }), resp(503, {}), resp(200, { id: "re_ok" })];
    const f = vi.fn<FetchLike>(async () => respostas.shift()!);
    const resend = criarClienteResend({ apiKey: "k", fetch: f, sleep: async (ms) => void esperas.push(ms) });
    expect(await resend.enviar(EMAIL)).toEqual({ id: "re_ok" });
    expect(esperas).toEqual([2000, 1000]);
  });

  it("não repete erro de validação (422) e expõe status e tipo", async () => {
    const f = vi.fn<FetchLike>(async () => resp(422, { statusCode: 422, name: "validation_error", message: "Invalid `from` field" }));
    const resend = criarClienteResend({ apiKey: "k", fetch: f, sleep: async () => {} });
    const erro = await resend.enviar(EMAIL).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroResend);
    expect(erro).toMatchObject({ status: 422, tipo: "validation_error" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("desiste após esgotar tentativas em erro de rede", async () => {
    const f = vi.fn<FetchLike>(async () => Promise.reject(new TypeError("fetch failed")));
    const resend = criarClienteResend({ apiKey: "k", fetch: f, sleep: async () => {}, tentativas: 2 });
    await expect(resend.enviar(EMAIL)).rejects.toThrow("Falha de rede");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("valida destinatário, conteúdo e configuração", async () => {
    const resend = criarClienteResend({ apiKey: "k", fetch: vi.fn<FetchLike>() });
    await expect(resend.enviar({ ...EMAIL, para: "sem-arroba" })).rejects.toThrow("inválido");
    await expect(resend.enviar({ ...EMAIL, para: [] })).rejects.toThrow("destinatários");
    await expect(resend.enviar({ ...EMAIL, html: undefined })).rejects.toThrow("html ou texto");
    expect(() => criarClienteResend({ apiKey: "" })).toThrow("API key");
    expect((await criarClienteResend({ apiKey: "k", fetch: async () => resp(200, { id: "x" }) }).enviar({ ...EMAIL, para: "Ana <ana@x.com>" })).id).toBe("x");
  });

  it("renderiza template escapando HTML (anti-XSS) e aceita caminhos aninhados", () => {
    const html = renderizarTemplate("<p>Olá, {{ cliente.nome }}! Pedido {{pedido}}</p>", {
      cliente: { nome: '<script>alert("x")</script>' },
      pedido: 123,
    });
    expect(html).toBe("<p>Olá, &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;! Pedido 123</p>");
    expect(renderizarTemplate("{{{assinatura}}}", { assinatura: "<b>Equipe</b>" })).toBe("<b>Equipe</b>");
    expect(escaparHtml(`a&b'c`)).toBe("a&amp;b&#39;c");
  });

  it("modo estrito acusa variável faltando; não estrito vira vazio", () => {
    expect(() => renderizarTemplate("Oi {{nome}}", {})).toThrow('Variável "nome"');
    expect(renderizarTemplate("Oi {{nome}}!", {}, { estrito: false })).toBe("Oi !");
    expect(() => renderizarTemplate("{{constructor}}", {})).toThrow();
  });

  it("renderizarEmail não escapa assunto nem texto puro", () => {
    expect(renderizarEmail({ assunto: "Pedido #{{n}} & cia", html: "<p>{{n}} & cia</p>", texto: "Pedido {{n}} & cia" }, { n: "<1>" })).toEqual({
      assunto: "Pedido #<1> & cia",
      html: "<p>&lt;1&gt; & cia</p>",
      texto: "Pedido <1> & cia",
    });
  });
});
