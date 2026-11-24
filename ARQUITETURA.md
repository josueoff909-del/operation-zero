# OPERATION ZERO — Arquitetura Técnica (Three.js + WebGL 2, Android)

> Definida na **Fase 1** conforme `GDD_MASTER.md` (Seção 22) e a skill
> `.agents/skills/threejs-android/SKILL.md`. Este documento é a fonte de
> verdade da estrutura de pastas e das regras de performance.

## 1. Visão geral

Jogo battle royale em terceira pessoa (protótipo inicia em 1ª pessoa),
partidas rápidas (~10 min, até 50 jogadores), rodando no navegador
mobile (Android) via **Three.js + WebGL 2** com **ES Modules** e **Vite**
(build estático). Sem assets externos na Fase 1: terreno, céu, árvores e
pedras são gerados por código (determinístico, leve, sem download).

## 2. Árvore de pastas (modular — Skill §2)

```
operation-zero/
├── index.html                  # entrada: canvas + HUD + joystick + botões
├── package.json / vite.config.js
├── GDD_MASTER.md               # especificação do jogo (9 tópicos)
├── ARQUITETURA.md              # este arquivo
├── PROGRESSO.md                # acompanhamento das 14 fases
├── src/
│   ├── main.js                 # bootstrap (só instancia o Engine)
│   ├── core/                   # núcleo do motor (nunca conhece regras de jogo)
│   │   ├── Config.js           # constantes centrais (balanceamento)
│   │   ├── Engine.js           # orquestra Renderer/Scene/Input/Loop/HUD
│   │   ├── Renderer.js         # WebGLRenderer, pixel ratio, qualidade
│   │   ├── SceneManager.js     # cena ativa + dispose() na troca
│   │   ├── Loop.js             # THREE.Clock, delta ≤ 0.05
│   │   ├── InputManager.js     # teclado + mouse + touch (multitouch)
│   │   └── PerformanceMonitor.js # FPS EMA + qualidade adaptativa
│   ├── world/                  # mundo estático
│   │   ├── Terrain.js          # heightmap + cores por vértice + getHeightAt
│   │   ├── Lighting.js         # sol + sombra 1024 + hemisfério + céu + fog
│   │   ├── Vegetation.js       # InstancedMesh (árvores/pedras/arbustos)
│   │   ├── Buildings.js        # cidade explorável (Fase 2: prédios/ruas/coberturas)
│   │   ├── Zones.js            # STUB (POIs, biomas — fases futuras)
│   │   └── Climate.js          # STUB (dia/noite, clima — fases futuras)
│   ├── entities/               # coisas que se movem
│   │   ├── Player.js           # controlador FPS (Fase 3 → 3ª pessoa)
│   │   ├── Viewmodel.js        # arma + mãos em 1ª pessoa (Fase 2: ADS/tiro visual)
│   │   ├── Bot.js              # STUB Fase 9 (44 bots FSM escalonados)
│   │   ├── Vehicle.js          # STUB Fase 7 (carro/moto/jipe)
│   │   └── Aircraft.js         # STUB Fase 8 (avião + paraquedas)
│   ├── systems/                # regras do jogo
│   │   ├── Collision.js        # colisão AABB + piso de caixas (Fase 2)
│   │   ├── Combat.js           # STUB Fase 4 (armas, balística, hitboxes)
│   │   ├── Inventory.js        # STUB Fase 5 (loot, cura, habilidades)
│   │   ├── SafeZone.js         # STUB Fase 6 (zona segura/gás)
│   │   ├── GameState.js        # STUB Fase 8 (fluxo da partida)
│   │   └── SaveSystem.js       # STUB Fase 11 (persistência local)
│   ├── ui/                     # interface
│   │   ├── HUD.js              # overlay de performance + estado (Fases 1–2)
│   │   ├── Joystick.js         # joystick virtual flutuante (esquerda)
│   │   ├── TouchLook.js        # olhar por toque (direita)
│   │   ├── Settings.js         # sensibilidade ajustável (Fase 2)
│   │   ├── Minimap.js          # STUB Fase 11
│   │   └── Lobby.js            # STUB Fases 8/11
│   └── utils/
│       └── Noise.js            # ruído determinístico (heightmap)
└── .agents/skills/threejs-android/SKILL.md  # regras obrigatórias
```

**Regra de dependência:** `core/` não importa de `world/entities/systems/ui`
(exceção: `Engine` monta tudo). `world/` não conhece `entities/`.
`systems/` operam sobre `entities/` e `world/` via interfaces, nunca via DOM.
`ui/` lê estado, nunca escreve regra de jogo.

## 3. Fluxo de dados (Fase 1)

```
InputManager (teclado/mouse/touch)
    → Engine._update(dt)
        → Player.applyLook + Player.update (física + câmera YXZ)
        → HUD.update (throttled 10 Hz)
Loop (rAF + Clock, delta ≤ 0.05)
    → Renderer.render(scene, camera)
    → PerformanceMonitor.record (FPS EMA → qualidade adaptativa)
```

## 4. Regras de performance mobile (Skill §1–§4, aplicadas na Fase 1)

| Regra | Onde está aplicada |
|---|---|
| Pixel ratio ≤ 1.5 | `Renderer.js` + `Config.PIXEL_RATIO_MAX` |
| `InstancedMesh` p/ repetidos | `Vegetation.js` (260 árvores, 130 pedras, 160 arbustos = 5 draw calls) |
| `dispose()` na troca de cena | `SceneManager.disposeScene` + `dispose()` em cada módulo |
| `frustumCulled = true` | terreno, vegetação, céu |
| `THREE.Clock` + delta ≤ 0.05 | `Loop.js` + `Config.MAX_DELTA` |
| Joystick flutuante + Touch Look + `Euler YXZ` | `Joystick.js`, `TouchLook.js`, `Player.js` |
| Multitouch simultâneo | `InputManager` (identifiers independentes) |
| `touch-action: none` + `preventDefault` | `index.html` + handlers touch |
| Qualidade adaptativa por FPS | `PerformanceMonitor.js` (4 níveis: pixel ratio + sombra) |
| Bots escalonados (11/frame, ciclo 4) | reservado p/ Fase 9 (`Bot.js`) |

## 5. Como rodar

```bash
npm install
npm run dev      # http://localhost:5173 (ou IP local no celular)
npm run build    # build estático em dist/
```

Controles Fase 1 — Desktop: WASD + mouse (clique p/ travar) + Shift + Espaço.
Android: joystick esquerdo + arrastar direita + botões PULAR/CORRER.

## 6. Como expandir (próximas fases)

Cada fase pluga um módulo novo no `Engine` sem reescrever o núcleo:
Fase 3 → câmera 3ª pessoa no `Player` (reaproveita movimento/colisão);
Fase 4 → `Combat` (raycast + pooling, dano real no lugar do tiro visual);
Fase 5 → `Inventory` (loot); Fase 6 → `SafeZone` (círculos + dano);
Fase 9 → `Bot` (FSM escalonada); Fase 10 → rede (autoridade do servidor);
Fase 11 → HUD completa. Detalhes e status em `PROGRESSO.md`.
