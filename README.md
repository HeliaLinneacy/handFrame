# ✋ HandFrame AR

Trang web nhận diện hai bàn tay realtime và hiển thị ảnh bên trong khung tay — giống AR filter TikTok, chạy hoàn toàn trên trình duyệt không cần backend.

![demo](https://i.imgur.com/placeholder.png)

## 🎯 Tính năng

- 📷 Webcam realtime với MediaPipe Hands tracking
- 🤙 Phát hiện gesture: dùng **ngón trỏ + ngón cái** của 2 tay tạo khung hình chữ nhật
- 🖼️ Upload ảnh JPG/PNG/WEBP và hiển thị trong khung tay
- 🌀 Ảnh di chuyển theo tay: scale, rotate, translate realtime
- 💫 Lerp smoothing — giảm rung lắc tracking
- 📸 Chụp ảnh màn hình (PNG)
- 🔄 Chuyển camera trước/sau (mobile)
- 🦴 Toggle skeleton overlay
- 100% Client-side — không cần đăng nhập, không có backend

## 🚀 Chạy local

```bash
npm install
npm run dev
```

Mở http://localhost:5173

## 🌐 Deploy lên Vercel

### Cách 1: Kéo thả (GUI)
1. Push code lên GitHub
2. Vào [vercel.com](https://vercel.com) → Import repo
3. Framework: **Vite** (tự detect)
4. Nhấn **Deploy**

### Cách 2: Vercel CLI
```bash
npm i -g vercel
vercel
```

## 📁 Cấu trúc

```
handrealtime/
├── src/
│   ├── components/
│   │   ├── WebcamCanvas.jsx   # Core: webcam + MediaPipe + canvas render
│   │   └── UploadPanel.jsx    # Image upload + multi-image
│   ├── utils/
│   │   ├── rectangle.js       # Compute rect from hand landmarks
│   │   └── smoothing.js       # Lerp interpolation
│   ├── App.jsx                # Main UI orchestrator
│   ├── main.jsx
│   └── index.css
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

## 🎮 Cách dùng

1. **Bật camera** — nhấn nút "Bật Camera"
2. **Upload ảnh** — nhấn "Chọn ảnh", chọn file JPG/PNG/WEBP
3. **Giơ 2 tay** lên camera
4. Dùng **ngón trỏ + ngón cái** của cả 2 tay tạo thành 4 góc khung
5. Ảnh xuất hiện trong khung và di chuyển theo tay!

## 🛠️ Tech stack

- **Vite + React** — Build framework
- **MediaPipe Hands** — Hand landmark detection (via CDN)
- **HTML5 Canvas** — Rendering
- **CSS3** — Dark mode glassmorphism design
- **Vercel** — Deployment

## 📜 License

MIT
# handFrame
