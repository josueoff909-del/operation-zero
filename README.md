# OPERATION ZERO

Battle royale em terceira pessoa de ritmo rápido (inspirado em Free Fire),
rodando no navegador mobile (Android) com **Three.js + WebGL 2**.

- **Especificação:** `GDD_MASTER.md`
- **Arquitetura:** `ARQUITETURA.md`
- **Progresso (14 fases):** `PROGRESSO.md`
- **Regras mobile:** `.agents/skills/threejs-android/SKILL.md`

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:5173` no desktop ou `http://<IP-do-PC>:5173` no celular
(mesma rede Wi-Fi). Build de produção: `npm run build` (pasta `dist/`).

## Status

**Fase 1 (atual):** arquitetura modular + protótipo 3D funcional —
iluminação (sol/sombra/céu/fog), terreno com relevo, vegetação instanciada,
controle FPS (teclado/mouse + joystick/touch) e monitor de FPS com qualidade
adaptativa. Fases 2–14 ainda não implementadas (ver `PROGRESSO.md`).
