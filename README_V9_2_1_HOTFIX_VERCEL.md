# VESCO CONTROL V9.2.1 — Hotfix Vercel

## Corrige os avisos do deploy

1. `styles.css 404`
   - Incluído arquivo `styles.css` como alias do CSS principal.
   - Também incluído `style.css` por segurança.

2. `API ERP não respondeu timeout`
   - Timeout da API ERP aumentado de 22s para 60s.
   - Se mesmo assim aparecer, o problema está no Apps Script ERP demorando ou não respondendo a action `loadVesco`.

3. `FormasEnvio V15 fallback`
   - Esse aviso vem do app.js antigo.
   - Não quebra o painel V9. É apenas fallback de forma de envio.

## Arquivos para subir no Vercel

Suba/substitua:

```txt
modulo.vesco-v8-operacional.js
vesco-v8-operacional.css
styles.css
style.css
```

Se usar app do motorista, mantenha/substitua:

```txt
motorista.html
motorista.js
painel_motorista_link_v22.js
```

## Conferência

No console:

```js
VescoV8.debug()
```

Precisa mostrar:

```txt
version: "V9.2.1"
```
