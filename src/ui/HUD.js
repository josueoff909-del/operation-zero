/**
 * HUD.js — Overlay de estado em DOM (Fases 1–2 → partida com bots).
 *
 * Mantém o painel de performance (FPS/ms/draw calls/qualidade) e ganha o que
 * uma partida jogável precisa: vida, munição/recarga, abates, vivos e o
 * tempo de partida, mais o feedback de acerto (hitmarker) e de dano
 * (vinheta). Regra da skill: o HUD **lê** estado, nunca escreve regra de jogo.
 *
 * Tudo é gravado no máximo ~10×/s (escrever DOM por frame custa layout no
 * Android); o hitmarker e o flash de dano são CSS com classe + tempo próprio.
 */
export class HUD {
  constructor() {
    this.fpsEl = document.getElementById('fps-value');
    this.msEl = document.getElementById('stat-ms');
    this.callsEl = document.getElementById('stat-calls');
    this.trisEl = document.getElementById('stat-tris');
    this.qualityEl = document.getElementById('stat-quality');
    this.posEl = document.getElementById('stat-pos');
    this.stateEl = document.getElementById('stat-state');

    this.healthFill = document.getElementById('health-fill');
    this.healthText = document.getElementById('health-text');
    this.ammoEl = document.getElementById('ammo-text');
    this.weaponEl = document.getElementById('ammo-weapon');
    this.reloadEl = document.getElementById('ammo-reload');
    this.killsEl = document.getElementById('stat-kills');
    this.aliveEl = document.getElementById('stat-alive');
    this.timeEl = document.getElementById('stat-time');
    this.hitmarkerEl = document.getElementById('hitmarker');
    this.damageEl = document.getElementById('damage-vignette');
    this.feedEl = document.getElementById('kill-feed');

    this._accum = 0;
    this._hitAt = -9;
    this._hitKills = 0;
    this._feed = [];
    this._feedWritten = 0;
  }

  /**
   * @param {number} dt
   * @param {{perf:object, render:object, player:object, combat:object|null, match:object|null, now:number}} s
   */
  update(dt, s) {
    if (s.hit) this.flashHit(s.hit, s.now); // mesmo relogio do Engine (s.now)
    if (s.damage) this.flashDamage(s.damage);

    this._accum += dt;
    if (this._accum < 0.1) return;
    this._accum = 0;

    const { perf, render, player, combat, match } = s;
    if (this.fpsEl) {
      this.fpsEl.textContent = `${perf.fps} FPS`;
      this.fpsEl.classList.toggle('low', perf.fps < 45);
    }
    if (this.msEl) this.msEl.textContent = `${perf.frameMs.toFixed(1)} ms`;
    if (this.callsEl) this.callsEl.textContent = String(render.calls);
    if (this.trisEl) this.trisEl.textContent = render.triangles.toLocaleString('pt-BR');
    if (this.qualityEl) this.qualityEl.textContent = perf.quality;
    if (this.posEl && player) {
      this.posEl.textContent = `${player.position.x.toFixed(0)}, ${player.position.z.toFixed(0)}`;
    }
    if (this.stateEl && player) this.stateEl.textContent = player.getState();

    if (player) {
      const ratio = Math.max(0, player.getHealthRatio());
      if (this.healthFill) this.healthFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
      if (this.healthText) this.healthText.textContent = `${Math.round(player.health)}`;
      if (this.healthFill) this.healthFill.classList.toggle('low', ratio < 0.35);
    }
    if (combat) {
      if (this.ammoEl) this.ammoEl.textContent = combat.getAmmoText();
      if (this.weaponEl) this.weaponEl.textContent = combat.weapon.label.toUpperCase();
      if (this.reloadEl) {
        const loading = combat.isReloading;
        this.reloadEl.classList.toggle('on', loading);
        if (loading) {
          const left = Math.max(0, combat.reloadEndsAt - combat.time);
          const pct = 1 - left / combat.weapon.reloadTime;
          this.reloadEl.style.transform = `scaleX(${pct.toFixed(3)})`;
        } else {
          this.reloadEl.style.transform = 'scaleX(0)';
        }
      }
    }
    if (match) {
      if (this.killsEl) this.killsEl.textContent = String(match.kills);
      if (this.aliveEl) this.aliveEl.textContent = `${match.alive}/${match.total}`;
      if (this.timeEl) this.timeEl.textContent = match.timeText;
    }
    // some com o hitmarker depois do tempo
    if (this.hitmarkerEl && this._hitAt >= 0 && (s.now - this._hitAt) > 0.14) {
      this.hitmarkerEl.classList.remove('on');
      this._hitAt = -1;
    }
  }

  /** hitmarker: X branco (acerto) / vermelho (kill) — fps-shooter skill. */
  flashHit(info, now = -1) {
    // _hitAt e comparado com `s.now` em update(): tem de ser o MESMO relogio,
    // senao o hitmarker nunca se apaga (agora do Engine vs performance.now()).
    this._hitAt = now >= 0 ? now : (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
    if (!this.hitmarkerEl) return;
    this.hitmarkerEl.classList.toggle('kill', !!info.killed);
    this.hitmarkerEl.classList.toggle('head', !!info.headshot);
    this.hitmarkerEl.classList.add('on');
    // reinicia a animação
    this.hitmarkerEl.style.animation = 'none';
    void this.hitmarkerEl.offsetWidth;
    this.hitmarkerEl.style.animation = '';
    if (info.killed) this._hitKills += 1;
  }

  /** vinheta de dano: intensidade proporcional ao que levou. */
  flashDamage(amount) {
    if (!this.damageEl) return;
    const k = Math.min(1, 0.35 + amount / 40);
    this.damageEl.style.opacity = String(k);
    this.damageEl.classList.add('on');
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => {
      if (this.damageEl) { this.damageEl.classList.remove('on'); this.damageEl.style.opacity = '0'; }
    }, 260);
  }

  /** kill feed: últimas 3 linhas ("VOCÊ eliminou Bia04 · HEADSHOT"). */
  pushFeed(line) {
    if (!this.feedEl) return;
    this._feed.unshift(line);
    if (this._feed.length > 3) this._feed.length = 3;
    this.feedEl.innerHTML = this._feed.map((l) => `<div class="feed-line">${l}</div>`).join('');
    this._feedWritten += 1;
  }

  clearFeed() {
    this._feed.length = 0;
    if (this.feedEl) this.feedEl.innerHTML = '';
  }

  /** Mostra/esconde o HUD de partida (no lobby só o painel de performance). */
  setMatchVisible(visible) {
    const el = document.getElementById('hud-match');
    if (el) el.classList.toggle('show', visible);
    const hud = document.getElementById('hud-top');
    if (hud) hud.classList.toggle('dim', !visible);
  }
}
