use std::path::PathBuf;
use std::process::Command;
use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, Manager, AppHandle};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Serialize, Deserialize)]
struct GameInfo {
    id: String,
    name: String,
    version: String,
    status: String,
    download_url: Option<String>,
    executable_path: Option<String>,
    image_url: String,
    background_id: String,
    description: String,
    file_size: Option<String>,
    release_date: Option<String>,
    changelog: Option<String>,
    is_coming_soon: bool,
    repair_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct GameManifest {
    manifest_version: String,
    last_updated: String,
    launcher_config: LauncherConfig,
    backgrounds: HashMap<String, Background>,
    games: Vec<GameInfo>,
    social_links: Vec<SocialLink>,
    settings: ManifestSettings,
}

#[derive(Debug, Serialize, Deserialize)]
struct LauncherConfig {
    current_version: String,
    update_url: String,
    changelog: String,
    auto_check_updates: bool,
    check_interval_hours: i32,
}

#[derive(Debug, Serialize, Deserialize)]
struct Background {
    id: String,
    name: String,
    image_url: String,
    active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct SocialLink {
    id: String,
    icon: String,
    url: String,
    tooltip: String,
    active: bool,
    action: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ManifestSettings {
    startup_with_windows: bool,
    minimize_to_tray: bool,
    auto_check_updates: bool,
    download_path: String,
    max_backups: i32,
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateInfo {
    current_version: String,
    latest_version: String,
    needs_update: bool,
    update_url: Option<String>,
    changelog: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RepairResult {
    success: bool,
    repaired_files: Vec<String>,
    errors: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct NetworkStatus {
    is_online: bool,
    message: String,
}

// Check network connectivity
async fn check_network() -> bool {
    match reqwest::get("https://httpbin.org/get").await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

// Set startup with Windows
fn set_startup_with_windows(enable: bool) -> Result<(), String> {
    let run_key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_READ | KEY_WRITE,
        )
        .map_err(|e| e.to_string())?;

    let app_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    if enable {
        run_key
            .set_value("GameLauncher", &app_path)
            .map_err(|e| e.to_string())?;
    } else {
        run_key
            .delete_value("GameLauncher")
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Check if launcher starts with Windows
fn is_startup_with_windows() -> Result<bool, String> {
    let run_key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_READ,
        )
        .map_err(|e| e.to_string())?;

    match run_key.get_value::<String, _>("GameLauncher") {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn download_game(game_id: String, download_url: String) -> Result<String, String> {
    let app_dir = tauri::api::path::app_data_dir(&tauri::Config::default())
        .ok_or("Could not get app data directory")?;
    
    let games_dir = app_dir.join("games").join(&game_id);
    std::fs::create_dir_all(&games_dir).map_err(|e| e.to_string())?;
    
    let zip_path = games_dir.join("game.zip");
    
    // Download file
    let response = reqwest::get(&download_url).await.map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    
    std::fs::write(&zip_path, bytes).map_err(|e| e.to_string())?;
    
    // Extract zip
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = games_dir.join(file.name());
        
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    
    // Remove zip file
    std::fs::remove_file(&zip_path).map_err(|e| e.to_string())?;
    
    Ok(games_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn launch_game(executable_path: String) -> Result<(), String> {
    let path = PathBuf::from(&executable_path);
    
    #[cfg(target_os = "windows")]
    {
        Command::new(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn get_games() -> Result<Vec<GameInfo>, String> {
    // Check network first
    if !check_network().await {
        return Err("No internet connection. Please check your network and try again.".to_string());
    }

    let manifest_url = "https://your-username.github.io/your-game-launcher/manifest.json";
    
    match reqwest::get(manifest_url).await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<GameManifest>().await {
                    Ok(manifest) => {
                        println!("Successfully loaded manifest with {} games", manifest.games.len());
                        return Ok(manifest.games);
                    }
                    Err(e) => eprintln!("Failed to parse manifest: {}", e),
                }
            }
        }
        Err(e) => eprintln!("Failed to fetch manifest: {}", e),
    }
    
    // Fallback to local data if manifest fails
    let games = vec![
        GameInfo {
            id: "stellar_quest".to_string(),
            name: "Stellar Quest".to_string(),
            version: "2.2.3".to_string(),
            status: "available".to_string(),
            download_url: Some("https://your-username.github.io/your-game-launcher/games/stellar_quest_v2.2.3.zip".to_string()),
            executable_path: Some("StellarQuest.exe".to_string()),
            image_url: "https://files.catbox.moe/2d8fvz.png".to_string(),
            background_id: "stellar_quest_bg".to_string(),
            description: "A space exploration game with stunning visuals and engaging gameplay.".to_string(),
            file_size: Some("1.2GB".to_string()),
            release_date: Some("2023-01-01".to_string()),
            changelog: Some("Initial release.".to_string()),
            is_coming_soon: false,
            repair_enabled: true,
        },
        GameInfo {
            id: "mystic_adventures".to_string(),
            name: "Mystic Adventures".to_string(),
            version: "1.0.0".to_string(),
            status: "coming_soon".to_string(),
            download_url: None,
            executable_path: None,
            image_url: "https://files.catbox.moe/6f2nc5.png".to_string(),
            background_id: "mystic_adventures_bg".to_string(),
            description: "A mysterious adventure game set in ancient ruins.".to_string(),
            file_size: None,
            release_date: None,
            changelog: None,
            is_coming_soon: true,
            repair_enabled: false,
        },
    ];
    
    Ok(games)
}

#[tauri::command]
async fn check_game_updates(game_id: String, current_version: String) -> Result<UpdateInfo, String> {
    if !check_network().await {
        return Err("No internet connection".to_string());
    }

    let manifest_url = "https://your-username.github.io/your-game-launcher/manifest.json";
    
    match reqwest::get(manifest_url).await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<GameManifest>().await {
                    Ok(manifest) => {
                        if let Some(game) = manifest.games.iter().find(|g| g.id == game_id) {
                            let needs_update = game.version != current_version;
                            return Ok(UpdateInfo {
                                current_version: current_version.clone(),
                                latest_version: game.version.clone(),
                                needs_update,
                                update_url: game.download_url.clone(),
                                changelog: game.changelog.clone(),
                            });
                        }
                    }
                    Err(e) => eprintln!("Failed to parse manifest for update check: {}", e),
                }
            }
        }
        Err(e) => eprintln!("Failed to fetch manifest for update check: {}", e),
    }
    
    Ok(UpdateInfo {
        current_version: current_version.clone(),
        latest_version: current_version,
        needs_update: false,
        update_url: None,
        changelog: None,
    })
}

#[tauri::command]
async fn download_game_update(game_id: String, download_url: String) -> Result<String, String> {
    let app_dir = tauri::api::path::app_data_dir(&tauri::Config::default())
        .ok_or("Could not get app data directory")?;
    
    let games_dir = app_dir.join("games").join(&game_id);
    
    // Create backup of current installation
    let backup_dir = app_dir.join("backups").join(&game_id).join(format!("backup_{}", chrono::Utc::now().timestamp()));
    if games_dir.exists() {
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
        copy_dir_recursive(&games_dir, &backup_dir).map_err(|e| e.to_string())?;
    }
    
    // Download and extract new version
    let result = download_game(game_id.clone(), download_url).await;
    
    // Clean up old backups (keep only last 3)
    cleanup_old_backups(&app_dir.join("backups").join(&game_id)).map_err(|e| e.to_string())?;
    
    result
}

#[tauri::command]
async fn repair_game(game_id: String) -> Result<RepairResult, String> {
    let app_dir = tauri::api::path::app_data_dir(&tauri::Config::default())
        .ok_or("Could not get app data directory")?;
    
    let games_dir = app_dir.join("games").join(&game_id);
    
    if !games_dir.exists() {
        return Ok(RepairResult {
            success: false,
            repaired_files: vec![],
            errors: vec!["Game not found".to_string()],
            message: "Game not found".to_string(),
        });
    }
    
    let mut repaired_files = vec![];
    let mut errors = vec![];
    
    for file in games_dir.read_dir().map_err(|e| e.to_string())? {
        let file = file.map_err(|e| e.to_string())?;
        let path = file.path();
        
        if path.is_file() {
            let file_name = path.file_name().unwrap().to_string_lossy().to_string();
            if file_name.ends_with(".exe") || file_name.ends_with(".dll") || file_name.ends_with(".config") {
                if let Err(e) = std::fs::remove_file(&path) {
                    errors.push(format!("Failed to remove {}: {}", file_name, e));
                } else {
                    repaired_files.push(file_name);
                }
            }
        }
    }
    
    let message = if errors.is_empty() {
        "Game repaired successfully".to_string()
    } else {
        "Game repaired with errors".to_string()
    };
    
    Ok(RepairResult {
        success: errors.is_empty(),
        repaired_files,
        errors,
        message,
    })
}

#[tauri::command]
async fn check_network_status() -> Result<NetworkStatus, String> {
    let is_online = check_network().await;
    let message = if is_online {
        "Connected to internet".to_string()
    } else {
        "No internet connection. Launcher requires internet to function.".to_string()
    };
    
    Ok(NetworkStatus { is_online, message })
}

#[tauri::command]
fn toggle_startup_with_windows(enable: bool) -> Result<(), String> {
    set_startup_with_windows(enable)
}

#[tauri::command]
fn get_startup_status() -> Result<bool, String> {
    is_startup_with_windows()
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), std::io::Error> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let ty = entry.file_type()?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            
            if ty.is_dir() {
                copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                std::fs::copy(&src_path, &dst_path)?;
            }
        }
    }
    Ok(())
}

fn cleanup_old_backups(backup_dir: &PathBuf) -> Result<(), std::io::Error> {
    if !backup_dir.exists() {
        return Ok(());
    }
    
    let mut entries: Vec<_> = std::fs::read_dir(backup_dir)?
        .filter_map(|entry| entry.ok())
        .collect();
    
    // Sort by creation time (newest first)
    entries.sort_by(|a, b| {
        a.metadata().unwrap().created().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            .cmp(&b.metadata().unwrap().created().unwrap_or(std::time::SystemTime::UNIX_EPOCH))
    });
    
    // Remove old backups, keep only last 3
    if entries.len() > 3 {
        for entry in entries[..entries.len() - 3].iter() {
            if entry.file_type()?.is_dir() {
                std::fs::remove_dir_all(&entry.path())?;
            } else {
                std::fs::remove_file(&entry.path())?;
            }
        }
    }
    
    Ok(())
}

fn create_system_tray() -> SystemTray {
    let quit = CustomMenuItem::new("quit".to_string(), "Thoát");
    let show = CustomMenuItem::new("show".to_string(), "Hiển thị");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(quit);
    
    SystemTray::new().with_menu(tray_menu)
}

fn handle_system_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => {
            let window = app.get_window("main").unwrap();
            window.show().unwrap();
            window.set_focus().unwrap();
        }
        SystemTrayEvent::MenuItemClick { id, .. } => {
            match id.as_str() {
                "quit" => {
                    std::process::exit(0);
                }
                "show" => {
                    let window = app.get_window("main").unwrap();
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
                _ => {}
            }
        }
        _ => {}
    }
}

fn main() {
    tauri::Builder::default()
        .system_tray(create_system_tray())
        .on_system_tray_event(handle_system_tray_event)
        .invoke_handler(tauri::generate_handler![
            download_game,
            launch_game,
            get_games,
            check_game_updates,
            download_game_update,
            repair_game,
            check_network_status,
            toggle_startup_with_windows,
            get_startup_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}