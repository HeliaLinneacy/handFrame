/**
 * UploadPanel.jsx — Controlled component.
 * Image state is managed in App.jsx; this component only handles
 * file picking UI and calls parent callbacks.
 *
 * Props:
 *   images     {Array}    - [{url, name}] array from parent
 *   activeIdx  {number}   - currently displayed image index
 *   onAdd      {fn}       - called with new File[] when user picks files
 *   onSelect   {fn}       - called with index when thumbnail clicked
 *   onRemove   {fn}       - called with index when × clicked
 */
import { useRef } from 'react';

export default function UploadPanel({ images, activeIdx, onAdd, onSelect, onRemove }) {
  const inputRef = useRef(null);

  const handleFiles = (files) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const valid = Array.from(files).filter(f => validTypes.includes(f.type));
    if (valid.length > 0) onAdd(valid);
    // Reset input so same file can be picked again
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="upload-section">
      <span className="upload-label">Ảnh hiển thị</span>
      <div className="upload-area">
        {/* Upload button */}
        <button
          id="upload-image-btn"
          className="upload-btn"
          onClick={() => inputRef.current?.click()}
          title="Chọn ảnh để hiển thị trong khung tay"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          {images.length === 0 ? 'Chọn ảnh' : 'Thêm ảnh'}
        </button>

        {/* Image thumbnails */}
        {images.map((img, idx) => (
          <div
            key={img.url}
            className="img-thumb"
            onClick={() => onSelect(idx)}
            title={img.name}
            style={{
              outline: idx === activeIdx ? '2px solid var(--accent-primary)' : '2px solid transparent',
              outlineOffset: '2px',
            }}
          >
            <img src={img.url} alt={img.name} />
            <div
              className="img-thumb-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
              title="Xóa ảnh"
            >
              ×
            </div>
          </div>
        ))}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        id="file-input"
      />
    </div>
  );
}
