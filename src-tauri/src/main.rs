use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[derive(Debug, Deserialize, Clone)]
struct GameManifest {
    games: Vec<ManifestGame>,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
struct DownloadUrl {
    name: String,
    url: String,
    #[serde(default, rename = "type")]
    content_type: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize, Clone)]
struct ManifestGame {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    download_urls: Option<Vec<DownloadUrl>>,
    #[serde(default)]
    executable_path: Option<String>,
    #[serde(default)]
    image_url: Option<String>,
    #[serde(default)]
    logo_url: Option<String>,
    #[serde(default)]
    background_id: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    file_size: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
    #[serde(default)]
    changelog: Option<String>,
    #[serde(default)]
    is_coming_soon: bool,
    #[serde(default)]
    repair_enabled: bool,
}

#[derive(Debug, Serialize, Clone)]
struct GameEntry {
    id: String,
    name: String,
    version: String,
    status: String,
    download_url: Option<String>,
    download_urls: Option<Vec<DownloadUrl>>,
    executable_path: Option<String>,
    image_url: Option<String>,
    logo_url: Option<String>,
    description: Option<String>,
    file_size: Option<String>,
    release_date: Option<String>,
    changelog: Option<String>,
    is_coming_soon: bool,
    repair_enabled: bool,
    install_dir: Option<String>,
    installed_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct InstalledGame {
    version: String,
    install_dir: String,
    executable_rel_path: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct InstallRegistry {
    games: HashMap<String, InstalledGame>,
}

#[derive(Debug, Serialize, Clone)]
struct DownloadProgressPayload {
    game_id: String,
    url_name: String,
    status: String,
    progress: Option<f64>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    speed_bytes_per_second: u64,
    message: Option<String>,
    install_dir: Option<String>,
    executable_path: Option<String>,
}

#[tauri::command]
fn load_games() -> Result<Vec<GameEntry>, String> {
    let manifest = read_manifest()?;
    let games_dir = ensure_games_directory()?;
    let registry = load_registry()?;

    let mut result = Vec::with_capacity(manifest.games.len());

    for game in manifest.games {
        let mut entry = GameEntry {
            id: game.id.clone(),
            name: game.name.clone(),
            version: game.version.clone(),
            status: game.status.clone().unwrap_or_else(|| "available".into()),
            download_url: game.download_url.clone(),
            download_urls: game.download_urls.clone(),
            executable_path: None,
            image_url: game.image_url.clone(),
            logo_url: game.logo_url.clone(),
            description: game.description.clone(),
            file_size: game.file_size.clone(),
            release_date: game.release_date.clone(),
            changelog: game.changelog.clone(),
            is_coming_soon: game.is_coming_soon,
            repair_enabled: game.repair_enabled,
            install_dir: None,
            installed_version: None,
        };

        if game.is_coming_soon {
            entry.status = "coming_soon".to_string();
            result.push(entry);
            continue;
        }

        let install_dir = games_dir.join(&game.id);
        let registry_entry = registry.games.get(&game.id);

        if let Some(reg) = registry_entry {
            let exec_path = PathBuf::from(&reg.install_dir).join(&reg.executable_rel_path);
            if exec_path.exists() {
                entry.executable_path = Some(exec_path.to_string_lossy().to_string());
                entry.install_dir = Some(reg.install_dir.clone());
                entry.installed_version = Some(reg.version.clone());

                if reg.version == game.version {
                    entry.status = "installed".into();
                } else {
                    entry.status = "update_available".into();
                }
            }
        } else if install_dir.exists() {
            if let Ok(Some(exec_path)) = find_executable_in_directory(&install_dir) {
                entry.executable_path = Some(exec_path.to_string_lossy().to_string());
                entry.install_dir = Some(install_dir.to_string_lossy().to_string());
                entry.status = "installed".into();
            }
        }

        result.push(entry);
    }

    Ok(result)
}

#[tauri::command]
fn get_install_directory() -> Result<String, String> {
    let dir = ensure_games_directory()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn install_game(
    app_handle: AppHandle,
    game_id: String,
    version: String,
    download_url: String,
    url_name: Option<String>,
) -> Result<(), String> {
    let url_name = url_name.unwrap_or_else(|| "Download".to_string());
    let games_dir = ensure_games_directory()?;
    let install_dir = games_dir.join(&game_id);

    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)
            .map_err(|e| format!("Failed to clean install directory: {e}"))?;
    }

    fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Failed to create install directory: {e}"))?;

    let zip_path = install_dir.join("package.zip");
    let mut emit = |status: &str,
                    progress: Option<f64>,
                    downloaded_bytes: u64,
                    total_bytes: Option<u64>,
                    speed: u64,
                    message: Option<String>,
                    executable_path: Option<String>| {
        let payload = DownloadProgressPayload {
            game_id: game_id.clone(),
            url_name: url_name.clone(),
            status: status.to_string(),
            progress,
            downloaded_bytes,
            total_bytes,
            speed_bytes_per_second: speed,
            message,
            install_dir: Some(install_dir.to_string_lossy().to_string()),
            executable_path,
        };

        let _ = app_handle.emit_all("download-progress", payload);
    };

    emit("started", Some(0.0), 0, None, 0, None, None);

    let response = reqwest::get(&download_url).await.map_err(|err| {
        let message = format!("Failed to start download: {err}");
        emit("error", Some(0.0), 0, None, 0, Some(message.clone()), None);
        message
    })?;

    if !response.status().is_success() {
        let message = format!("Download failed with status {}", response.status());
        emit("error", Some(0.0), 0, None, 0, Some(message.clone()), None);
        return Err(message);
    }

    let total_size = response.content_length();
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file =
        File::create(&zip_path).map_err(|err| format!("Failed to create archive file: {err}"))?;

    let mut last_emit = Instant::now();
    let mut last_emitted_bytes = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| {
            let message = format!("Download error: {err}");
            emit(
                "error",
                None,
                downloaded,
                total_size,
                0,
                Some(message.clone()),
                None,
            );
            message
        })?;

        file.write_all(&chunk)
            .map_err(|err| format!("Failed to write to archive: {err}"))?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(250) || Some(downloaded) == total_size {
            let elapsed = last_emit.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                ((downloaded - last_emitted_bytes) as f64 / elapsed) as u64
            } else {
                0
            };

            let progress = total_size.map(|size| {
                if size == 0 {
                    0.0
                } else {
                    (downloaded as f64 / size as f64) * 100.0
                }
            });

            emit(
                "progress", progress, downloaded, total_size, speed, None, None,
            );

            last_emit = Instant::now();
            last_emitted_bytes = downloaded;
        }
    }

    emit(
        "extracting",
        Some(100.0),
        downloaded,
        total_size,
        0,
        None,
        None,
    );

    drop(file);

    let archive_file =
        File::open(&zip_path).map_err(|err| format!("Failed to open archive: {err}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|err| format!("Failed to read archive: {err}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|err| format!("Failed to extract archive entry: {err}"))?;
        let out_path = sanitize_archive_path(&install_dir, file.name())?;

        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path)
                .map_err(|err| format!("Failed to create directory: {err}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to prepare file path: {err}"))?;
        }

        let mut outfile = File::create(&out_path)
            .map_err(|err| format!("Failed to create file {:?}: {err}", out_path))?;
        io::copy(&mut file, &mut outfile)
            .map_err(|err| format!("Failed to write file {:?}: {err}", out_path))?;
    }

    let _ = fs::remove_file(&zip_path);

    let executable = find_executable_in_directory(&install_dir)?
        .ok_or_else(|| "No executable file found after extraction".to_string())?;

    let executable_rel = executable
        .strip_prefix(&install_dir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| executable.to_string_lossy().to_string());

    let mut registry = load_registry()?;
    registry.games.insert(
        game_id.clone(),
        InstalledGame {
            version: version.clone(),
            install_dir: install_dir.to_string_lossy().to_string(),
            executable_rel_path: executable_rel.clone(),
        },
    );
    save_registry(&registry)?;

    emit(
        "completed",
        Some(100.0),
        downloaded,
        total_size,
        0,
        None,
        Some(executable.to_string_lossy().to_string()),
    );

    Ok(())
}

#[tauri::command]
async fn launch_game(executable_path: String) -> Result<(), String> {
    let path = PathBuf::from(&executable_path);
    if !path.exists() {
        return Err("Executable file not found".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&path)
            .spawn()
            .map_err(|err| format!("Failed to launch game: {err}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(&path)
            .spawn()
            .map_err(|err| format!("Failed to launch game: {err}"))?;
    }

    Ok(())
}

fn read_manifest() -> Result<GameManifest, String> {
    let candidates = manifest_locations();

    for candidate in candidates {
        if candidate.exists() {
            let content = fs::read_to_string(&candidate)
                .map_err(|err| format!("Failed to read manifest {:?}: {err}", candidate))?;
            return serde_json::from_str::<GameManifest>(&content)
                .map_err(|err| format!("Failed to parse manifest {:?}: {err}", candidate));
        }
    }

    Err("Unable to locate manifest.json".into())
}

fn manifest_locations() -> Vec<PathBuf> {
    let mut locations = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            locations.push(parent.join("manifest.json"));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        locations.push(current_dir.join("manifest.json"));
    }

    locations
}

fn ensure_games_directory() -> Result<PathBuf, String> {
    let base = launcher_root()?;
    let games_dir = base.join("games");
    fs::create_dir_all(&games_dir)
        .map_err(|err| format!("Failed to create games directory: {err}"))?;
    Ok(games_dir)
}

fn launcher_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|err| format!("Failed to determine launcher path: {err}"))?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Unable to resolve launcher directory".to_string())
}

fn registry_path() -> Result<PathBuf, String> {
    let base = launcher_root()?;
    Ok(base.join("installed_games.json"))
}

fn load_registry() -> Result<InstallRegistry, String> {
    let path = registry_path()?;
    if !path.exists() {
        return Ok(InstallRegistry::default());
    }

    let data =
        fs::read_to_string(&path).map_err(|err| format!("Failed to read registry: {err}"))?;
    serde_json::from_str(&data).map_err(|err| format!("Failed to parse registry: {err}"))
}

fn save_registry(registry: &InstallRegistry) -> Result<(), String> {
    let path = registry_path()?;
    let json = serde_json::to_string_pretty(registry)
        .map_err(|err| format!("Failed to serialize registry: {err}"))?;
    fs::write(&path, json).map_err(|err| format!("Failed to save registry: {err}"))
}

fn find_executable_in_directory(dir: &Path) -> Result<Option<PathBuf>, String> {
    if !dir.exists() {
        return Ok(None);
    }

    let mut stack = vec![dir.to_path_buf()];
    let mut candidates: Vec<PathBuf> = Vec::new();

    while let Some(current) = stack.pop() {
        for entry in fs::read_dir(&current)
            .map_err(|err| format!("Failed to read directory {:?}: {err}", current))?
        {
            let entry = entry.map_err(|err| format!("Failed to inspect entry: {err}"))?;
            let path = entry.path();

            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("exe"))
                .unwrap_or(false)
            {
                candidates.push(path);
            }
        }
    }

    candidates.sort_by_key(|path| executable_score(path));

    Ok(candidates.first().cloned())
}

fn executable_score(path: &Path) -> i32 {
    let depth = path.components().count() as i32;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let mut score = depth * 10;

    if name.contains("unins") || name.contains("uninstall") {
        score += 1_000;
    }

    if name.contains("setup") || name.contains("install") {
        score += 500;
    }

    if name.contains("launcher") {
        score += 200;
    }

    if name.contains("game") || name.contains("play") {
        score -= 50;
    }

    score
}

fn sanitize_archive_path(base: &Path, entry: &str) -> Result<PathBuf, String> {
    let mut path = PathBuf::new();

    for component in Path::new(entry).components() {
        match component {
            std::path::Component::Prefix(_) | std::path::Component::RootDir => {
                continue;
            }
            std::path::Component::CurDir => continue,
            std::path::Component::ParentDir => {
                return Err("Archive contains parent directory traversal".into());
            }
            std::path::Component::Normal(name) => path.push(name),
        }
    }

    Ok(base.join(path))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_games,
            get_install_directory,
            install_game,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
