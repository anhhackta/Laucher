import React, { useState, useEffect } from 'react';
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

  const handleGameSelect = (game: GameInfo) => {
    setSelectedGame(game);
    setCurrentBackground(game.background_id);
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading Game Launcher...</p>
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

  return (
    <div className={`app ${currentTheme}`}>
      {/* Header with Settings */}
      <header className="header">
        <div className="logo">Game Launcher</div>
        <div className="header-controls">
          <button 
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
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
              <img 
                src={game.image_url} 
                alt={game.name}
                className="game-icon"
              />
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
              <h2>Welcome to Game Launcher</h2>
              <p>Select a game from the sidebar to get started!</p>
            </div>
          )}
        </div>
      </div>

      {/* Social Footer */}
      <footer className="social-footer">
        <div className="social-links">
          <button 
            className="social-btn"
            onClick={() => open('https://discord.gg/your-server')}
            title="Discord"
          >
            💬
          </button>
          <button 
            className="social-btn"
            onClick={() => open('https://x.com/LagAnime')}
            title="Twitter/X"
          >
            🐦
          </button>
          <button 
            className="social-btn"
            onClick={() => open('https://facebook.com/anhhackta.official')}
            title="Facebook"
          >
            📘
          </button>
          <button 
            className="social-btn"
            onClick={() => open('mailto:your-email@example.com')}
            title="Email"
          >
            📧
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;