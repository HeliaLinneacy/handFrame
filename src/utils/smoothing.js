/**
 * smoothing.js — Smoothing utilities for hand landmark positions
 * Uses lerp (linear interpolation) to reduce tracking jitter.
 */

/**
 * Linear interpolation between two values.
 * @param {number} a - Current value
 * @param {number} b - Target value
 * @param {number} t - Interpolation factor (0-1, lower = smoother)
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * LerpPoint — smoothly interpolate a 2D point
 * @param {{x:number,y:number}} current
 * @param {{x:number,y:number}} target
 * @param {number} t
 */
export function lerpPoint(current, target, t) {
  return {
    x: lerp(current.x, target.x, t),
    y: lerp(current.y, target.y, t),
  };
}

/**
 * LerpAngle — smooth angle interpolation (handles wrap-around)
 * @param {number} a - current angle (radians)
 * @param {number} b - target angle (radians)
 * @param {number} t
 */
export function lerpAngle(a, b, t) {
  let diff = b - a;
  // Wrap diff to [-π, π]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

/**
 * SmoothedRect — class to smooth rectangle transform over time
 */
export class SmoothedRect {
  constructor(factor = 0.18) {
    this.factor = factor; // Lower = smoother but more lag
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.angle = 0;
    this.opacity = 0;
    this.initialized = false;
  }

  /**
   * Update with new target values
   * @param {{x,y,w,h,angle}} target
   * @param {boolean} active - Whether gesture is active
   */
  update(target, active) {
    const f = this.factor;

    if (!this.initialized && active) {
      // Snap to first detected position
      this.x = target.x;
      this.y = target.y;
      this.w = target.w;
      this.h = target.h;
      this.angle = target.angle;
      this.initialized = true;
    } else if (active) {
      this.x = lerp(this.x, target.x, f);
      this.y = lerp(this.y, target.y, f);
      this.w = lerp(this.w, target.w, f);
      this.h = lerp(this.h, target.h, f);
      this.angle = lerpAngle(this.angle, target.angle, f);
    }

    // Instant show/hide — no fade transition
    this.opacity = active ? 1 : 0;

    return {
      x: this.x,
      y: this.y,
      w: this.w,
      h: this.h,
      angle: this.angle,
      opacity: this.opacity,
    };
  }

  reset() {
    this.initialized = false;
    this.opacity = 0;
  }
}
