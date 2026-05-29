/**
 * WebcamCanvas.jsx
 * Core component: manages webcam stream, MediaPipe hand tracking,
 * canvas rendering, and image display inside the gesture rectangle.
 *
 * Flow:
 *  1. Request camera access
 *  2. Load MediaPipe Hands via CDN script
 *  3. Per-frame: detect hands → compute rectangle → draw everything
 */

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import { computeRectangle, getHandedness, drawHandSkeleton, drawRectGuide } from '../utils/rectangle';
import { SmoothedRect } from '../utils/smoothing';

// ─────────────────────────────────────────────────────────────
// MediaPipe loads via CDN (avoids bundler issues with WASM)
// ─────────────────────────────────────────────────────────────
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
const MEDIAPIPE_UTILS = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
const MEDIAPIPE_FILES = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/';

let mediapipeLoaded = false;
let mediapipeLoading = false;
let onLoadCallbacks = [];

function loadMediaPipe(callback) {
  if (mediapipeLoaded) return callback();
  onLoadCallbacks.push(callback);
  if (mediapipeLoading) return;

  mediapipeLoading = true;

  const script1 = document.createElement('script');
  script1.src = MEDIAPIPE_CDN;
  script1.crossOrigin = 'anonymous';

  const script2 = document.createElement('script');
  script2.src = MEDIAPIPE_UTILS;
  script2.crossOrigin = 'anonymous';

  script1.onload = () => {
    document.head.appendChild(script2);
  };

  script2.onload = () => {
    mediapipeLoaded = true;
    mediapipeLoading = false;
    onLoadCallbacks.forEach(cb => cb());
    onLoadCallbacks = [];
  };

  document.head.appendChild(script1);
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
const WebcamCanvas = forwardRef(function WebcamCanvas(
  { imageSrc, showSkeleton = true, onHandsDetected, onFPS, onGestureChange },
  ref
) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handsRef = useRef(null);       // MediaPipe Hands instance
  const cameraRef = useRef(null);      // MediaPipe Camera instance
  const imageRef = useRef(null);       // Loaded HTMLImageElement
  const smootherRef = useRef(new SmoothedRect(0.28));
  const rafRef = useRef(null);
  const renderRafRef = useRef(null);
  const frameCount = useRef(0);
  const fpsIntervalRef = useRef(null);
  const handsResultRef = useRef([]);
  const facingModeRef = useRef('user');
  const prevGestureRef = useRef(false);
  const ctxRef = useRef(null);                  // cached canvas context (desynchronized)

  const [cameraActive, setCameraActive] = useState(false);

  // ── Expose capture & camera switch via ref ──────────────────
  useImperativeHandle(ref, () => ({
    capture: () => captureFrame(),
    switchCamera: () => switchCamera(),
  }));

  // ── Load image when imageSrc changes ───────────────────────
  useEffect(() => {
    if (!imageSrc) {
      imageRef.current = null;
      return;
    }
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      imageRef.current = img;
    };
  }, [imageSrc]);

  // ── Start camera stream (always front camera, max FPS) ──────
  const startStream = useCallback(async (videoEl) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 },    // request 60fps from camera
        },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      cameraRef.current = stream;
      setCameraActive(true);
      startFPSCounter();

      // ── MediaPipe feed: use requestVideoFrameCallback when available ──
      // This fires exactly once per new video frame (no duplicate sends).
      // mpBusy prevents queue buildup when MP is slower than camera fps.
      let mpBusy = false;

      const feedMP = async () => {
        if (!mpBusy && handsRef.current && videoEl.readyState >= 2 && videoEl.srcObject) {
          mpBusy = true;
          try {
            await handsRef.current.send({ image: videoEl });
          } finally {
            mpBusy = false;
          }
        }
        // Schedule next MP frame
        if (videoEl.srcObject) {
          if ('requestVideoFrameCallback' in videoEl) {
            videoEl.requestVideoFrameCallback(feedMP);
          } else {
            rafRef.current = requestAnimationFrame(feedMP);
          }
        }
      };

      // Kick off MP feed loop
      if ('requestVideoFrameCallback' in videoEl) {
        videoEl.requestVideoFrameCallback(feedMP);
      } else {
        rafRef.current = requestAnimationFrame(feedMP);
      }

      // ── Continuous 60fps render loop (decoupled from MediaPipe) ──
      const renderLoop = () => {
        renderFrameRef.current?.();
        renderRafRef.current = requestAnimationFrame(renderLoop);
      };
      renderRafRef.current = requestAnimationFrame(renderLoop);
    } catch (err) {
      console.error('Camera error:', err);
    }
  }, []); // eslint-disable-line

  // ── Main initialization ─────────────────────────────────────
  const initMediaPipe = useCallback((videoEl) => {
    loadMediaPipe(() => {
      // Construct MediaPipe Hands
      // eslint-disable-next-line no-undef
      const hands = new Hands({
        locateFile: (file) => `${MEDIAPIPE_FILES}${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,              // fastest model (0 vs 1)
        minDetectionConfidence: 0.6,     // slightly lower = fewer rejections
        minTrackingConfidence: 0.5,
      });

      hands.onResults((results) => {
        // Only update data refs — 60fps loop handles all rendering
        handsResultRef.current = results.multiHandLandmarks?.length > 0
          ? results.multiHandLandmarks.map((lm, i) => ({
              landmarks: lm,
              handednessLabel: results.multiHandedness?.[i]?.label ?? null,
            }))
          : [];
        onHandsDetected?.(handsResultRef.current.length);
      });

      handsRef.current = hands;

      // Start camera after hands model is ready
      startStream(videoEl);
    });
  }, []); // eslint-disable-line

  // ── Render frame on canvas ──────────────────────────────────
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // Plain context — NO desynchronized:true.
    // desynchronized causes GPU to read canvas between clearRect and drawImage
    // → black flash every frame (the real flickering cause).
    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext('2d');
    }
    const ctx = ctxRef.current;
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // ── Draw mirrored webcam video ────────────────────────
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    const hands = handsResultRef.current;
    const canvasSize = { width: W, height: H };

    // ── Classify hands ─────────────────────────────────────
    let leftHand = null, rightHand = null;
    hands.forEach((hand) => {
      const side = getHandedness(hand);
      if (side === 'Left') leftHand = hand;
      else rightHand = hand;
    });

    // ── Draw skeleton ──────────────────────────────────────
    if (showSkeleton && hands.length > 0) {
      // Mirror context for landmarks (they're in un-mirrored space)
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      drawHandSkeleton(ctx, hands, canvasSize);
      ctx.restore();
    }

    // ── Compute rectangle ──────────────────────────────────
    const rawRect = computeRectangle(leftHand, rightHand, canvasSize);
    const gestureActive = rawRect?.valid === true;

    // Notify parent only when state CHANGES (avoid 60fps React state spam)
    if (gestureActive !== prevGestureRef.current) {
      prevGestureRef.current = gestureActive;
      onGestureChange?.(gestureActive);
    }

    // Smooth the rectangle
    const smoothed = smootherRef.current.update(
      rawRect || { x: W / 2, y: H / 2, w: 0, h: 0, angle: 0 },
      gestureActive
    );

    // ── Draw guide rectangle & image ──────────────────────────
    // Render whenever opacity is visible — independent of rawRect being
    // present THIS frame. This prevents 1-2 frame tracking gaps from
    // causing visible flicker; the smoother gradually fades opacity out.
    if (smoothed.opacity > 0.02) {
      const mirroredRect = { ...smoothed, x: W - smoothed.x };

      ctx.save();
      ctx.globalAlpha = Math.min(smoothed.opacity, 1);
      drawRectGuide(ctx, mirroredRect);
      ctx.restore();

      // ── Draw image inside rectangle ──────────────────────
      if (imageRef.current) {
        const img = imageRef.current;
        const { x: mx, y: my, w, h, angle } = mirroredRect;

        ctx.save();
        ctx.globalAlpha = smoothed.opacity;
        ctx.translate(mx, my);
        ctx.rotate(angle);

        // Fit image inside rectangle maintaining aspect ratio
        const imgAspect = img.width / img.height;
        const rectAspect = w / h;
        let drawW, drawH;
        if (imgAspect > rectAspect) {
          drawW = w;
          drawH = w / imgAspect;
        } else {
          drawH = h;
          drawW = h * imgAspect;
        }

        // Clip to rectangle boundary
        ctx.beginPath();
        ctx.rect(-w / 2, -h / 2, w, h);
        ctx.clip();

        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }
    }

    // ── FPS counter ────────────────────────────────────────
    frameCount.current++;
  }, [showSkeleton]); // onGestureChange handled via change-detection, not dep

  // ── Keep a ref to renderFrame so the 60fps rAF can call it ──
  const renderFrameRef = useRef(null);
  renderFrameRef.current = renderFrame;

  // ── FPS counter ─────────────────────────────────────────────
  const startFPSCounter = () => {
    fpsIntervalRef.current = setInterval(() => {
      onFPS?.(frameCount.current * 2); // every 500ms
      frameCount.current = 0;
    }, 500);
  };

  // ── Canvas resize handler ───────────────────────────────────
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    // Invalidate context cache on resize (canvas reset clears context state)
    ctxRef.current = null;
  }, []);

  // ── Mount / unmount ─────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    initMediaPipe(video);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (cameraRef.current) {
        cameraRef.current.getTracks?.().forEach((t) => t.stop());
        cameraRef.current = null;
      }
      if (handsRef.current) {
        handsRef.current.close?.();
        handsRef.current = null;
      }
      if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
    };
  }, []); // eslint-disable-line

  // ── Capture current canvas frame ────────────────────────────
  const captureFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `handframe-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  // ── Switch camera (mobile) ───────────────────────────────────
  const switchCamera = async () => {
    facingModeRef.current = facingModeRef.current === 'user' ? 'environment' : 'user';
    if (cameraRef.current) {
      await cameraRef.current.stop?.();
    }
    if (handsRef.current) {
      await handsRef.current.close?.();
      handsRef.current = null;
    }
    setCameraActive(false);
    setTimeout(() => {
      initMediaPipe(videoRef.current);
    }, 300);
  };

  return (
    <div className="camera-wrapper">
      {/* Video element: must be in DOM (not display:none) for camera_utils to work */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />

      {/* Main rendering canvas */}
      <canvas
        ref={canvasRef}
        className="camera-canvas"
        id="hand-tracking-canvas"
      />
    </div>
  );
});

export default WebcamCanvas;
