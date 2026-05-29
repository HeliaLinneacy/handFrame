/**
 * WebcamCanvas.jsx
 * Core component: manages webcam stream, MediaPipe hand tracking,
 * canvas rendering, and image display inside the gesture rectangle.
 *
 * Mobile Chrome fixes applied:
 *  - Single getUserMedia call (no duplicate stream from App.jsx)
 *  - Adaptive frameRate: 30fps on mobile, 60fps on desktop
 *  - Robust rVFC fallback that handles tab throttling on mobile
 *  - onCameraReady / onCameraError callbacks for App-level loading state
 *  - MediaPipe model complexity 0 for mobile performance
 *
 * Flow:
 *  1. Request camera access (single call)
 *  2. Load MediaPipe Hands via CDN script
 *  3. Per-frame: detect hands → compute rectangle → draw everything
 */

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import { computeRectangle, getHandedness, drawHandSkeleton, drawRectGuide } from '../utils/rectangle';
import { SmoothedRect } from '../utils/smoothing';

// ─────────────────────────────────────────────────────────────
// MediaPipe loads via CDN (avoids bundler issues with WASM)
// ─────────────────────────────────────────────────────────────
const MEDIAPIPE_CDN   = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
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

  script1.onerror = () => {
    mediapipeLoading = false;
    console.error('Failed to load MediaPipe Hands script');
    onLoadCallbacks = [];
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
// Detect mobile device
// ─────────────────────────────────────────────────────────────
const isMobile = () => /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
const WebcamCanvas = forwardRef(function WebcamCanvas(
  { imageSrc, showSkeleton = true, onHandsDetected, onFPS, onGestureChange, onCameraReady, onCameraError },
  ref
) {
  const videoRef        = useRef(null);
  const canvasRef       = useRef(null);
  const handsRef        = useRef(null);       // MediaPipe Hands instance
  const streamRef       = useRef(null);       // active MediaStream (not Camera util)
  const imageRef        = useRef(null);       // Loaded HTMLImageElement
  const smootherRef     = useRef(new SmoothedRect(0.28));
  const rafRef          = useRef(null);       // rAF id for MP feed loop
  const renderRafRef    = useRef(null);       // rAF id for 60fps render loop
  const frameCount      = useRef(0);
  const fpsIntervalRef  = useRef(null);
  const handsResultRef  = useRef([]);
  const facingModeRef   = useRef('user');
  const prevGestureRef  = useRef(false);
  const ctxRef          = useRef(null);       // cached canvas 2d context
  const mountedRef      = useRef(true);       // guard against post-unmount setState

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

  // ── Start camera stream ─────────────────────────────────────
  // SINGLE getUserMedia call — App.jsx no longer pre-checks.
  // Adaptive frameRate: 30fps on mobile (60fps on desktop).
  const startStream = useCallback(async (videoEl) => {
    const mobile = isMobile();
    const targetFps = mobile ? 30 : 60;

    // Resolution: reduce on mobile to ease GPU/CPU pressure
    const videoConstraints = {
      facingMode: { ideal: facingModeRef.current },
      width:  { ideal: mobile ? 640 : 1280 },
      height: { ideal: mobile ? 480 : 720  },
      frameRate: { ideal: targetFps, max: targetFps },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      videoEl.srcObject = stream;
      streamRef.current = stream;

      // playsInline is already set in JSX; required for iOS/Android
      await videoEl.play();

      if (!mountedRef.current) return;
      setCameraActive(true);
      onCameraReady?.();
      startFPSCounter();
      startFeedLoop(videoEl);
      startRenderLoop();

    } catch (err) {
      console.error('Camera error:', err);
      let msg = 'Không thể truy cập camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Bạn đã từ chối quyền camera. Hãy cấp quyền trong cài đặt trình duyệt.';
      } else if (err.name === 'NotFoundError') {
        msg = 'Không tìm thấy camera trên thiết bị này.';
      } else if (err.name === 'NotReadableError') {
        msg = 'Camera đang được ứng dụng khác sử dụng.';
      } else if (err.name === 'OverconstrainedError') {
        // Retry with minimal constraints (very old/basic cameras)
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (!mountedRef.current) { fallbackStream.getTracks().forEach(t => t.stop()); return; }
          videoEl.srcObject = fallbackStream;
          streamRef.current = fallbackStream;
          await videoEl.play();
          setCameraActive(true);
          onCameraReady?.();
          startFPSCounter();
          startFeedLoop(videoEl);
          startRenderLoop();
          return;
        } catch {
          msg = 'Camera không tương thích với thiết bị này.';
        }
      }
      onCameraError?.(msg);
    }
  }, []); // eslint-disable-line

  // ── MediaPipe feed loop ─────────────────────────────────────
  // Uses requestVideoFrameCallback when available (fires per video frame),
  // with a rAF fallback. A heartbeat timer restarts the loop if throttled
  // (e.g. mobile Chrome suspends rVFC when tab is in background).
  const startFeedLoop = useCallback((videoEl) => {
    let mpBusy = false;

    const feedMP = async () => {
      if (!mountedRef.current || !videoEl.srcObject) return;
      if (!mpBusy && handsRef.current && videoEl.readyState >= 2) {
        mpBusy = true;
        try {
          await handsRef.current.send({ image: videoEl });
        } catch {
          /* ignore individual frame errors */
        } finally {
          mpBusy = false;
        }
      }
      // Schedule next frame
      if (videoEl.srcObject && mountedRef.current) {
        if ('requestVideoFrameCallback' in videoEl) {
          videoEl.requestVideoFrameCallback(feedMP);
        } else {
          rafRef.current = requestAnimationFrame(feedMP);
        }
      }
    };

    // Kick off
    if ('requestVideoFrameCallback' in videoEl) {
      videoEl.requestVideoFrameCallback(feedMP);
    } else {
      rafRef.current = requestAnimationFrame(feedMP);
    }

    // ── Heartbeat: on mobile, rVFC can silently stop when tab is
    //    backgrounded. Restart every 3s if video is still live.
    const heartbeat = setInterval(() => {
      if (!mountedRef.current || !videoEl.srcObject) { clearInterval(heartbeat); return; }
      if (videoEl.readyState >= 2 && !mpBusy) {
        // Nudge — if rVFC stopped, this rAF call will trigger feedMP again
        if (!('requestVideoFrameCallback' in videoEl)) return;
        videoEl.requestVideoFrameCallback(feedMP);
      }
    }, 3000);

    // Store for cleanup
    rafRef._heartbeat = heartbeat;
  }, []); // eslint-disable-line

  // ── 60fps render loop (decoupled from MediaPipe) ─────────────
  const startRenderLoop = useCallback(() => {
    const loop = () => {
      renderFrameRef.current?.();
      renderRafRef.current = requestAnimationFrame(loop);
    };
    renderRafRef.current = requestAnimationFrame(loop);
  }, []);

  // ── Main initialization ─────────────────────────────────────
  const initMediaPipe = useCallback((videoEl) => {
    loadMediaPipe(() => {
      if (!mountedRef.current) return;

      // eslint-disable-next-line no-undef
      const hands = new Hands({
        locateFile: (file) => `${MEDIAPIPE_FILES}${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,              // fastest model; fine for gesture detection
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });

      hands.onResults((results) => {
        handsResultRef.current = results.multiHandLandmarks?.length > 0
          ? results.multiHandLandmarks.map((lm, i) => ({
              landmarks: lm,
              handednessLabel: results.multiHandedness?.[i]?.label ?? null,
            }))
          : [];
        onHandsDetected?.(handsResultRef.current.length);
      });

      handsRef.current = hands;

      // Start stream after hands model is ready
      startStream(videoEl);
    });
  }, []); // eslint-disable-line

  // ── Render frame on canvas ──────────────────────────────────
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video || video.readyState < 2) return;

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
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      drawHandSkeleton(ctx, hands, canvasSize);
      ctx.restore();
    }

    // ── Compute rectangle ──────────────────────────────────
    const rawRect = computeRectangle(leftHand, rightHand, canvasSize);
    const gestureActive = rawRect?.valid === true;

    if (gestureActive !== prevGestureRef.current) {
      prevGestureRef.current = gestureActive;
      onGestureChange?.(gestureActive);
    }

    const smoothed = smootherRef.current.update(
      rawRect || { x: W / 2, y: H / 2, w: 0, h: 0, angle: 0 },
      gestureActive
    );

    // ── Draw guide rectangle & image ──────────────────────
    if (smoothed.opacity > 0.02) {
      const mirroredRect = { ...smoothed, x: W - smoothed.x };

      ctx.save();
      ctx.globalAlpha = Math.min(smoothed.opacity, 1);
      drawRectGuide(ctx, mirroredRect);
      ctx.restore();

      if (imageRef.current) {
        const img = imageRef.current;
        const { x: mx, y: my, w, h, angle } = mirroredRect;

        ctx.save();
        ctx.globalAlpha = smoothed.opacity;
        ctx.translate(mx, my);
        ctx.rotate(angle);

        const imgAspect  = img.width / img.height;
        const rectAspect = w / h;
        let drawW, drawH;
        if (imgAspect > rectAspect) {
          drawW = w;
          drawH = w / imgAspect;
        } else {
          drawH = h;
          drawW = h * imgAspect;
        }

        ctx.beginPath();
        ctx.rect(-w / 2, -h / 2, w, h);
        ctx.clip();
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }
    }

    frameCount.current++;
  }, [showSkeleton]); // onGestureChange via change-detection, not dep

  // Keep a stable ref so the rAF loop always calls latest renderFrame
  const renderFrameRef = useRef(null);
  renderFrameRef.current = renderFrame;

  // ── FPS counter ─────────────────────────────────────────────
  const startFPSCounter = () => {
    fpsIntervalRef.current = setInterval(() => {
      onFPS?.(frameCount.current * 2); // every 500ms → ×2 = fps
      frameCount.current = 0;
    }, 500);
  };

  // ── Canvas resize handler ───────────────────────────────────
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width  = parent.clientWidth;
    canvas.height = parent.clientHeight;
    ctxRef.current = null; // invalidate on resize
  }, []);

  // ── Mount / unmount ─────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const video = videoRef.current;
    if (!video) return;

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    // Also resize on orientation change (mobile)
    window.addEventListener('orientationchange', resizeCanvas);

    initMediaPipe(video);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('orientationchange', resizeCanvas);

      // Stop camera stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      // Close MediaPipe
      if (handsRef.current) {
        handsRef.current.close?.();
        handsRef.current = null;
      }

      // Clear timers & animation frames
      if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current);
      if (rafRef._heartbeat)      clearInterval(rafRef._heartbeat);
      if (rafRef.current)         cancelAnimationFrame(rafRef.current);
      if (renderRafRef.current)   cancelAnimationFrame(renderRafRef.current);
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

  // ── Switch camera (front ↔ back on mobile) ───────────────────
  const switchCamera = async () => {
    facingModeRef.current = facingModeRef.current === 'user' ? 'environment' : 'user';

    // Stop current stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (handsRef.current) {
      handsRef.current.close?.();
      handsRef.current = null;
    }
    if (rafRef.current)       cancelAnimationFrame(rafRef.current);
    if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
    if (rafRef._heartbeat)    clearInterval(rafRef._heartbeat);

    setCameraActive(false);

    setTimeout(() => {
      if (mountedRef.current) initMediaPipe(videoRef.current);
    }, 300);
  };

  return (
    <div className="camera-wrapper">
      {/* Video element must be in DOM (not display:none) for the stream to work */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        webkit-playsinline="true"
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
