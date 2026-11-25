mod github;
use flate2::read::GzDecoder;
use fs2::FileExt;
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection, OpenFlags};
use serde::Deserialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::Manager;
use tempfile::NamedTempFile;

const SNAPSHOT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/content.sqlite3.gz"));
const MANIFEST: &str = include_str!("../../../build/manifest.json");
const QUERIES: &str = include_str!("../../src/queries.json");
type Failure = Box<dyn std::error::Error + Send + Sync>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    sha256: String,
    bytes: u64,
    schema_version: u32,
}

fn matches_manifest(path: &Path, manifest: &Manifest) -> Result<bool, Failure> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    if file.metadata()?.len() != manifest.bytes {
        return Ok(false);
    }
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash)?;
    Ok(format!("{:x}", hash.finalize()) == manifest.sha256)
}

fn open_snapshot(path: &Path) -> Result<Connection, Failure> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")?;
    Ok(db)
}

fn validate_schema(path: &Path, manifest: &Manifest) -> Result<(), Failure> {
    let db = open_snapshot(path)?;
    let schema: u32 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if schema != 1 || schema != manifest.schema_version {
        return Err("Unsupported public snapshot schema".into());
    }
    let result: String = db.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if result != "ok" {
        return Err("The public snapshot failed SQLite integrity validation".into());
    }
    Ok(())
}

/// Each binary opens the immutable file corresponding to its own embedded digest.
/// The OS releases the installation lock if a process is interrupted.
fn materialize(directory: &Path) -> Result<PathBuf, Failure> {
    let manifest: Manifest = serde_json::from_str(MANIFEST)?;
    if manifest.sha256.len() != 64 || !manifest.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid public snapshot digest".into());
    }
    fs::create_dir_all(directory)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("install.lock"))?;
    lock.lock_exclusive()?;
    let path = directory.join(format!("{}.sqlite3", manifest.sha256));
    if !matches_manifest(&path, &manifest)? {
        let mut staging = NamedTempFile::new_in(directory)?;
        let written = io::copy(
            &mut GzDecoder::new(SNAPSHOT).take(manifest.bytes + 1),
            &mut staging,
        )?;
        if written != manifest.bytes || !matches_manifest(staging.path(), &manifest)? {
            return Err("Bundled public snapshot digest or size mismatch".into());
        }
        validate_schema(staging.path(), &manifest)?;
        staging.as_file().sync_all()?;
        staging.persist(&path)?;
    }
    Ok(path)
}

fn query(path: &Path, name: &str, params: Vec<Value>) -> Result<Vec<Value>, Failure> {
    static ALLOWLIST: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    let sql = ALLOWLIST
        .get_or_init(|| serde_json::from_str(QUERIES).expect("Invalid built-in query definitions"))
        .get(name)
        .ok_or("Unknown public query")?;
    if params.len() > 32 {
        return Err("Too many public query parameters".into());
    }
    let params = params
        .into_iter()
        .map(|value| match value {
            Value::Null => Ok(SqlValue::Null),
            Value::String(s) if s.len() <= 4096 => Ok(SqlValue::Text(s)),
            Value::Number(n) if n.is_i64() => Ok(SqlValue::Integer(n.as_i64().unwrap())),
            _ => Err("Invalid public query parameter"),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let db = open_snapshot(path)?;
    let mut stmt = db.prepare(sql)?;
    if !stmt.readonly() {
        return Err("Public queries must be read-only".into());
    }
    let columns: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
    let mut rows = stmt.query(params_from_iter(params))?;
    let mut output = Vec::new();
    while let Some(row) = rows.next()? {
        if output.len() >= 8192 {
            return Err("Public query exceeded the result limit".into());
        }
        let mut item = Map::new();
        for (i, name) in columns.iter().enumerate() {
            let value = match row.get(i)? {
                SqlValue::Null => Value::Null,
                SqlValue::Integer(n) => Value::from(n),
                SqlValue::Real(n) => Value::from(n),
                SqlValue::Text(s) => Value::from(s),
                SqlValue::Blob(_) => {
                    return Err("Binary values are unsupported in public queries".into())
                }
            };
            item.insert(name.clone(), value);
        }
        output.push(Value::Object(item));
    }
    Ok(output)
}

#[tauri::command]
async fn read_public(
    app: tauri::AppHandle,
    name: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Value>, Failure> {
        let state = app.state::<Mutex<Option<PathBuf>>>();
        let path = {
            let mut ready = state
                .lock()
                .map_err(|_| "Snapshot initialization was interrupted")?;
            if ready.is_none() {
                *ready = Some(materialize(&app.path().app_data_dir()?.join("public"))?);
            }
            ready.as_ref().unwrap().clone()
        };
        query(&path, &name, params)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

pub fn self_test() -> Result<(), Failure> {
    let scratch = tempfile::tempdir()?;
    let path = materialize(scratch.path())?;
    {
        let db = open_snapshot(&path)?;
        let count: u64 = db.query_row("SELECT count(*) FROM verses", [], |r| r.get(0))?;
        if count == 0 {
            return Err("The bundled snapshot contains no verses".into());
        }
        let queries: BTreeMap<String, String> = serde_json::from_str(QUERIES)?;
        for (name, sql) in &queries {
            if !db.prepare(sql)?.readonly() {
                return Err(format!("Writable query: {name}").into());
            }
        }
        if query(&path, "unknown public query", vec![]).is_ok() {
            return Err("Unknown query was accepted".into());
        }
        println!(
            "Verified {count} verses and {} named queries.",
            queries.len()
        );
    }
    // Simulate same-size corruption and verify the next launch repairs it.
    use std::io::Write;
    OpenOptions::new()
        .write(true)
        .open(&path)?
        .write_all(b"corrupt")?;
    let repaired = materialize(scratch.path())?;
    validate_schema(&repaired, &serde_json::from_str(MANIFEST)?)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(github::GitHub::new())
        .manage(Mutex::new(Option::<PathBuf>::None))
        .invoke_handler(tauri::generate_handler![
            read_public,
            github::github_status,
            github::github_start,
            github::github_poll,
            github::github_logout,
            github::github_notes,
            github::github_list_notes,
            github::github_get_note,
            github::github_put_note
        ])
        .run(tauri::generate_context!())
        .expect("Start the Didaske reader");
}
