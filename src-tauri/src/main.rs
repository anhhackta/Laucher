use std::path::PathBuf;
use std::process::Command;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, Manager, AppHandle};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GameInfo {
  id: String,
  name: String,
  version: String,
  status: String,
  download_url: Option<String>,
  executable_path: Option<String>,
  image_url: String,
  logo_url: Option<String>,
  background_id: String,
  description: String,
  file_size: Option<String>,
  release_date: Option<String>,
  changelog: Option<String>,
  is_coming_soon: bool,
  repair_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GameManifest {
  manifest_version: String,
  last_updated: String,
  launcher_config: LauncherConfig,
  backgrounds: HashMap<String, Background>,
  games: Vec<GameInfo>,
  social_links: Vec<SocialLink>,
  settings: ManifestSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LauncherConfig {
  current_version: String,
  update_url: String,
  changelog: String,
  auto_check_updates: bool,
  check_interval_hours: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Background {
  id: String,
  name: String,
  image_url: String,
  active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SocialLink {
  id: String,
  icon: String,
  url: String,
  tooltip: String,
  active: bool,
  action: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LocalManifest {
  manifest: GameManifest,
  last_updated: u64,
  is_offline: bool,
}

// Global variable to store local manifest
static mut LOCAL_MANIFEST: Option<LocalManifest> = None;

// Check network connectivity
async fn check_network() -> bool {
  match reqwest::get("https://httpbin.org/get").await {
    Ok(response) => response.status().is_success(),
    Err(_) => false,
  }
}

// Save manifest to local storage
fn save_local_manifest(manifest: &GameManifest) -> Result<(), String> {
  let current_time = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|e| e.to_string())?
    .as_secs();
  
  let local_manifest = LocalManifest {
    manifest: manifest.clone(),
    last_updated: current_time,
    is_offline: false,
  };
  
  // Save to file for persistence
  let app_dir = tauri::api::path::app_dir(&tauri::Config::default())
    .ok_or("Failed to get app directory")?;
  let manifest_path = app_dir.join("local_manifest.json");
  
  let manifest_json = serde_json::to_string_pretty(&local_manifest)
    .map_err(|e| e.to_string())?;
  
  fs::write(manifest_path, manifest_json)
    .map_err(|e| e.to_string())?;
  
  unsafe {
    LOCAL_MANIFEST = Some(local_manifest);
  }
  
  Ok(())
}

// Load manifest from local storage
fn load_local_manifest() -> Option<GameManifest> {
  unsafe {
    LOCAL_MANIFEST.as_ref().map(|lm| lm.manifest.clone())
  }
}

// Get manifest file path
fn get_manifest_path() -> Result<PathBuf, String> {
  let app_dir = tauri::api::path::app_dir(&tauri::Config::default())
    .ok_or("Failed to get app directory")?;
  Ok(app_dir.join("local_manifest.json"))
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
    // Offline mode - try to load from local storage
    if let Some(local_manifest) = load_local_manifest() {
      println!("Using local manifest (offline mode)");
      return Ok(local_manifest.games);
    }
    return Err("No internet connection and no local manifest available.".to_string());
  }

  // Online mode - try to fetch latest manifest
  let manifest_url = "https://pub-72a5a57231ae489cb74409bdc120cb93.r2.dev/manifest.json";
  
  match reqwest::get(manifest_url).await {
    Ok(response) => {
      if response.status().is_success() {
        match response.json::<GameManifest>().await {
          Ok(manifest) => {
            println!("Successfully loaded online manifest with {} games", manifest.games.len());
            
            // Save to local storage for offline use
            if let Err(e) = save_local_manifest(&manifest) {
              eprintln!("Failed to save local manifest: {}", e);
            }
            
            return Ok(manifest.games);
          }
          Err(e) => eprintln!("Failed to parse online manifest: {}", e),
        }
      }
    }
    Err(e) => eprintln!("Failed to fetch online manifest: {}", e),
  }
  
  // Fallback to local manifest if online fetch fails
  if let Some(local_manifest) = load_local_manifest() {
    println!("Using local manifest as fallback");
    return Ok(local_manifest.games);
  }
  
  // Final fallback to hardcoded data
  get_offline_games().await
}

#[tauri::command]
async fn get_offline_games() -> Result<Vec<GameInfo>, String> {
  // Return local games data for offline mode
  let games = vec![
    GameInfo {
      id: "brato_io".to_string(),
      name: "Brato.io".to_string(),
      version: "0.01".to_string(),
      status: "available".to_string(),
      download_url: Some("https://pub-72a5a57231ae489cb74409bdc120cb93.r2.dev/games/brato_io_v0.01.zip".to_string()),
      executable_path: None,
      image_url: "https://files.catbox.moe/2d8fvz.png".to_string(),
      logo_url: Some("https://lh3.googleusercontent.com/pw/AP1GczMLJwyjMDaF7xJ3VS2zGuKTDnzoEBZ57qgNT39c9_kthr_5POsfSnR0Wpacn9tz4CeYjciAuAIZPDO7N67wUswUC7cDpJTymmKlxH2ehuTHvwoUcyM=w2400".to_string()),
      background_id: "brato_io_bg".to_string(),
      description: "A space exploration game with stunning visuals and engaging gameplay.".to_string(),
      file_size: Some("100 MB".to_string()),
      release_date: Some("2023-01-01".to_string()),
      changelog: Some("Initial release with space exploration mechanics.".to_string()),
      is_coming_soon: false,
      repair_enabled: true,
    },
    GameInfo {
      id: "antknow".to_string(),
      name: "AntKnow".to_string(),
      version: "1.0".to_string(),
      status: "coming_soon".to_string(),
      download_url: None,
      executable_path: None,
      image_url: "https://files.catbox.moe/6f2nc5.png".to_string(),
      logo_url: Some("https://lh3.googleusercontent.com/pw/AP1GczNZq-auYxUvVXyPKce-MVkITxLbwAkSv3IJLLwH7toRhEo_8oEHI4R0Vs9-lVluYDBcpEG0I2oIR_dSqRJXMkO5ibytMLneSvCxppwCus9boxvEqM=w2400".to_string()),
      background_id: "antknow_bg".to_string(),
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
async fn get_social_links() -> Result<Vec<SocialLink>, String> {
  // Try to get from local manifest first
  if let Some(local_manifest) = load_local_manifest() {
    return Ok(local_manifest.social_links);
  }
  
  // Fallback to hardcoded social links
  let social_links = vec![
    SocialLink {
      id: "home".to_string(),
      icon: "src-tauri/social/home.png".to_string(),
      url: "https://anhhackta.github.io".to_string(),
      tooltip: "Website".to_string(),
      active: true,
      action: None,
    },
    SocialLink {
      id: "facebook".to_string(),
      icon: "src-tauri/social/facebook.png".to_string(),
      url: "https://facebook.com/anhhackta.official".to_string(),
      tooltip: "Facebook".to_string(),
      active: true,
      action: None,
    },
    SocialLink {
      id: "discord".to_string(),
      icon: "src-tauri/social/discord.png".to_string(),
      url: "https://discord.gg/3J2nemTtDq".to_string(),
      tooltip: "Discord".to_string(),
      active: true,
      action: None,
    },
    SocialLink {
      id: "email".to_string(),
      icon: "src-tauri/social/email.png".to_string(),
      url: "mailto:bahoangcran@gmail.com".to_string(),
      tooltip: "Email Support".to_string(),
      active: true,
      action: None,
    },
    SocialLink {
      id: "repair".to_string(),
      icon: "src-tauri/social/repair.png".to_string(),
      url: "#".to_string(),
      tooltip: "Repair Game Files".to_string(),
      active: true,
      action: Some("repair_game".to_string()),
    },
  ];
  
  Ok(social_links)
}

#[tauri::command]
async fn get_backgrounds() -> Result<Vec<Background>, String> {
  // Try to get from local manifest first
  if let Some(local_manifest) = load_local_manifest() {
    let backgrounds: Vec<Background> = local_manifest.backgrounds.values().cloned().collect();
    return Ok(backgrounds);
  }
  
  // Fallback to hardcoded backgrounds
  let backgrounds = vec![
    Background {
      id: "brato_io_bg".to_string(),
      name: "Brato.io Background".to_string(),
      image_url: "https://files.catbox.moe/2d8fvz.png".to_string(),
      active: true,
    },
    Background {
      id: "antknow_bg".to_string(),
      name: "AntKnow Background".to_string(),
      image_url: "https://files.catbox.moe/6f2nc5.png".to_string(),
      active: true,
    },
  ];
  
  Ok(backgrounds)
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

#[tauri::command]
async fn minimize_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_window("main")
        .ok_or("Window not found")?;
    window.minimize().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_window("main")
        .ok_or("Window not found")?;
    window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_window("main")
        .ok_or("Window not found")?;
    window.close().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start_dragging(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_window("main")
        .ok_or("Window not found")?;
    window.start_dragging().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn scan_local_games(games: Vec<GameInfo>) -> Result<Vec<GameInfo>, String> {
    let mut scanned_games = games;
    
    // Get launcher directory - go up to the project root
    let launcher_dir = std::env::current_exe()
        .map_err(|e| format!("Failed to get launcher path: {}", e))?
        .parent()
        .ok_or("Failed to get launcher directory")?
        .to_path_buf();
    
    // Go up to the project root (where AntChillGame folder should be)
    let project_root = launcher_dir
        .ancestors()
        .find(|path| path.file_name().map_or(false, |name| name == "Laucher"))
        .unwrap_or(&launcher_dir)
        .to_path_buf();
    
    println!("Launcher directory: {:?}", launcher_dir);
    println!("Project root: {:?}", project_root);
    
    // Look for AntChillGame directory in project root
    let game_base_dir = project_root.join("AntChillGame");
    println!("Looking for game base directory: {:?}", game_base_dir);
    
    if !game_base_dir.exists() {
        println!("AntChillGame directory not found, returning games as-is");
        // If AntChillGame directory doesn't exist, return games as-is
        return Ok(scanned_games);
    }
    
    println!("AntChillGame directory found, scanning for games...");
    
    for game in &mut scanned_games {
        println!("Scanning game: {} v{}", game.name, game.version);
        
        if game.status == "coming_soon" {
            println!("Skipping coming soon game: {}", game.name);
            continue; // Skip coming soon games
        }
        
        // Look for game directory with version
        let game_dir_pattern = format!("{}.v{}", game.name, game.version);
        let game_dir = game_base_dir.join(&game_dir_pattern);
        println!("Looking for game directory: {:?}", game_dir);
        
        if game_dir.exists() {
            println!("Game directory found: {:?}", game_dir);
            // Look for executable file
            let executable_path = find_executable_in_directory(&game_dir)?;
            if let Some(exec_path) = executable_path {
                println!("Executable found: {}", exec_path);
                game.executable_path = Some(exec_path);
                game.status = "available".to_string();
            } else {
                println!("No executable found in game directory");
            }
        } else {
            println!("Game directory not found, checking for older versions...");
            // Check if there's an older version installed
            if let Some(older_version) = find_older_version(&game_base_dir, &game.name)? {
                println!("Older version found: {}", older_version);
                game.executable_path = Some(older_version);
                game.status = "update_available".to_string();
            } else {
                println!("No game installation found");
                game.executable_path = None;
                game.status = "available".to_string();
            }
        }
        
        println!("Final game status: {} - executable: {:?}", game.status, game.executable_path);
    }
    
    Ok(scanned_games)
}

fn find_executable_in_directory(dir: &std::path::Path) -> Result<Option<String>, String> {
    println!("Searching for executables in: {:?}", dir);
    
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                println!("Checking file: {:?}", path);
                
                if path.is_file() {
                    if let Some(extension) = path.extension() {
                        println!("File extension: {:?}", extension);
                        if extension == "exe" {
                            println!("Found executable: {:?}", path);
                            return Ok(Some(path.to_string_lossy().to_string()));
                        }
                    }
                }
            }
        }
    } else {
        println!("Failed to read directory: {:?}", dir);
    }
    
    println!("No executables found in directory");
    Ok(None)
}

fn find_older_version(base_dir: &std::path::Path, game_name: &str) -> Result<Option<String>, String> {
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(dir_name) = path.file_name() {
                        let dir_name_str = dir_name.to_string_lossy();
                        if dir_name_str.starts_with(game_name) {
                            // Found a version of this game
                            if let Some(exec_path) = find_executable_in_directory(&path)? {
                                return Ok(Some(exec_path));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
async fn open_directory(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    Ok(())
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
            get_offline_games,
            get_social_links,
            get_backgrounds,
            check_game_updates,
            download_game_update,
            repair_game,
            check_network_status,
            toggle_startup_with_windows,
            get_startup_status,
            minimize_window,
            hide_window,
            close_window,
            start_dragging,
            scan_local_games,
            open_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}