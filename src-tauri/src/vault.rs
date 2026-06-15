//! Vault scanning for the Obsidian-style document graph (M2).
//!
//! A "vault" is just the folder containing the current document. These commands
//! enumerate its markdown files (for the graph + link resolution) and create new
//! notes on demand (Obsidian's create-on-click for unresolved links).
//!
//! Runs in Rust via `std::fs` / `walkdir`, so it is not constrained by the
//! `tauri-plugin-fs` JS scope (no capability change needed). Path traversal is
//! guarded so a relative target can never escape the vault root.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

const ALLOWED_EXTS: &[&str] = &["md", "markdown", "mdx", "txt"];
/// Skip reading bodies larger than this (link extraction on huge files isn't worth the cost).
const MAX_CONTENT_BYTES: u64 = 1_000_000;

#[derive(Serialize)]
pub struct VaultFile {
    /// Path relative to the vault root, slash-separated.
    path: String,
    /// File name including extension (e.g. "Note.md").
    name: String,
    /// File text — empty when the file is too large or unreadable.
    content: String,
}

fn ext_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Recursively list markdown files under `root` (hidden dirs like .git/.obsidian
/// skipped). Includes each file's body so the JS side can extract links with one
/// IPC round-trip (link parsing stays single-sourced in wikilinks.ts).
#[tauri::command]
pub fn scan_vault(root: String) -> Result<Vec<VaultFile>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(root_path)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || !e
                    .file_name()
                    .to_str()
                    .map(|n| n.starts_with('.'))
                    .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() || !ext_allowed(entry.path()) {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(root_path) else {
            continue;
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let content = if meta.len() <= MAX_CONTENT_BYTES {
            std::fs::read_to_string(entry.path()).unwrap_or_default()
        } else {
            String::new()
        };
        files.push(VaultFile {
            path: rel.to_string_lossy().replace('\\', "/"),
            name: entry.file_name().to_string_lossy().to_string(),
            content,
        });
    }

    Ok(files)
}

/// Join `rel` under `root`, rejecting absolute paths and `..`/`.`/prefix
/// components (traversal guard).
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim_start_matches('/');
    let mut p = root.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => p.push(c),
            _ => return Err("invalid path".into()),
        }
    }
    Ok(p)
}

#[derive(Serialize)]
pub struct CreatedFile {
    /// Absolute path of the (existing or newly created) file.
    path: String,
    /// File body — the freshly written stub, or the existing file's content.
    content: String,
}

/// Create a new note at `rel_path` under the vault `root` (Obsidian create-on-click).
/// Adds a `.md` extension when none is given. Never overwrites — if the file
/// already exists its current content is returned instead. Returns the absolute
/// path + content of the (existing or newly created) file.
#[tauri::command]
pub fn create_file_at(root: String, rel_path: String, content: String) -> Result<CreatedFile, String> {
    let root_path = Path::new(&root);
    let mut abs = safe_join(root_path, &rel_path)?;
    if abs.extension().is_none() {
        abs.set_extension("md");
    }
    if abs.exists() {
        let existing = std::fs::read_to_string(&abs).unwrap_or_default();
        return Ok(CreatedFile {
            path: abs.to_string_lossy().to_string(),
            content: existing,
        });
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        // symlink guard: the (now-existing) parent must resolve inside the root
        if let (Ok(pc), Ok(rc)) = (parent.canonicalize(), root_path.canonicalize()) {
            if !pc.starts_with(&rc) {
                return Err("path escapes vault".into());
            }
        }
    }
    std::fs::write(&abs, &content).map_err(|e| e.to_string())?;
    Ok(CreatedFile {
        path: abs.to_string_lossy().to_string(),
        content,
    })
}
