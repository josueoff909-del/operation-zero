Atue como um arquiteto de jogos sênior, game designer e engenheiro de sistemas especialista em jogos battle royale em terceira pessoa de ritmo rápido (inspirados em Free Fire). Sua tarefa é gerar a especificação completa, a arquitetura técnica, os sistemas de jogo e o código base modular para recriar um jogo battle royale em terceira pessoa com partidas rápidas (cerca de 10 minutos, até 50 jogadores), zona segura encolhendo progressivamente, loot no mapa, movimentação ágil e combate tático.

Não restrinja a implementação a HTML5/Canvas ou aplicações web simples; projete a arquitetura de forma agnóstica ou focada em um motor/estrutura profissional escalável (como Unity/C#, Unreal ou arquitetura cliente-servidor limpa), deixando claro como cada módulo se conecta.

Estruture sua resposta de forma completa e técnica cobrindo obrigatoriamente os seguintes tópicos:

1. VISÃO GERAL E GAME LOOP (BATTLE ROYALE RÁPIDO)
- Duração alvo da partida, número de jogadores, modos (solo, duo, esquadrão).
- Fluxo completo da partida: lobby de espera -> embarque no avião/transporte -> salto de paraquedas com controle de direção e velocidade de queda -> pouso e busca por loot -> rotações sob a zona segura -> confrontos finais -> vitória (Booyah / último sobrevivente ou esquadrão).
- Ritmo de progressão e micro-objetivos para evitar tempos mortos.

2. MAPA, AMBIENTE E ZONA SEGURA (SAFE ZONE / GÁS)
- Estrutura do mapa: biomas/regiões nomeadas, pontos de interesse (POIs) com alta/média/baixa densidade de loot, coberturas (muros, pedras, veículos, construções) e rotas de rotação.
- Sistema de zona segura em múltiplas fases: raio inicial, centro aleatório ou semi-ponderado, tempo de espera, tempo de fechamento, dano por tick escalonado por fase e feedback visual/sonoro no HUD e no mundo.
- Mecânicas de prevenção de camping extremo ou zonas finais previsíveis.

3. MOVIMENTAÇÃO, CONTROLES E FÍSICA
- Movimentação em terceira pessoa: corrida, sprint, andar agachado, deitar/rolar (se aplicável), pulo, escalada/transposição de obstáculos baixos e sprint com arma vs. sem arma.
- Câmera em terceira pessoa: posicionamento over-the-shoulder, colisão de câmera contra paredes/terreno, mira (hip-fire e ADS/mira de precisão) e sensibilidade ajustável.
- Interação com ambiente e veículos terrestres (ex.: carro, moto, jipe): entrar/sair, dirigir, física de colisão, dano por atropelamento e destruição do veículo.

4. SISTEMA DE COMBATE, ARMAS E BALÍSTICA
- Classes de armas: fuzis de assalto (AR), submetralhadoras (SMG), espingardas (SG), rifles de precisão/sniper (SR), pistolas e armas corpo a corpo/granadas.
- Atributos de armas: dano base, queda de dano por distância (falloff), cadência de tiro (fire rate), tamanho do carregador, tempo de recarga, recuo (recoil) e dispersão (spread), velocidade de movimento ao portar.
- Hit detection, hitboxes (cabeça, torso, membros), multiplicadores de dano, indicadores de hit/dano, efeitos visuais e sonoros de disparo, impacto e recarga.
- Sistema de mira assistida/precisão e controle de cadência.

5. INVENTÁRIO, LOOT, CURA E HABILIDADES
- Geração e distribuição de loot no chão e em caixas/drops aéreos (airdrops): armas, munição por calibre, coletes/capacetes (níveis de proteção e durabilidade), mochilas (capacidade de carga), kits médicos, inaladores/itens de escudo ou energia e granadas/paredes de gel (cover portátil).
- Inventário rápido: coleta automática configurável, troca rápida de armas, uso de itens de cura em movimento ou parado com tempo de canalização e cancelamento.
- Sistema de personagens/habilidades (opcional ou modular): habilidades ativas e passivas com cooldown, cargas e sinergias de esquadrão.

6. ARQUITETURA TÉCNICA E REDE (MULTIPLAYER)
- Arquitetura cliente-servidor (autoridade do servidor vs. predição no cliente, reconciliação, interpolação de entidades remotas).
- Sincronização de estado: posição/rotação dos jogadores, tiros/projéteis ou raycasts, estado da zona segura, itens no chão, veículos e HP/escudo.
- Otimizações para alta contagem de jogadores e dispositivos variados: object pooling, LOD (nível de detalhe), culling de oclusão/distância, ticks de rede e compressão de pacotes.

7. IA DE BOTS E BALANCEAMENTO DE PARTIDA
- Comportamento de bots para preencher lobbies ou treinar: navegação, busca por loot, reação a tiros, movimentação/cobertura e níveis de dificuldade.
- Economia e pacing da partida: curva de escassez/abundância de loot, tamanho das zonas e janela de engajamento.

8. UI/UX, HUD E ÁUDIO
- HUD em partida: minimapa com zona segura e direção do avião, contador de vivos/abates, barras de HP/colete, slots de armas e granadas/cura, botões/controles responsivos e hitmarkers.
- Áudio posicional 3D: passos, direção de tiros, sons de veículos, alerta de zona e áudio espacial para leitura de ameaças.

9. CÓDIGO BASE E ESTRUTURA DE PROJETO
- Apresente a árvore de pastas recomendada e implementações de código limpas, bem comentadas e funcionais para os sistemas centrais (ex.: gerenciador de partida e zona segura, controlador de jogador/combate/dano e sistema de inventário/loot).
- Explique como expandir o código base para um jogo completo e jogável.

Escreva com profundidade técnica, clareza e organização. Evite resumos vagos: especifique regras, fórmulas ou estruturas de dados concretas sempre que possível.
