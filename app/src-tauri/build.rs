use flate2::{write::GzEncoder, Compression};
use std::{env, fs::File, io, path::Path};

fn main() {
    let database = Path::new("../../build/content.sqlite3");
    println!("cargo:rerun-if-changed={}", database.display());
    println!("cargo:rerun-if-changed=../../build/manifest.json");
    println!("cargo:rerun-if-changed=../src/queries.json");
    let mut source = File::open(database)
        .expect("Build the public snapshot with data/build/snapshot.py before compiling.");
    let compressed = Path::new(&env::var_os("OUT_DIR").unwrap()).join("content.sqlite3.gz");
    let mut encoder = GzEncoder::new(File::create(compressed).unwrap(), Compression::fast());
    io::copy(&mut source, &mut encoder).expect("Compress the bundled public snapshot");
    encoder
        .finish()
        .expect("Finish the bundled public snapshot");
    tauri_build::build();
}
