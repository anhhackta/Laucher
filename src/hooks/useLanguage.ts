import { useState, useEffect } from 'react';

type Language = 'en' | 'vi';

interface Translations {
  [key: string]: any;
}

// Hardcode translations instead of using require() which doesn't work in Vite
const translations: Record<Language, Translations> = {
  en: {
    "launcher": {
      "title": "AntChill Launcher",
      "loading": "Loading AntChill Launcher by BaHoang...",
      "welcome": {
        "title": "AntChill"
      },
      "games": {
        "title": "Games",
        "available": "Available",
        "coming_soon": "Coming Soon",
        "installed": "Installed",
        "update_available": "Update Available",
        "play": "▶️ Play",
        "install": "📥 Install",
        "downloading": "⏳ Downloading...",
        "extracting": "📦 Extracting files...",
        "speed_idle": "Waiting...",
        "update_package": "Launcher Update",
        "check_updates": "🔄 Check Updates",
        "repair": "🔧 Repair",
        "coming_soon_btn": "🕐 Coming Soon"
      },
      "settings": {
        "title": "Settings",
        "general": "General",
        "game": "Game",
        "version": "Version: 1.0.0",
        "language": "Language",
        "close_window": "Close Window",
        "startup_behavior": "Startup Behavior",
        "theme": "Theme",
        "minimize_to_tray": "Minimize to system tray",
        "exit_launcher": "Exit Launcher",
        "run_on_startup": "Run AntChill Launcher on startup",
        "theme_light": "Light",
        "theme_dark": "Dark",
        "reload_launcher": "🔄 Reload Launcher",
        "close": "Close",
        "game_installation_directory": "Game Installation Directory",
        "auto_search_info": "Launcher automatically searches for games in:",
        "full_path": "Full path:",
        "example": "Example:",
        "open_folder": "Open Folder",
        "rescan_games": "🔍 Rescan Games",
        "detecting_directory": "Detecting..."
      },
      "status": {
        "offline_mode": "Offline Mode",
        "tray_mode": "Tray Mode",
        "last_check": "Last check:"
      },
      "errors": {
        "connection_error": "Connection Error",
        "retry_connection": "🔄 Retry Connection"
      }
    }
  },
  vi: {
    "launcher": {
      "title": "AntChill Launcher",
      "loading": "Đang tải AntChill Launcher bởi BaHoang...",
      "welcome": {
        "title": "AntChill"
      },
      "games": {
        "title": "Games",
        "available": "Có sẵn",
        "coming_soon": "Sắp ra mắt",
        "installed": "Đã cài đặt",
        "update_available": "Có bản cập nhật",
        "play": "▶️ Chơi",
        "install": "📥 Cài đặt",
        "downloading": "⏳ Đang tải...",
        "extracting": "📦 Đang giải nén...",
        "speed_idle": "Đang chờ...",
        "update_package": "Gói cập nhật",
        "check_updates": "🔄 Kiểm tra cập nhật",
        "repair": "🔧 Sửa chữa",
        "coming_soon_btn": "🕐 Sắp ra mắt"
      },
      "settings": {
        "title": "Cài đặt",
        "general": "Chung",
        "game": "Game",
        "version": "Phiên bản: 1.0.0",
        "language": "Ngôn ngữ",
        "close_window": "Đóng cửa sổ",
        "startup_behavior": "Hành vi khởi động",
        "theme": "Giao diện",
        "minimize_to_tray": "Thu nhỏ vào khay hệ thống",
        "exit_launcher": "Thoát Launcher",
        "run_on_startup": "Chạy AntChill Launcher khi khởi động",
        "theme_light": "Sáng",
        "theme_dark": "Tối",
        "reload_launcher": "🔄 Tải lại Launcher",
        "close": "Đóng",
        "game_installation_directory": "Thư mục cài đặt Game",
        "auto_search_info": "Launcher tự động tìm kiếm game trong:",
        "full_path": "Đường dẫn đầy đủ:",
        "example": "Ví dụ:",
        "open_folder": "Mở thư mục",
        "rescan_games": "🔍 Quét lại game",
        "detecting_directory": "Đang xác định..."
      },
      "status": {
        "offline_mode": "Chế độ Offline",
        "tray_mode": "Chế độ Khay",
        "last_check": "Kiểm tra cuối:"
      },
      "errors": {
        "connection_error": "Lỗi kết nối",
        "retry_connection": "🔄 Thử kết nối lại"
      }
    }
  }
};

export const useLanguage = () => {
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');
  const [t, setT] = useState<Translations>(translations.en);

  useEffect(() => {
    // Load saved language from localStorage
    const savedLanguage = localStorage.getItem('launcher_language') as Language;
    if (savedLanguage && translations[savedLanguage]) {
      setCurrentLanguage(savedLanguage);
      setT(translations[savedLanguage]);
    }
  }, []);

  const changeLanguage = (language: Language) => {
    if (translations[language]) {
      setCurrentLanguage(language);
      setT(translations[language]);
      localStorage.setItem('launcher_language', language);
    }
  };

  const getText = (key: string): string => {
    const keys = key.split('.');
    let value: any = t;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return key; // Return key if translation not found
      }
    }
    
    return typeof value === 'string' ? value : key;
  };

  return {
    currentLanguage,
    changeLanguage,
    t: getText,
    availableLanguages: Object.keys(translations) as Language[]
  };
};
