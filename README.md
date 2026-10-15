# E-mail Transacional (Resend)

> Envia e-mail transacional pela API da Resend com retry em 429/5xx, Idempotency-Key e templates {{variavel}} com escape de HTML. Boas-vindas, senha e nota fiscal chegando uma vez só.

**Ver ao vivo, com preview e manual:** https://flowcoresolucoes.com.br/codigos/email-transacional-resend

Criado por **FlowCore Soluções LTDA**.

## Arquivos

- [`src/email-resend.ts`](src/email-resend.ts)
- [`src/email-resend.test.ts`](src/email-resend.test.ts)

## Como instalar

1. **Funciona onde você já roda** Node 18+, Cloudflare Workers, Deno, Bun, Vercel e Netlify Functions. Zero dependência: só fetch e Web Crypto, que já vêm no runtime.
2. **Crie src/lib/email-resend.ts** Copie o conteúdo de `src/email-resend.ts` e `src/email-resend.test.ts` deste repositório.
3. **Use**

   ```bash
   const resend = criarClienteResend({ apiKey: env.RESEND_API_KEY });
   const { assunto, html } = renderizarEmail(modeloBoasVindas, { nome: cliente.nome });
   await resend.enviar(
     { de: "Empresa <ola@empresa.com.br>", para: cliente.email, assunto, html },
     { idempotencyKey: `boas-vindas/${cliente.id}` },
   );
   ```

4. **Rode o teste junto** O arquivo de teste (`src/email-resend.test.ts`) cobre 8 cenários. Copie para src/lib/ ao lado e rode:

   ```bash
   npm install -D vitest
   npx vitest run src/lib
   ```


## Testes

`src/email-resend.test.ts` cobre 8 cenários.

```bash
npm install
npm test
```

## Licença

MIT. Pode usar em projeto pessoal ou comercial, de graça. A única condição é manter a linha **“Criado por FlowCore Soluções LTDA”** (ou o crédito de adaptação) onde ela está.

---

Precisa disso integrado no seu sistema? A [FlowCore](https://flowcoresolucoes.com.br) desenvolve sob medida.
