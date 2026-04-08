use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::Command,
};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use url::Url;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    token_type: Option<String>,
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    token_type: Option<String>,
    id_token: Option<String>,
}

fn random_urlsafe(byte_len: usize) -> String {
    let mut buf = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Nepodařilo se otevřít browser: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map_err(|e| format!("Nepodařilo se otevřít browser: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Nepodařilo se otevřít browser: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Nepodporovaný operační systém".to_string())
}

const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Canto Silva</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #1a1d23;
  }
  .card {
    background: #fff;
    border-radius: 24px;
    padding: 48px 40px;
    max-width: 400px;
    text-align: center;
    box-shadow: 0 24px 64px rgba(0,0,0,0.12);
  }
  .check {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: #ecfdf5;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
  }
  .check svg { color: #10b981; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color: #6b7280; line-height: 1.5; }
</style>
</head>
<body>
<div class="card">
  <div class="check">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
  <h1>Přihlášení proběhlo</h1>
  <p>Můžeš zavřít tuto záložku a vrátit se do Canto Silva.</p>
</div>
<script>setTimeout(()=>window.close(),1500)</script>
</body>
</html>"#;

const ERROR_HTML: &str = r#"<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Canto Silva</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #1a1d23;
  }
  .card {
    background: #fff;
    border-radius: 24px;
    padding: 48px 40px;
    max-width: 400px;
    text-align: center;
    box-shadow: 0 24px 64px rgba(0,0,0,0.12);
  }
  .icon {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: #fef2f2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
  }
  .icon svg { color: #ef4444; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color: #6b7280; line-height: 1.5; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </div>
  <h1>Přihlášení selhalo</h1>
  <p>Můžeš zavřít tuto záložku a zkusit to znovu v aplikaci.</p>
</div>
</body>
</html>"#;

fn write_html_response(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn wait_for_oauth_code(listener: TcpListener, expected_state: String) -> Result<String, String> {
    let (mut stream, _) = listener
        .accept()
        .map_err(|e| format!("Nepodařilo se přijmout OAuth redirect: {e}"))?;

    let mut buffer = [0u8; 8192];
    let size = stream
        .read(&mut buffer)
        .map_err(|e| format!("Nepodařilo se přečíst OAuth redirect: {e}"))?;

    let request = String::from_utf8_lossy(&buffer[..size]);
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "Prázdný HTTP request z browseru.".to_string())?;

    let path = first_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Nepodařilo se rozparsovat OAuth callback URL.".to_string())?;

    let callback_url = Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|e| format!("Neplatná callback URL: {e}"))?;

    let pairs: HashMap<String, String> = callback_url.query_pairs().into_owned().collect();

    if let Some(error) = pairs.get("error") {
        write_html_response(&mut stream, "200 OK", ERROR_HTML);
        return Err(format!("Google OAuth chyba: {error}"));
    }

    let state = pairs
        .get("state")
        .ok_or_else(|| "V callbacku chybí state.".to_string())?;

    if state != &expected_state {
        write_html_response(&mut stream, "400 Bad Request", ERROR_HTML);
        return Err("State nesouhlasí. OAuth odpověď byla odmítnuta.".to_string());
    }

    let code = pairs
        .get("code")
        .ok_or_else(|| "V callbacku chybí authorization code.".to_string())?
        .to_string();

    write_html_response(&mut stream, "200 OK", SUCCESS_HTML);

    Ok(code)
}

#[tauri::command]
async fn start_google_oauth(
    app: AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<AuthSession, String> {
    let scopes = [
        "openid",
        "email",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
        "https://www.googleapis.com/auth/drive.file",
    ]
    .join(" ");

    let code_verifier = random_urlsafe(32);
    let code_challenge = pkce_challenge(&code_verifier);
    let state = random_urlsafe(24);

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Nepodařilo se spustit lokální callback server: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Nepodařilo se zjistit port callback serveru: {e}"))?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{port}/");

    let auth_url = Url::parse_with_params(
        "https://accounts.google.com/o/oauth2/v2/auth",
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", scopes.as_str()),
            ("state", state.as_str()),
            ("code_challenge", code_challenge.as_str()),
            ("code_challenge_method", "S256"),
        ],
    )
    .map_err(|e| format!("Nepodařilo se sestavit OAuth URL: {e}"))?;

    open_in_browser(auth_url.as_str())?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_oauth_code(listener, state))
        .await
        .map_err(|e| format!("OAuth listener task selhal: {e}"))??;

    // ── Token exchange ──

    let client = reqwest::Client::new();

    let token_response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code.as_str()),
            ("code_verifier", code_verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Token request selhal: {e}"))?;

    if !token_response.status().is_success() {
        let status = token_response.status();
        let text = token_response
            .text()
            .await
            .unwrap_or_else(|_| "Nepodařilo se přečíst tělo odpovědi.".to_string());
        return Err(format!("Google token endpoint vrátil {status}: {text}"));
    }

    let token: TokenResponse = token_response
        .json()
        .await
        .map_err(|e| format!("Nepodařilo se rozparsovat token response: {e}"))?;

    // Bring our window to front after successful login
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_focus();
    }

    Ok(AuthSession {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_in: token.expires_in,
        scope: token.scope,
        token_type: token.token_type,
        id_token: token.id_token,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![start_google_oauth])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
