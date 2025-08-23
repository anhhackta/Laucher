# 🌐 Hướng dẫn Quản lý Launcher Online

## Tổng quan hệ thống

Hệ thống bao gồm:
- **API Server**: Backend để quản lý games, events, config
- **Admin Panel**: Web interface để quản lý
- **Tauri App**: Desktop launcher fetch data từ API

## 🚀 Cài đặt và chạy API Server

### 1. Cài đặt dependencies
```bash
cd api-server
npm install
```

### 2. Chạy server
```bash
# Development
npm run dev

# Production
npm start
```

Server sẽ chạy tại: `http://localhost:3001`

### 3. Truy cập Admin Panel
Mở browser: `http://localhost:3001/admin`

## 📊 API Endpoints

### Games Management
- `GET /api/games` - Lấy danh sách games
- `POST /api/games` - Thêm game mới
- `PUT /api/games/:id` - Cập nhật game
- `DELETE /api/games/:id` - Xóa game

### Events Management  
- `GET /api/events` - Lấy danh sách events
- `POST /api/events` - Thêm event mới
- `PUT /api/events/:id` - Cập nhật event

### Configuration
- `GET /api/config` - Lấy cấu hình launcher
- `PUT /api/config` - Cập nhật cấu hình

### Updates
- `GET /api/check-updates?version=1.0.0` - Kiểm tra update

## 🎮 Cách quản lý Games

### Thêm game mới:
1. Vào Admin Panel
2. Click "Add New Game"
3. Điền thông tin:
   - **Name**: Tên game
   - **Version**: Phiên bản (VD: 2.2.3)
   - **Status**: available/coming_soon/installed
   - **Download URL**: Link tải game (.zip)
   - **Background Image**: Link ảnh nền 1920x1080
   - **Description**: Mô tả game

### Cập nhật game:
1. Click "Edit" trên game muốn sửa
2. Thay đổi thông tin
3. Click "Save"

**Launcher sẽ tự động cập nhật khi restart!**

## 📢 Cách quản lý Events

### Thêm event mới:
1. Click "Add New Event"
2. Điền thông tin:
   - **Title**: Tiêu đề event
   - **Description**: Mô tả
   - **Image URL**: Link ảnh event
   - **Date**: Ngày (format: 2025.08.20)
   - **Link**: URL khi click event
   - **Active**: Bật/tắt event

### Event sẽ hiện ngay trên launcher!

## 🎨 Cách thay đổi Background Game

### Cách 1: Qua Admin Panel
1. Edit game
2. Thay đổi "Background Image URL"
3. Save

### Cách 2: Qua API
```javascript
fetch('http://localhost:3001/api/games/game1', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    image_url: 'https://new-background-url.jpg'
  })
})
```

## 🌍 Deploy lên Production

### 1. Deploy API Server

#### Option A: Heroku
```bash
# Tạo Heroku app
heroku create your-launcher-api

# Deploy
git add .
git commit -m "Deploy API"
git push heroku main
```

#### Option B: VPS/Cloud
```bash
# Upload code lên server
scp -r api-server/ user@your-server:/path/to/app

# Trên server
cd /path/to/app
npm install
pm2 start server.js --name "launcher-api"
```

#### Option C: Vercel/Netlify
- Upload folder `api-server` lên platform
- Set environment variables nếu cần

### 2. Cập nhật Tauri App

Trong `src-tauri/src/main.rs`, thay:
```rust
let api_url = "https://your-api-domain.com/api/games";
```

Thay `your-api-domain.com` bằng domain thật của bạn.

### 3. Build và distribute Tauri App
```bash
npm run tauri build
```

## 🔧 Cấu hình nâng cao

### Environment Variables
Tạo file `.env` trong `api-server/`:
```env
PORT=3001
API_URL=https://your-domain.com
DATABASE_URL=mongodb://...
JWT_SECRET=your-secret-key
```

### Database Integration
Thay đổi từ in-memory sang database thật:

```javascript
// Thay vì gameData object
const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
  name: String,
  version: String,
  status: String,
  download_url: String,
  image_url: String,
  last_updated: { type: Date, default: Date.now }
});

const Game = mongoose.model('Game', GameSchema);
```

### Authentication
Thêm login cho Admin Panel:
```javascript
const jwt = require('jsonwebtoken');

// Middleware
function authenticateToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.sendStatus(401);
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Protect admin routes
app.use('/api/games', authenticateToken);
```

## 📱 Mobile App Support

API này cũng có thể dùng cho mobile app:

```javascript
// React Native example
const fetchGames = async () => {
  const response = await fetch('https://your-api.com/api/games');
  const data = await response.json();
  return data.data;
};
```

## 🔄 Auto-Update System

### 1. Version Check
Launcher tự động check version khi khởi động:
```rust
#[tauri::command]
async fn check_updates(current_version: String) -> Result<serde_json::Value, String> {
    // API call to check updates
}
```

### 2. Update Notification
Hiện popup khi có update:
```javascript
if (updateInfo.data?.needs_update) {
  showUpdateDialog(updateInfo.data.latest_version);
}
```

## 📊 Analytics & Monitoring

### 1. Usage Tracking
```javascript
// Track launcher opens
app.post('/api/analytics/launch', (req, res) => {
  // Log user activity
});
```

### 2. Error Reporting
```javascript
// Track errors
app.post('/api/analytics/error', (req, res) => {
  // Log errors from launcher
});
```

## 🛡️ Security Best Practices

1. **HTTPS Only**: Luôn dùng HTTPS cho production
2. **Rate Limiting**: Giới hạn requests
3. **Input Validation**: Validate tất cả input
4. **Authentication**: Bảo vệ admin endpoints
5. **CORS**: Cấu hình CORS đúng cách

## 🚨 Troubleshooting

### Launcher không load games:
1. Check API server có chạy không
2. Check network connection
3. Check CORS settings
4. Xem console logs

### Admin Panel không hoạt động:
1. Check browser console
2. Verify API endpoints
3. Check server logs

### Games không download:
1. Verify download URLs
2. Check file permissions
3. Test URLs manually

## 📈 Scaling

### Load Balancing
```nginx
upstream launcher_api {
    server api1.yourdomain.com;
    server api2.yourdomain.com;
}
```

### CDN cho Assets
- Upload game files lên CDN
- Update download URLs
- Faster downloads globally

### Caching
```javascript
// Redis caching
const redis = require('redis');
const client = redis.createClient();

app.get('/api/games', async (req, res) => {
  const cached = await client.get('games');
  if (cached) {
    return res.json(JSON.parse(cached));
  }
  
  // Fetch from database
  const games = await fetchGamesFromDB();
  await client.setex('games', 300, JSON.stringify(games)); // Cache 5 minutes
  res.json(games);
});
```

## 🎯 Kết luận

Với hệ thống này, bạn có thể:
- ✅ Quản lý games online mà không cần update launcher
- ✅ Thay đổi background, events real-time  
- ✅ Track usage và analytics
- ✅ Auto-update system
- ✅ Scale dễ dàng khi có nhiều user

**Launcher users chỉ cần tải 1 lần, mọi thay đổi đều online!** 🚀