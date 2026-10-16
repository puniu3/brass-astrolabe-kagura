/**
 * Hierarchical Multi-Part Articulated Boss Rig (`procedural-i2i` Parts-Rig Architecture)
 * Assembles the 7 distinct component cells from `boss_parts_atlas.png` (with Left/Right instanced
 * symmetry for wings, fins, and shoulder turrets -> 11 articulated parts total):
 * - Avoids temporal texture boil (W4) by generating once and animating via rigid hierarchical transforms.
 * - Avoids uncanny valley (W2) via ceremonial porcelain Noh mask (`boss_mask_plate`) + mechanical brass servos.
 * - Supports Phase 1 -> Phase 2 -> Phase 3 armor unsealing (parts slide outward on servo rails, revealing core)
 *   and independent turret tracking, barrel recoil, and destructible wing/turret parts!
 */

export class BossRig {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 360;
    this.y = -180;
    this.targetX = 360;
    this.targetY = 235;
    this.phase = 1; // 1 = Astrolabe Epicycle, 2 = Unsealed Mandala, 3 = Eternal Sun-Wheel
    this.time = 0;
    this.unsealProgress = 0; // 0.0 in Phase 1 -> 1.0 in Phase 2/3

    // Individual part states (destructible side parts + recoil + hit tint)
    this.parts = {
      leftWing: { hp: 2600, maxHp: 2600, destroyed: false, hitTint: 0, recoil: 0 },
      rightWing: { hp: 2600, maxHp: 2600, destroyed: false, hitTint: 0, recoil: 0 },
      leftTurret: { hp: 1900, maxHp: 1900, destroyed: false, hitTint: 0, recoil: 0, aimAngle: 0 },
      rightTurret: { hp: 1900, maxHp: 1900, destroyed: false, hitTint: 0, recoil: 0, aimAngle: 0 },
      core: { hitTint: 0, pulse: 0 },
    };
  }

  triggerTurretRecoil(side, amount = 14) {
    if (side === "left" || side === "both") {
      this.parts.leftTurret.recoil = Math.min(20, this.parts.leftTurret.recoil + amount);
    }
    if (side === "right" || side === "both") {
      this.parts.rightTurret.recoil = Math.min(20, this.parts.rightTurret.recoil + amount);
    }
  }

  update(dt, playerX, playerY, bossPhase) {
    this.time += dt;
    this.phase = bossPhase;

    // Smoothly approach target position
    this.x += (this.targetX - this.x) * Math.min(1, dt * 3.5);
    this.y += (this.targetY - this.y) * Math.min(1, dt * 3.5);

    // Unseal armor plates in Phase 2 & 3
    const targetUnseal = this.phase >= 2 ? (this.phase === 3 ? 1.25 : 1.0) : 0.0;
    this.unsealProgress += (targetUnseal - this.unsealProgress) * Math.min(1, dt * 2.4);

    // Decay hit tints and cannon recoils
    for (const key of ["leftWing", "rightWing", "leftTurret", "rightTurret", "core"]) {
      const p = this.parts[key];
      if (p.hitTint > 0) p.hitTint = Math.max(0, p.hitTint - dt * 4.5);
      if (p.recoil > 0) p.recoil = Math.max(0, p.recoil - dt * 38.0);
    }

    // Track player with shoulder rotary cannon turrets
    for (const [side, sign] of [
      ["leftTurret", -1],
      ["rightTurret", 1],
    ]) {
      const tPart = this.parts[side];
      const tx = this.x + sign * (86 + this.unsealProgress * 22);
      const ty = this.y + 18;
      // Turret sprite points straight down (+Y) at angle 0
      const desired = Math.atan2(playerY - ty, playerX - tx) - Math.PI * 0.5;
      // Clamp turret gimballing to +/- 0.68 rad
      const clamped = Math.max(-0.68, Math.min(0.68, desired));
      tPart.aimAngle += (clamped - tPart.aimAngle) * Math.min(1, dt * 6.0);
    }
  }

  /**
   * Returns world-space muzzle coordinates for firing danmaku from specific articulated parts
   */
  getMuzzlePositions() {
    const u = this.unsealProgress;
    const breath = Math.sin(this.time * 2.2) * 5;
    const bx = this.x;
    const by = this.y + breath;

    const muzzles = {
      core: { x: bx, y: by },
      thirdEye: { x: bx, y: by - 26 - u * 14 },
      leftWingTip: {
        x: bx - (155 + u * 34),
        y: by - 15 + Math.sin(this.time * 3.1) * 18,
      },
      rightWingTip: {
        x: bx + (155 + u * 34),
        y: by - 15 + Math.sin(this.time * 3.1) * 18,
      },
      leftTurret: { x: bx - 88, y: by + 76 },
      rightTurret: { x: bx + 88, y: by + 76 },
      tailTip: {
        x: bx + Math.sin(this.time * 2.6) * 32,
        y: by + 135 + u * 18,
      },
    };

    for (const [side, sign] of [
      ["leftTurret", -1],
      ["rightTurret", 1],
    ]) {
      const tPart = this.parts[side];
      const tx = bx + sign * (86 + u * 24);
      const ty = by + 16 - tPart.recoil * 0.6;
      const ang = tPart.aimAngle + Math.PI * 0.5;
      muzzles[side] = {
        x: tx + Math.cos(ang) * 62,
        y: ty + Math.sin(ang) * 62,
        angle: ang,
      };
    }

    return muzzles;
  }

  /**
   * Returns hitboxes for player bullets -> boss core and destructible sub-parts
   */
  getHitboxes() {
    const u = this.unsealProgress;
    const bx = this.x;
    const by = this.y + Math.sin(this.time * 2.2) * 5;
    const boxes = [];

    if (!this.parts.leftTurret.destroyed) {
      boxes.push({ id: "leftTurret", x: bx - (86 + u * 24), y: by + 32, r: 42 });
    }
    if (!this.parts.rightTurret.destroyed) {
      boxes.push({ id: "rightTurret", x: bx + (86 + u * 24), y: by + 32, r: 42 });
    }
    if (!this.parts.leftWing.destroyed) {
      boxes.push({ id: "leftWing", x: bx - (132 + u * 30), y: by - 12, r: 56 });
    }
    if (!this.parts.rightWing.destroyed) {
      boxes.push({ id: "rightWing", x: bx + (132 + u * 30), y: by - 12, r: 56 });
    }
    boxes.push({ id: "core", x: bx, y: by, r: 68 });
    return boxes;
  }

  /**
   * Appends ordered sprite instances (back-to-front painter's order) into `outSprites`
   */
  appendSprites(outSprites) {
    const t = this.time;
    const u = this.unsealProgress;
    const breath = Math.sin(t * 2.2) * 5.0;
    const bx = this.x;
    const by = this.y + breath;

    // Phase-dependent emissive color (Phase 1: Warm Amber Gold, Phase 2: Jade & Vermilion, Phase 3: Solar Crimson-Gold)
    let er = 1.35,
      eg = 0.78,
      eb = 0.18;
    if (this.phase === 2) {
      er = 0.35 + 0.85 * (0.5 + 0.5 * Math.sin(t * 4.0));
      eg = 1.15;
      eb = 0.55;
    } else if (this.phase >= 3) {
      er = 1.65;
      eg = 0.52 + 0.45 * Math.sin(t * 6.0);
      eb = 0.22;
    }

    const coreTint = this.parts.core.hitTint;

    // 1. Back Layer: Outer Astrolabe Ring (rotates continuously)
    outSprites.push({
      key: "boss_astrolabe_ring",
      x: bx,
      y: by - 6,
      scale: 0.92 + u * 0.22,
      rot: t * (0.55 + this.phase * 0.25),
      er,
      eg,
      eb,
      hitTint: coreTint * 0.4,
    });

    // In Phase 2+, deploy a second counter-rotating inner astrolabe halo
    if (u > 0.05) {
      outSprites.push({
        key: "boss_astrolabe_ring",
        x: bx,
        y: by - 6,
        scale: (0.62 + u * 0.12) * Math.min(1, u * 1.3),
        rot: -t * 1.15,
        er: 1.5,
        eg: 0.42,
        eb: 0.18,
        hitTint: coreTint * 0.4,
      });
    }

    // 2. Ceremonial Tail Pendulum Halberd (swings rhythmically below chassis)
    const tailSwing = Math.sin(t * 2.6) * (0.18 + u * 0.12);
    outSprites.push({
      key: "boss_tail_pendulum",
      x: bx,
      y: by + 48 + u * 16,
      scale: 0.52,
      rot: tailSwing,
      er,
      eg,
      eb,
      hitTint: coreTint * 0.5,
    });

    // 3. Secondary Lower Jade/Brass Stabilizer Fins (Left & Right mirrored)
    const finFlare = 0.12 + u * 0.28 + Math.sin(t * 2.2 - 0.8) * 0.08;
    for (const sign of [-1, 1]) {
      outSprites.push({
        key: "boss_wing_secondary",
        x: bx + sign * (58 + u * 26),
        y: by + 26 + u * 14,
        scale: 0.54,
        rot: sign * finFlare,
        mirrorX: sign < 0,
        er: 0.35,
        eg: 1.25,
        eb: 0.65,
        hitTint: coreTint * 0.5,
      });
    }

    // 4. Primary Sweeping Mechanical Feather-Wing Pinions (Left & Right mirrored, destructible)
    const wingSweep = -0.10 + u * 0.32 + Math.sin(t * 3.1) * (0.12 + this.phase * 0.04);
    for (const [sideKey, sign] of [
      ["leftWing", -1],
      ["rightWing", 1],
    ]) {
      const wPart = this.parts[sideKey];
      const destroyedScale = wPart.destroyed ? 0.32 : 0.68;
      outSprites.push({
        key: "boss_wing_primary",
        x: bx + sign * (64 + u * 34),
        y: by - 18 - u * 10,
        scale: destroyedScale,
        rot: sign * wingSweep,
        mirrorX: sign < 0,
        er: wPart.destroyed ? 0.2 : er,
        eg: wPart.destroyed ? 0.1 : eg,
        eb: wPart.destroyed ? 0.05 : eb,
        hitTint: Math.max(coreTint * 0.5, wPart.hitTint),
      });
    }

    // 5. Central Octagonal Obsidian & Brass Sanctum Core Chassis
    outSprites.push({
      key: "boss_core_chassis",
      x: bx,
      y: by,
      scale: 0.62 + u * 0.08,
      rot: -t * 0.35,
      er: er * 1.25,
      eg: eg * 1.15,
      eb,
      hitTint: coreTint,
    });

    // 6. Heavy Twin-Barrel Rotary Cannon Pauldrons (Left & Right mirrored, aim at player + recoil)
    for (const [sideKey, sign] of [
      ["leftTurret", -1],
      ["rightTurret", 1],
    ]) {
      const tPart = this.parts[sideKey];
      if (tPart.destroyed) continue;
      outSprites.push({
        key: "boss_shoulder_turret",
        x: bx + sign * (86 + u * 24),
        y: by + 16 - tPart.recoil,
        scale: 0.48,
        rot: tPart.aimAngle,
        mirrorX: sign < 0,
        er: 1.45,
        eg: 0.55,
        eb: 0.16,
        hitTint: Math.max(coreTint * 0.4, tPart.hitTint),
      });
    }

    // 7. Front Layer: Ceremonial White Porcelain & Gold Kintsugi Noh Sun-Deity Mask
    // In Phase 2/3, the mask unseals upward slightly so the blazing core furnace peeks from beneath!
    const maskHoverY = by - 8 - u * 22 + Math.sin(t * 3.4) * 3.5;
    const maskTilt = Math.sin(t * 1.7) * 0.04;
    outSprites.push({
      key: "boss_mask_plate",
      x: bx,
      y: maskHoverY,
      scale: 0.56,
      rot: maskTilt,
      er: er * 1.3,
      eg: eg * 1.1,
      eb,
      hitTint: coreTint * 0.85,
    });
  }
}
