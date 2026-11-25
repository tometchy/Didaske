//! Native transport for the registered GitHub App. Credentials live in process memory.
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{redirect::Policy, Client, Method, RequestBuilder};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;

type Result<T> = std::result::Result<T, String>;
const DEVICE_URL: &str = "https://github.com/login/device";
const CLIENT_ID: Option<&str> = option_env!("DIDASKE_GITHUB_CLIENT_ID");
const APP_ID: Option<&str> = option_env!("DIDASKE_GITHUB_APP_ID");
const MAX_NOTE_BYTES: usize = 512 * 1024;

#[derive(Clone, Serialize)]
struct User {
    id: u64,
    login: String,
}
#[derive(Clone)]
struct Credentials {
    user: User,
    token: String,
    generation: u64,
}
struct Device {
    code: String,
    expires: Instant,
    next: Instant,
    interval: u64,
}
#[derive(Default)]
struct Session {
    generation: u64,
    credentials: Option<Credentials>,
    device: Option<Device>,
}
pub struct GitHub {
    http: Client,
    session: Mutex<Session>,
}

impl GitHub {
    pub fn new() -> Self {
        let http = Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .user_agent("Didaske-Reader")
            .timeout(Duration::from_secs(25))
            .build()
            .expect("Create the GitHub HTTPS client");
        Self {
            http,
            session: Mutex::new(Session::default()),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Session>> {
        self.session
            .lock()
            .map_err(|_| "SESSION_UNAVAILABLE".into())
    }

    fn generation(&self, generation: u64) -> Result<()> {
        if self.lock()?.generation == generation {
            Ok(())
        } else {
            Err("SESSION_CHANGED".into())
        }
    }

    fn credentials(&self, id: u64) -> Result<Credentials> {
        self.lock()?
            .credentials
            .as_ref()
            .filter(|c| c.user.id == id)
            .cloned()
            .ok_or_else(|| "ACCOUNT_CHANGED".into())
    }
}

fn client_id() -> Result<&'static str> {
    CLIENT_ID
        .filter(|s| !s.is_empty() && app_id().is_ok())
        .ok_or_else(|| "GITHUB_UNCONFIGURED".into())
}
fn app_id() -> Result<u64> {
    APP_ID
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|i| *i > 0)
        .ok_or_else(|| "GITHUB_UNCONFIGURED".into())
}
async fn receive(request: RequestBuilder) -> Result<Value> {
    let mut response = request.send().await.map_err(|_| "NETWORK_ERROR")?;
    if !response.status().is_success() {
        return Err(format!("HTTP_{}", response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "NETWORK_ERROR")? {
        if bytes.len() + chunk.len() > 12 * 1024 * 1024 {
            return Err("RESPONSE_TOO_LARGE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "INVALID_GITHUB_RESPONSE".into())
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "INVALID_GITHUB_RESPONSE".into())
}
fn id(v: &Value) -> Result<u64> {
    v["id"]
        .as_u64()
        .filter(|v| *v > 0 && *v <= (1u64 << 53) - 1)
        .ok_or_else(|| "INVALID_GITHUB_ID".into())
}
fn user(v: &Value) -> Result<User> {
    let login = string(v, "login")?;
    if !login
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("INVALID_GITHUB_LOGIN".into());
    }
    Ok(User {
        id: id(v)?,
        login: login.to_owned(),
    })
}
fn request(http: &Client, token: &str, method: Method, path: &[&str]) -> RequestBuilder {
    let mut url = Url::parse("https://api.github.com").expect("Fixed API origin");
    url.path_segments_mut().expect("HTTPS URL").extend(path);
    http.request(method, url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

#[tauri::command]
pub fn github_status(github: State<'_, GitHub>) -> Result<Value> {
    Ok(
        json!({"configured":client_id().is_ok(),"user":github.lock()?.credentials.as_ref().map(|c| &c.user)}),
    )
}
#[tauri::command]
pub fn github_logout(github: State<'_, GitHub>) -> Result<()> {
    let mut state = github.lock()?;
    *state = Session {
        generation: state.generation + 1,
        ..Session::default()
    };
    Ok(())
}
#[tauri::command]
pub async fn github_start(app: AppHandle, github: State<'_, GitHub>) -> Result<Value> {
    let client = client_id()?;
    let generation = {
        let mut state = github.lock()?;
        *state = Session {
            generation: state.generation + 1,
            ..Session::default()
        };
        state.generation
    };
    let v = receive(
        github
            .http
            .post("https://github.com/login/device/code")
            .header("Accept", "application/json")
            .form(&[("client_id", client)]),
    )
    .await?;
    let code = string(&v, "device_code")?;
    let user_code = string(&v, "user_code")?;
    if string(&v, "verification_uri")? != DEVICE_URL {
        return Err("UNEXPECTED_VERIFICATION_URI".into());
    }
    let expires = v["expires_in"]
        .as_u64()
        .filter(|n| (1..=3600).contains(n))
        .ok_or("INVALID_GITHUB_RESPONSE")?;
    let interval = v["interval"].as_u64().unwrap_or(5).clamp(1, expires);
    let now = Instant::now();
    {
        let mut state = github.lock()?;
        if state.generation != generation {
            return Err("SESSION_CHANGED".into());
        }
        state.device = Some(Device {
            code: code.to_owned(),
            expires: now + Duration::from_secs(expires),
            next: now + Duration::from_secs(interval),
            interval,
        });
    }
    // The code remains usable when the host has no browser opener.
    let opened = app.opener().open_url(DEVICE_URL, None::<&str>).is_ok();
    Ok(
        json!({"userCode":user_code,"verificationUri":DEVICE_URL,"interval":interval,"expiresIn":expires,"opened":opened}),
    )
}
#[tauri::command]
pub async fn github_poll(github: State<'_, GitHub>) -> Result<Value> {
    let (generation, code, interval) = {
        let mut state = github.lock()?;
        let generation = state.generation;
        let device = state.device.as_mut().ok_or("NO_DEVICE_FLOW")?;
        let now = Instant::now();
        if now >= device.expires {
            state.device = None;
            return Err("EXPIRED_TOKEN".into());
        }
        if now < device.next {
            return Ok(json!({"state":"pending","interval":device.interval}));
        }
        device.next = now + Duration::from_secs(device.interval);
        (generation, device.code.clone(), device.interval)
    };
    let v = receive(
        github
            .http
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id()?),
                ("device_code", code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ]),
    )
    .await?;
    github.generation(generation)?;
    if let Some(error) = v["error"].as_str() {
        let mut state = github.lock()?;
        if state.generation != generation {
            return Err("SESSION_CHANGED".into());
        }
        let device = state.device.as_mut().ok_or("NO_DEVICE_FLOW")?;
        match error {
            "authorization_pending" => {
                return Ok(json!({"state":"pending","interval":device.interval}))
            }
            "slow_down" => {
                device.interval = (device.interval + 5)
                    .max(v["interval"].as_u64().unwrap_or(0))
                    .min(3600);
                device.next = Instant::now() + Duration::from_secs(device.interval);
                return Ok(json!({"state":"slow_down","interval":device.interval}));
            }
            _ => {
                state.device = None;
                return Err(match error {
                    "access_denied" => "ACCESS_DENIED",
                    "expired_token" => "EXPIRED_TOKEN",
                    _ => "DEVICE_FLOW_FAILED",
                }
                .into());
            }
        }
    }
    let token = string(&v, "access_token")?.to_owned();
    let identity = user(&receive(request(&github.http, &token, Method::GET, &["user"])).await?)?;
    let mut state = github.lock()?;
    if state.generation != generation
        || state
            .device
            .as_ref()
            .is_none_or(|d| Instant::now() >= d.expires)
    {
        return Err("SESSION_CHANGED".into());
    }
    state.device = None;
    state.credentials = Some(Credentials {
        user: identity.clone(),
        token,
        generation,
    });
    Ok(json!({"state":"authorized","interval":interval,"user":identity}))
}

struct Access<'a> {
    github: &'a GitHub,
    credentials: Credentials,
}
impl<'a> Access<'a> {
    fn new(github: &'a GitHub, id: u64) -> Result<Self> {
        Ok(Self {
            github,
            credentials: github.credentials(id)?,
        })
    }
    async fn call(
        &self,
        method: Method,
        path: &[&str],
        args: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Value> {
        self.github.generation(self.credentials.generation)?;
        let mut r = request(&self.github.http, &self.credentials.token, method, path).query(args);
        if let Some(b) = body {
            r = r.json(&b);
        }
        let value = receive(r).await?;
        self.github.generation(self.credentials.generation)?;
        Ok(value)
    }
    async fn get(&self, path: &[&str]) -> Result<Value> {
        self.call(Method::GET, path, &[], None).await
    }
    async fn check_identity(&self) -> Result<User> {
        let current = user(&self.get(&["user"]).await?)?;
        if current.id != self.credentials.user.id {
            return Err("ACCOUNT_CHANGED".into());
        }
        Ok(current)
    }
    // Installation and repository selection are separate from Device Flow login.
    async fn selected(
        &self,
        path: &[&str],
        key: &str,
        matches: impl Fn(&Value) -> bool,
    ) -> Result<u64> {
        for page in 1..=100 {
            let v = self
                .call(
                    Method::GET,
                    path,
                    &[("per_page", "100".into()), ("page", page.to_string())],
                    None,
                )
                .await?;
            let rows = v[key].as_array().ok_or("INVALID_GITHUB_RESPONSE")?;
            if let Some(row) = rows.iter().find(|r| matches(r)) {
                return id(row);
            }
            if rows.len() < 100 {
                break;
            }
        }
        Err("INSTALLATION_ACCESS_REQUIRED".into())
    }
    async fn installation(&self) -> Result<u64> {
        let app = app_id()?;
        self.selected(&["user", "installations"], "installations", |r| {
            r["app_id"] == app
                && r["account"]["id"] == self.credentials.user.id
                && r["account"]["type"] == "User"
                && r["suspended_at"].is_null()
        })
        .await
    }
    async fn repository(&self, expected: Option<u64>, create: bool) -> Result<Repo> {
        let u = self.check_identity().await?;
        let installation = self.installation().await?;
        let lookup = async || {
            if let Some(id) = expected {
                self.get(&["repositories", &id.to_string()]).await
            } else {
                self.get(&["repos", &u.login, "Notes"]).await
            }
        };
        let metadata = match lookup().await {
            Ok(v) => v,
            Err(e) if e == "HTTP_404" && create && expected.is_none() => {
                let result = self
                    .call(
                        Method::POST,
                        &["user", "repos"],
                        &[],
                        Some(json!({"name":"Notes","private":true,
                    "auto_init":true,"has_issues":false,"has_projects":false,"has_wiki":false})),
                    )
                    .await;
                if let Err(e) = result {
                    if e != "HTTP_422" && e != "NETWORK_ERROR" {
                        return Err(e);
                    }
                }
                lookup().await?
            }
            Err(e) => return Err(e),
        };
        let repo = Repo::from_metadata(&metadata, &u, expected)?;
        self.selected(
            &[
                "user",
                "installations",
                &installation.to_string(),
                "repositories",
            ],
            "repositories",
            |r| r["id"] == repo.id,
        )
        .await?;
        Ok(repo)
    }
}
struct Repo {
    id: u64,
    login: String,
    branch: String,
}
impl Repo {
    fn from_metadata(v: &Value, u: &User, expected: Option<u64>) -> Result<Self> {
        let repo = id(v)?;
        if expected.is_some_and(|e| e != repo)
            || v["name"] != "Notes"
            || v["owner"]["id"] != u.id
            || v["owner"]["login"] != u.login
            || v["owner"]["type"] != "User"
            || v["private"] != true
            || v["visibility"] != "private"
            || v["archived"] != false
            || v["disabled"] != false
        {
            return Err("UNSAFE_NOTES_REPOSITORY".into());
        }
        Ok(Self {
            id: repo,
            login: u.login.clone(),
            branch: string(v, "default_branch")?.to_owned(),
        })
    }
}

#[tauri::command]
pub async fn github_notes(
    github: State<'_, GitHub>,
    account_id: u64,
    repository_id: Option<u64>,
    create: bool,
) -> Result<Value> {
    let access = Access::new(&github, account_id)?;
    let repo = access.repository(repository_id, create).await?;
    Ok(json!({"id":repo.id,"name":"Notes","ownerId":account_id,"defaultBranch":repo.branch}))
}

fn valid_note(name: &str) -> bool {
    let Some(uuid) = name.strip_suffix(".md") else {
        return false;
    };
    uuid.len() == 36
        && uuid.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn filename(path: &str) -> Result<&str> {
    path.strip_prefix("kdzj/notes/")
        .filter(|s| valid_note(s))
        .ok_or_else(|| "INVALID_NOTE_PATH".into())
}
fn hash<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    string(v, key).and_then(|s| {
        if s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
            Ok(s)
        } else {
            Err("INVALID_GIT_OBJECT".into())
        }
    })
}
struct CheckedTree {
    head: String,
    root: String,
    entries: Vec<Value>,
}
impl Access<'_> {
    async fn tree(&self, repo: &Repo, branch: &str) -> Result<CheckedTree> {
        if repo.branch != branch {
            return Err("BRANCH_CHANGED".into());
        }
        let commit = self
            .get(&["repos", &repo.login, "Notes", "commits", branch])
            .await?;
        let head = hash(&commit, "sha")?.to_owned();
        let root = hash(&commit["commit"]["tree"], "sha")?.to_owned();
        let mut sha = root.clone();
        for next in [Some("kdzj"), Some("notes"), None] {
            let response = self
                .get(&["repos", &repo.login, "Notes", "git", "trees", &sha])
                .await?;
            if response["truncated"] != false || hash(&response, "sha")? != sha {
                return Err("INCOMPLETE_TREE".into());
            }
            let rows = response["tree"].as_array().ok_or("INVALID_GIT_OBJECT")?;
            if let Some(segment) = next {
                match rows.iter().find(|r| r["path"] == segment) {
                    Some(r) if r["type"] == "tree" && r["mode"] == "040000" => {
                        sha = hash(r, "sha")?.to_owned()
                    }
                    Some(_) => return Err("UNSAFE_NOTE_PATH".into()),
                    None => {
                        return Ok(CheckedTree {
                            head,
                            root,
                            entries: vec![],
                        })
                    }
                }
            } else {
                return Ok(CheckedTree {
                    head,
                    root,
                    entries: rows.clone(),
                });
            }
        }
        unreachable!()
    }
}
fn file<'a>(tree: &'a CheckedTree, name: &str) -> Result<Option<&'a str>> {
    match tree.entries.iter().find(|r| r["path"] == name) {
        None => Ok(None),
        Some(row) if row["type"] == "blob" && row["mode"] == "100644" => {
            Ok(Some(hash(row, "sha")?))
        }
        _ => Err("UNSAFE_NOTE_PATH".into()),
    }
}
#[tauri::command]
pub async fn github_list_notes(
    github: State<'_, GitHub>,
    account_id: u64,
    repository_id: u64,
    branch: String,
) -> Result<Value> {
    let access = Access::new(&github, account_id)?;
    let repo = access.repository(Some(repository_id), false).await?;
    let tree = access.tree(&repo, &branch).await?;
    let mut notes = Vec::new();
    for row in &tree.entries {
        let name = string(row, "path")?;
        if valid_note(name) && row["type"] == "blob" && row["mode"] == "100644" {
            notes.push(json!({"path":format!("kdzj/notes/{name}"),"blobSha":hash(row,"sha")?}));
        }
    }
    Ok(Value::Array(notes))
}
#[tauri::command]
pub async fn github_get_note(
    github: State<'_, GitHub>,
    account_id: u64,
    repository_id: u64,
    branch: String,
    path: String,
) -> Result<Value> {
    let name = filename(&path)?;
    let access = Access::new(&github, account_id)?;
    let repo = access.repository(Some(repository_id), false).await?;
    let tree = access.tree(&repo, &branch).await?;
    let Some(sha) = file(&tree, name)? else {
        return Ok(Value::Null);
    };
    let v = access
        .get(&["repos", &repo.login, "Notes", "git", "blobs", sha])
        .await?;
    if hash(&v, "sha")? != sha
        || v["encoding"] != "base64"
        || v["size"].as_u64().is_none_or(|n| n > MAX_NOTE_BYTES as u64)
    {
        return Err("UNSUPPORTED_NOTE".into());
    }
    let encoded = v["content"].as_str().ok_or("INVALID_GITHUB_RESPONSE")?;
    let normalized = encoded.replace(['\r', '\n'], "");
    let bytes = STANDARD
        .decode(normalized)
        .map_err(|_| "INVALID_NOTE_CONTENT")?;
    if bytes.len() > MAX_NOTE_BYTES || v["size"].as_u64() != Some(bytes.len() as u64) {
        return Err("UNSUPPORTED_NOTE".into());
    }
    let markdown = String::from_utf8(bytes).map_err(|_| "INVALID_NOTE_UTF8")?;
    Ok(json!({"markdown":markdown,"blobSha":sha}))
}
#[tauri::command]
pub async fn github_put_note(
    github: State<'_, GitHub>,
    account_id: u64,
    repository_id: u64,
    branch: String,
    path: String,
    markdown: String,
    base_sha: Option<String>,
) -> Result<Value> {
    let name = filename(&path)?;
    if markdown.len() > MAX_NOTE_BYTES {
        return Err("NOTE_TOO_LARGE".into());
    }
    let access = Access::new(&github, account_id)?;
    let repo = access.repository(Some(repository_id), false).await?;
    let tree = access.tree(&repo, &branch).await?;
    if file(&tree, name)? != base_sha.as_deref() {
        return Err("CONFLICT".into());
    }

    // Pin the entire verified ancestor tree. A concurrent edit or symlink substitution
    // cannot be published on top of the stale parent through a non-fast-forward update.
    let mutate = async |method: Method, tail: Vec<&str>, body: Value| {
        let checked = access.repository(Some(repository_id), false).await?;
        if checked.branch != branch || checked.login != repo.login {
            return Err("REPOSITORY_CHANGED".into());
        }
        let mut route = vec!["repos", repo.login.as_str(), "Notes", "git"];
        route.extend(tail);
        access.call(method, &route, &[], Some(body)).await
    };
    let v=mutate(Method::POST,vec!["trees"],json!({"base_tree":tree.root,"tree":[{"path":path,"mode":"100644","type":"blob","content":markdown}]})).await?;
    let next_tree = hash(&v, "sha")?;
    let v = mutate(
        Method::POST,
        vec!["commits"],
        json!({"message":"Save Didaske note","tree":next_tree,"parents":[tree.head]}),
    )
    .await?;
    let commit = hash(&v, "sha")?;
    let mut tail = vec!["refs", "heads"];
    tail.extend(branch.split('/'));
    let v = mutate(Method::PATCH, tail, json!({"sha":commit,"force":false})).await?;
    if v["object"]["sha"] != commit {
        return Err("UNCONFIRMED_WRITE".into());
    }
    // Read back that exact commit even if another editor has advanced the branch.
    let v = access
        .call(
            Method::GET,
            &[
                "repos",
                &repo.login,
                "Notes",
                "contents",
                "kdzj",
                "notes",
                name,
            ],
            &[("ref", commit.to_owned())],
            None,
        )
        .await?;
    if v["type"] != "file" || v["path"] != path {
        return Err("UNCONFIRMED_WRITE".into());
    }
    Ok(json!({"blobSha":hash(&v,"sha")?}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes_accept_only_managed_markdown_paths() {
        assert!(filename("kdzj/notes/16c82c6d-51c5-414a-b9f4-c40c20ac095c.md").is_ok());
        for invalid in [
            "../private.md",
            "kdzj/notes/.git/config",
            "kdzj/notes/../../README.md",
            "kdzj/notes/123.md",
        ] {
            assert!(filename(invalid).is_err());
        }
    }
    #[test]
    fn private_notes_are_bound_to_personal_repository_identity() {
        let u = User {
            id: 43,
            login: "reader".into(),
        };
        let good = json!({"id":543,"name":"Notes","owner":{"id":43,"login":"reader","type":"User"},
            "private":true,"visibility":"private","default_branch":"main","archived":false,"disabled":false});
        assert!(Repo::from_metadata(&good, &u, Some(543)).is_ok());
        assert!(Repo::from_metadata(&good, &u, Some(22)).is_err());
        for (key, val) in [
            ("visibility", json!("public")),
            ("name", json!("notes")),
            ("private", json!(false)),
            ("archived", json!(true)),
        ] {
            let mut bad = good.clone();
            bad[key] = val;
            assert!(Repo::from_metadata(&bad, &u, Some(543)).is_err());
        }
    }
}
