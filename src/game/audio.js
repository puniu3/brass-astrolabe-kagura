/**
 * Procedural WebAudio Gagaku / Karakuri Sound Synthesizer
 * - Uses Japanese pentatonic tuning (Yo-sen / In-sen) for medal pickups, grazing sparks,
 *   laser hums, and ceremonial taiko/brass boss transitions.
 * - Zero external audio file dependencies; instant mute toggle in HUD.
 */

const PENTATONIC_HZ = [293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.medalStep = 0;
    this.lastMedalTime = 0;
    this.lastGrazeTime = 0;
    this.lastShotTime = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0.0 : 0.28, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  playShot(focus = false) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShotTime < 0.055) return;
    this.lastShotTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = focus ? "triangle" : "sine";
    const baseFreq = focus ? 520 : 380;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.045);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  playGraze() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGrazeTime < 0.035) return;
    this.lastGrazeTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1180 + Math.random() * 260, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.032);

    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.038);
  }

  playMedal() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastMedalTime < 0.028) return;
    if (now - this.lastMedalTime > 0.45) {
      this.medalStep = 0;
    } else {
      this.medalStep = (this.medalStep + 1) % PENTATONIC_HZ.length;
    }
    this.lastMedalTime = now;

    const freq = PENTATONIC_HZ[this.medalStep];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.setValueAtTime(freq * 1.5, now + 0.025);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  playExplosion(heavy = false) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Resonant low taiko + bronze shimmer
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(heavy ? 135 : 190, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + (heavy ? 0.42 : 0.18));

    gain.gain.setValueAtTime(heavy ? 0.26 : 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.45 : 0.2));

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + (heavy ? 0.46 : 0.22));
  }

  playSpellDeclare() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Ceremonial Gagaku chord (D4 - A4 - D5 - E5 - G5)
    const chord = [293.66, 440.0, 587.33, 659.25, 783.99];
    chord.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(f, now + i * 0.03);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + i * 0.03 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.15);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now + i * 0.03);
      osc.stop(now + 1.2);
    });
  }

  playBombWard() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [293.66, 392.0, 523.25, 783.99];
    notes.forEach((f) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f * 0.5, now);
      osc.frequency.exponentialRampToValueAtTime(f * 1.5, now + 0.55);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.78);
    });
  }
}
