# Reprodutor de câmeras (teste em rede local)

Projeto pessoal **experimental** para assistir, na TV de casa, às câmeras de um DVR
Intelbras (MHDX 1108, base Dahua) **dentro da rede local**.

> **Aviso**
> - É apenas um teste para uso doméstico em rede local. **Não é um produto, não tem fins comerciais**
>   e não será publicado em lojas de aplicativos.
> - Não tem nenhuma relação com a Intelbras, a Dahua ou a LG, nem apoio delas. Os nomes são citados só
>   para identificar o equipamento usado nos testes.
> - Não contém código, firmware ou arquivos do fabricante. A comunicação usa só as interfaces que o
>   próprio DVR expõe na rede (RTSP, RTSP via WebSocket e snapshot HTTP).
> - Nenhuma senha fica no repositório. As credenciais são digitadas na TV ou em arquivos locais
>   ignorados pelo git.
> - Não exponha o DVR à internet para usar este projeto.

## Estrutura

| Pasta      | O que é |
|------------|---------|
| `android/` | App Android TV (Kotlin + Media3/ExoPlayer, RTSP nativo) |
| `webos/`   | App LG webOS (HTML/JS: RTSP via WebSocket → fMP4 → Media Source Extensions) |
| `scripts/` | `build_ipk.py`: empacota o app webOS em `.ipk` sem precisar do SDK da LG |

## Como funciona

**Android TV**
- Grade 2×2 ou 3×3 com o substream de cada câmera (`subtype=1`). OK abre a câmera em tela cheia com o
  stream principal (`subtype=0`).
- URL: `rtsp://IP:554/cam/realmonitor?channel=N&subtype=S`, com autenticação Digest feita pelo ExoPlayer.

**LG webOS**
- O navegador da TV não toca RTSP. O app abre `ws://IP/rtspoverwebsocket` (o mesmo endpoint que a
  página web do DVR usa), conversa RTSP por ali, remonta o H.264/H.265 em MP4 fragmentado e toca num
  `<video>` via MSE.
- A TV só consegue decodificar poucos vídeos ao mesmo tempo. Por isso a grade mostra snapshots
  (`/cgi-bin/snapshot.cgi`) atualizados continuamente, e o vídeo ao vivo fica só na tela cheia.

**Controles**: setas navegam, OK abre a tela cheia, ◀ ▶ trocam a câmera em tela cheia, Voltar volta para
a grade. Configurações: MENU / OK segurado (Android) ou botão vermelho (webOS).

## Build

### Android
```sh
cd android
cp local.properties.example local.properties   # ajuste sdk.dir (e, se quiser, usuário/senha padrão)
./gradlew assembleRelease                       # app/build/outputs/apk/release/app-release.apk
```
Sem `keystore.properties`, o build release é assinado com a chave de debug, o que basta para instalar
direto na TV.

### webOS
```sh
cp webos/js/config.local.example.js webos/js/config.local.js   # opcional
python3 scripts/build_ipk.py                                    # gera dist/*.ipk
```
Para instalar, ative o **Developer Mode** na TV e use `ares-install` ou o webOS Dev Manager. Também
dá para copiar o `.ipk` por SSH (porta 9922) e chamar `luna://com.webos.appInstallService/dev/install`.

Para testar no navegador do computador, sirva a pasta `webos/` (ex.: `python3 -m http.server`) e abra
`index.html`.

## Limitações conhecidas
- No webOS, a grade é "quase ao vivo": cada câmera atualiza a cada 1 ou 2 segundos.
- Na tela cheia, o atraso é de cerca de 2 segundos.
- O app Android ainda usa um vídeo por quadro na grade. Em aparelhos com poucos decodificadores, pode
  ser preciso usar a grade 2×2.
- Testado em um único DVR e em uma única TV LG (webOS com Chrome 79).
