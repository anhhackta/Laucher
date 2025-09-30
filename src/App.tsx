import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/shell';
import { useLanguage } from './hooks/useLanguage';
import './App.css';

interface DownloadUrl {
  name: string;
  url: string;
  type: string;
  size: string;
  primary: boolean;
}

interface GameInfo {
  id: string;
  name: string;
  version: string;
  status: string;
  download_url?: string;
  download_urls?: DownloadUrl[];
  executable_path?: string;
  image_url: string;
  logo_url?: string;
  background_id: string;
  description: string;
  file_size?: string;
  release_date?: string;
  changelog?: string;
  is_coming_soon: boolean;
  repair_enabled: boolean;
}

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  needs_update: boolean;
  update_url?: string;
  changelog?: string;
}

interface Background {
  id: string;
  name: string;
  image_url: string;
  active: boolean;
}

interface SocialLink {
  id: string;
  icon: string;
  url: string;
  tooltip: string;
  active: boolean;
  action?: string;
}

interface RepairResult {
  success: boolean;
  repaired_files: string[];
  errors: string[];
  message: string;
}

interface NetworkStatus {
  is_online: boolean;
  message: string;
}

function App() {
  const { t, currentLanguage, changeLanguage } = useLanguage();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameInfo | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('light');
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [currentBackground, setCurrentBackground] = useState<string>('');
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({ is_online: true, message: '' });
  const [startupWithWindows, setStartupWithWindows] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [lastOnlineCheck, setLastOnlineCheck] = useState<Date>(new Date());
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'game'>('general');
  const [gameBaseDirectory, setGameBaseDirectory] = useState('C:\\Games\\AntChillGame');
  const [downloadProgress, setDownloadProgress] = useState<{[gameId: string]: {progress: number, urlName: string}}>({});
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLauncher();
    
    // Tắt F12 và Developer Tools
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tắt F12
      if (e.key === 'F12') {
        e.preventDefault();
        return false;
      }
      
      // Tắt Ctrl+Shift+I (Developer Tools)
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        return false;
      }
      
      // Tắt Ctrl+Shift+C (Inspect Element)
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        return false;
      }
      
      // Tắt Ctrl+U (View Source)
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        return false;
      }
      
      // Tắt Ctrl+Shift+J (Console)
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        return false;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    // Tắt right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };
    
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // Kiểm tra kết nối định kỳ
  useEffect(() => {
    const checkConnectionInterval = setInterval(async () => {
      try {
        const result = await invoke<NetworkStatus>('check_network_status');
        setNetworkStatus(result);
        
        if (result.is_online && isOfflineMode) {
          // Chuyển từ offline về online
          setIsOfflineMode(false);
          setError(null);
          // Reload games và social links khi có kết nối trở lại
          const gamesResult = await invoke<GameInfo[]>('get_games');
          setGames(gamesResult);
          
          const socialLinksResult = await invoke<SocialLink[]>('get_social_links');
          setSocialLinks(socialLinksResult);
        } else if (!result.is_online && !isOfflineMode) {
          // Chuyển sang offline mode
          setIsOfflineMode(true);
          setError(null); // Không hiện error khi offline
        }
        
        setLastOnlineCheck(new Date());
      } catch (err) {
        console.error('Connection check failed:', err);
        if (!isOfflineMode) {
          setIsOfflineMode(true);
        }
      }
    }, 30000); // Kiểm tra mỗi 30 giây

    return () => clearInterval(checkConnectionInterval);
  }, [isOfflineMode]);

  const loadLauncher = async () => {
    try {
      setIsLoading(true);
      
      // Check network status
      const networkResult = await invoke<NetworkStatus>('check_network_status');
      setNetworkStatus(networkResult);
      
      if (!networkResult.is_online) {
        // Chuyển sang offline mode
        setIsOfflineMode(true);
        setError(null); // Không hiện error khi offline
        
        // Load offline games data
        const offlineGames = await invoke<GameInfo[]>('get_offline_games');
        setGames(offlineGames);
        
        // Load offline social links
        const offlineSocialLinks = await invoke<SocialLink[]>('get_social_links');
        setSocialLinks(offlineSocialLinks);
        
        if (offlineGames.length > 0) {
          setCurrentBackground(offlineGames[0].background_id);
        }
        
        setIsLoading(false);
        return;
      }

      // Online mode - Load games normally
      const gamesResult = await invoke<GameInfo[]>('get_games');
      console.log('Games loaded from manifest:', gamesResult);
      
      // Scan local game directories to update game status
      try {
        const scannedGames = await invoke<GameInfo[]>('scan_local_games', { games: gamesResult });
        console.log('Games after local scan:', scannedGames);
        setGames(scannedGames);
      } catch (scanError) {
        console.error('Local scan failed, using manifest games:', scanError);
        setGames(gamesResult);
      }
      
      // Load social links from manifest
      const socialLinksResult = await invoke<SocialLink[]>('get_social_links');
      setSocialLinks(socialLinksResult);
      
      // Set default background
      if (gamesResult.length > 0) {
        setCurrentBackground(gamesResult[0].background_id);
      }

      // Load startup status
      const startupResult = await invoke<boolean>('get_startup_status');
      setStartupWithWindows(startupResult);

      setIsOfflineMode(false);
      setIsLoading(false);
    } catch (err) {
      // Fallback to offline mode
      setIsOfflineMode(true);
      setError(null); // Không hiện error khi offline
      
      try {
        const offlineGames = await invoke<GameInfo[]>('get_offline_games');
        setGames(offlineGames);
        
        const offlineSocialLinks = await invoke<SocialLink[]>('get_social_links');
        setSocialLinks(offlineSocialLinks);
        
        if (offlineGames.length > 0) {
          setCurrentBackground(offlineGames[0].background_id);
        }
      } catch (offlineErr) {
        console.error('Failed to load offline data:', offlineErr);
      }
      
      setIsLoading(false);
    }
  };

  const handleDownloadGame = async (game: GameInfo) => {
    if (!game.download_urls || game.download_urls.length === 0) {
      console.error('No download URLs available for game:', game.name);
      return;
    }
    
    setDownloading(game.id);
    
    // Try each download URL in order (primary first, then others)
    const sortedUrls = [...game.download_urls].sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return 0;
    });
    
    let lastError: string = '';
    
    for (let i = 0; i < sortedUrls.length; i++) {
      const downloadUrl = sortedUrls[i];
      console.log(`Trying download URL ${i + 1}/${sortedUrls.length}: ${downloadUrl.name}`);
      
      try {
        // Set initial progress
        setDownloadProgress(prev => ({
          ...prev,
          [game.id]: { progress: 0, urlName: downloadUrl.name }
        }));
        
              await invoke('download_game_with_progress', { 
                gameId: game.id, 
                downloadUrl: downloadUrl.url,
                urlName: downloadUrl.name,
                version: game.version
              });
        
        // Success! Refresh games list
        const updatedGames = await invoke<GameInfo[]>('get_games');
        setGames(updatedGames);
        
        // Clear progress
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[game.id];
          return newProgress;
        });
        
        // Show success notification
        alert(`✅ ${game.name} downloaded and installed successfully!\n\nSource: ${downloadUrl.name}\n\nYou can now play the game!`);
        
        console.log(`Download successful using ${downloadUrl.name}`);
        return;
        
      } catch (err) {
        lastError = err as string;
        console.error(`Download failed with ${downloadUrl.name}:`, err);
        
        // If this is not the last URL, continue to next one
        if (i < sortedUrls.length - 1) {
          console.log(`Trying next download URL...`);
          continue;
        }
      }
    }
    
    // All URLs failed
    console.error('All download URLs failed. Last error:', lastError);
    
    // Clear progress
    setDownloadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[game.id];
      return newProgress;
    });
    
    // Show detailed error message
    const errorMessage = `Download failed for ${game.name}!\n\n` +
      `Tried ${sortedUrls.length} download sources:\n` +
      sortedUrls.map((url, index) => `${index + 1}. ${url.name}`).join('\n') +
      `\n\nLast error: ${lastError}\n\nPlease check your internet connection and try again.`;
    
    alert(errorMessage);
    setDownloading(null);
  };

  const handleLaunchGame = async (game: GameInfo) => {
    if (!game.executable_path) return;
    
    try {
      await invoke('launch_game', { 
        executablePath: game.executable_path 
      });
    } catch (err) {
      console.error('Launch failed:', err);
    }
  };

  const handleCheckUpdates = async (game: GameInfo) => {
    try {
      const updateInfo: UpdateInfo = await invoke('check_game_updates', {
        gameId: game.id,
        currentVersion: game.version
      });
      
      if (updateInfo.needs_update) {
        if (confirm(`Update available: ${updateInfo.latest_version}\n\n${updateInfo.changelog || 'No changelog available'}\n\nUpdate now?`)) {
          await handleGameUpdate(game, updateInfo.update_url!);
        }
      } else {
        alert('Game is up to date!');
      }
    } catch (err) {
      console.error('Update check failed:', err);
    }
  };

  const handleGameUpdate = async (game: GameInfo, updateUrl: string) => {
    setDownloading(game.id);
    try {
      await invoke('download_game_update', {
        gameId: game.id,
        downloadUrl: updateUrl
      });
      // Refresh games list
      const updatedGames = await invoke<GameInfo[]>('get_games');
      setGames(updatedGames);
      alert('Game updated successfully!');
    } catch (err) {
      console.error('Update failed:', err);
      alert('Update failed. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  const handleRepairGame = async (game: GameInfo) => {
    if (!game.repair_enabled) return;
    
    try {
      const result: RepairResult = await invoke('repair_game', {
        gameId: game.id
      });
      
      if (result.success) {
        alert(`Game repaired successfully!\nRepaired files: ${result.repaired_files.join(', ')}`);
      } else {
        alert(`Repair completed with errors:\n${result.errors.join('\n')}`);
      }
    } catch (err) {
      console.error('Repair failed:', err);
      alert('Repair failed. Please try again.');
    }
  };

  const toggleStartupWithWindows = async (enable: boolean) => {
    try {
      await invoke('toggle_startup_with_windows', { enable });
      setStartupWithWindows(enable);
    } catch (err) {
      console.error('Failed to toggle startup:', err);
    }
  };

  const handleSocialLink = (link: SocialLink) => {
    if (link.action === 'repair' && selectedGame) {
      handleRepairGame(selectedGame);
    } else if (link.url) {
      open(link.url);
    }
  };

  const handleMinimize = async () => {
    try {
      if (minimizeToTray) {
        // Minimize to tray
        await invoke('hide_window');
      } else {
        // Regular minimize to taskbar
        await invoke('minimize_window');
      }
    } catch (err) {
      console.error('Minimize failed:', err);
      // Fallback to regular minimize if tray operation fails
      try {
        await invoke('minimize_window');
      } catch (fallbackErr) {
        console.error('Fallback minimize also failed:', fallbackErr);
      }
    }
  };

  const handleClose = async () => {
    try {
      if (minimizeToTray) {
        // Hide to tray instead of closing
        await invoke('hide_window');
      } else {
        // Close the application
        await invoke('close_window');
      }
    } catch (err) {
      console.error('Close failed:', err);
      // Fallback to regular close if tray operation fails
      try {
        await invoke('close_window');
      } catch (fallbackErr) {
        console.error('Fallback close also failed:', fallbackErr);
      }
    }
  };

  const handleHeaderMouseDown = async (e: React.MouseEvent) => {
    // Only allow dragging from the header area, not from buttons
    if (e.target === headerRef.current || (e.target as HTMLElement).closest('.logo')) {
      try {
        await invoke('start_dragging');
      } catch (err) {
        console.error('Start dragging failed:', err);
      }
    }
  };

  const handleHeaderMouseEnter = () => {
    if (headerRef.current) {
      headerRef.current.style.cursor = 'grab';
    }
  };

  const handleHeaderMouseLeave = () => {
    if (headerRef.current) {
      headerRef.current.style.cursor = 'default';
    }
  };

  const handleBrowseGameDirectory = async () => {
    try {
      const result = await invoke<string>('select_directory');
      if (result) {
        setGameBaseDirectory(result);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  };

  const handleChangeGamePath = async (game: GameInfo) => {
    try {
      const result = await invoke<string>('select_directory');
      if (result) {
        // Update game path logic here
        console.log(`Changing path for ${game.name} to: ${result}`);
      }
    } catch (err) {
      console.error('Failed to change game path:', err);
    }
  };

  const handleLocateGame = async (game: GameInfo) => {
    try {
      const result = await invoke<string>('select_file', { 
        title: `Select ${game.name} executable`,
        filters: [{ name: 'Executable', extensions: ['exe'] }]
      });
      if (result) {
        // Update game executable path logic here
        console.log(`Located ${game.name} at: ${result}`);
      }
    } catch (err) {
      console.error('Failed to locate game:', err);
    }
  };

  const handleRescanGames = async () => {
    try {
      // Trigger automatic game scan
      const updatedGames = await invoke<GameInfo[]>('scan_games');
      setGames(updatedGames);
      console.log('Games rescanned successfully');
    } catch (err) {
      console.error('Failed to rescan games:', err);
    }
  };

  const handleOpenGameFolder = async (game: GameInfo) => {
    if (game.executable_path) {
      try {
        // Extract directory path from executable path
        const dirPath = game.executable_path.substring(0, game.executable_path.lastIndexOf('\\'));
        await invoke('open_directory', { path: dirPath });
      } catch (err) {
        console.error('Failed to open game folder:', err);
      }
    }
  };

  const handleOpenGameDirectory = async () => {
    try {
      // Open the main AntChillGame directory
      await invoke('open_directory', { path: 'AntChillGame' });
    } catch (err) {
      console.error('Failed to open game directory:', err);
    }
  };

  const handleGameSelect = (game: GameInfo) => {
    setSelectedGame(game);
    setCurrentBackground(game.background_id);
    
    // Apply game-specific theme colors
    const gamePanel = document.querySelector('.game-panel');
    if (gamePanel) {
      // Remove existing theme classes
      gamePanel.classList.remove('game-theme-1', 'game-theme-2', 'game-theme-3');
      
      // Add theme class based on game ID or name
      if (game.id === 'game1' || game.name.toLowerCase().includes('anime')) {
        gamePanel.classList.add('game-theme-1');
      } else if (game.id === 'game2' || game.name.toLowerCase().includes('action')) {
        gamePanel.classList.add('game-theme-2');
      } else {
        gamePanel.classList.add('game-theme-3');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-video-container">
          <video 
            className="loading-video" 
            autoPlay 
            muted 
            loop
            playsInline
          >
            <source src="/social/loading.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
        <div className="loading-spinner"></div>
        <p>{t('launcher.loading')}</p>
      </div>
    );
  }

  // Chỉ hiện error screen khi thực sự có lỗi và không phải offline mode
  if (error && !isOfflineMode) {
    return (
      <div className="error-screen">
        <h2>{t('launcher.errors.connection_error')}</h2>
        <p>{error}</p>
        <div className="error-actions">
          <button onClick={loadLauncher} className="retry-btn">
            {t('launcher.errors.retry_connection')}
          </button>
        </div>
      </div>
    );
  }

  const backgroundStyle = selectedGame
    ? { backgroundImage: `url(${selectedGame.image_url})` }
    : {};

  return (
    <div className={`app ${currentTheme}`} style={backgroundStyle}>
      {/* Status Indicators */}
      {minimizeToTray && (
        <div className="tray-mode-indicator">
          {t('launcher.status.tray_mode')}
        </div>
      )}
      
      {isOfflineMode && (
        <div className="offline-mode-indicator">
          <span className="offline-icon">📱</span>
          {t('launcher.status.offline_mode')}
          <span className="last-check">
            {t('launcher.status.last_check')} {lastOnlineCheck.toLocaleTimeString()}
          </span>
        </div>
      )}
      
      {/* Header with Settings */}
       <header 
         className="header" 
         ref={headerRef}
         onMouseDown={handleHeaderMouseDown}
         onMouseEnter={handleHeaderMouseEnter}
         onMouseLeave={handleHeaderMouseLeave}
       >
         <div 
           className="logo"
           onClick={() => {
             setSelectedGame(null);
             setCurrentBackground('');
           }}
           style={{ cursor: 'pointer' }}
         >
           <img 
             src="/logo.png" 
             alt="AntChill Logo" 
             className="logo-img" 
             onClick={(e) => {
               e.stopPropagation();
               setSelectedGame(null);
               setCurrentBackground('');
             }}
             style={{ cursor: 'pointer' }}
           />
           <span>{t('launcher.title')}</span>
         </div>
         <div className="header-controls">
           <button 
             className="header-btn settings-btn"
             onClick={() => setShowSettings(!showSettings)}
             title="Settings"
           >
             <img src="/social/settings.png" alt="Settings" />
           </button>
           <button 
             className={`header-btn minimize-btn ${minimizeToTray ? 'active' : ''}`}
             onClick={handleMinimize}
             title={minimizeToTray ? "Minimize to Tray" : "Minimize to Taskbar"}
           >
             <img src="/social/minimize.png" alt="Minimize" />
           </button>
           <button 
             className="header-btn close-btn"
             onClick={handleClose}
             title={minimizeToTray ? "Hide to Tray" : "Close"}
           >
             <img src="/social/close.png" alt="Close" />
           </button>
         </div>
       </header>

             {/* Settings Panel */}
       {showSettings && (
         <>
           <div className="settings-overlay" onClick={() => setShowSettings(false)} />
           <div className="settings-panel">
             <div className="settings-header">
               <h3>{t('launcher.settings.title')}</h3>
               <button 
                 className="close-settings-btn"
                 onClick={() => setShowSettings(false)}
               >
                 ✕
               </button>
             </div>
             
             <div className="settings-content">
               <div className="settings-sidebar">
                 <div 
                   className={`settings-tab ${activeSettingsTab === 'general' ? 'active' : ''}`}
                   onClick={() => setActiveSettingsTab('general')}
                 >
                   {t('launcher.settings.general')}
                 </div>
                 <div 
                   className={`settings-tab ${activeSettingsTab === 'game' ? 'active' : ''}`}
                   onClick={() => setActiveSettingsTab('game')}
                 >
                   {t('launcher.settings.game')}
                 </div>
                 <div className="settings-version">
                   {t('launcher.settings.version')}
                 </div>
               </div>
               
                                <div className="settings-main">
                   {activeSettingsTab === 'general' && (
                     <>
                       <div className="settings-section">
                         <h4>{t('launcher.settings.language')}</h4>
                         <div className="radio-group horizontal">
                           <label className="radio-option">
                             <input
                               type="radio"
                               name="language"
                               value="vi"
                               checked={currentLanguage === 'vi'}
                               onChange={(e) => changeLanguage(e.target.value as 'en' | 'vi')}
                             />
                             <span className="radio-custom"></span>
                             <span className="radio-label">Tiếng Việt</span>
                           </label>
                           <label className="radio-option">
                             <input
                               type="radio"
                               name="language"
                               value="en"
                               checked={currentLanguage === 'en'}
                               onChange={(e) => changeLanguage(e.target.value as 'en' | 'vi')}
                             />
                             <span className="radio-custom"></span>
                             <span className="radio-label">English</span>
                           </label>
                         </div>
                       </div>

                       <div className="settings-section">
                         <h4>{t('launcher.settings.close_window')}</h4>
                         <div className="radio-group vertical">
                           <label className="radio-option">
                             <input
                               type="radio"
                               name="closeBehavior"
                               value="minimize"
                               checked={minimizeToTray}
                               onChange={(e) => setMinimizeToTray(e.target.checked)}
                             />
                             <span className="radio-custom"></span>
                             <span className="radio-label">{t('launcher.settings.minimize_to_tray')}</span>
                           </label>
                           <label className="radio-option">
                             <input
                               type="radio"
                               name="closeBehavior"
                               value="exit"
                               checked={!minimizeToTray}
                               onChange={(e) => setMinimizeToTray(!e.target.checked)}
                             />
                             <span className="radio-custom"></span>
                             <span className="radio-label">{t('launcher.settings.exit_launcher')}</span>
                           </label>
                         </div>
                       </div>

                       <div className="settings-section">
                         <h4>{t('launcher.settings.startup_behavior')}</h4>
                         <div className="toggle-option">
                           <span>{t('launcher.settings.run_on_startup')}</span>
                           <label className="toggle-switch">
                             <input
                               type="checkbox"
                               checked={startupWithWindows}
                               onChange={(e) => toggleStartupWithWindows(e.target.checked)}
                             />
                             <span className="toggle-slider"></span>
                           </label>
                         </div>
                       </div>

                       <div className="settings-section">
                         <h4>{t('launcher.settings.theme')}</h4>
                         <div className="radio-group horizontal">
                           <label className="radio-option">
                             <input
                               type="radio"
                               name="theme"
                               value="light"
                               checked={currentTheme === 'light'}
                               onChange={(e) => setCurrentTheme(e.target.value as 'light' | 'dark')}
                             />
                             <span className="radio-custom"></span>
                             <span className="radio-label">{t('launcher.settings.theme_light')}</span>
                           </label>
                           <label className="radio-option">
                             <input
                               type="radio"
                               name="theme"
                               value="dark"
                               checked={currentTheme === 'dark'}
                               onChange={(e) => setCurrentTheme(e.target.value as 'light' | 'dark')}
                             />
                             <span className="radio-custom"></span>
                             <span className="radio-label">{t('launcher.settings.theme_dark')}</span>
                           </label>
                         </div>
                       </div>

                       <div className="settings-actions">
                         <button 
                           className="reload-launcher-btn"
                           onClick={loadLauncher}
                           title="Reload launcher and refresh all data"
                         >
                           {t('launcher.settings.reload_launcher')}
                         </button>
                         <button 
                           className="rescan-games-btn"
                           onClick={async () => {
                             try {
                               const scannedGames = await invoke<GameInfo[]>('scan_local_games', { games });
                               console.log('Manual rescan result:', scannedGames);
                               setGames(scannedGames);
                             } catch (err) {
                               console.error('Manual rescan failed:', err);
                             }
                           }}
                           title="Rescan local game directories"
                         >
                           🔍 Rescan Games
                         </button>
                       </div>
                     </>
                   )}

                                       {activeSettingsTab === 'game' && (
                      <>
                        <div className="settings-section">
                          <h4>{t('launcher.settings.game_installation_directory')}</h4>
                          <div className="game-directory-info">
                            <p>{t('launcher.settings.auto_search_info')} <code>AntChillGame/</code></p>
                            <p>{t('launcher.settings.full_path')} <code>Ổ đĩa/Folder Launcher/AntChillGame/</code></p>
                            <p>{t('launcher.settings.example')} <code>AntChillGame/Brato.io.v0.01/</code></p>
                          </div>
                          
                          <div className="game-directory-action">
                            <div className="directory-info">
                              <span className="directory-path">AntChillGame</span>
                              <button 
                                className="open-directory-btn"
                                onClick={() => handleOpenGameDirectory()}
                              >
                                {t('launcher.settings.open_folder')}
                              </button>
                            </div>
                          </div>
                        </div>
                        
                        {/* Spacer để giữ kích thước tab bằng với General */}
                        <div className="settings-section">
                          <div className="settings-spacer"></div>
                        </div>
                      </>
                    )}
                 </div>
             </div>
           </div>
         </>
       )}

      {/* Main Content */}
      <div className="main-content">
        {/* Game Sidebar */}
        <div className="game-sidebar">
          <h3>{t('launcher.games.title')}</h3>
          {games.map((game) => (
            <div
              key={game.id}
              className={`game-item ${selectedGame?.id === game.id ? 'selected' : ''}`}
              onClick={() => handleGameSelect(game)}
            >
              <div className="game-logo-container">
                {game.logo_url ? (
                  <img 
                    src={game.logo_url} 
                    alt={`${game.name} Logo`}
                    className="game-logo"
                  />
                ) : (
                  <img 
                    src={game.image_url} 
                    alt={game.name}
                    className="game-icon"
                  />
                )}
              </div>
              <div className="game-info">
                <h4>{game.name}</h4>
                <p>v{game.version}</p>
                                 <span className={`status ${game.status}`}>
                   {game.status === 'available' ? t('launcher.games.available') : t('launcher.games.coming_soon')}
                 </span>
              </div>
            </div>
          ))}
        </div>

        {/* Game Panel */}
        <div className="game-panel">
          {selectedGame ? (
            <>
              <div className="game-header">
                <h2>{selectedGame.name}</h2>
                <div className="game-actions">
                  {selectedGame.status === 'coming_soon' ? (
                    <button className="btn-coming-soon" disabled>
                      {t('launcher.games.coming_soon_btn')}
                    </button>
                  ) : (
                    <>
                      {selectedGame.executable_path ? (
                        <>
                          <button 
                            className="btn-play"
                            onClick={() => handleLaunchGame(selectedGame)}
                          >
                            {t('launcher.games.play')}
                          </button>
                          
                          <button 
                            className="btn-update"
                            onClick={() => handleCheckUpdates(selectedGame)}
                          >
                            {t('launcher.games.check_updates')}
                          </button>
                          
                          {selectedGame.repair_enabled && (
                            <button 
                              className="btn-repair"
                              onClick={() => handleRepairGame(selectedGame)}
                            >
                              {t('launcher.games.repair')}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="download-container">
                          <button 
                            className="btn-install"
                            onClick={() => handleDownloadGame(selectedGame)}
                            disabled={downloading === selectedGame.id}
                          >
                            {downloading === selectedGame.id ? (
                              <div className="download-content">
                                <div className="download-spinner"></div>
                                <span>{t('launcher.games.downloading')}</span>
                              </div>
                            ) : (
                              t('launcher.games.install')
                            )}
                          </button>
                          {downloading === selectedGame.id && downloadProgress[selectedGame.id] && (
                            <div className="download-progress">
                              <div className="progress-bar">
                                <div 
                                  className="progress-fill" 
                                  style={{ width: `${downloadProgress[selectedGame.id].progress}%` }}
                                ></div>
                              </div>
                              <div className="progress-info">
                                <span className="progress-text">
                                  {downloadProgress[selectedGame.id].progress}% - {downloadProgress[selectedGame.id].urlName}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="game-details">
                <div className="game-image">
                  <img src={selectedGame.image_url} alt={selectedGame.name} />
                </div>
                
                <div className="game-info-details">
                  <p className="description">{selectedGame.description}</p>
                  
                  {selectedGame.file_size && (
                    <div className="game-stat">
                      <strong>File Size:</strong> {selectedGame.file_size}
                    </div>
                  )}
                  
                  {selectedGame.release_date && (
                    <div className="game-stat">
                      <strong>Release Date:</strong> {selectedGame.release_date}
                    </div>
                  )}
                  
                  {selectedGame.download_urls && selectedGame.download_urls.length > 0 && (
                    <div className="download-options">
                      <h4>📥 Download Sources</h4>
                      <p className="download-description">
                        Multiple download sources available for faster and more reliable downloads.
                        The launcher will automatically try each source until one succeeds.
                      </p>
                      <div className="download-urls">
                        {selectedGame.download_urls.map((url, index) => (
                          <div key={index} className={`download-option ${url.primary ? 'primary' : ''}`}>
                            <div className="download-info">
                              <div className="download-header">
                                <span className="download-name">{url.name}</span>
                                {url.primary && <span className="primary-badge">PRIMARY</span>}
                              </div>
                              <div className="download-details">
                                <span className="download-size">📦 {url.size}</span>
                                <span className="download-type">🔗 {url.type}</span>
                              </div>
                            </div>
                            <button 
                              className="download-btn"
                              onClick={() => {
                                if (url.primary) {
                                  handleDownloadGame(selectedGame);
                                } else {
                                  open(url.url);
                                }
                              }}
                              disabled={downloading === selectedGame.id}
                            >
                              {url.primary ? '🚀 Auto Download' : '🔗 Open Link'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {selectedGame.changelog && (
                    <div className="changelog">
                      <h4>Changelog:</h4>
                      <p>{selectedGame.changelog}</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="welcome-screen">
              <h2 className="welcome-title">{t('launcher.welcome.title')}</h2>
            </div>
          )}
        </div>
      </div>

      {/* Social Sidebar */}
      <aside className="social-sidebar">
        <button
          className="social-btn"
          onClick={() => open('https://anhhackta.github.io')}
          title="Website"
        >
          <img src="/social/home.png" alt="Home" />
        </button>
        <button
          className="social-btn"
          onClick={() => open('https://facebook.com/anhhackta.official')}
          title="Facebook"
        >
          <img src="/social/facebook.png" alt="Facebook" />
        </button>
        <button
          className="social-btn"
          onClick={() => open('https://discord.gg/3J2nemTtDq')}
          title="Discord"
        >
          <img src="/social/discord.png" alt="Discord" />
        </button>
        <button
          className="social-btn"
          onClick={() => open('mailto:bahoangcran@gmail.com')}
          title="Email Support"
        >
          <img src="/social/email.png" alt="Email" />
        </button>
        {selectedGame && (
          <button
            className="social-btn"
            onClick={() => handleRepairGame(selectedGame)}
            title="Repair Game Files"
          >
            <img src="/social/repair.png" alt="Repair" />
          </button>
        )}
      </aside>
    </div>
  );
}

export default App;