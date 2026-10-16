/**
 * Core 60Hz Danmaku STG Engine for "Kagura of the Brass Astrolabe"
 * Coordinates: 720 x 960 logical arcade space.
 * Integrates:
 * - Player craft + 4 orbital Option Thuribles (Wide formation vs Focus locked forward formation)
 * - Graze Resonance system & Medal vacuum physics
 * - 5-Stage / Phase progression with instant Phase Jump (`jumpToPhase(0..4)`)
 * - Hierarchical 11-part BossRig with destructible wings & rotary cannon turrets
 * - Dynamic WebGL2 point light population (up to 16 active lights per frame)
 * - Photosensitivity-safe Bomb Ward & Phase Transitions (expanding golden astrolabe rings, zero flashes)
 */

import { BossRig } from "../render/boss_rig.js";

// Bullet shape constants matching FS_BULLET
const SHAPE_ORB = 0;
const SHAPE_NEEDLE = 1;
const SHAPE_OFUDA = 2;
const SHAPE_PETAL = 3;
const SHAPE_STAR = 4;
const SHAPE_LASER = 5;
const SHAPE_SPARK = 6;
const SHAPE_WARD = 7;

// Palette indices matching FS_BULLET (0=Vermilion, 1=AmberGold, 2=Jade, 3=CrimsonPlum, 4=SunBrass, 5=CopperOrange, 6=Ivory)
const PAL_VERMILION = 0;
const PAL_AMBER = 1;
const PAL_JADE = 2;
const PAL_CRIMSON = 3;
const PAL_BRASS = 4;
const PAL_COPPER = 5;
const PAL_IVORY = 6;

export const PHASE_METADATA = [
  {
    id: 0,
    shortName: "Stage",
    title: "第一幕：黒曜水路",
    subtitle: "水路アプローチ",
  },
  {
    id: 1,
    shortName: "Midboss",
    title: "中ボス：広目カラクリ守護機",
    subtitle: "四重真鍮輪の番人",
  },
  {
    id: 2,
    shortName: "Boss I",
    title: "天球律「黄金周転円」",
    subtitle: "天照カラクリ大御神・第一形態",
  },
  {
    id: 3,
    shortName: "Boss II",
    title: "開帳「翡翠と朱の曼荼羅」",
    subtitle: "天照カラクリ大御神・装甲開帳",
  },
  {
    id: 4,
    shortName: "Final",
    title: "終焉神楽「常世の日輪・大祝詞」",
    subtitle: "天照カラクリ大御神・最終神楽",
  },
];

export class GameEngine {
  constructor(compositor, sound, callbacks = {}) {
    this.compositor = compositor;
    this.sound = sound;
    this.callbacks = callbacks;

    this.bossRig = new BossRig();
    this.additiveData = new Float32Array(10000 * 8);

    this.immortalMode = true; // Default ON for Visual Demo showcase
    this.resetGame();
  }

  resetGame() {
    this.time = 0;
    this.scrollY = 0;
    this.bgBlend = 0;
    this.targetBgBlend = 0;

    this.score = 0;
    this.graze = 0;
    this.multiplier = 1.0;
    this.lives = 3;
    this.bombs = 3;
    this.bombGauge = 0; // 0..100 (fills via grazing & medals)

    this.player = {
      x: 360,
      y: 810,
      focus: false,
      invulnTimer: 0,
      shotCooldown: 0,
      optionAngle: 0,
      options: [
        { x: 310, y: 830 },
        { x: 410, y: 830 },
        { x: 270, y: 850 },
        { x: 450, y: 850 },
      ],
    };

    this.enemies = [];
    this.playerBullets = [];
    this.enemyBullets = [];
    this.items = [];
    this.particles = [];
    this.wardRings = [];

    this.bossActive = false;
    this.bossHp = 0;
    this.bossMaxHp = 1;
    this.bossPhase = 0; // 0=Stage, 1=Midboss, 2=BossP1, 3=BossP2, 4=BossP3
    this.phaseTimer = 0;
    this.waveStep = 0;
    this.waveClearTimer = 0;

    this.mandalaAlpha = 0;
    this.mandalaX = 360;
    this.mandalaY = 240;
    this.mandalaRot = 0;

    this.jumpToPhase(0);
  }

  jumpToPhase(phaseIdx, fromDefeat = false) {
    this.bossPhase = phaseIdx;
    this.phaseTimer = 0;
    this.waveStep = 0;
    this.waveClearTimer = 0;

    // Convert existing enemy bullets into golden starlight medals smoothly
    this.cancelAllBulletsToMedals(fromDefeat);
    this.enemies = [];

    if (phaseIdx === 0) {
      // Stage Wave 1
      this.bossActive = false;
      this.targetBgBlend = 0.0;
      this.spawnStageWave(0);
    } else if (phaseIdx === 1) {
      // Midboss Koumoku Guardian
      this.bossActive = false;
      this.targetBgBlend = 0.0;
      this.spawnMidboss();
      this.sound.playSpellDeclare();
    } else {
      // Main Boss Phase 1, 2, or 3
      this.bossActive = true;
      const pNum = phaseIdx - 1; // 1, 2, or 3
      if (pNum === 1) {
        this.bossRig.reset();
        this.bossRig.x = 360;
        this.bossRig.y = -140;
      } else {
        this.bossRig.x = 360;
        this.bossRig.y = 225;
      }
      this.bossRig.targetX = 360;
      this.bossRig.targetY = 225;
      this.bossRig.phase = pNum;

      this.bossMaxHp = pNum === 1 ? 12500 : pNum === 2 ? 15500 : 19000;
      this.bossHp = this.bossMaxHp;
      this.targetBgBlend = pNum >= 2 ? 1.0 : 0.0;

      // Visual golden astrolabe ring on phase start (does not eat newly fired boss bullets)
      this.spawnWardRing(this.bossRig.x, Math.max(180, this.bossRig.y), 420, PAL_AMBER, 0.95, false);
      this.sound.playSpellDeclare();

      if (this.callbacks.onCutIn) {
        this.callbacks.onCutIn(PHASE_METADATA[phaseIdx]);
      }
    }

    if (this.callbacks.onPhaseChange) {
      this.callbacks.onPhaseChange(PHASE_METADATA[phaseIdx]);
    }
  }

  triggerBomb() {
    if (this.bombs <= 0 && this.bombGauge < 100) return;
    if (this.bombs > 0) {
      this.bombs--;
    } else {
      this.bombGauge = 0;
    }
    this.player.invulnTimer = Math.max(this.player.invulnTimer, 3.2);
    this.sound.playBombWard();

    // Expanding double golden astrolabe ward ring from player (cancels bullets to medals!)
    this.spawnWardRing(this.player.x, this.player.y, 820, PAL_AMBER, 1.25, true);
    this.spawnWardRing(this.player.x, this.player.y, 540, PAL_JADE, 0.95, true);
  }

  spawnWardRing(x, y, maxRadius, palette = PAL_AMBER, duration = 1.0, cancelBullets = false) {
    this.wardRings.push({
      x,
      y,
      r: 24,
      maxR: maxRadius,
      palette,
      age: 0,
      duration,
      cancelBullets,
    });
  }

  cancelAllBulletsToMedals(vacuumImmediately = true) {
    for (let i = 0; i < this.enemyBullets.length; i++) {
      const b = this.enemyBullets[i];
      if (i % 2 === 0 && this.items.length < 450) {
        this.items.push({
          key: "item_medal",
          x: b.x,
          y: b.y,
          vx: (Math.random() - 0.5) * 65,
          vy: -85 - Math.random() * 60,
          rot: Math.random() * 6.28,
          vacuum: vacuumImmediately,
        });
      }
      this.spawnSpark(b.x, b.y, b.palette, 18);
    }
    this.enemyBullets.length = 0;
  }

  spawnSpark(x, y, palette = PAL_AMBER, size = 16, vx = 0, vy = 0, life = 0.35) {
    if (this.particles.length >= 1500) return;
    this.particles.push({
      x,
      y,
      vx: vx + (Math.random() - 0.5) * 90,
      vy: vy + (Math.random() - 0.5) * 90,
      size,
      palette,
      age: 0,
      life,
    });
  }

  fireEnemyBullet(x, y, vx, vy, shape = SHAPE_ORB, palette = PAL_VERMILION, rx = 11, ry = 11, extra = {}) {
    if (this.enemyBullets.length >= 5500) return;
    this.enemyBullets.push({
      x,
      y,
      vx,
      vy,
      rx,
      ry,
      shape,
      palette,
      grazed: false,
      age: 0,
      angVel: extra.angVel || 0,
      accel: extra.accel || 0,
      curve: extra.curve || 0,
    });
  }

  fireRibbonLaser(x, y, angle, speed, segments = 10, palette = PAL_AMBER, curve = 0) {
    for (let i = 0; i < segments; i++) {
      const s = speed * (1.0 - i * 0.028);
      this.fireEnemyBullet(
        x - Math.cos(angle) * i * 9,
        y - Math.sin(angle) * i * 9,
        Math.cos(angle) * s,
        Math.sin(angle) * s,
        SHAPE_LASER,
        palette,
        9,
        20,
        { curve }
      );
    }
  }

  spawnStageWave(step) {
    if (step === 0) {
      // Left & Right streams of Vermilion Swallow Scouts + Jade Relic Pylons
      for (let i = 0; i < 6; i++) {
        this.enemies.push({
          key: "enemy_scout_a",
          x: 110 + i * 32,
          y: -40 - i * 58,
          vx: 38,
          vy: 145,
          hp: 26,
          maxHp: 26,
          radius: 26,
          timer: i * 0.25,
          pattern: "swallow_arc_r",
          hitTint: 0,
        });
        this.enemies.push({
          key: "enemy_scout_a",
          x: 610 - i * 32,
          y: -40 - i * 58,
          vx: -38,
          vy: 145,
          hp: 26,
          maxHp: 26,
          radius: 26,
          timer: i * 0.25,
          pattern: "swallow_arc_l",
          hitTint: 0,
        });
      }
      this.enemies.push({
        key: "enemy_turret_med",
        x: 210,
        y: -70,
        vx: 0,
        vy: 85,
        hp: 260,
        maxHp: 260,
        radius: 44,
        timer: 0,
        pattern: "tri_bastion",
        hitTint: 0,
      });
      this.enemies.push({
        key: "enemy_turret_med",
        x: 510,
        y: -70,
        vx: 0,
        vy: 85,
        hp: 260,
        maxHp: 260,
        radius: 44,
        timer: 0.4,
        pattern: "tri_bastion",
        hitTint: 0,
      });
    } else if (step === 1) {
      // Four-Blade Jade Spinners + Twin Shrine Barges
      for (let i = 0; i < 5; i++) {
        this.enemies.push({
          key: "enemy_scout_b",
          x: 130 + i * 115,
          y: -50 - (i % 2) * 45,
          vx: 0,
          vy: 120,
          hp: 48,
          maxHp: 48,
          radius: 28,
          rotSpeed: 3.5,
          timer: i * 0.2,
          pattern: "jade_spinner",
          hitTint: 0,
        });
      }
      this.enemies.push({
        key: "enemy_barge_med",
        x: 180,
        y: -90,
        vx: 0,
        vy: 75,
        hp: 340,
        maxHp: 340,
        radius: 48,
        timer: 0,
        pattern: "shrine_barge",
        hitTint: 0,
      });
      this.enemies.push({
        key: "enemy_barge_med",
        x: 540,
        y: -90,
        vx: 0,
        vy: 75,
        hp: 340,
        maxHp: 340,
        radius: 48,
        timer: 0.5,
        pattern: "shrine_barge",
        hitTint: 0,
      });
    } else if (step === 2) {
      // Heavy Lamellar Shrine Carrier + 2 Relic Pylons
      this.enemies.push({
        key: "enemy_carrier_heavy",
        x: 360,
        y: -110,
        vx: 0,
        vy: 68,
        hp: 780,
        maxHp: 780,
        radius: 62,
        timer: 0,
        pattern: "heavy_carrier",
        hitTint: 0,
      });
      for (const rx of [145, 575]) {
        this.enemies.push({
          key: "relic_node",
          x: rx,
          y: -60,
          vx: 0,
          vy: 90,
          hp: 220,
          maxHp: 220,
          radius: 36,
          rotSpeed: -1.8,
          timer: 0,
          pattern: "relic_pylon",
          hitTint: 0,
        });
      }
    }
  }

  spawnMidboss() {
    this.enemies.push({
      key: "midboss_koumoku",
      isMidboss: true,
      x: 360,
      y: -100,
      vx: 0,
      vy: 120,
      hp: 5400,
      maxHp: 5400,
      radius: 64,
      timer: 0,
      pattern: "midboss_koumoku",
      hitTint: 0,
    });
    for (const rx of [160, 560]) {
      this.enemies.push({
        key: "relic_node",
        x: rx,
        y: -70,
        vx: 0,
        vy: 110,
        hp: 520,
        maxHp: 520,
        radius: 38,
        rotSpeed: 2.2,
        timer: 0,
        pattern: "relic_pylon",
        hitTint: 0,
      });
    }
  }

  update(dt, input) {
    this.time += dt;
    this.scrollY += dt * (this.bossActive ? 0.55 : 0.85);
    this.bgBlend += (this.targetBgBlend - this.bgBlend) * Math.min(1, dt * 1.6);
    this.phaseTimer += dt;
    this.mandalaRot += dt * 0.45;

    // 1. Update Player Movement (iPad relative touch delta + keyboard)
    const p = this.player;
    p.focus = input.isFocus;
    const moveSpeed = p.focus ? 210 : 430;
    p.x += input.kbX * moveSpeed * dt + input.dragDX;
    p.y += input.kbY * moveSpeed * dt + input.dragDY;
    p.x = Math.max(34, Math.min(686, p.x));
    p.y = Math.max(54, Math.min(916, p.y));

    if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);

    // Update 4 Option Thuribles (Wide arc vs Focus forward lock)
    p.optionAngle += dt * 3.8;
    const optOffsetsWide = [
      { dx: -58, dy: 16 },
      { dx: 58, dy: 16 },
      { dx: -98, dy: 38 },
      { dx: 98, dy: 38 },
    ];
    const optOffsetsFocus = [
      { dx: -24, dy: -36 },
      { dx: 24, dy: -36 },
      { dx: -48, dy: -18 },
      { dx: 48, dy: -18 },
    ];
    const targetOffsets = p.focus ? optOffsetsFocus : optOffsetsWide;
    for (let i = 0; i < 4; i++) {
      const tx = p.x + targetOffsets[i].dx;
      const ty = p.y + targetOffsets[i].dy;
      p.options[i].x += (tx - p.options[i].x) * Math.min(1, dt * 15.0);
      p.options[i].y += (ty - p.options[i].y) * Math.min(1, dt * 15.0);
    }

    if (input.bomb) {
      this.triggerBomb();
    }

    // 2. Player Shooting (Focus rewards +36% concentrated single-target DPS instead of item vacuum)
    p.shotCooldown -= dt;
    if (input.isFiring && p.shotCooldown <= 0) {
      p.shotCooldown = 0.065;
      this.sound.playShot(p.focus);
      // Main twin brass needles
      this.playerBullets.push({ x: p.x - 12, y: p.y - 24, vx: 0, vy: -1180, dmg: 8, palette: PAL_AMBER });
      this.playerBullets.push({ x: p.x + 12, y: p.y - 24, vx: 0, vy: -1180, dmg: 8, palette: PAL_AMBER });

      // Option shots (penetrating forward lances in Focus, wide coverage in Normal)
      for (let i = 0; i < 4; i++) {
        const opt = p.options[i];
        const spreadAng = p.focus ? (i - 1.5) * 0.02 : (i - 1.5) * 0.11;
        this.playerBullets.push({
          x: opt.x,
          y: opt.y - 12,
          vx: Math.sin(spreadAng) * 1050,
          vy: -Math.cos(spreadAng) * 1050,
          dmg: p.focus ? 7.5 : 4.5,
          palette: p.focus ? PAL_VERMILION : PAL_JADE,
        });
      }
    }

    // 3. Stage Progression & Spawning (advances immediately when wave is cleared)
    if (this.bossPhase === 0) {
      if (this.enemies.length === 0) {
        this.waveClearTimer += dt;
      } else {
        this.waveClearTimer = 0;
      }
      if ((this.phaseTimer > 6.5 || this.waveClearTimer > 0.65) && this.waveStep === 0) {
        this.waveStep = 1;
        this.waveClearTimer = 0;
        this.spawnStageWave(1);
      } else if ((this.phaseTimer > 13.5 || this.waveClearTimer > 0.65) && this.waveStep === 1) {
        this.waveStep = 2;
        this.waveClearTimer = 0;
        this.spawnStageWave(2);
      } else if (this.phaseTimer > 22.0 || (this.waveStep === 2 && this.waveClearTimer > 0.65)) {
        this.jumpToPhase(1);
      }
    } else if (this.bossPhase === 1) {
      // Midboss active
      const mb = this.enemies.find((e) => e.isMidboss);
      if (mb) {
        this.mandalaAlpha = Math.min(0.65, this.mandalaAlpha + dt * 1.2);
        this.mandalaX = mb.x;
        this.mandalaY = mb.y;
      } else if (this.phaseTimer > 1.5) {
        this.jumpToPhase(2);
      }
    } else if (this.bossActive) {
      this.mandalaAlpha = Math.min(0.85, this.mandalaAlpha + dt * 1.2);
      this.mandalaX = this.bossRig.x;
      this.mandalaY = this.bossRig.y;
      this._updateMainBoss(dt);
    }

    if (!this.bossActive && !this.enemies.some((e) => e.isMidboss)) {
      this.mandalaAlpha = Math.max(0, this.mandalaAlpha - dt * 1.5);
    }

    // 4. Update Enemies
    this._updateEnemies(dt);

    // 5. Update Player Bullets & Collisions
    this._updatePlayerBullets(dt);

    // 6. Update Ward Rings (Bomb / Phase Cancel Waves)
    this._updateWardRings(dt);

    // 7. Update Enemy Bullets, Grazing & Hit Detection
    this._updateEnemyBullets(dt);

    // 8. Update Collectible Medals & Items
    this._updateItems(dt);

    // 9. Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.age += dt;
      if (pt.age >= pt.life) {
        this.particles.splice(i, 1);
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
  }

  _updateMainBoss(dt) {
    const pNum = this.bossPhase - 1; // 1, 2, 3
    const t = this.phaseTimer;

    // Smooth figure-8 drift across upper sanctum
    this.bossRig.targetX = 360 + Math.sin(t * 0.58) * 105;
    this.bossRig.targetY = 215 + Math.cos(t * 1.15) * 24;
    this.bossRig.update(dt, this.player.x, this.player.y, pNum);

    const muzzles = this.bossRig.getMuzzlePositions();
    const prevTick = Math.floor((t - dt) * 60);
    const currTick = Math.floor(t * 60);
    if (currTick === prevTick) return;

    if (pNum === 1) {
      // PHASE 1: "Astrolabe Gear — Golden Epicycle"
      // Wingtips fire counter-rotating brass & vermilion spirals with clear dodging lanes
      if (currTick % 9 === 0) {
        const baseAng = t * 1.85;
        for (let k = 0; k < 5; k++) {
          const aL = baseAng + (k * Math.PI * 2) / 5;
          const aR = -baseAng + (k * Math.PI * 2) / 5;
          if (!this.bossRig.parts.leftWing.destroyed) {
            this.fireEnemyBullet(
              muzzles.leftWingTip.x,
              muzzles.leftWingTip.y,
              Math.cos(aL) * 175,
              Math.sin(aL) * 175,
              SHAPE_PETAL,
              PAL_AMBER,
              10,
              14,
              { curve: 0.18 }
            );
          }
          if (!this.bossRig.parts.rightWing.destroyed) {
            this.fireEnemyBullet(
              muzzles.rightWingTip.x,
              muzzles.rightWingTip.y,
              Math.cos(aR) * 175,
              Math.sin(aR) * 175,
              SHAPE_PETAL,
              PAL_VERMILION,
              10,
              14,
              { curve: -0.18 }
            );
          }
        }
      }
      // Shoulder rotary cannons fire aimed crimson kunai volleys with mechanical barrel recoil
      if (currTick % 54 === 0) {
        for (const side of ["leftTurret", "rightTurret"]) {
          if (this.bossRig.parts[side].destroyed) continue;
          const mz = muzzles[side];
          this.bossRig.triggerTurretRecoil(side === "leftTurret" ? "left" : "right", 14);
          for (let j = -2; j <= 2; j++) {
            const ang = mz.angle + j * 0.12;
            this.fireEnemyBullet(
              mz.x,
              mz.y,
              Math.cos(ang) * 255,
              Math.sin(ang) * 255,
              SHAPE_NEEDLE,
              PAL_VERMILION,
              8,
              17
            );
          }
        }
      }
      // Central astrolabe ring emits 12-way golden sun orbs
      if (currTick % 96 === 0) {
        const offset = t * 0.65;
        for (let i = 0; i < 12; i++) {
          const ang = offset + (i * Math.PI * 2) / 12;
          this.fireEnemyBullet(
            muzzles.core.x,
            muzzles.core.y,
            Math.cos(ang) * 155,
            Math.sin(ang) * 155,
            SHAPE_ORB,
            PAL_BRASS,
            14,
            14
          );
        }
      }
    } else if (pNum === 2) {
      // PHASE 2: "Unsealed Sanctum — Jade & Vermilion Mandala"
      // Sweeping curved ribbon lasers from unsealed core + 4-fold talisman streams
      if (currTick % 64 === 0) {
        const base = t * 0.85;
        for (let k = 0; k < 6; k++) {
          const ang = base + (k * Math.PI * 2) / 6;
          this.fireRibbonLaser(muzzles.core.x, muzzles.core.y, ang, 220, 8, k % 2 === 0 ? PAL_JADE : PAL_AMBER, k % 2 === 0 ? 0.25 : -0.25);
        }
      }
      if (currTick % 10 === 0) {
        const a = t * 2.5;
        for (let k = 0; k < 4; k++) {
          const ang = a + (k * Math.PI) / 2;
          this.fireEnemyBullet(
            muzzles.thirdEye.x,
            muzzles.thirdEye.y,
            Math.cos(ang) * 190,
            Math.sin(ang) * 190,
            SHAPE_OFUDA,
            k % 2 === 0 ? PAL_VERMILION : PAL_JADE,
            10,
            15,
            { curve: 0.14 * (k % 2 === 0 ? 1 : -1) }
          );
        }
      }
      // Tail pendulum swings and releases jade star wheels
      if (currTick % 42 === 0) {
        const aim = Math.atan2(this.player.y - muzzles.tailTip.y, this.player.x - muzzles.tailTip.x);
        for (let j = -2; j <= 2; j++) {
          const ang = aim + j * 0.18;
          this.fireEnemyBullet(
            muzzles.tailTip.x,
            muzzles.tailTip.y,
            Math.cos(ang) * 195,
            Math.sin(ang) * 195,
            SHAPE_STAR,
            PAL_JADE,
            13,
            13
          );
        }
      }
    } else {
      // PHASE 3: "Kagura of the Eternal Sun-Wheel" (Grand Finale)
      if (currTick % 8 === 0) {
        const spin1 = t * 2.8;
        const spin2 = -t * 2.1;
        for (let k = 0; k < 6; k++) {
          const a1 = spin1 + (k * Math.PI * 2) / 6;
          const a2 = spin2 + (k * Math.PI * 2) / 6;
          this.fireEnemyBullet(
            muzzles.core.x,
            muzzles.core.y,
            Math.cos(a1) * 185,
            Math.sin(a1) * 185,
            SHAPE_PETAL,
            PAL_AMBER,
            10,
            15,
            { curve: 0.22 }
          );
          this.fireEnemyBullet(
            muzzles.core.x,
            muzzles.core.y,
            Math.cos(a2) * 165,
            Math.sin(a2) * 165,
            SHAPE_OFUDA,
            PAL_CRIMSON,
            10,
            14,
            { curve: -0.22 }
          );
        }
      }
      if (currTick % 80 === 0) {
        // Grand 14-way Solar Wheel ring
        for (let i = 0; i < 14; i++) {
          const ang = t * 0.4 + (i * Math.PI * 2) / 14;
          this.fireEnemyBullet(
            muzzles.core.x,
            muzzles.core.y,
            Math.cos(ang) * 150,
            Math.sin(ang) * 150,
            SHAPE_ORB,
            i % 2 === 0 ? PAL_VERMILION : PAL_BRASS,
            15,
            15
          );
        }
      }
    }
  }

  _updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.timer += dt;
      if (e.hitTint > 0) e.hitTint = Math.max(0, e.hitTint - dt * 5.0);
      if (e.rotSpeed) e.rot = (e.rot || 0) + e.rotSpeed * dt;

      if (e.pattern === "swallow_arc_r") {
        e.vx += 45 * dt;
        e.vy -= 22 * dt;
        e.rot = Math.atan2(e.vy, e.vx) - Math.PI * 0.5;
        if (Math.floor(e.timer * 10) !== Math.floor((e.timer - dt) * 10) && Math.floor(e.timer * 10) % 7 === 0 && e.y > 20) {
          const aim = Math.atan2(this.player.y - e.y, this.player.x - e.x);
          this.fireEnemyBullet(e.x, e.y, Math.cos(aim) * 230, Math.sin(aim) * 230, SHAPE_NEEDLE, PAL_VERMILION, 8, 16);
        }
      } else if (e.pattern === "swallow_arc_l") {
        e.vx -= 45 * dt;
        e.vy -= 22 * dt;
        e.rot = Math.atan2(e.vy, e.vx) - Math.PI * 0.5;
        if (Math.floor(e.timer * 10) !== Math.floor((e.timer - dt) * 10) && Math.floor(e.timer * 10) % 7 === 0 && e.y > 20) {
          const aim = Math.atan2(this.player.y - e.y, this.player.x - e.x);
          this.fireEnemyBullet(e.x, e.y, Math.cos(aim) * 230, Math.sin(aim) * 230, SHAPE_NEEDLE, PAL_VERMILION, 8, 16);
        }
      } else if (e.pattern === "tri_bastion" || e.pattern === "shrine_barge") {
        if (e.y > 190) e.vy *= 0.92;
        if (e.timer > 7.5) e.vy -= 85 * dt;
        const tick = Math.floor(e.timer * 20);
        const prev = Math.floor((e.timer - dt) * 20);
        if (tick !== prev && tick % 14 === 0 && e.y > 40) {
          const aim = Math.atan2(this.player.y - e.y, this.player.x - e.x);
          for (let k = -2; k <= 2; k++) {
            const a = aim + k * 0.22;
            this.fireEnemyBullet(
              e.x,
              e.y + 24,
              Math.cos(a) * 195,
              Math.sin(a) * 195,
              e.pattern === "tri_bastion" ? SHAPE_ORB : SHAPE_OFUDA,
              PAL_AMBER,
              12,
              12
            );
          }
        }
      } else if (e.pattern === "jade_spinner" || e.pattern === "relic_pylon") {
        if (e.y > 230 && e.pattern === "relic_pylon") e.vy *= 0.9;
        const tick = Math.floor(e.timer * 20);
        const prev = Math.floor((e.timer - dt) * 20);
        if (tick !== prev && tick % 10 === 0 && e.y > 30) {
          for (let k = 0; k < 4; k++) {
            const a = (e.rot || 0) + (k * Math.PI) / 2;
            this.fireEnemyBullet(e.x, e.y, Math.cos(a) * 175, Math.sin(a) * 175, SHAPE_STAR, PAL_JADE, 11, 11);
          }
        }
      } else if (e.pattern === "heavy_carrier") {
        if (e.y > 200) e.vy *= 0.9;
        const tick = Math.floor(e.timer * 30);
        const prev = Math.floor((e.timer - dt) * 30);
        if (tick !== prev && tick % 12 === 0 && e.y > 50) {
          for (let k = 0; k < 10; k++) {
            const a = e.timer * 1.4 + (k * Math.PI * 2) / 10;
            this.fireEnemyBullet(e.x, e.y, Math.cos(a) * 185, Math.sin(a) * 185, SHAPE_PETAL, PAL_VERMILION, 11, 15, {
              curve: 0.18,
            });
          }
        }
      } else if (e.pattern === "midboss_koumoku") {
        if (e.y > 235) {
          e.vy = 0;
          e.x = 360 + Math.sin(e.timer * 0.9) * 125;
        }
        const tick = Math.floor(e.timer * 60);
        const prev = Math.floor((e.timer - dt) * 60);
        if (tick !== prev) {
          if (tick % 8 === 0) {
            for (let k = 0; k < 6; k++) {
              const a = e.timer * 2.4 + (k * Math.PI * 2) / 6;
              this.fireEnemyBullet(
                e.x,
                e.y,
                Math.cos(a) * 205,
                Math.sin(a) * 205,
                SHAPE_OFUDA,
                k % 2 === 0 ? PAL_JADE : PAL_AMBER,
                11,
                15,
                { curve: k % 2 === 0 ? 0.2 : -0.2 }
              );
            }
          }
          if (tick % 50 === 0) {
            const aim = Math.atan2(this.player.y - e.y, this.player.x - e.x);
            for (let j = -4; j <= 4; j++) {
              const a = aim + j * 0.14;
              this.fireEnemyBullet(e.x, e.y + 20, Math.cos(a) * 255, Math.sin(a) * 255, SHAPE_ORB, PAL_VERMILION, 14, 14);
            }
          }
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      if (e.x < -120 || e.x > 840 || e.y < -180 || e.y > 1080) {
        this.enemies.splice(i, 1);
      }
    }
  }

  _updatePlayerBullets(dt) {
    for (let i = this.playerBullets.length - 1; i >= 0; i--) {
      const b = this.playerBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.y < -40 || b.x < -40 || b.x > 760) {
        this.playerBullets.splice(i, 1);
        continue;
      }

      let hit = false;

      // Check Main Boss Multi-Part Hitboxes
      if (this.bossActive) {
        const boxes = this.bossRig.getHitboxes();
        for (const box of boxes) {
          const dx = b.x - box.x;
          const dy = b.y - box.y;
          if (dx * dx + dy * dy < box.r * box.r) {
            hit = true;
            this.score += Math.floor(25 * this.multiplier);
            this.spawnSpark(b.x, b.y, b.palette, 15, (Math.random() - 0.5) * 140, 80, 0.22);

            if (box.id === "core") {
              this.bossHp -= b.dmg;
              this.bossRig.parts.core.hitTint = 0.65;
            } else {
              const part = this.bossRig.parts[box.id];
              part.hp -= b.dmg;
              part.hitTint = 0.75;
              this.bossHp -= b.dmg * 0.45;
              if (part.hp <= 0 && !part.destroyed) {
                part.destroyed = true;
                this.sound.playExplosion(true);
                this.score += Math.floor(250000 * this.multiplier);
                this.spawnWardRing(box.x, box.y, 260, PAL_BRASS, 0.75);
                for (let m = 0; m < 18; m++) {
                  this.items.push({
                    key: m % 5 === 0 ? "item_power" : "item_medal",
                    x: box.x + (Math.random() - 0.5) * 50,
                    y: box.y + (Math.random() - 0.5) * 50,
                    vx: (Math.random() - 0.5) * 160,
                    vy: -140 - Math.random() * 120,
                    rot: Math.random() * 6.28,
                    vacuum: false,
                  });
                }
              }
            }

            if (this.bossHp <= 0) {
              this.sound.playExplosion(true);
              this.score += Math.floor(500000 * this.multiplier);
              if (this.bossPhase < 4) {
                this.jumpToPhase(this.bossPhase + 1, true);
              } else {
                // Loop back to Phase 2 with Victory medal shower
                this.jumpToPhase(2, true);
              }
            }
            break;
          }
        }
      }

      // Check Regular Enemies & Midboss
      if (!hit) {
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          if (dx * dx + dy * dy < e.radius * e.radius) {
            hit = true;
            e.hp -= b.dmg;
            e.hitTint = 0.75;
            this.score += Math.floor(20 * this.multiplier);
            this.spawnSpark(b.x, b.y, PAL_AMBER, 14, 0, 60, 0.2);

            if (e.hp <= 0) {
              this.sound.playExplosion(e.isMidboss || e.maxHp >= 250);
              const medalCount = e.isMidboss ? 36 : e.maxHp >= 200 ? 10 : 3;
              for (let m = 0; m < medalCount; m++) {
                this.items.push({
                  key: m === 0 && e.maxHp >= 220 ? (e.isMidboss ? "item_bomb" : "item_power") : "item_medal",
                  x: e.x + (Math.random() - 0.5) * 36,
                  y: e.y + (Math.random() - 0.5) * 36,
                  vx: (Math.random() - 0.5) * 140,
                  vy: -110 - Math.random() * 90,
                  rot: Math.random() * 6.28,
                  vacuum: e.isMidboss,
                });
              }
              this.spawnWardRing(e.x, e.y, e.isMidboss ? 480 : 140, PAL_AMBER, e.isMidboss ? 1.1 : 0.45);
              if (e.isMidboss) {
                this.cancelAllBulletsToMedals(true);
              }
              this.enemies.splice(j, 1);
            }
            break;
          }
        }
      }

      if (hit) {
        this.playerBullets.splice(i, 1);
      }
    }
  }

  _updateWardRings(dt) {
    for (let i = this.wardRings.length - 1; i >= 0; i--) {
      const w = this.wardRings[i];
      w.age += dt;
      if (w.age >= w.duration) {
        this.wardRings.splice(i, 1);
        continue;
      }
      const prog = 1.0 - Math.pow(1.0 - w.age / w.duration, 2.2);
      w.r = 24 + (w.maxR - 24) * prog;

      // Cancel enemy bullets inside expanding ward ring when cancelBullets is true
      if (w.cancelBullets) {
        const r2 = w.r * w.r;
        for (let j = this.enemyBullets.length - 1; j >= 0; j--) {
          const b = this.enemyBullets[j];
          const dx = b.x - w.x;
          const dy = b.y - w.y;
          if (dx * dx + dy * dy <= r2) {
            if (this.items.length < 450 && j % 2 === 0) {
              this.items.push({
                key: "item_medal",
                x: b.x,
                y: b.y,
                vx: 0,
                vy: -60,
                rot: 0,
                vacuum: true,
              });
            }
            this.spawnSpark(b.x, b.y, w.palette, 16);
            this.enemyBullets.splice(j, 1);
          }
        }
      }
    }
  }

  _updateEnemyBullets(dt) {
    const px = this.player.x;
    const py = this.player.y;
    const hitR2 = 4.2 * 4.2; // Crisp 4.2px Danmaku core hitbox
    const grazeR2 = 34.0 * 34.0;

    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.age += dt;

      if (b.curve !== 0) {
        const c = Math.cos(b.curve * dt);
        const s = Math.sin(b.curve * dt);
        const nvx = b.vx * c - b.vy * s;
        const nvy = b.vx * s + b.vy * c;
        b.vx = nvx;
        b.vy = nvy;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x < -60 || b.x > 780 || b.y < -60 || b.y > 1020) {
        this.enemyBullets.splice(i, 1);
        continue;
      }

      const dx = b.x - px;
      const dy = b.y - py;
      const d2 = dx * dx + dy * dy;

      // Graze check
      if (!b.grazed && d2 < grazeR2) {
        b.grazed = true;
        this.graze++;
        this.multiplier = Math.min(9.99, this.multiplier + 0.02);
        this.bombGauge = Math.min(100, this.bombGauge + 1.2);
        this.score += Math.floor(350 * this.multiplier);
        this.sound.playGraze();
        this.spawnSpark(px + dx * 0.5, py + dy * 0.5, PAL_AMBER, 16, -b.vx * 0.25, -b.vy * 0.25, 0.25);
      }

      // Hitbox check
      if (d2 < hitR2 && this.player.invulnTimer <= 0) {
        this.player.invulnTimer = 2.6;
        // Clear immediate danger radius around player with a thin vermilion ring
        this.spawnWardRing(px, py, 240, PAL_VERMILION, 0.65, true);
        this.sound.playBombWard();
        if (!this.immortalMode) {
          this.lives--;
          this.multiplier = Math.max(1.0, this.multiplier * 0.75);
          this.bombs = Math.max(this.bombs, 3);
          if (this.lives <= 0) {
            // Seamless arcade credit continue
            this.lives = 3;
            this.score = Math.floor(this.score * 0.7);
          }
        }
        this.enemyBullets.splice(i, 1);
      }
    }
  }

  _updateItems(dt) {
    const px = this.player.x;
    const py = this.player.y;
    // Focus auto-collection abolished: only vacuum all items when pushing above the upper collection line (y < 240)
    const autoCollectLine = py < 240;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.rot += dt * 2.5;
      const dx = px - it.x;
      const dy = py - it.y;
      const dist = Math.hypot(dx, dy);

      if (it.vacuum || autoCollectLine || dist < 78) {
        if (autoCollectLine) it.vacuum = true;
        const speed = it.vacuum ? 580 : 380;
        it.x += (dx / Math.max(1, dist)) * speed * dt;
        it.y += (dy / Math.max(1, dist)) * speed * dt;
      } else {
        it.vy = Math.min(185, it.vy + 240 * dt);
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.vx *= 0.96;
      }

      if (dist < 26) {
        this.sound.playMedal();
        if (it.key === "item_bomb") {
          this.bombs = Math.min(6, this.bombs + 1);
          this.score += Math.floor(25000 * this.multiplier);
        } else if (it.key === "item_power") {
          this.multiplier = Math.min(9.99, this.multiplier + 0.15);
          this.score += Math.floor(10000 * this.multiplier);
        } else {
          this.multiplier = Math.min(9.99, this.multiplier + 0.01);
          this.bombGauge = Math.min(100, this.bombGauge + 0.6);
          this.score += Math.floor(1200 * this.multiplier);
        }
        this.spawnSpark(it.x, it.y, PAL_BRASS, 18, 0, -40, 0.24);
        this.items.splice(i, 1);
      } else if (it.y > 1010) {
        this.items.splice(i, 1);
      }
    }
  }

  /**
   * Packs current frame state for WebGL2 Compositor & populates dynamic point lights
   */
  buildRenderState() {
    this.compositor.clearLights();

    // 1. Dynamic Point Lights: Player core + Boss core + Ward Rings + Sampled Bullets
    this.compositor.addPointLight(this.player.x, this.player.y, 175, 0.98, 0.72, 0.25, 0.9);

    if (this.bossActive) {
      const isP2 = this.bossPhase >= 3;
      this.compositor.addPointLight(
        this.bossRig.x,
        this.bossRig.y,
        340,
        isP2 ? 0.98 : 0.95,
        isP2 ? 0.45 : 0.72,
        0.18,
        1.35
      );
    }

    for (const w of this.wardRings) {
      this.compositor.addPointLight(w.x, w.y, Math.min(480, w.r * 1.25), 0.98, 0.76, 0.24, 1.15);
    }

    for (const e of this.enemies) {
      if (e.isMidboss || e.maxHp >= 220) {
        this.compositor.addPointLight(e.x, e.y, 220, 0.35, 0.85, 0.55, 0.95);
      }
    }

    // Sample up to 8 bright bullets/lasers as moving point lights illuminating background reliefs
    const stepB = Math.max(1, Math.floor(this.enemyBullets.length / 8));
    for (let i = 0; i < this.enemyBullets.length && this.compositor.numLights < 16; i += stepB) {
      const b = this.enemyBullets[i];
      if (b.shape === SHAPE_LASER || b.shape === SHAPE_ORB) {
        this.compositor.addPointLight(b.x, b.y, 125, 0.95, 0.48, 0.18, 0.65);
      }
    }

    // 2. Pack Ship & Enemy Sprites (`ships_and_enemies` sheet)
    const shipSprites = [];

    // Collectible items
    for (const it of this.items) {
      shipSprites.push({
        key: it.key,
        x: it.x,
        y: it.y,
        scale: it.key === "item_medal" ? 0.19 : 0.24,
        rot: it.rot,
        er: 1.2,
        eg: 0.85,
        eb: 0.2,
      });
    }

    // Enemies
    for (const e of this.enemies) {
      const sc =
        e.key === "midboss_koumoku"
          ? 0.56
          : e.key === "enemy_carrier_heavy"
          ? 0.48
          : e.key.includes("scout")
          ? 0.28
          : 0.36;
      shipSprites.push({
        key: e.key,
        x: e.x,
        y: e.y,
        scale: sc,
        rot: e.rot || 0,
        er: 1.3,
        eg: 0.55,
        eb: 0.18,
        hitTint: e.hitTint || 0,
      });
    }

    // Player Options
    for (const opt of this.player.options) {
      shipSprites.push({
        key: "player_option",
        x: opt.x,
        y: opt.y,
        scale: 0.18,
        rot: this.player.optionAngle,
        er: 0.35,
        eg: 1.25,
        eb: 0.65,
      });
    }

    // Player Craft
    const invulnGlow = this.player.invulnTimer > 0 ? 0.45 + 0.25 * Math.sin(this.time * 5.0) : 0.0;
    shipSprites.push({
      key: "player_ship",
      x: this.player.x,
      y: this.player.y,
      scale: 0.32,
      rot: 0,
      er: 0.45,
      eg: 1.35,
      eb: 0.72,
      hitTint: invulnGlow,
    });

    // 3. Pack Multi-Part Boss Rig Sprites (`boss_parts` sheet)
    const bossSprites = [];
    if (this.bossActive) {
      this.bossRig.appendSprites(bossSprites);
    }

    // 4. Pack Standard Instanced Bullets (`this.compositor.bulletData`)
    const bArr = this.compositor.bulletData;
    let bCount = 0;

    for (let i = 0; i < this.enemyBullets.length && bCount < this.compositor.maxBullets; i++) {
      const b = this.enemyBullets[i];
      const ang = Math.atan2(b.vy, b.vx) - Math.PI * 0.5;
      const ptr = bCount * 8;
      bArr[ptr + 0] = b.x;
      bArr[ptr + 1] = b.y;
      bArr[ptr + 2] = b.rx;
      bArr[ptr + 3] = b.ry;
      bArr[ptr + 4] = ang;
      bArr[ptr + 5] = b.shape;
      bArr[ptr + 6] = b.palette;
      bArr[ptr + 7] = 0.96;
      bCount++;
    }

    // 5. Pack Additive Glow Instances (Player Bullets, Focus Hitbox Sigil, Ward Rings, Sparks)
    let aCount = 0;
    const aArr = this.additiveData;

    for (let i = 0; i < this.playerBullets.length && aCount < 9000; i++) {
      const pb = this.playerBullets[i];
      const ang = Math.atan2(pb.vy, pb.vx) - Math.PI * 0.5;
      const ptr = aCount * 8;
      aArr[ptr + 0] = pb.x;
      aArr[ptr + 1] = pb.y;
      aArr[ptr + 2] = 7;
      aArr[ptr + 3] = 24;
      aArr[ptr + 4] = ang;
      aArr[ptr + 5] = SHAPE_LASER;
      aArr[ptr + 6] = pb.palette;
      aArr[ptr + 7] = 0.78;
      aCount++;
    }

    // Focus Hitbox Astrolabe Sigil (always visible in Focus or when Invulnerable)
    if (this.player.focus || this.player.invulnTimer > 0) {
      const ptr = aCount * 8;
      aArr[ptr + 0] = this.player.x;
      aArr[ptr + 1] = this.player.y;
      aArr[ptr + 2] = this.player.invulnTimer > 0 ? 48 : 30;
      aArr[ptr + 3] = this.player.invulnTimer > 0 ? 48 : 30;
      aArr[ptr + 4] = this.time * 2.2;
      aArr[ptr + 5] = SHAPE_WARD;
      aArr[ptr + 6] = this.player.invulnTimer > 0 ? PAL_AMBER : PAL_JADE;
      aArr[ptr + 7] = 0.88;
      aCount++;
    }

    // Expanding Ward Rings
    for (const w of this.wardRings) {
      const alpha = 1.0 - w.age / w.duration;
      const ptr = aCount * 8;
      aArr[ptr + 0] = w.x;
      aArr[ptr + 1] = w.y;
      aArr[ptr + 2] = w.r;
      aArr[ptr + 3] = w.r;
      aArr[ptr + 4] = this.time * 1.5;
      aArr[ptr + 5] = SHAPE_WARD;
      aArr[ptr + 6] = w.palette;
      aArr[ptr + 7] = alpha * 0.9;
      aCount++;
    }

    // Sparks & Embers
    for (let i = 0; i < this.particles.length && aCount < 9800; i++) {
      const pt = this.particles[i];
      const alpha = 1.0 - pt.age / pt.life;
      const ptr = aCount * 8;
      aArr[ptr + 0] = pt.x;
      aArr[ptr + 1] = pt.y;
      aArr[ptr + 2] = pt.size * alpha;
      aArr[ptr + 3] = pt.size * alpha;
      aArr[ptr + 4] = 0;
      aArr[ptr + 5] = SHAPE_SPARK;
      aArr[ptr + 6] = pt.palette;
      aArr[ptr + 7] = alpha * 0.85;
      aCount++;
    }

    return {
      time: this.time,
      scrollY: this.scrollY,
      bgBlend: this.bgBlend,
      mandalaAlpha: this.mandalaAlpha,
      mandalaX: this.mandalaX,
      mandalaY: this.mandalaY,
      mandalaRot: this.mandalaRot,
      shipSprites,
      bossSprites,
      bulletCount: bCount,
      additiveData: aArr,
      additiveCount: aCount,
    };
  }
}
