VESCO CONTROL — V10.28 REALTIME OPERACIONAL

ARQUIVOS A SUBSTITUIR NO GITHUB/VERCEL
1. modulo.vesco-v8-operacional.js
2. vesco-firebase-realtime.js

NO index.html E logistica.html USE:
<script src="firebase-config.js?v=1028"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="modulo.vesco-v8-operacional.js?v=1028"></script>
<script src="vesco-firebase-realtime.js?v=1028"></script>

NÃO CARREGUE JUNTO:
- modulo.rotas.js
- modulo.vesco-v7-core.js
- modulo.vesco-v7-2-operacional.js
- modulo.vesco-v9-operacional.js
- modulo.vesco-v10-operacional.js

O QUE ESTA VERSÃO FAZ
- status alterado por um operador aparece nos outros painéis imediatamente;
- Em Separação, Separado, Pronto, Entregue e Retirado mudam sem F5;
- observação, link e pendência também são gravados no Firebase;
- rotas criadas/editadas/excluídas aparecem instantaneamente;
- lista Rotas criadas mostra somente as rotas da data selecionada;
- Pedidos em rota e indicadores usam somente as rotas da data selecionada;
- Entregues usa a data real da entrega, sem transformar rota antiga em entrega de hoje;
- remove o loop antigo que repetia “Firebase rotas sincronizadas” e deixava a página pesada;
- se o SDK realtime não estiver disponível, usa fallback a cada 8 segundos.

DEPOIS DO DEPLOY
1. Aguarde o Vercel concluir.
2. Pressione Ctrl + F5.
3. Abra o console e execute:
   VescoV8.realtimeStatus()

RESULTADO ESPERADO:
{
  attached: true,
  mode: "firebase",
  routesToday: ...,
  deliveredToday: ...
}

TESTE ENTRE DOIS COMPUTADORES
1. Abra o painel nos dois.
2. No primeiro, clique Em Separação ou Separado.
3. No segundo, o pedido deve mudar de lista sem atualizar a página.
4. Crie/edite uma rota no primeiro.
5. A rota deve aparecer no segundo automaticamente.
