# Hướng Dẫn Cập Nhật Game Launcher

## Tổng Quan
Launcher đã được cải tiến với hệ thống quản lý game và cập nhật tự động thông qua `manifest.json` từ cloud storage.

## Cấu Trúc Hệ Thống

### 1. Manifest.json
File `manifest.json` chứa thông tin về:
- Danh sách game
- Phiên bản hiện tại
- URL tải xuống
- Thông tin cập nhật
- Yêu cầu hệ thống

### 2. Quản Lý Game
- **Stellar Quest**: Game đã phát hành (v2.2.3)
- **Mystic Adventures**: Game sắp phát hành (Coming Soon)

## Cách Sử Dụng

### Cài Đặt Game
1. Chọn game từ sidebar
2. Nhấn "Tải xuống" 
3. Game sẽ được tải và giải nén tự động
4. Sau khi hoàn thành, nhấn "Start" để chơi

### Kiểm Tra Cập Nhật
1. Với game đã cài đặt, nhấn "🔄 Kiểm tra cập nhật"
2. Hệ thống sẽ so sánh phiên bản hiện tại với manifest
3. Nếu có cập nhật, hiển thị nút "🆕 Cập nhật ngay"

### Cập Nhật Game
1. Nhấn "🆕 Cập nhật ngay"
2. Hệ thống tạo backup phiên bản cũ
3. Tải và cài đặt phiên bản mới
4. Giữ lại 3 backup gần nhất

## Cấu Hình Cloud Storage

### Google Cloud Storage
```bash
# Tạo bucket
gsutil mb gs://your-game-launcher

# Upload manifest
gsutil cp manifest.json gs://your-game-launcher/

# Upload game files
gsutil cp game.zip gs://your-game-launcher/games/
```

### AWS S3
```bash
# Tạo bucket
aws s3 mb s3://your-game-launcher

# Upload manifest
aws s3 cp manifest.json s3://your-game-launcher/

# Upload game files
aws s3 cp game.zip s3://your-game-launcher/games/
```

### Azure Blob Storage
```bash
# Tạo container
az storage container create --name your-game-launcher

# Upload manifest
az storage blob upload --container-name your-game-launcher --file manifest.json --name manifest.json

# Upload game files
az storage blob upload --container-name your-game-launcher --file game.zip --name games/game.zip
```

## Cập Nhật Manifest

### Khi Phát Hành Game Mới
1. Cập nhật `manifest.json`
2. Thay đổi `status` từ "coming_soon" thành "available"
3. Thêm `download_url` và `file_size`
4. Upload lên cloud storage

### Khi Cập Nhật Game
1. Tăng `version` trong manifest
2. Cập nhật `download_url` với file mới
3. Cập nhật `changelog`
4. Upload lên cloud storage

## Ví Dụ Manifest Cập Nhật

```json
{
  "id": "stellar_quest",
  "name": "Stellar Quest",
  "version": "2.3.0",
  "status": "available",
  "download_url": "https://your-cloud.com/games/stellar_quest_v2.3.0.zip",
  "file_size": "1.3GB",
  "changelog": "Version 2.3.0:\n- New DLC: Galactic Empires\n- Multiplayer improvements\n- Bug fixes and optimizations"
}
```

## Lưu Ý Bảo Mật

1. **HTTPS**: Luôn sử dụng HTTPS cho download
2. **Authentication**: Có thể thêm API key nếu cần
3. **Rate Limiting**: Giới hạn số lần tải xuống
4. **Backup**: Luôn có backup cho manifest và game files

## Troubleshooting

### Game Không Tải Được
- Kiểm tra URL trong manifest
- Kiểm tra quyền truy cập cloud storage
- Kiểm tra kết nối internet

### Cập Nhật Không Hoạt Động
- Kiểm tra version trong manifest
- Kiểm tra download_url có đúng không
- Kiểm tra log trong console

### Backup Không Tạo Được
- Kiểm tra quyền ghi file
- Kiểm tra dung lượng ổ cứng
- Kiểm tra đường dẫn backup

## Tương Lai

### Tính Năng Sắp Tới
- [ ] Auto-update launcher
- [ ] Download manager với pause/resume
- [ ] Game verification (checksum)
- [ ] Cloud save sync
- [ ] Social features (friends, achievements)

### Tối Ưu Hóa
- [ ] Delta updates (chỉ tải phần thay đổi)
- [ ] Peer-to-peer download
- [ ] CDN integration
- [ ] Offline mode support