import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { applyConeSpread, damageAt, intersectCylinder } from '../utils/Hitbox.js';

/**
 * Combat.js — Tiro, dano e munição (Fase 4 antecipada no essencial).
 * Segue a skill `fps-shooter`:
 *
 * • **Arma é dado** (`Config.WEAPONS`): dano por banda de distância (falloff),
 *   multiplicador de cabeça/pernas, cadência, pente, recarga, spread,
 *   padrão de recuo FIXO (aprendível, não aleatório).
 * • **Cadência em relógio agendado** (Pattern 1): nunca "reset = agora";
 *   `while (nextShot <= now)` emite N balas num frame longo, e a fila é
 *   zerada quando o jogador fica parado (não "banca" tiro de bônus).
 * • **Spread** = cone amostrado no disco; cresce por tiro, com movimento e
 *   cai ao recuar; ADS reduz muito (arma precisa ao mirar).
 * • **Hitscan do olho**: raio parte da câmera; primeiro o mundo (cobertura),
 *   depois o alvo mais próximo — assim bala não atravessa parede.
 * • **Hitboxes**: cabeça / torso / pernas (utils/Hitbox).
 * • **Recarga** só pode começar no chão da cadência, cancela ao atirar? Não:
 *   atirar com pente vazio dispara a recarga automaticamente.
 *
 * Sem dano automático por frame: quem aplica é o `onHit` (HUD/hitmarker) e o
 * alvo (`bot.takeDamage` / `player.takeDamage`).
 */
export class Combat {
  /**
   * @param {{collision:object, getTargets:()=>object[], scene:THREE.Scene}} deps
   */
  constructor(deps) {
    this.collision = deps.collision;
    this.getTargets = deps.getTargets || (() => []);
    this.scene = deps.scene;

    this.weapon = Config.WEAPONS[Config.START_WEAPON];
    this.ammo = this.weapon.magazine;
    this.reserve = this.weapon.magazine * 4;
    this.nextShotAt = 0;
    this.time = 0;
    this.shotIndex = 0;
    this.spread = this.weapon.baseSpread;
    this.reloadEndsAt = -1;
    this.reloading = false;

    this.onShot = null;   // (shotInfo) => {}  — viewmodel/áudio
    this.onHit = null;    // (result) => {}    — HUD hitmarker/número
    this.onAmmoChange = null;

    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._rand = this._mulberry(987654321);
  }

  _mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  equip(id) {
    const w = Config.WEAPONS[id];
    if (!w) return false;
    this.weapon = w;
    this.ammo = w.magazine;
    this.reserve = w.magazine * 4;
    this.spread = w.baseSpread;
    this.cancelReload();
    if (this.onAmmoChange) this.onAmmoChange();
    return true;
  }

  get interval() {
    return 1 / this.weapon.fireRate;
  }

  get isEmpty() {
    return this.ammo <= 0;
  }

  get isReloading() {
    return this.reloading;
  }

  reload() {
    if (this.reloading || this.ammo >= this.weapon.magazine || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadEndsAt = this.time + this.weapon.reloadTime;
    return true;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadEndsAt = -1;
  }

  /** Zera o estado (novo round do lobby). */
  reset() {
    this.equip(Config.START_WEAPON);
    this.nextShotAt = 0;
    this.shotIndex = 0;
    this.cancelReload();
  }

  /**
   * Um tick de tiro. Chamado pelo Engine todo frame.
   * @param {number} dt
   * @param {{trigger:boolean, aiming:boolean, moving:boolean, player:object, camera:THREE.Camera}} st
   */
  update(dt, st) {
    this.time += dt;

    if (this.reloading && this.time >= this.reloadEndsAt) {
      const need = this.weapon.magazine - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.reloading = false;
      if (this.onAmmoChange) this.onAmmoChange();
    }

    // Recuperação do spread (skill: current = max(base, current - recover*dt))
    const w = this.weapon;
    this.spread = Math.max(w.baseSpread, this.spread - w.spreadRecover * dt);

    if (!st.trigger || !st.player.alive || this.reloading) {
      // Fila zerada quando para de atirar: sem "bônus" de balas no próximo gatilho.
      this.nextShotAt = 0;
      return;
    }

    if (this.isEmpty) {
      this.reload(); // pente vazio + gatilho = recarga automática
      return;
    }

    const now = this.time;
    if (this.nextShotAt === 0 || this.nextShotAt < now - this.interval) this.nextShotAt = now;
    let fired = 0;
    while (this.nextShotAt <= now && this.ammo > 0 && fired < 8) {
      this.fire(st);
      this.ammo -= 1;
      this.shotIndex += 1;
      this.nextShotAt += this.interval;
      fired += 1;
    }
    if (fired > 0) {
      if (this.onAmmoChange) this.onAmmoChange();
      if (this.isEmpty) this.reload();
    }
  }

  /** Dispara uma bala: spread → hitscan (mundo, depois alvo) → dano. */
  fire(st) {
    const w = this.weapon;
    const camera = st.camera;
    camera.getWorldPosition(this._origin);
    camera.getWorldDirection(this._dir);

    // --- Spread: cone, cresce por tiro, pune movimento, ADS afunila ---
    const pattern = w.recoilPattern[this.shotIndex % w.recoilPattern.length];
    const first = this.shotIndex === 0 || this.nextShotAt - this.interval < this.time - 0.25;
    let spreadRad = first ? this.spread * 0.35 : this.spread;
    if (st.moving) spreadRad += w.moveSpread * (st.aiming ? 0.5 : 1);
    if (st.aiming) spreadRad *= w.adsSpreadMult;
    const dir = applyConeSpread(this._dir, spreadRad, this._rand);

    // --- Recuo: padrão fixo em offset (Player decai sozinho) ---
    st.player.applyRecoil(pattern[0], pattern[1]);
    this.spread = Math.min(w.maxSpread, this.spread + w.spreadPerShot);

    // --- Alcance: o mundo primeiro (não dá p/ atirar através de parede) ---
    const coverDist = this.collision
      ? this.collision.rayDistance(
        this._origin.x, this._origin.z, this._origin.y,
        dir.x, dir.z, w.range, 0.5, dir.y,
      )
      : w.range;

    let hit = null;
    let bestT = coverDist;
    for (const target of this.getTargets()) {
      if (!target.alive || target.team === st.player.team) continue;
      const o = intersectCylinder(
        this._origin.x, this._origin.y, this._origin.z,
        dir.x, dir.y, dir.z,
        target.position.x, target.position.z, target.feetY ?? target.position.y,
        target.hitRadius, target.hitHeight,
      );
      if (o && o.t > 0.01 && o.t < bestT) {
        bestT = o.t;
        hit = { target, ...o };
      }
    }

    const impactDist = hit ? hit.t : coverDist;
    const shot = {
      origin: this._origin.clone(),
      dir: { ...dir },
      weapon: w.id,
      distance: impactDist,
      blocked: !hit && coverDist < w.range,
      impact: hit ? null : { x: this._origin.x + dir.x * coverDist, y: this._origin.y + dir.y * coverDist, z: this._origin.z + dir.z * coverDist },
    };
    if (this.onShot) this.onShot(shot, impactDist);

    if (!hit) {
      if (this.onHit) this.onHit({ miss: true, distance: impactDist });
      return shot;
    }

    // --- Dano: falloff por banda × multiplicador de hitbox ---
    const mult = hit.part === 'head' ? w.head : hit.part === 'legs' ? w.legs : 1;
    const damage = damageAt(w, hit.t) * mult;
    const result = hit.target.takeDamage(damage, hit.part, st.player.team, {
      part: hit.part, distance: hit.t, weapon: w.id,
      byPlayer: true, fromPosition: st.player.position, time: this.time,
    });
    const killed = !!(result && result.died);
    if (this.onHit) {
      this.onHit({
        miss: false, part: hit.part, damage, killed,
        headshot: hit.part === 'head', distance: hit.t,
        target: hit.target,
      });
    }
    shot.hit = hit;
    return shot;
  }

  getAmmoText() {
    return `${this.ammo}/${this.weapon.magazine} · ${this.reserve}`;
  }
}
