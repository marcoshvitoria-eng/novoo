# Grave e Leia

PWA 100% front-end (sem backend, sem APIs externas) para gravar vídeos com teleprompter, apresentação com câmera em miniatura, gravação meio a meio e edição/corte de vídeos direto no navegador. Funciona em Android, iPhone e computador.

## Rodar localmente

Qualquer servidor estático HTTPS/localhost serve. Exemplo:

```bash
npx serve .
# ou
python3 -m http.server 8080
```

Abra `http://localhost:8080` (câmera exige `localhost` ou HTTPS).

## Publicar na Cloudflare Pages

**Opção 1 — pelo painel (mais simples):**

1. Suba esta pasta para um repositório Git (GitHub/GitLab).
2. No painel da Cloudflare, vá em **Workers & Pages** → **Create** → aba **Pages** → **Connect to Git** → escolha o repositório.
3. Configuração de build:
   - **Framework preset**: `None`
   - **Build command**: (deixe em branco)
   - **Build output directory**: `/` (a raiz — o `index.html` já está nela)
4. Clique em **Save and Deploy**. A Cloudflare já fornece HTTPS automaticamente, necessário para a câmera funcionar.

**Opção 2 — via CLI (Wrangler), sem precisar de repositório Git:**

```bash
npm i -g wrangler
wrangler login
wrangler pages deploy . --project-name=grave-e-leia
```

O arquivo `_headers` já configura os cabeçalhos corretos do `sw.js` (service worker) e do `manifest.json` — a Cloudflare Pages lê esse arquivo automaticamente, não precisa de nenhuma configuração extra.

## Instalar como app

- **Android/Chrome/Edge**: toque em "⬇ Baixar app" na tela inicial (ou use o menu do navegador → "Instalar aplicativo").
- **iPhone/Safari**: toque em "⬇ Baixar app" para ver as instruções, ou manualmente: toque no ícone de compartilhar → "Adicionar à Tela de Início".

## Funções

1. **Gravar na vertical** — formato TikTok (9:16). Texto rolante em cima, câmera embaixo, controle de velocidade da rolagem, zoom, tela dividida 50/50. Toque na área da câmera para iniciar/pausar a gravação.
2. **Gravar na horizontal** — formato YouTube (16:9). Texto na esquerda, câmera na direita, layout se adapta automaticamente ao girar o celular.
3. **Apresentação** — vídeo de fundo com sua câmera em miniatura (redonda ou quadrada), arrastável e redimensionável, formatos TikTok ou YouTube.
4. **Edição de vídeo** — selecione trechos (início/fim) que deseja manter, monte a lista na ordem desejada e gere o vídeo final já cortado, sem as partes indesejadas.
5. **Gravar meio a meio** — câmera de um lado, vídeo adicionado do outro, com divisor arrastável para ajustar o tamanho de cada parte; layout muda entre empilhado (TikTok) e lado a lado (YouTube).
6. **Vídeos** — galeria com todos os vídeos salvos (armazenados no próprio navegador via IndexedDB), com opções de reproduzir, baixar novamente ou excluir.

## Observações técnicas

- Toda a gravação é feita compondo os vídeos em um `<canvas>` e capturando com `MediaRecorder` — não há upload para nenhum servidor.
- Os vídeos ficam salvos localmente no navegador (IndexedDB). Limpar os dados do site apaga os vídeos salvos — baixe os que quiser guardar em definitivo.
- Zoom de câmera usa a API nativa do dispositivo quando disponível; em aparelhos sem suporte, o controle fica sem efeito.
