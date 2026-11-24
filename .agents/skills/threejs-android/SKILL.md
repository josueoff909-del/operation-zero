---
name: threejs-android-battle-royale
description: Padrões profissionais de arquitetura Three.js, WebGL 2, física FPS e otimização extrema para dispositivos móveis Android.
---

# Regras Técnicas Obrigatórias — OPERATION ZERO

## 1. Performance e Renderização Mobile (Android)
- **Pixel Ratio:** Limitar `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))` para evitar superaquecimento e queda de FPS em telas 2K/4K de celular.
- **Instancing Obrigatório:** Usar `THREE.InstancedMesh` para qualquer objeto repetido (árvores, pedras, prédios modulares, balas e os 44 bots). Nunca criar dezenas de `THREE.Mesh` individuais com a mesma geometria.
- **Gerenciamento de Memória:** Sempre chamar `.dispose()` em geometrias, materiais e texturas não utilizados ao trocar de cena (ex.: Lobby -> Avião -> Mapa).
- **Frustum Culling & LOD:** Ativar `frustumCulled = true` e usar `THREE.LOD` para construções e terrenos distantes.

## 2. Arquitetura Modular (ES Modules)
- Nunca concentrar código em um único arquivo `main.js` gigante. Separar estritamente em:
  - `/src/core/` (Engine, Loop, Renderer, SceneManager, InputManager)
  - `/src/world/` (Terreno, Zonas, Vegetação, Clima, Iluminação)
  - `/src/entities/` (Player FPS, Bots FSM, Veículos, Avião/Paraquedas)
  - `/src/systems/` (Inventário, Zona Segura, Pontuação, SaveSystem)
  - `/src/ui/` (HUD Touch, Minimapa, Lobby, Configurações)
- Usar `THREE.Clock` com `deltaTime` limitado (`Math.min(clock.getDelta(), 0.05)`) para a física não quebrar se o navegador travar por um instante.

## 3. Controles Touch e Câmera FPS Mobile
- Implementar zona esquerda da tela para **Joystick Virtual flutuante** (movimentação) e zona direita para **Touch Look** (rotação de câmera com `Euler('YXZ')` para evitar Gimbal Lock).
- Garantir suporte simultâneo a múltiplos toques (`e.touches`) para o jogador poder andar, girar a câmera e atirar/pular ao mesmo tempo no Android.
- Bloquear gestos padrão do navegador (`touch-action: none` no CSS e `e.preventDefault()`) para a tela não puxar para atualizar nem dar zoom acidental.

## 4. Inteligência Artificial Escalonada (44 Bots)
- Nunca atualizar a lógica de decisão de todos os 44 bots no mesmo frame. Dividir em lotes (ex.: 11 bots por frame em ciclo de 4 frames) mantendo apenas a interpolação de movimento suave a 60 FPS.
