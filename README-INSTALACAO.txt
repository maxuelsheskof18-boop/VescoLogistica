VESCO CONTROL — MAPA V10.29

ARQUIVOS PARA SUBSTITUIR
1. index.html
2. modulo.vesco-v8-operacional.js
3. vesco-firebase-realtime.js

ORDEM DOS SCRIPTS
<script src="firebase-config.js?v=1029"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="modulo.vesco-v8-operacional.js?v=1029"></script>
<script src="vesco-firebase-realtime.js?v=1029"></script>

CORREÇÕES DO MAPA
- O zoom feito pelo operador não volta sozinho quando chega uma atualização realtime.
- O centro e o nível de zoom são preservados ao atualizar pedidos e rotas.
- A roda do mouse usa passos de 0,5 e sensibilidade mais controlada.
- Arrastar, duplo clique, toque, teclado e caixa de zoom ficam habilitados.
- Redimensionamentos do painel recalculam o tamanho do Leaflet sem deslocar o mapa.
- O botão Ajustar continua enquadrando todos os pontos quando o operador solicitar.
- A abertura inicial enquadra os pinos automaticamente.
- Ao abrir um pedido, o mapa centraliza no pino com animação e abre o popup.
- O nível de zoom atual aparece abaixo do mapa.

INSTALAÇÃO
1. Substitua os três arquivos no GitHub/Vercel.
2. Não carregue modulo.mapas.js, modulo.mapas-lite-v7.js ou outros núcleos antigos junto com o V10.29.
3. Aguarde o deploy.
4. Pressione Ctrl + F5.

TESTE
- Abra Envios Flex.
- Use a roda do mouse para aproximar.
- Aguarde uma atualização realtime ou altere um pedido em outro computador.
- O mapa deve manter exatamente a região e o zoom escolhidos.
- Clique em Ajustar para voltar a enquadrar todos os pinos.

CONSOLE ESPERADO
VESCO V10.29 ativo — mapa estável, zoom suave e realtime sem resetar a visão.
VESCO index V10.29 Mapa Estável carregado com sucesso.
