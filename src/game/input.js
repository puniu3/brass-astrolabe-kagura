/**
 * Dual Input Controller for iPad Pro 11-inch M1 (Relative 1:1 Touch Drag + Multi-Touch Bomb)
 * and Keyboard / Gamepad.
 * Ensures the user's finger never occludes the player hitbox on iPad Safari.
 */

export class InputController {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.keys = new Set();
    this.focusToggle = false;
    this.autoFire = true;

    // Touch drag state (incremental delta in logical 720x960 space)
    this.touchActive = false;
    this.primaryTouchId = null;
    this.lastTouchX = 0;
    this.lastTouchY = 0;
    this.pendingDeltaX = 0;
    this.pendingDeltaY = 0;
    this.touchSensitivity = 1.18;

    this.bombRequested = false;
    this._bindEvents();
  }

  _clientToGameDelta(dxClient, dyClient) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = 720 / Math.max(1, rect.width);
    const scaleY = 960 / Math.max(1, rect.height);
    return {
      dx: dxClient * scaleX * this.touchSensitivity,
      dy: dyClient * scaleY * this.touchSensitivity,
    };
  }

  _bindEvents() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (this.callbacks.onInteract) this.callbacks.onInteract();

      if (e.code === "KeyX" || e.code === "KeyB") {
        this.bombRequested = true;
      }
      if (e.code === "Digit1" && this.callbacks.onJumpPhase) this.callbacks.onJumpPhase(0);
      if (e.code === "Digit2" && this.callbacks.onJumpPhase) this.callbacks.onJumpPhase(1);
      if (e.code === "Digit3" && this.callbacks.onJumpPhase) this.callbacks.onJumpPhase(2);
      if (e.code === "Digit4" && this.callbacks.onJumpPhase) this.callbacks.onJumpPhase(3);
      if (e.code === "Digit5" && this.callbacks.onJumpPhase) this.callbacks.onJumpPhase(4);

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    // iPad / Touch relative 1:1 drag on canvas
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (this.callbacks.onInteract) this.callbacks.onInteract();

        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (this.primaryTouchId === null) {
            this.primaryTouchId = t.identifier;
            this.touchActive = true;
            this.lastTouchX = t.clientX;
            this.lastTouchY = t.clientY;
          } else {
            // Second finger tap while dragging triggers Spell / Bomb Ward!
            this.bombRequested = true;
          }
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.primaryTouchId) {
            const dxC = t.clientX - this.lastTouchX;
            const dyC = t.clientY - this.lastTouchY;
            this.lastTouchX = t.clientX;
            this.lastTouchY = t.clientY;
            const { dx, dy } = this._clientToGameDelta(dxC, dyC);
            this.pendingDeltaX += dx;
            this.pendingDeltaY += dy;
          }
        }
      },
      { passive: false }
    );

    const endTouch = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.primaryTouchId) {
          this.primaryTouchId = null;
          this.touchActive = false;
        }
      }
      // If another finger is still down, promote it smoothly
      if (this.primaryTouchId === null && e.touches.length > 0) {
        const t = e.touches[0];
        this.primaryTouchId = t.identifier;
        this.touchActive = true;
        this.lastTouchX = t.clientX;
        this.lastTouchY = t.clientY;
      }
    };

    this.canvas.addEventListener("touchend", endTouch, { passive: false });
    this.canvas.addEventListener("touchcancel", endTouch, { passive: false });

    // Mouse drag support for desktop testing
    let mouseDown = false;
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.callbacks.onInteract) this.callbacks.onInteract();
      if (e.button === 0) {
        mouseDown = true;
        this.touchActive = true;
        this.lastTouchX = e.clientX;
        this.lastTouchY = e.clientY;
      } else if (e.button === 2) {
        this.bombRequested = true;
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (!mouseDown) return;
      const dxC = e.clientX - this.lastTouchX;
      const dyC = e.clientY - this.lastTouchY;
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
      const { dx, dy } = this._clientToGameDelta(dxC, dyC);
      this.pendingDeltaX += dx;
      this.pendingDeltaY += dy;
    });
    window.addEventListener("mouseup", () => {
      mouseDown = false;
      if (this.primaryTouchId === null) {
        this.touchActive = false;
      }
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  consumeFrameInput() {
    let kbX = 0;
    let kbY = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) kbX -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) kbX += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) kbY -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) kbY += 1;
    if (kbX !== 0 && kbY !== 0) {
      const inv = 1 / Math.SQRT2;
      kbX *= inv;
      kbY *= inv;
    }

    const isFocus =
      this.focusToggle ||
      this.keys.has("ShiftLeft") ||
      this.keys.has("ShiftRight") ||
      this.keys.has("KeyC");

    const isFiring =
      this.autoFire ||
      this.touchActive ||
      this.keys.has("KeyZ") ||
      this.keys.has("Space") ||
      this.keys.has("Enter");

    const bomb = this.bombRequested;
    this.bombRequested = false;

    const dragDX = this.pendingDeltaX;
    const dragDY = this.pendingDeltaY;
    this.pendingDeltaX = 0;
    this.pendingDeltaY = 0;

    return {
      kbX,
      kbY,
      dragDX,
      dragDY,
      isFocus,
      isFiring,
      bomb,
    };
  }
}
