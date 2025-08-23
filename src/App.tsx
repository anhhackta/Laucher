import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/shell';
import './App.css';

interface GameInfo {
  id: string;
  name: string;
  version: string;
  status: string;
  download_url?: string;
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
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLauncher();
  }, []);

  const loadLauncher = async () => {
    try {
      setIsLoading(true);
      
      // Check network status
      const networkResult = await invoke<NetworkStatus>('check_network_status');
      setNetworkStatus(networkResult);
      
      if (!networkResult.is_online) {
        setError('Lỗi mạng vui lòng kiểm tra lại.');
        setIsLoading(false);
        return;
      }

      // Load games
      const gamesResult = await invoke<GameInfo[]>('get_games');
      setGames(gamesResult);
      
      // Set default background
      if (gamesResult.length > 0) {
        setCurrentBackground(gamesResult[0].background_id);
      }

      // Load startup status
      const startupResult = await invoke<boolean>('get_startup_status');
      setStartupWithWindows(startupResult);

      setIsLoading(false);
    } catch (err) {
      setError(err as string);
      setIsLoading(false);
    }
  };

  const handleDownloadGame = async (game: GameInfo) => {
    if (!game.download_url) return;
    
    setDownloading(game.id);
    try {
      await invoke('download_game', { 
        gameId: game.id, 
        downloadUrl: game.download_url 
      });
      // Refresh games list
      const updatedGames = await invoke<GameInfo[]>('get_games');
      setGames(updatedGames);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(null);
    }
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
        <div className="loading-spinner"></div>
        <p>Loading AntChill Launcher by BaHoang...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-screen">
        <h2>Connection Error</h2>
        <p>{error}</p>
        <button onClick={loadLauncher}>Retry</button>
      </div>
    );
  }

  const backgroundStyle = selectedGame
    ? { backgroundImage: `url(${selectedGame.image_url})` }
    : {};

  return (
    <div className={`app ${currentTheme}`} style={backgroundStyle}>
      {/* Tray Mode Indicator */}
      {minimizeToTray}
      
      {/* Header with Settings */}
       <header 
         className="header" 
         ref={headerRef}
         onMouseDown={handleHeaderMouseDown}
         onMouseEnter={handleHeaderMouseEnter}
         onMouseLeave={handleHeaderMouseLeave}
       >
         <div className="logo">
           <img src="/logo.png" alt="AntChill Logo" className="logo-img" />
           <span>AntChill Launcher</span>
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
             <h3>Settings</h3>
             
             <div className="setting-item">
               <label>Theme:</label>
               <select 
                 value={currentTheme} 
                 onChange={(e) => setCurrentTheme(e.target.value as 'light' | 'dark')}
               >
                 <option value="light">Light</option>
                 <option value="dark">Dark</option>
               </select>
             </div>

             <div className="setting-item">
               <label>Startup with Windows:</label>
               <input
                 type="checkbox"
                 checked={startupWithWindows}
                 onChange={(e) => toggleStartupWithWindows(e.target.checked)}
               />
             </div>

             <div className="setting-item">
               <label>Minimize to Tray:</label>
               <input
                 type="checkbox"
                 checked={minimizeToTray}
                 onChange={(e) => setMinimizeToTray(e.target.checked)}
               />
             </div>

             <button 
               className="close-settings"
               onClick={() => setShowSettings(false)}
             >
               Close
             </button>
           </div>
         </>
       )}

      {/* Main Content */}
      <div className="main-content">
        {/* Game Sidebar */}
        <div className="game-sidebar">
          <h3>Games</h3>
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
                  {game.status === 'available' ? 'Available' : 'Coming Soon'}
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
                  {selectedGame.status === 'available' ? (
                    <>
                      {selectedGame.executable_path ? (
                        <button 
                          className="btn-play"
                          onClick={() => handleLaunchGame(selectedGame)}
                        >
                          ▶️ Play
                        </button>
                      ) : (
                        <button 
                          className="btn-install"
                          onClick={() => handleDownloadGame(selectedGame)}
                          disabled={downloading === selectedGame.id}
                        >
                          {downloading === selectedGame.id ? '⏳ Downloading...' : '📥 Install'}
                        </button>
                      )}
                      
                      <button 
                        className="btn-update"
                        onClick={() => handleCheckUpdates(selectedGame)}
                      >
                        🔄 Check Updates
                      </button>
                      
                      {selectedGame.repair_enabled && (
                        <button 
                          className="btn-repair"
                          onClick={() => handleRepairGame(selectedGame)}
                        >
                          🔧 Repair
                        </button>
                      )}
                    </>
                  ) : (
                    <button className="btn-coming-soon" disabled>
                      🕐 Coming Soon
                    </button>
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
              <h2>AntChill</h2>
              <p>Game Launcher by BaHoang </p>
            </div>
          )}
        </div>
      </div>

      {/* Social Sidebar */}
      <aside className="social-sidebar">
        <button
          className="social-btn"
          onClick={() => open('https://yourgame.com')}
          title="Home"
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
          onClick={() => open('https://discord.gg/your-server')}
          title="Discord"
        >
                        <img src="/social/discord.png" alt="Discord" />
        </button>
        <button
          className="social-btn"
          onClick={() => open('mailto:your-email@example.com')}
          title="Email"
        >
                        <img src="/social/email.png" alt="Email" />
        </button>
        {selectedGame && (
          <button
            className="social-btn"
            onClick={() => handleRepairGame(selectedGame)}
            title="Repair"
          >
                          <img src="/social/repair.png" alt="Repair" />
          </button>
        )}
      </aside>
    </div>
  );
}

export default App;