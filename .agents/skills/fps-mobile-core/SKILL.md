---
name: fps-mobile-core
description: Núcleo obrigatório de FPS mobile na Web (Three.js) — portão de Lobby, orientação/tela cheia no primeiro toque, layout de toque sem sobreposição, colisão sólida compartilhada com IA e IA de bots em lotes. Escrito a partir do OPERATION ZERO.
---

# FPS Mobile Core — OPERATION ZERO

Regras extraídas de três bugs reais que o `npm run build` **não** pega: um
`ReferenceError` de escopo que só aparecia no browser, um `getElementById` que
retornava `null` e virava no-op silencioso, e um hitmarker preso na tela porque
dois relógios diferentes dividiam o mesmo estado. Build verde ≠ rodando.

## 1. Gate de Lobby (o jogo nunca abre solto no mapa)

A cena 3D já existe atrás do menu (é o fundo dele), mas **nada de jogo roda**:

```js
// Engine.start()
this._buildScene();          // terreno → prédios → colisão → nav → player → bots
this.input.setEnabled(false);// menu não herda "dedo preso" nem WASD
this.lobby.show();            // fase = LOBBY
this.loop.start();            // o loop roda: câmera orbital + HUD de debug
```

- A máquina de fases fica num módulo DOM-free (`systems/GameState.js`):
  `LOBBY → DEPLOY (0.6 s) → MATCH → RESULT`. UI chama comando
  (`gameState.startMatch()`), nunca escreve regra.
- `Loop.update` **sempre** renderiza; ele só pula o `player.update`/`combat`
  quando `phase !== MATCH`. Se você congelar o loop, o fundo do menu morre.
- Toda saída de fase tem de refazer o input: `setEnabled(true)` no spawn,
  `setEnabled(false)` no resultado — e `setEnabled(false)` **zera** o estado
  (firing/aiming/joystick/look), senão o jogador sai correndo atirando ao
  voltar do menu.
- `DEPLOY` existe para a cena assentar (texturas/sombra) antes do input entrar;
  sem ele o primeiro frame do MATCH tem um pico de 60–200 ms no Android.

## 2. Tela cheia + orientação: dentro do gesto, com fallback que não quebra

Fullscreen e `orientation.lock()` **só podem** ser pedidos dentro de um user
gesture (toque no JOGAR) e **nunca** podem lançar exceção para fora:

```js
async enter() {
  const result = { fullscreen: false, orientation: null, error: null };
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else result.error = 'fullscreen-indisponivel';
  } catch { result.error = 'fullscreen-bloqueado'; }   // iframe sem allow, iOS, etc.
  try { await screen.orientation.lock('landscape'); this._locked = true; }
  catch { this._locked = false; }                        // iOS/desktop nega: segue
  return result;
}
```

- Rejeições viram **estado**, não erro: a UI mostra "Tela cheia bloqueada pelo
  navegador — jogando em janela" e o jogo continua.
- `requestPointerLock()` também retorna promessa no Chrome novo: `.catch(() => {})`
  obrigatório, ou você ganha um `Uncaught (in promise) SecurityError`.
- Depois de entrar em tela cheia o viewport muda sem `resize` em alguns
  navegadores → dispare `renderer.resize()` + `camera.updateProjectionMatrix()`
  no callback de `fullscreenchange`/`orientationchange`.
- CSS: `height: 100dvh` (com `100vh` antes como fallback) + `viewport-fit=cover`
  + `env(safe-area-inset-*)` em **todos** os elementos fixos, ou a barra de
  navegação come o botão de atirar.

## 3. Layout de toque: geometria é regra, não estética

Zonas e botões têm contrato: **nada de botão sob HUD, nada de botão colado**.

| camada | z-index | papel |
| --- | --- | --- |
| `#joystick-zone` (esq. 50%) / `#look-zone` (dir. 50%) | 4–5 | capturam o arraste |
| HUD (`#hud-top`, `#hud-match`, crosshair) | 8–10 | `pointer-events: none` sempre |
| `.action-btn` (ATIRAR/MIRAR/PULAR/AGACHAR/CORRER) | 11 | botões reais |
| Lobby / resultado | 25–26 | cobrem o jogo e matam os botões (`body[data-phase="lobby"] .action-btn { display: none }`) |

- Alvo de toque ≥ 64 px (ATIRAR 84 px), espaçamento ≥ 12 px entre botões.
- HUD de partida (vida/munição) fica no **topo**; se você colocar vida embaixo,
  ela briga com PULAR/AGACHAR no polegar direito.
- `touch-action: none` nos três níveis (`html`, zona, botão) + `e.preventDefault()`
  nos handlers — sem isso o pull-to-refresh/zoom rouba o gesto no meio do tiro.
- Multitouch: um `identifier` por função (joystick guarda o dele, look guarda o
  dele, botão é `touchstart/touchend/touchcancel`). **`touchcancel` tem de
  soltar o gatilho**, senão o arma continua atirando sozinha depois de uma
  notificação do sistema.

## 4. Colisão sólida: uma única função para jogador, bots e bala

Regra dura: **o cenário é sólido** (pedra, tronco, parede, cerca) e tudo que se
move usa o mesmo código — 90% dos bugs de "atravessou o prédio" vêm de cada
entidade ter sua própria colisão.

```js
// Collision.js — grade espacial + 1 array reutilizado (zero alocação/frame)
resolveCircle(position, radius, feetY)  // círculo (cápsula projetada) vs AABB/círculo
rayDistance(ox, oz, oy, dx, dz, maxDist, halfHeight, dirY) // linha de tiro
isBlockedCircle(x, z, r, feetY)         // spawn/waypoint válido
getGroundHeight(x, z, feetY)            // subir em caixa/mesa/calçada
```

- **Meio-fio andável:** volume só bloqueia se `maxY > feetY + COLLISION_STEP`
  (0.55 m). Abaixo disso é pisável — inclusive a laje do térreo, para o prédio
  continuar fechado por dentro.
- Duas passadas de `resolveCircle` quando a primeira moveu algo: props
  encostados (barril + poste) se empurram de volta na passada única.
- Slide natural: resolve-eixo-mais-curto, nunca "gruda" ao andar contra a parede.
- Passo de raio do tiro com **margem do meio do passo** (`t - 0.5*step`):
  passo com ponto final atravessa parede na diagonal em `t ≈ 0.99`.
- Tiro para na cobertura **antes** de escolher o alvo, e o mesmo `rayDistance`
  bloqueia o tiro do bot. Balas não atravessam prédio — sem exceção.
- Bots usam `resolveCircle` + o chão do terreno (`getGroundHeight`), então a IA
  anda na cidade sem atravessar nada de graça.

## 5. IA de bots em lote, movimento a 60 FPS

```
decisão (percepção + FSM)  →  BOT_DECISION_BATCH bots/frame (round-robin)
integração (movimento+chão) →  TODOS os bots, TODO frame
```

- Percepção em ordem de custo: `dist²` → cone de FOV → **1** `rayDistance`.
  Fora do raio de audição (60 m), o bot nem lê o mapa.
- Histerese **espacial** (ataca a 44 m, solta a 60 m) e **temporal**
  (`MIN_STATE_TIME` 0.4 s) — sem isso o bot pisca entre ATTACK/PATROL no limiar.
- Bot travado: `< 0.5 u` de progresso em 2 s ⇒ repath + girar o destino ~60°
  por 0.5 s. Steering puro trava em quina porque o push-out cancela o avanço.
- Bots andam **para o próximo nó do A\***, não para o waypoint final
  (`_nextNode`); ignorar o caminho é o clássico "encostou na parede e empurra".
- Orçamento por frame: `BOT_REPATH_BUDGET` A*s no máximo (0.6 ms cada em mapa
  cheio) e no máximo um tiro por bot no frame, para o pico de draw calls não
  estourar os 16 ms.
- Renderização: 6 `InstancedMesh` (por parte do corpo) + 1 para traces =
  **7 draw calls para 44 bots**. Cor por instância só é reescrita quando
  `hitFlash`/`alive` **muda** (`instanceColor.needsUpdate` não é grátis).
  Slot morto = escala `0.0001` em `y = -999` (não re-alocar buffers).
- Tracer de bot dura 0.06 s — em 30 FPS ainda é visto.

## 6. Feel de tiro (o que o build não valida)

- Cadência em **relógio agendado**, não em `if (now - last > interval)`; com
  fila zerada ao soltar o gatilho (senão o primeiro clique após 2 s de pausa
  dispara as balas "atrasadas"):

```js
while (this.nextShotAt <= now && this.ammo > 0) { this.fire(); this.nextShotAt += this.interval; }
```

  Prova disso é obrigatória: 10 s de full-auto a 30/60/144 FPS devem dar
  `fire_rate × 10` balas (±1).
- Recuo como offset de câmera que decai (nunca direto no yaw de mira), padrão
  fixo por arma; spread por **disco** (`r = spread * sqrt(u)`), cresce por
  tiro, cai com `spreadRecover`, dobra andando, `× adsSpreadMult` mirando.
- Dano por parte com bandas de distância (falloff) e TTK alvo 0.2–0.6 s no
  corpo — headshot precisa sair mais rápido, sniper 1–2 tiros.
- Um único dono para cada número: munição/abate no `Combat`, **crédito de
  abate** no `Engine` (o `Combat` não incrementa `player.kills`), `GameState`
  guarda `kills`/`alive`/tempo. Dois donos = abate duplo no placar.
- HUD é leitura, ~10 Hz, e usa **um só relógio** para timing de feedback: se o
  `hitmarker` usa `performance.now()` e o `update()` compara com o tempo do
  `Clock`, ele nunca apaga. Passe `now` para dentro (`hud.flashHit(info, now)`).

## 7. Verificação (obrigatória, o build não basta)

Dois harnesses em Node, sem GPU e sem navegador:

```
npm test        # mundo: colisão, LOS, cadência 30/60/144, TTK, lote de IA,
                #      fiação Engine→métodos, ids do index.html
npm run test:ui # DOM real de index.html: JOGAR → imersão → DEPLOY, botões de
                #      toque, recarga, hitmarker, tela de resultado, geometria
npm run bench   # draw calls teóricas + ms de lógica/frame (0 → 44 bots)
```

Regras que esses testes sustentam (OPERATION ZERO, 44 bots):

| métrica | valor |
| --- | --- |
| draw calls da cena completa | 41 (bots = 7) |
| triângulos | 75,000 |
| lógica de frame (player+combat+44 bots+luz) | 0.22 ms |
| A* mapa inteiro 180×180 m | 0.5–1.8 ms (com budget/frame) |
| `resolveCircle` | ~4.7 µs por chamada |

E o mínimo do headless: **`getElementById` de todo módulo de UI precisa
existir no HTML** e **toda chamada `this.<dep>.<método>()` do Engine precisa
resolver na classe do dep** — foi assim que se pegaram `#ammo-weapon` ausente,
`viewmodel.reset()` inexistente e `hud.flashHit` lendo o relógio errado.

## Gotchas

- `document.getElementById` que retorna `null` **não** quebra nada: o módulo
  guarda `if (this.xEl)` e o HUD simplesmente nunca atualiza. Teste o seletor,
  não só a ausência de exceção.
- `body[data-phase]` é o que esconde os botões no menu; esquecer = botão
  fantasma clicável sobre o Lobby.
- Rejeição de `orientation.lock` é o **normal** em desktop/iOS: nunca trate
  como falha.
- `frustumCulled` em `InstancedMesh` com bounding box de uma instância só
  corta metade do mundo — defina uma `boundingSphere` grande ou desligue.
- Nunca edite código por `str.replace`/`sed` sem `assert count == 1`: um
  no-op silencioso é exatamente o tipo de "funciona no build, quebra no
  runtime" que este projeto já levou 1 hotfix para descobrir.
