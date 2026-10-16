/**
 * Main Application Entry Point for "Kagura of the Brass Astrolabe"
 * Wires together:
 * - WebGL2 HDR Multi-Pass Compositor (`WebGLCompositor`)
 * - 60Hz Danmaku STG Engine (`GameEngine`)
 * - iPad Pro 11-inch M1 Relative Touch + Keyboard Input (`InputController`)
 * - Procedural Gagaku WebAudio Synthesizer (`SoundEngine`)
 * - Minimalist, Zero-Overlap Sidebar HUD fitted to human visual processing budget
 */

import { WebGLCompositor } from "./render/webgl_compositor.js";
import { GameEngine } from "./game/engine.js";
import { InputController } from "./game/input.js";
import { SoundEngine } from "./game/audio.js";

async function boot() {
  const canvas = document.getElementById("stg-canvas");
  const statusEl = document.getElementById("loading-banner");

  // Load procedural reference & socket manifest
  const manifestRes = await fetch(`public/assets/ref_manifest.json?t=${Date.now()}`);
  const manifest = await manifestRes.json();

  let auditReport = null;
  try {
    const auditRes = await fetch(`public/assets/audit_report.json?t=${Date.now()}`);
    auditReport = await auditRes.json();
  } catch (_) {}

  const compositor = new WebGLCompositor(canvas, manifest);
  await compositor.loadTextures("public/assets");

  if (statusEl) statusEl.style.display = "none";

  const sound = new SoundEngine();

  // DOM HUD elements (4 clean chunks in right sidebar + 1 slim top HP bar)
  const scoreEl = document.getElementById("hud-score");
  const multEl = document.getElementById("hud-mult");
  const livesEl = document.getElementById("hud-lives");
  const bombsEl = document.getElementById("hud-bombs");
  const bombBarEl = document.getElementById("hud-bomb-bar");

  const encounterCard = document.getElementById("encounter-card");
  const portraitWrap = document.getElementById("boss-portrait-wrap");
  const phaseTitleEl = document.getElementById("phase-title");
  const phaseSubEl = document.getElementById("phase-subtitle");
  const bossHudWrap = document.getElementById("boss-hud-wrap");
  const bossHpFill = document.getElementById("boss-hp-fill");

  let cutinTimer = 0;
  const phaseBtns = document.querySelectorAll("[data-phase-jump]");
  const modal = document.getElementById("i2i-modal");

  const engine = new GameEngine(compositor, sound, {
    onPhaseChange(meta) {
      if (phaseTitleEl) phaseTitleEl.textContent = meta.title;
      if (phaseSubEl) phaseSubEl.textContent = meta.subtitle;
      if (portraitWrap) {
        portraitWrap.classList.toggle("visible", meta.id >= 2);
      }
      phaseBtns.forEach((btn) => {
        const idx = Number(btn.getAttribute("data-phase-jump"));
        btn.classList.toggle("active", idx === meta.id);
      });
    },
    onCutIn() {
      if (!encounterCard) return;
      encounterCard.classList.add("cutin-pulse");
      cutinTimer = 2.0;
    },
  });

  const input = new InputController(canvas, {
    onInteract() {
      sound.init();
    },
    onJumpPhase(idx) {
      engine.jumpToPhase(idx);
    },
  });

  // Wire Phase Jump buttons inside modal (closes modal upon selection)
  phaseBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      sound.init();
      const idx = Number(btn.getAttribute("data-phase-jump"));
      engine.jumpToPhase(idx);
      if (modal) modal.classList.remove("open");
    });
  });

  // Wire iPad Right-Thumb Bomb button
  const btnBomb = document.getElementById("btn-bomb");
  if (btnBomb) {
    btnBomb.addEventListener("click", () => {
      sound.init();
      input.bombRequested = true;
    });
  }

  // Wire Settings / Modal controls
  const btnImmortal = document.getElementById("btn-immortal");
  if (btnImmortal) {
    btnImmortal.addEventListener("click", () => {
      engine.immortalMode = !engine.immortalMode;
      btnImmortal.classList.toggle("active", engine.immortalMode);
      btnImmortal.textContent = engine.immortalMode ? "無敵鑑賞: ON" : "無敵鑑賞: OFF";
    });
  }

  const btnSound = document.getElementById("btn-sound");
  if (btnSound) {
    btnSound.addEventListener("click", () => {
      sound.init();
      const muted = sound.toggleMute();
      btnSound.classList.toggle("active", !muted);
      btnSound.textContent = muted ? "効果音 SFX: MUTE" : "効果音 SFX: ON";
    });
  }

  const btnInspect = document.getElementById("btn-inspect-i2i");
  const btnCloseModal = document.getElementById("btn-close-modal");
  const auditPre = document.getElementById("audit-json-pre");
  if (auditPre && auditReport) {
    auditPre.textContent = JSON.stringify(auditReport, null, 2);
  }
  if (btnInspect && modal) {
    btnInspect.addEventListener("click", () => modal.classList.add("open"));
  }
  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener("click", () => modal.classList.remove("open"));
  }

  // Fixed 60Hz timestep loop + minimal HUD sync
  let lastTime = performance.now();
  let fpsFrames = 0;
  let fpsTimer = 0;
  let displayedFps = 60;

  function frame(now) {
    const rawDt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    fpsFrames++;
    fpsTimer += rawDt;
    if (fpsTimer >= 0.5) {
      displayedFps = Math.round(fpsFrames / fpsTimer);
      fpsFrames = 0;
      fpsTimer = 0;
    }

    if (cutinTimer > 0) {
      cutinTimer -= rawDt;
      if (cutinTimer <= 0 && encounterCard) {
        encounterCard.classList.remove("cutin-pulse");
      }
    }

    const frameInput = input.consumeFrameInput();
    engine.update(1 / 60, frameInput);

    const renderState = engine.buildRenderState();
    compositor.renderFrame(renderState);

    // Update minimal sidebar readouts
    if (scoreEl) scoreEl.textContent = engine.score.toLocaleString("en-US").padStart(9, "0");
    if (multEl) multEl.textContent = `×${engine.multiplier.toFixed(2)}`;
    if (livesEl) {
      livesEl.textContent = "♥".repeat(Math.max(0, engine.lives)) || "—";
    }
    if (bombsEl) bombsEl.textContent = "✦".repeat(engine.bombs) || "—";
    if (bombBarEl) bombBarEl.style.width = `${Math.round(engine.bombGauge)}%`;

    // Update razor-slim Boss / Midboss HP bar at top rim of playfield
    const midboss = engine.enemies.find((e) => e.isMidboss);
    if (engine.bossActive) {
      bossHudWrap.classList.add("active");
      const pct = Math.max(0, Math.min(100, (engine.bossHp / engine.bossMaxHp) * 100));
      bossHpFill.style.width = `${pct.toFixed(1)}%`;
    } else if (midboss) {
      bossHudWrap.classList.add("active");
      const pct = Math.max(0, Math.min(100, (midboss.hp / midboss.maxHp) * 100));
      bossHpFill.style.width = `${pct.toFixed(1)}%`;
    } else {
      bossHudWrap.classList.remove("active");
    }

    // Expose live state for automated headless verification
    window.__STG_STATE__ = {
      time: engine.time,
      phase: engine.bossPhase,
      score: engine.score,
      graze: engine.graze,
      lives: engine.lives,
      enemyBullets: engine.enemyBullets.length,
      bossActive: engine.bossActive,
      bossHp: engine.bossHp,
      bgBlend: engine.bgBlend,
      fps: displayedFps,
    };

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error("STG boot error:", err);
  const banner = document.getElementById("loading-banner");
  if (banner) banner.textContent = `Init Error: ${err.message}`;
});
