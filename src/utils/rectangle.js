/**
 * rectangle.js — Compute rectangle transform from hand landmarks.
 *
 * MediaPipe Hand landmark indices (key ones used):
 *   4  = Thumb tip
 *   8  = Index finger tip
 *   12 = Middle finger tip
 *   20 = Pinky tip
 *
 * We define the frame rectangle using:
 *   - Top-left corner     = Index tip of LEFT hand
 *   - Top-right corner    = Index tip of RIGHT hand
 *   - Bottom-left corner  = Thumb tip of LEFT hand
 *   - Bottom-right corner = Thumb tip of RIGHT hand
 */

/** Minimum rectangle area (as fraction of canvas area) to activate */
const MIN_AREA_FRACTION = 0.015;

/**
 * Extract key fingertip landmarks from a hand result set.
 * @param {Object} hand - Single hand result from MediaPipe
 * @param {{width:number, height:number}} canvasSize
 * @returns {{thumb, index, middle, pinky}}
 */
export function extractTips(hand, canvasSize) {
  const lm = hand.landmarks;
  const { width, height } = canvasSize;

  // MediaPipe returns normalized [0,1] coords; we scale to canvas pixels.
  // Note: MediaPipe mirrors x for front camera, we keep as-is and handle mirror in canvas draw.
  const toPixel = (pt) => ({
    x: pt.x * width,
    y: pt.y * height,
  });

  return {
    thumb:  toPixel(lm[4]),
    index:  toPixel(lm[8]),
    middle: toPixel(lm[12]),
    pinky:  toPixel(lm[20]),
    wrist:  toPixel(lm[0]),
  };
}

/**
 * Determine if a hand is "left" or "right" from MediaPipe classification.
 * MediaPipe labels are relative to the person (not mirrored), but since
 * webcam is mirrored visually, we flip the label.
 */
export function getHandedness(hand) {
  // MediaPipe gives 'Left' or 'Right' from the person's perspective (handednessLabel).
  // Since we mirror the canvas, we swap: person's Left appears on screen's Right.
  const raw = hand.handednessLabel ?? 'Left';
  return raw === 'Left' ? 'Right' : 'Left';
}

/**
 * Compute the rectangle transform from two hands.
 *
 * @param {Object} leftHand  - Hand classified as LEFT (person's left, appears right on mirrored screen)
 * @param {Object} rightHand - Hand classified as RIGHT
 * @param {{width, height}} canvasSize
 * @returns {{x, y, w, h, angle, valid}} or null
 */
export function computeRectangle(leftHand, rightHand, canvasSize) {
  if (!leftHand || !rightHand) return null;

  const left  = extractTips(leftHand, canvasSize);
  const right = extractTips(rightHand, canvasSize);

  // Define 4 corners:
  // Top-left  = index of left hand
  // Top-right = index of right hand
  // Bot-left  = thumb of left hand
  // Bot-right = thumb of right hand
  const TL = left.index;
  const TR = right.index;
  const BL = left.thumb;
  const BR = right.thumb;

  // Center of rectangle
  const cx = (TL.x + TR.x + BL.x + BR.x) / 4;
  const cy = (TL.y + TR.y + BL.y + BR.y) / 4;

  // Width = average of top edge + bottom edge
  const topW  = Math.hypot(TR.x - TL.x, TR.y - TL.y);
  const botW  = Math.hypot(BR.x - BL.x, BR.y - BL.y);
  const w = (topW + botW) / 2;

  // Height = average of left edge + right edge
  const leftH  = Math.hypot(BL.x - TL.x, BL.y - TL.y);
  const rightH = Math.hypot(BR.x - TR.x, BR.y - TR.y);
  const h = (leftH + rightH) / 2;

  // Rotation angle computed in MIRRORED screen space.
  // In original space TL (person's right hand) has larger x than TR (person's left hand),
  // so TR.x - TL.x is negative → atan2 gives ~π for horizontal hands → wrong rotation.
  // Using TL.x - TR.x gives the angle as seen on the mirrored canvas (0 = horizontal). ✓
  const angle = Math.atan2(TR.y - TL.y, TL.x - TR.x);

  // Validate minimum area
  const area = w * h;
  const canvasArea = canvasSize.width * canvasSize.height;
  if (area < canvasArea * MIN_AREA_FRACTION) {
    return { x: cx, y: cy, w, h, angle, valid: false };
  }

  return { x: cx, y: cy, w, h, angle, valid: true };
}

/** Vibrant color palette — one fixed color per landmark index (0–20) */
const HEART_COLORS = [
  '#FF6B9D','#FF4757','#FF6348','#FFA502','#FFBE76',
  '#7BED9F','#2ED573','#1E90FF','#70A1FF','#5352ED',
  '#FF4081','#E91E63','#FF80AB','#EA80FC','#B388FF',
  '#82B1FF','#80D8FF','#A7FFEB','#CCFF90','#FFD180',
  '#FF9E80',
];

/**
 * Draw a filled heart shape centered at (cx, cy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - center x
 * @param {number} cy - center y
 * @param {number} r  - half-width radius (all hearts same size)
 * @param {string} color
 */
function drawHeart(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.translate(cx, cy);
  ctx.scale(r, r);
  // Normalized heart path — tip at bottom (0, 0.9), bumps at top
  ctx.moveTo(0, 0.9);
  ctx.bezierCurveTo(-0.5, 0.5,  -1.2, -0.1, -0.7, -0.6);
  ctx.bezierCurveTo(-0.3, -1.0,   0,  -0.8,    0, -0.5);
  ctx.bezierCurveTo(  0,  -0.8,  0.3, -1.0,  0.7, -0.6);
  ctx.bezierCurveTo( 1.2, -0.1,  0.5,  0.5,    0,  0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draw skeleton overlay for both hands on canvas.
 * Connection lines are subtle; each of the 21 landmarks gets a colored heart.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} hands - array of hand result objects
 * @param {{width, height}} canvasSize
 */
export function drawHandSkeleton(ctx, hands, canvasSize) {
  hands.forEach((hand) => {
    const lm = hand.landmarks;
    const { width, height } = canvasSize;

    // ── Bone connections ──────────────────────────────────────
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17],
    ];

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    connections.forEach(([a, b]) => {
      const pa = lm[a], pb = lm[b];
      ctx.beginPath();
      ctx.moveTo(pa.x * width, pa.y * height);
      ctx.lineTo(pb.x * width, pb.y * height);
      ctx.stroke();
    });
    ctx.restore();

    // ── Heart at every landmark (same size = 7px, fixed colors) ─
    const HEART_R = 7;
    lm.forEach((pt, idx) => {
      drawHeart(ctx, pt.x * width, pt.y * height, HEART_R, HEART_COLORS[idx % HEART_COLORS.length]);
    });
  });
}

/**
 * Draw the rectangle outline (guide frame) on canvas.
 */
export function drawRectGuide(ctx, rect, color = 'rgba(124,106,247,0.7)') {
  const { x, y, w, h, angle } = rect;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 5]);
  ctx.lineDashOffset = Date.now() / 60; // animated dash
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  // Corner accents
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  const cs = 14; // corner size
  const hw = w / 2, hh = h / 2;
  // TL
  ctx.beginPath(); ctx.moveTo(-hw, -hh + cs); ctx.lineTo(-hw, -hh); ctx.lineTo(-hw + cs, -hh); ctx.stroke();
  // TR
  ctx.beginPath(); ctx.moveTo(hw - cs, -hh); ctx.lineTo(hw, -hh); ctx.lineTo(hw, -hh + cs); ctx.stroke();
  // BL
  ctx.beginPath(); ctx.moveTo(-hw, hh - cs); ctx.lineTo(-hw, hh); ctx.lineTo(-hw + cs, hh); ctx.stroke();
  // BR
  ctx.beginPath(); ctx.moveTo(hw - cs, hh); ctx.lineTo(hw, hh); ctx.lineTo(hw, hh - cs); ctx.stroke();

  ctx.restore();
}
