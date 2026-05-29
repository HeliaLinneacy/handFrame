/**
 * App.jsx — Main application component.
 *
 * Key behaviours:
 *  - Auto-starts front camera on mount (no button press needed)
 *  - Manages image array state; passes controlled props to UploadPanel
 *  - Detects gesture falling-edge → advances to next image automatically
 *  - Camera permission is handled entirely by WebcamCanvas (no duplicate stream)
 *  - Compatible with both desktop and mobile Chrome
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import WebcamCanvas from './components/WebcamCanvas';
import UploadPanel from './components/UploadPanel';

// ─────────────────────────────────────────────────────────────
// Instruction steps
// ─────────────────────────────────────────────────────────────
const STEPS = [
  {
    icon: '📤',
    title: 'Bước 1: Tải ảnh lên',
    text: 'Nhấn nút "Chọn ảnh" bên dưới để chọn ảnh JPG, PNG hoặc WEBP bạn muốn hiển thị.',
  },
  {
    icon: '🤙',
    title: 'Bước 2: Giơ hai tay lên',
    text: 'Đưa cả hai bàn tay vào camera. Dùng ngón trỏ và ngón cái để tạo khung hình chữ nhật.',
  },
];

export default function App() {
  // ── Camera / loading state ───────────────────────────────────
  // Start immediately; WebcamCanvas handles the actual permission request
  const [permissionGranted, setPermissionGranted] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingText, setLoadingText] = useState('Đang khởi tạo camera...');

  // ── Image state (lifted from UploadPanel) ────────────────────
  const [images, setImages] = useState([]);       // [{url, name}]
  const [activeIdx, setActiveIdx] = useState(0);
  // Derived: current image url
  const imageSrc = images.length > 0 ? images[activeIdx]?.url ?? null : null;

  // ── Hand / gesture state ─────────────────────────────────────
  const [handsCount, setHandsCount] = useState(0);
  const [gestureActive, setGestureActive] = useState(false);
  const [fps, setFps] = useState(0);

  // ── Instruction state ─────────────────────────────────────────
  const [stepIdx] = useState(0);
  const [instructionDone] = useState(true); // instructions disabled permanently

  // ── UI toggles ────────────────────────────────────────────────
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [toast, setToast] = useState({ show: false, text: '', type: 'success' });

  // ── Refs ───────────────────────────────────────────────────────
  const webcamRef = useRef(null);
  const stepIntervalRef = useRef(null);
  const stepCountRef = useRef(0);
  const prevGestureRef = useRef(false);   // track falling edge of gesture
  const imagesRef = useRef(images);       // stable ref to avoid stale closures
  const activeIdxRef = useRef(activeIdx);

  // Keep refs in sync
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  // ── Toast helper ────────────────────────────────────────────
  const showToast = useCallback((text, type = 'success') => {
    setToast({ show: true, text, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2500);
  }, []);

  // ── Camera ready callback (from WebcamCanvas) ────────────────
  const handleCameraReady = useCallback(() => {
    setLoadingText('Đang tải MediaPipe Hands...');
    // Give MediaPipe extra time to init (mobile needs more)
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    setTimeout(() => setIsLoading(false), isMobile ? 5000 : 3500);
  }, []);

  const handleCameraError = useCallback((errMsg) => {
    setIsLoading(false);
    setPermissionGranted(false);
    showToast(errMsg || 'Không thể truy cập camera. Vui lòng cấp quyền.', 'error');
  }, [showToast]);

  // ── Image management callbacks ──────────────────────────────
  const handleAddImages = useCallback((files) => {
    const newImgs = files.map(f => ({ url: URL.createObjectURL(f), name: f.name }));
    setImages(prev => {
      const updated = [...prev, ...newImgs];
      const newIdx = prev.length; // first newly added
      setActiveIdx(newIdx);
      return updated;
    });
  }, []);

  const handleSelectImage = useCallback((idx) => {
    setActiveIdx(idx);
  }, []);

  const handleRemoveImage = useCallback((idx) => {
    setImages(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      if (updated.length === 0) {
        setActiveIdx(0);
      } else {
        setActiveIdx(i => Math.min(i, updated.length - 1));
      }
      return updated;
    });
  }, []);

  // ── Gesture callbacks ────────────────────────────────────────
  const handleHandsDetected = useCallback((count) => {
    setHandsCount(count);
  }, []);

  const handleGestureChange = useCallback((active) => {
    setGestureActive(active);

    // Detect falling edge (gesture just ended) → advance image
    if (prevGestureRef.current && !active) {
      const imgs = imagesRef.current;
      if (imgs.length > 1) {
        setActiveIdx(prev => (prev + 1) % imgs.length);
      }
    }
    prevGestureRef.current = active;
  }, []);

  const handleFPS = useCallback((val) => setFps(val), []);



  // ── Status display helpers ────────────────────────────────────
  const statusText = () => {
    if (!permissionGranted) return 'Đang bật camera...';
    if (isLoading) return 'Đang tải...';
    if (gestureActive) return 'Gesture đã nhận!';
    if (handsCount > 0) return `${handsCount} tay phát hiện`;
    return 'Camera hoạt động';
  };

  const statusClass = () => {
    if (gestureActive) return 'gesture';
    if (permissionGranted && !isLoading) return 'active';
    return '';
  };

  const instructionHidden = (gestureActive && imageSrc) || instructionDone;
  const currentStep = !imageSrc
    ? STEPS[0]
    : STEPS[Math.min(stepIdx, STEPS.length - 1)];

  return (
    <div className="app">

      {/* ─── Loading overlay (also shown on auto-start) ─────── */}
      <div className={`loading-overlay ${!isLoading ? 'hidden' : ''}`}>
        <div className="spinner" />
        <p className="loading-text">{loadingText}</p>
      </div>

      {/* ─── Camera + Canvas ──────────────────────────────────── */}
      {permissionGranted && (
        <WebcamCanvas
          ref={webcamRef}
          imageSrc={imageSrc}
          showSkeleton={showSkeleton}
          onHandsDetected={handleHandsDetected}
          onGestureChange={handleGestureChange}
          onFPS={handleFPS}
          onCameraReady={handleCameraReady}
          onCameraError={handleCameraError}
        />
      )}

      {/* ─── UI Overlay ───────────────────────────────────────── */}
      {permissionGranted && !isLoading && (
        <div className="ui-overlay">

          {/* Header */}
          <div className="header">
            <div className="logo">
              <div className="logo-icon">✋</div>
              <span className="logo-text">HandFrame AR</span>
            </div>
            <div className={`status-badge ${statusClass()}`}>
              <div className="status-dot" />
              <span>{statusText()}</span>
            </div>
          </div>

          {/* Instruction card */}
          <div className={`instruction-card ${instructionHidden ? 'hidden' : ''}`}>
            <span className="instruction-icon">{currentStep.icon}</span>
            <h2 className="instruction-title">{currentStep.title}</h2>
            <p className="instruction-text">{currentStep.text}</p>
          </div>

          {/* Bottom controls */}
          <div className="bottom-controls">
            <UploadPanel
              images={images}
              activeIdx={activeIdx}
              onAdd={handleAddImages}
              onSelect={handleSelectImage}
              onRemove={handleRemoveImage}
            />

            <div className="action-btns">
              {/* Skeleton toggle */}
              <button
                id="toggle-skeleton-btn"
                className="icon-btn"
                onClick={() => {
                  setShowSkeleton(s => !s);
                  showToast(showSkeleton ? 'Ẩn skeleton' : 'Hiện skeleton');
                }}
                title={showSkeleton ? 'Ẩn skeleton bàn tay' : 'Hiện skeleton bàn tay'}
              >
                {showSkeleton ? '🦴' : '✋'}
              </button>

              {/* Bắt Đầu — only when image uploaded */}
              {images.length > 0 && (
                <button
                  id="start-gesture-btn"
                  className="upload-btn"
                  onClick={() => showToast('Giơ 2 tay lên để tạo khung! ✋🤙')}
                  style={{ fontSize: '13px', padding: '10px 18px' }}
                >
                  🚀 Bắt Đầu
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Hands count badge ────────────────────────────────── */}
      {permissionGranted && !isLoading && (
        <div className="hands-count-badge" style={{ opacity: handsCount > 0 ? 1 : 0 }}>
          {handsCount === 1 && <span>✋ 1 tay — cần thêm 1 tay nữa</span>}
          {handsCount === 2 && !gestureActive && (
            <span>🙌 2 tay — giơ ngón trỏ + ngón cái tạo khung!</span>
          )}
          {handsCount === 2 && gestureActive && images.length > 1 && (
            <span style={{ color: 'var(--accent-primary)' }}>
              ✨ Gesture! Thả tay → ảnh {activeIdx + 1}/{images.length} tiếp theo
            </span>
          )}
          {handsCount === 2 && gestureActive && images.length <= 1 && (
            <span style={{ color: 'var(--accent-primary)' }}>✨ Gesture active!</span>
          )}
        </div>
      )}

      {/* ─── FPS badge ───────────────────────────────────────── */}
      {permissionGranted && !isLoading && (
        <div className="fps-badge">{fps} FPS</div>
      )}

      {/* ─── Toast ───────────────────────────────────────────── */}
      <div className={`toast ${toast.show ? 'show' : ''} ${toast.type}`}>
        {toast.text}
      </div>
    </div>
  );
}
