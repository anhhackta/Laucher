import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type DownloadUrl = {
  name: string;
  url: string;
  size?: string;
  primary?: boolean;
  content_type?: string;
};

type GameEntry = {
  id: string;
  name: string;
  version: string;
  status: string;
  download_url?: string | null;
  download_urls?: DownloadUrl[] | null;
  executable_path?: string | null;
  image_url?: string | null;
  description?: string | null;
  file_size?: string | null;
  release_date?: string | null;
  changelog?: string | null;
  is_coming_soon: boolean;
  repair_enabled: boolean;
  install_dir?: string | null;
  installed_version?: string | null;
};

type DownloadProgress = {
  status: string;
  urlName: string;
  progress?: number;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSecond: number;
  message?: string | null;
  installDir?: string | null;
  executablePath?: string | null;
};

type DownloadEventPayload = {
  game_id: string;
  url_name: string;
  status: string;
  progress?: number;
  downloaded_bytes: number;
  total_bytes?: number;
  speed_bytes_per_second: number;
  message?: string;
  install_dir?: string;
  executable_path?: string;
};

const formatBytes = (bytes?: number) => {
  if (!bytes || Number.isNaN(bytes)) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

const formatSpeed = (bytesPerSecond?: number) => {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return "0 B/s";
  }

  return `${formatBytes(bytesPerSecond)}/s`;
};

const getDefaultTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

function App() {
  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installDirectory, setInstallDirectory] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [serverSelection, setServerSelection] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState<"light" | "dark">(() => getDefaultTheme());

  const loadGames = useCallback(
    async (focusId?: string) => {
      try {
        setLoading(true);
        setLoadError(null);
        const data = await invoke<GameEntry[]>("load_games");
        setGames(data);
        setSelectedGameId((current) => {
          if (focusId && data.some((game) => game.id === focusId)) {
            return focusId;
          }

          if (current && data.some((game) => game.id === current)) {
            return current;
          }

          return data[0]?.id ?? null;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refreshInstallDirectory = useCallback(async () => {
    try {
      const dir = await invoke<string>("get_install_directory");
      setInstallDirectory(dir);
    } catch (err) {
      console.warn("Failed to resolve install directory", err);
    }
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    loadGames();
    refreshInstallDirectory();
  }, [loadGames, refreshInstallDirectory]);

  useEffect(() => {
    const unlistenPromise = listen<DownloadEventPayload>("download-progress", (event) => {
      const payload = event.payload;
      setDownloadProgress((prev) => {
        const next: Record<string, DownloadProgress> = { ...prev };
        next[payload.game_id] = {
          status: payload.status,
          urlName: payload.url_name,
          progress: payload.progress ?? prev[payload.game_id]?.progress,
          downloadedBytes: payload.downloaded_bytes,
          totalBytes: payload.total_bytes,
          speedBytesPerSecond: payload.speed_bytes_per_second,
          message: payload.message,
          installDir: payload.install_dir,
          executablePath: payload.executable_path ?? prev[payload.game_id]?.executablePath,
        };
        return next;
      });

      if (payload.status === "completed") {
        loadGames(payload.game_id);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadGames]);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId]
  );

  const availableDownloads = useMemo(() => {
    if (!selectedGame) {
      return [] as DownloadUrl[];
    }

    if (selectedGame.download_urls && selectedGame.download_urls.length > 0) {
      return selectedGame.download_urls;
    }

    if (selectedGame.download_url) {
      return [
        {
          name: "Primary Server",
          url: selectedGame.download_url,
          primary: true,
        },
      ];
    }

    return [] as DownloadUrl[];
  }, [selectedGame]);

  const selectedDownloadUrl = useMemo(() => {
    if (!selectedGame) {
      return undefined;
    }

    const stored = serverSelection[selectedGame.id];
    const options = availableDownloads;

    if (stored) {
      return options.find((option) => option.url === stored) ?? options[0];
    }

    return options.find((option) => option.primary) ?? options[0];
  }, [availableDownloads, selectedGame, serverSelection]);

  const activeProgress = selectedGame ? downloadProgress[selectedGame.id] : undefined;
  const busyStatuses = new Set(["started", "progress", "extracting"]);
  const isBusy = activeProgress ? busyStatuses.has(activeProgress.status) : false;

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const handleInstall = async (game: GameEntry) => {
    const downloadTarget = selectedDownloadUrl ?? availableDownloads[0];
    if (!downloadTarget) {
      return;
    }

    setDownloadProgress((prev) => ({
      ...prev,
      [game.id]: {
        status: "started",
        urlName: downloadTarget.name,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: undefined,
        speedBytesPerSecond: 0,
      },
    }));

    try {
      await invoke("install_game", {
        gameId: game.id,
        version: game.version,
        downloadUrl: downloadTarget.url,
        urlName: downloadTarget.name,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDownloadProgress((prev) => ({
        ...prev,
        [game.id]: {
          status: "error",
          urlName: downloadTarget.name,
          progress: prev[game.id]?.progress,
          downloadedBytes: prev[game.id]?.downloadedBytes ?? 0,
          totalBytes: prev[game.id]?.totalBytes,
          speedBytesPerSecond: 0,
          message,
          installDir: prev[game.id]?.installDir,
          executablePath: prev[game.id]?.executablePath,
        },
      }));
    }
  };

  const handlePlay = async (game: GameEntry) => {
    if (!game.executable_path) {
      return;
    }

    try {
      await invoke("launch_game", { executablePath: game.executable_path });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDownloadProgress((prev) => ({
        ...prev,
        [game.id]: {
          status: "error",
          urlName: prev[game.id]?.urlName ?? "Launch",
          progress: prev[game.id]?.progress,
          downloadedBytes: prev[game.id]?.downloadedBytes ?? 0,
          totalBytes: prev[game.id]?.totalBytes,
          speedBytesPerSecond: 0,
          message,
          installDir: prev[game.id]?.installDir,
          executablePath: game.executable_path ?? prev[game.id]?.executablePath,
        },
      }));
    }
  };

  const handleServerChange = (gameId: string, url: string) => {
    setServerSelection((prev) => ({ ...prev, [gameId]: url }));
  };

  const renderStatusChip = (status: string) => {
    switch (status) {
      case "installed":
        return <span className="status-chip status-installed">Installed</span>;
      case "update_available":
        return <span className="status-chip status-update">Update</span>;
      case "coming_soon":
        return <span className="status-chip status-coming">Coming Soon</span>;
      default:
        return <span className="status-chip status-available">Available</span>;
    }
  };

  const primaryActionLabel = (game: GameEntry) => {
    if (game.status === "installed" && game.executable_path) {
      return "Play";
    }
    if (game.status === "update_available") {
      return "Update";
    }
    return "Install";
  };

  const actionHandler = (game: GameEntry) => {
    if (game.status === "installed" && game.executable_path) {
      void handlePlay(game);
    } else if (!game.is_coming_soon) {
      void handleInstall(game);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-badge">AC</div>
          <span>AntChill Launcher</span>
        </div>
        <div className="toolbar">
          <button className="refresh-button" onClick={() => loadGames(selectedGameId ?? undefined)}>
            Refresh
          </button>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </header>

      <div className="app-content">
        <aside className="game-list">
          <h2>Library</h2>
          <div className="game-cards">
            {games.map((game) => (
              <div
                key={game.id}
                className={`game-card ${selectedGameId === game.id ? "active" : ""}`}
                onClick={() => setSelectedGameId(game.id)}
                role="button"
              >
                <img
                  src={game.image_url ?? "https://dummyimage.com/256x256/1f2330/ffffff&text=Game"}
                  alt={game.name}
                />
                <div className="game-card-info">
                  <span className="game-card-title">{game.name}</span>
                  <div className="game-card-meta">
                    {renderStatusChip(game.status)}
                    <span>v{game.installed_version ?? game.version}</span>
                  </div>
                </div>
              </div>
            ))}

            {!loading && games.length === 0 && (
              <div className="empty-state">No games found in manifest.</div>
            )}
          </div>
        </aside>

        <main className="game-detail">
          {loading && (
            <div className="loading-state">Loading manifest…</div>
          )}

          {!loading && loadError && (
            <div className="error-state">
              <div>
                <strong>Failed to load manifest.</strong>
                <p>{loadError}</p>
                <button className="refresh-button" onClick={() => loadGames()}>
                  Try again
                </button>
              </div>
            </div>
          )}

          {!loading && !loadError && !selectedGame && (
            <div className="empty-state">Select a game to see details.</div>
          )}

          {!loading && !loadError && selectedGame && (
            <>
              <section className="detail-hero">
                <div
                  className="hero-image"
                  style={{
                    backgroundImage: `url(${selectedGame.image_url ?? "https://dummyimage.com/640x360/141824/ffffff&text=No+Artwork"})`,
                  }}
                />
                <div className="hero-info">
                  <div className="hero-top">
                    <div>
                      <h1 className="hero-title">{selectedGame.name}</h1>
                      <div className="hero-meta">
                        <span>Version: {selectedGame.version}</span>
                        {selectedGame.file_size && <span>Size: {selectedGame.file_size}</span>}
                        {selectedGame.release_date && <span>Released: {selectedGame.release_date}</span>}
                        {installDirectory && <span>Install Path: {installDirectory}</span>}
                      </div>
                    </div>
                  </div>
                  {selectedGame.description && (
                    <p className="hero-description">{selectedGame.description}</p>
                  )}

                  <div className="action-row">
                    <button
                      className="primary-button"
                      onClick={() => actionHandler(selectedGame)}
                      disabled={isBusy || selectedGame.is_coming_soon || (!selectedDownloadUrl && selectedGame.status !== "installed")}
                    >
                      {selectedGame.is_coming_soon ? "Coming Soon" : primaryActionLabel(selectedGame)}
                    </button>

                    {(selectedGame.status === "installed" || selectedGame.status === "update_available") && !selectedGame.is_coming_soon && (
                      <button
                        className="secondary-button"
                        onClick={() => handleInstall(selectedGame)}
                        disabled={isBusy || !selectedDownloadUrl}
                      >
                        Repair Install
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section className="info-panels">
                <div className="info-card">
                  <span>Status</span>
                  <strong>{selectedGame.status.replace("_", " ")}</strong>
                </div>
                <div className="info-card">
                  <span>Installed Version</span>
                  <strong>{selectedGame.installed_version ?? "Not installed"}</strong>
                </div>
                <div className="info-card">
                  <span>Install Directory</span>
                  <strong>{selectedGame.install_dir ?? "–"}</strong>
                </div>
              </section>

              <section className="download-panel">
                <h3>Download Options</h3>

                {availableDownloads.length === 0 ? (
                  <p className="hero-description">
                    Downloads will be available when the game is released.
                  </p>
                ) : (
                  <div className="download-selection">
                    <label htmlFor="server-select">Select server</label>
                    <select
                      id="server-select"
                      value={selectedDownloadUrl?.url ?? ""}
                      onChange={(event) => handleServerChange(selectedGame.id, event.target.value)}
                    >
                      {availableDownloads.map((option) => (
                        <option key={option.url} value={option.url}>
                          {option.name}
                          {option.size ? ` • ${option.size}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {activeProgress && (
                  <div className="progress-card">
                    <div className="progress-meta">
                      <span>{activeProgress.urlName}</span>
                      <span>{activeProgress.status === "extracting" ? "Extracting" : `${Math.round(activeProgress.progress ?? 0)}%`}</span>
                    </div>
                    <div className="progress-bar-track">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.min(100, Math.round(activeProgress.progress ?? 0))}%` }}
                      />
                    </div>
                    <div className="progress-meta">
                      <span>
                        {formatBytes(activeProgress.downloadedBytes)}
                        {activeProgress.totalBytes ? ` / ${formatBytes(activeProgress.totalBytes)}` : ""}
                      </span>
                      <span>{formatSpeed(activeProgress.speedBytesPerSecond)}</span>
                    </div>
                    {activeProgress.message && <span className="hero-description">{activeProgress.message}</span>}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
