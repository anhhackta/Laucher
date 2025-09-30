
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

import { open } from '@tauri-apps/api/shell';
import { useLanguage } from './hooks/useLanguage';
import './App.css';

type DownloadStatus = 'started' | 'progress' | 'extracting' | 'completed' | 'error';

type GameStatus =
  | 'available'
  | 'installed'
  | 'coming_soon'
  | 'update_available'
  | 'downloading';

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
  status: GameStatus | string;
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

interface DownloadProgressPayload {
  game_id: string;
  url_name: string;
  status: DownloadStatus;
  progress?: number;
  downloaded_bytes: number;
  total_bytes?: number;
  speed_bytes_per_second: number;
  message?: string;
  install_dir?: string;
  executable_path?: string;
}

interface DownloadState {
  status: DownloadStatus;
  urlName: string;
  progress?: number;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSecond: number;
  message?: string;
  installDir?: string;
  executablePath?: string;
}

interface SocialLink {
  id: string;
  icon: string;
  url: string;
  tooltip: string;
  active: boolean;
  action?: string;
}

interface LoadGamesOptions {
  focusGameId?: string;
  showSpinner?: boolean;
}

const statusKeyMap: Record<string, string> = {
  installed: 'launcher.games.installed',
  available: 'launcher.games.available',
  coming_soon: 'launcher.games.coming_soon',
  update_available: 'launcher.games.update_available',
  downloading: 'launcher.games.downloading',
};

const formatBytes = (value?: number) => {
  if (!value || !Number.isFinite(value)) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }


  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatSpeed = (value?: number) => {
  if (!value || !Number.isFinite(value)) {
    return '';
  }

  return `${formatBytes(value)}/s`;
};

const resolveIcon = (icon: string) => {
  if (!icon) {
    return '/social/home.png';
  }

  if (icon.startsWith('http://') || icon.startsWith('https://')) {
    return icon;
  }

  const sanitized = icon.replace(/^src-tauri\//, '/');
  if (sanitized.startsWith('/')) {
    return sanitized;
  }

  return `/social/${sanitized}`;
};

const App: React.FC = () => {
  const { t } = useLanguage();

  const [games, setGames] = useState<GameInfo[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [serverSelection, setServerSelection] = useState<Record<string, string>>({});
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);


  const loadGames = useCallback(
    async ({ focusGameId, showSpinner }: LoadGamesOptions = {}) => {
      if (showSpinner) {
        setLoading(true);

      }


      try {
        setErrorKey(null);
        const manifestGames = await invoke<GameInfo[]>('get_games');

        let mergedGames = manifestGames;
        try {
          mergedGames = await invoke<GameInfo[]>('scan_local_games', { games: manifestGames });
        } catch (scanErr) {
          console.warn('scan_local_games failed:', scanErr);
        }

        setGames(mergedGames);


        setSelectedGameId((previous) => {
          if (focusGameId && mergedGames.some((game) => game.id === focusGameId)) {
            return focusGameId;
          }

          if (previous && mergedGames.some((game) => game.id === previous)) {
            return previous;
          }


          return mergedGames.length > 0 ? mergedGames[0].id : null;
        });

        setServerSelection((previous) => {
          const updated = { ...previous };
          let changed = false;


          mergedGames.forEach((game) => {
            if (!updated[game.id] && game.download_urls && game.download_urls.length > 0) {
              const preferred =
                game.download_urls.find((url) => url.primary)?.name ?? game.download_urls[0]?.name;

              if (preferred) {
                updated[game.id] = preferred;
                changed = true;
              }
            }
          });

          return changed ? updated : previous;
        });
      } catch (err) {
        console.error('Failed to load games', err);
        setGames([]);
        setSelectedGameId(null);
        setErrorKey('launcher.errors.load_manifest');
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    [],
  );


  const loadSocialLinks = useCallback(async () => {
    try {
      const links = await invoke<SocialLink[]>('get_social_links');
      setSocialLinks(links.filter((link) => link.active));
    } catch (err) {
      console.warn('Failed to load social links', err);
    }
  }, []);


  useEffect(() => {
    void loadGames({ showSpinner: true });
    void loadSocialLinks();
  }, [loadGames, loadSocialLinks]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const attachListener = async () => {
      unlisten = await listen<DownloadProgressPayload>('download-progress', (event) => {
        const payload = event.payload;

        setDownloads((previous) => ({
          ...previous,
          [payload.game_id]: {
            status: payload.status,
            urlName: payload.url_name,
            progress: payload.progress,
            downloadedBytes: payload.downloaded_bytes,
            totalBytes: payload.total_bytes,
            speedBytesPerSecond: payload.speed_bytes_per_second,
            message: payload.message,
            installDir: payload.install_dir,
            executablePath: payload.executable_path,
          },
        }));

        if (payload.status === 'completed') {
          setGames((previous) =>
            previous.map((game) =>
              game.id === payload.game_id
                ? {
                    ...game,
                    status: 'installed',
                    executable_path: payload.executable_path ?? game.executable_path,
                  }
                : game,
            ),
          );
          setBusyGameId(null);
          if (!payload.executable_path) {
            void loadGames({ focusGameId: payload.game_id });
          }

        }


        if (payload.status === 'error') {
          setBusyGameId(null);
          setErrorKey('launcher.errors.download_failed');
          setGames((previous) =>
            previous.map((game) =>
              game.id === payload.game_id
                ? {
                    ...game,
                    status: 'available',
                  }
                : game,
            ),
          );
        }
      });
    };


    void attachListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [loadGames]);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId],
  );

  const selectedServer = selectedGame?.download_urls?.length
    ? serverSelection[selectedGame.id] ??
      selectedGame.download_urls.find((url) => url.primary)?.name ??
      selectedGame.download_urls[0]?.name
    : undefined;

  const activeDownload = selectedGame ? downloads[selectedGame.id] : undefined;
  const progressPercent = activeDownload?.progress ?? 0;
  const progressSummary = activeDownload?.totalBytes
    ? `${formatBytes(activeDownload.downloadedBytes)} / ${formatBytes(activeDownload.totalBytes)}`
    : formatBytes(activeDownload?.downloadedBytes ?? 0);
  const progressSpeed = formatSpeed(activeDownload?.speedBytesPerSecond);

  const isBusySelected = selectedGame ? busyGameId === selectedGame.id : false;
  const canPlaySelected = Boolean(selectedGame?.executable_path);
  const isUpdateAvailable = selectedGame?.status === 'update_available';
  const primaryActionLabel = isUpdateAvailable
    ? t('launcher.games.update')
    : canPlaySelected
      ? t('launcher.games.play')
      : t('launcher.games.install');
  const finalPrimaryLabel = isBusySelected
    ? t('launcher.games.downloading')
    : primaryActionLabel;
  const showPlaySecondary = Boolean(selectedGame && isUpdateAvailable && selectedGame.executable_path);

  const handlePrimaryClick = () => {
    if (!selectedGame) {
      return;
    }

    if (isUpdateAvailable || !selectedGame.executable_path) {
      handleInstall(selectedGame);
    } else {
      handlePlay(selectedGame);
    }
  };

  const handleSelectGame = (gameId: string) => {
    setSelectedGameId(gameId);
    setErrorKey(null);
  };

  const handleInstall = (game: GameInfo) => {
    if (!game.download_urls || game.download_urls.length === 0) {
      setErrorKey('launcher.errors.download_start');
      return;
    }

    const serverName =
      serverSelection[game.id] ??
      game.download_urls.find((url) => url.primary)?.name ??
      game.download_urls[0]?.name;

    const server = game.download_urls.find((url) => url.name === serverName) ?? game.download_urls[0];

    if (!server) {
      setErrorKey('launcher.errors.download_start');
      return;
    }

    setBusyGameId(game.id);
    setErrorKey(null);
    setGames((previous) =>
      previous.map((item) =>
        item.id === game.id
          ? {
              ...item,
              status: 'downloading',
            }
          : item,
      ),
    );
    setDownloads((previous) => ({
      ...previous,
      [game.id]: {
        status: 'started',
        urlName: server.name,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: undefined,
        speedBytesPerSecond: 0,
      },
    }));

    void invoke<string>('download_game_with_progress', {
      gameId: game.id,
      downloadUrl: server.url,
      urlName: server.name,
      version: game.version,
    }).catch((err) => {
      console.error('Failed to start download', err);
      setBusyGameId(null);
      setErrorKey('launcher.errors.download_start');
      setDownloads((previous) => ({
        ...previous,
        [game.id]: {
          status: 'error',
          urlName: server.name,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: undefined,
          speedBytesPerSecond: 0,
          message: String(err),
        },
      }));
      setGames((previous) =>
        previous.map((item) =>
          item.id === game.id
            ? {
                ...item,
                status: 'available',
              }
            : item,
        ),
      );
    });
  };

  const handlePlay = (game: GameInfo) => {
    if (!game.executable_path) {
      return;
    }


    setErrorKey(null);
    void invoke('launch_game', { executablePath: game.executable_path }).catch((err) => {
      console.error('Failed to launch game', err);
      setErrorKey('launcher.errors.launch');
    });
  };

  const handleServerChange = (gameId: string, serverName: string) => {
    setServerSelection((previous) => ({
      ...previous,
      [gameId]: serverName,
    }));
  };

  const handleRetry = () => {
    void loadGames({ showSpinner: true, focusGameId: selectedGameId ?? undefined });
  };

  const handleRefresh = () => {
    void loadGames({ showSpinner: true, focusGameId: selectedGameId ?? undefined });
  };

  const getStatusLabel = (status: string) => {
    const key = statusKeyMap[status] ?? statusKeyMap[status.toLowerCase()] ?? null;
    return key ? t(key) : status;
  };


  useEffect(() => {
    if (!selectedGame || !selectedGame.download_urls || selectedGame.download_urls.length === 0) {
      return;
    }

    setDownloadServerSelection((previous) => {
      if (previous[selectedGame.id]) {
        return previous;
      }

      const preferred =
        selectedGame.download_urls.find((url) => url.primary)?.name ??
        selectedGame.download_urls[0]?.name;

      if (!preferred) {
        return previous;
      }

      return {
        ...previous,
        [selectedGame.id]: preferred,
      };
    });
  }, [selectedGame]);

  const resolveSocialIcon = (icon: string) => {
    if (!icon) {
      return '/social/home.png';
    }

    if (icon.startsWith('http://') || icon.startsWith('https://')) {
      return icon;
    }

    const sanitized = icon.replace(/^src-tauri\//, '/');
    if (sanitized.startsWith('/')) {
      return sanitized;
    }

    return `/social/${sanitized}`;
  };

  const handleSocialLinkClick = (link: SocialLink) => {
    if (link.action === 'repair_game') {
      if (selectedGame && selectedGame.repair_enabled) {
        handleRepairGame(selectedGame);
      }
      return;
    }

    if (link.url && link.url !== '#') {
      open(link.url);
    }
  };

  const selectedServerName = selectedGame?.download_urls && selectedGame.download_urls.length > 0
    ? downloadServerSelection[selectedGame.id] ??
      selectedGame.download_urls.find((url) => url.primary)?.name ??
      selectedGame.download_urls[0]?.name
    : undefined;

  return (
    <div className="app">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-card">
            <img src="/logo.png" alt="Launcher" className="loading-logo" />
            <p>{t('launcher.loading')}</p>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/logo.png" alt="AntChill" className="logo" />
          <div className="sidebar-title">
            <span className="launcher-title">{t('launcher.title')}</span>
            <button type="button" className="refresh-button" onClick={handleRefresh}>
              {t('launcher.actions.refresh')}
            </button>
          </div>
        </div>


        <ul className="game-list">
          {games.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                className={`game-button ${selectedGameId === game.id ? 'active' : ''}`}
                onClick={() => handleSelectGame(game.id)}
              >
                <span className="game-name">{game.name}</span>
                <span className="game-version">v{game.version}</span>
                <span className={`status-pill ${game.status}`}>{getStatusLabel(game.status)}</span>
              </button>
            </li>

          ))}
        </ul>

        {socialLinks.length > 0 && (
          <div className="social-section">
            <span className="social-title">{t('launcher.social.connect')}</span>
            <div className="social-links">
              {socialLinks.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  className="social-button"
                  title={link.tooltip}
                  onClick={() => {
                    if (link.url && link.url !== '#') {
                      open(link.url);
                    }
                  }}
                >
                  <img src={resolveIcon(link.icon)} alt={link.tooltip || link.id} />
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>


      <main className="content">
        {errorKey && (
          <div className="error-banner">
            <span>{t(errorKey)}</span>
            <button type="button" onClick={handleRetry}>
              {t('launcher.actions.retry')}
            </button>
          </div>
        )}


        {selectedGame ? (
          <>
            <section
              className="game-hero"
              style={{ backgroundImage: `url(${selectedGame.image_url})` }}
            >
              <div className="hero-overlay" />
              <div className="hero-content">
                <h1 className="game-title">{selectedGame.name}</h1>
                <p className="hero-description">{selectedGame.description}</p>
                <div className="game-meta">
                  <span>
                    {t('launcher.games.details.version')} · v{selectedGame.version}
                  </span>
                  {selectedGame.file_size && (
                    <span>
                      {t('launcher.games.details.size')} · {selectedGame.file_size}
                    </span>
                  )}
                  {selectedGame.release_date && (
                    <span>
                      {t('launcher.games.details.release')} · {selectedGame.release_date}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="actions">
                <div className="action-buttons">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handlePrimaryClick}
                    disabled={isBusySelected}
                  >
                    {finalPrimaryLabel}
                  </button>

                  {showPlaySecondary && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => handlePlay(selectedGame)}
                      disabled={isBusySelected}
                    >
                      {t('launcher.games.play')}
                    </button>
                  )}

                  {selectedGame.download_urls && selectedGame.download_urls.length > 0 && (

                    <div className="server-select">
                      <label htmlFor="server-select">{t('launcher.games.select_download')}</label>
                      <div className="select-wrapper">
                        <select
                          id="server-select"
                          value={selectedServer}
                          onChange={(event) => handleServerChange(selectedGame.id, event.target.value)}
                          disabled={isBusySelected}
                        >
                          {selectedGame.download_urls.map((url) => (
                            <option key={url.name} value={url.name}>
                              {url.name} · {url.size}
                            </option>
                          ))}
                        </select>

                      </div>
                    </div>
                  )}
                </div>

                {selectedGame.executable_path && (
                  <span className="install-path">
                    {t('launcher.games.ready')} {selectedGame.executable_path}
                  </span>
                )}
              </div>


              {activeDownload && (
                <div className={`progress-card ${activeDownload.status}`}>
                  <div className="progress-header">
                    <span>{activeDownload.urlName}</span>
                    <span className="progress-status">
                      {activeDownload.status === 'extracting'
                        ? t('launcher.games.extracting')
                        : `${Math.round(progressPercent)}%`}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${Math.round(progressPercent)}%` }} />
                  </div>
                  <div className="progress-footer">
                    <span>{progressSummary}</span>
                    {progressSpeed && <span>{progressSpeed}</span>}
                  </div>
                </div>
              )}

              {(!selectedGame.download_urls || selectedGame.download_urls.length === 0) && (
                <div className="empty-panel">{t('launcher.games.no_downloads')}</div>
              )}

              {selectedGame.changelog && (
                <div className="changelog">
                  <h2>Changelog</h2>
                  <p>{selectedGame.changelog}</p>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="empty-state">
            <h1>{t('launcher.empty.title')}</h1>
            <p>{t('launcher.empty.subtitle')}</p>
          </div>
        )}
      </main>

    </div>
  );
};

export default App;
