# OPERATION ZERO — DOCUMENTO MESTRE & SKILL TÉCNICA (FPS MUNDO ABERTO ANDROID)

Leia este documento integralmente antes de realizar qualquer alteração no projeto.

Você está assumindo o papel de uma equipe profissional de desenvolvimento de jogos (programação 3D, game design, IA, animação, UI/UX mobile, física e otimização WebGL 2).

Não interprete este projeto como uma demonstração visual simples. O objetivo é construir um jogo FPS de mundo aberto original, fluido (60 FPS no Android), com sistemas integrados e funcionalidades verificáveis.

---

## 1. VISÃO GERAL DO PRODUTO
- **Nome:** OPERATION ZERO
- **Gênero:** FPS (Primeira Pessoa) competitivo de exploração e sobrevivência em mundo aberto.
- **Referências de UX/Fluidez:** Free Fire e Blood Strike (usar como padrão de responsividade de controles touch, clareza de HUD e ritmo, sem copiar marcas ou assets).
- **Plataforma Prioritária:** Android (navegadores mobile em modo paisagem/landscape), com suporte secundário a PC (teclado/mouse).
- **Pilares:** Câmera FPS com arma/mãos em primeira pessoa (viewmodel), mapa aberto de 2–3 km² com interiores acessíveis, 45 participantes (1 jogador + até 44 bots com IA), entrada por avião e paraquedas, coleta de recursos/equipamentos, objetivos disputados, zona segura progressiva, veículos funcionais e progressão real salva localmente.

---

## 2. DIRETRIZES TÉCNICAS OBRIGATÓRIAS (SKILL THREE.JS + ANDROID)

### A. Arquitetura Modular (ES Modules + Vite)
Nunca concentrar lógica em um único arquivo gigante. Manter separação estrita:
- `/src/core/` — Engine, Loop (`deltaTime` limitado a `0.05s`), Renderer WebGL 2, SceneManager, InputManager.
- `/src/world/` — Terreno 3D, regiões do mapa, interiores, vegetação, iluminação e clima.
- `/src/entities/` — Player FPS (câmera + viewmodel), Bots (Máquina de Estados), Veículos, Avião e Paraquedas.
- `/src/systems/` — Física/Colisões, Combate/Interação, Inventário, Zona Segura, Pontuação e SaveSystem (`localStorage`/IndexedDB).
- `/src/ui/` — Lobby 3D, HUD Touch Paisagem, Minimapa, Bússola, Inventário e Configurações.

### B. Otimização Extrema para Mobile (Meta: 60 FPS no Android)
- **Pixel Ratio:** Limitar `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))` (ajustável nas configurações gráficas: Baixo, Médio, Alto).
- **InstancedMesh Obrigatório:** Usar `THREE.InstancedMesh` para árvores, rochas, estruturas repetidas, projéteis, itens e os 44 bots. Nunca instanciar dezenas de `THREE.Mesh` idênticos separadamente.
- **Culling & LOD:** Ativar `frustumCulled = true` e usar `THREE.LOD` para construções e detalhes distantes.
- **Gestão de Memória:** Sempre chamar `.dispose()` em geometrias, materiais e texturas ao trocar de cena (Lobby -> Avião -> Partida).
- **IA Escalonada:** Nunca processar a tomada de decisão dos 44 bots no mesmo frame. Dividir em lotes (ex.: 11 bots por frame em ciclo de 4 frames), mantendo apenas a interpolação de movimento suave a 60 FPS.

### C. Controles FPS Touch e Orientação (Android)
- **Orientação Paisagem (Landscape):** Projetar todo o HUD para tela deitada, exibindo aviso amigável caso o celular esteja em pé e ocultando mensagens de "mouse/teclado" em dispositivos touchscreen.
- **Multi-Touch Simultâneo (`e.touches`):** Permitir andar (joystick flutuante na metade esquerda), girar a câmera (arrasto livre na metade direita usando `Euler('YXZ')`) e acionar botões (Atirar, Mirar/ADS, Pular, Agachar, Correr, Interagir) ao mesmo tempo.
- Bloquear gestos padrão do navegador (`touch-action: none` no CSS).

---

## 3. DIREÇÃO ARTÍSTICA E DESIGN DO MUNDO ABERTO
- **Visual:** Moderno, tático e legível, com iluminação coerente, neblina atmosférica para profundidade/distância de visão e materiais PBR leves.
- **Lobby Principal:** Hangar 3D em tempo real com personagem animado no centro e botões 100% funcionais (Jogar, Personagens, Coleção, Loja, Eventos, Perfil/XP/Moedas e Configurações).
- **Mapa Aberto (2 a 3 km², construído por regiões testáveis):**
  1. **Cidade:** Prédios variados, ruas, coberturas e interiores exploráveis.
  2. **Complexo Industrial:** Galpões, contêineres e passarelas.
  3. **Vila Rural:** Casas, estradas de terra e vegetação.
  4. **Porto:** Docas, guindastes e armazéns.
  5. **Florestas e Montanhas:** Relevos, mirantes e caminhos naturais.
- *Regra:* Nunca criar grandes planos vazios; construir uma região rica e totalmente colidível primeiro e expandir após testes.

---

## 4. SISTEMAS DE JOGO INTEGRADOS
1. **Movimentação & FPS:** Caminhada, corrida, salto, agachamento, colisão sólida (sem atravessar paredes), detecção de altura do terreno e viewmodel de arma/equipamento em primeira pessoa.
2. **Entrada na Partida:** Avião percorrendo rota sobre o mapa com indicador no minimapa, salto livre, abertura de paraquedas, controle direcional na descida e pouso (incluindo os 44 bots).
3. **Exploração, Loot & Objetivos:** Mochila/inventário funcional para itens, recursos de energia, armas/equipamentos e módulos de pontuação disputados pelos bots no mapa.
4. **Zona Segura:** Círculo progressivo visível no mundo e no minimapa com temporizador, avisos e dano/desclassificação fora da área.
5. **Veículos:** Entrada/saída, direção touch, aceleração, freio, colisão com terreno e câmera dedicada.
6. **HUD Personalizável & Progressão:** Minimapa, bússola, vida/energia, vivos restantes, pontuação e editor de posição/tamanho dos botões touch salvos junto com XP, nível e estatísticas reais.

---

## 5. PLANO DE IMPLEMENTAÇÃO POR FASES (EXECUÇÃO CONTROLADA)
- **FASE 1:** Arquitetura técnica modular e protótipo 3D base com contador de FPS.
- **FASE 2:** Câmera FPS completa (viewmodel), controles touch paisagem e primeiras construções exploráveis com colisão sólida.
- **FASE 3:** Personagens 3D e sistema de animações (respiração, andar, correr, pular, agachar, pouso).
- **FASE 4:** Primeira região completa do mapa aberto (Cidade/Vila com interiores, estradas e pontos de interesse).
- **FASE 5:** Lobby 3D integrado no hangar com interface funcional.
- **FASE 6:** Sistema de avião, salto e paraquedas.
- **FASE 7:** Sistema de exploração, coleta de loot e inventário funcional.
- **FASE 8:** Inteligência Artificial dos bots (Máquina de Estados + desvio de obstáculos).
- **FASE 9:** Sistema completo de 45 participantes na partida.
- **FASE 10:** Objetivos distribuídos pelo mapa e Zona Segura progressiva.
- **FASE 11:** Veículos funcionais com física de terreno.
- **FASE 12:** HUD completo, minimapa, bússola e personalização de controles touch.
- **FASE 13:** Tela de resultados, XP, níveis, coleção e salvamento persistente.
- **FASE 14:** Expansão das demais regiões do mapa, balanceamento e otimização final Android.

---

## 6. REGRAS DE CONDUTA E CONTINUIDADE (ANTI-ESTOURO DE TOKENS)
1. **Uma fase por vez:** Nunca tente programar múltiplas fases de uma só vez. Implemente apenas a fase solicitada com qualidade máxima e sem placeholders falsos.
2. **Preservar o que funciona:** Nunca quebre ou apague sistemas das fases anteriores.
3. **Registro obrigatório (`PROGRESSO.md`):** Ao final de cada etapa, atualize o arquivo `PROGRESSO.md` listando os arquivos criados/alterados, o que já está funcional e o próximo passo exato para a fase seguinte.
4. **Verificação real:** Rode o build (`npm run build`) antes de concluir cada etapa para garantir zero erros de sintaxe ou importação.
