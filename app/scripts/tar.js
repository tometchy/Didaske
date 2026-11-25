import { closeSync, openSync, writeSync } from "node:fs";

const block = 512;
const emptyBlocks = Buffer.alloc(2 * block);

// A regular-files-only POSIX ustar stream. All paths are relative to the public root.
// A single buffer keeps this build independent of the filesystem's per-inode latency.
export class SiteTar {
  constructor(path) {
    this.fd = openSync(path, "w");
    this.buffer = Buffer.allocUnsafe(1024 * 1024);
    this.used = 0;
  }

  flush() {
    let offset = 0;
    while (offset < this.used) offset += writeSync(this.fd, this.buffer, offset, this.used - offset);
    this.used = 0;
  }

  append(bytes) {
    let offset = 0;
    while (offset < bytes.length) {
      const count = bytes.copy(this.buffer, this.used, offset);
      this.used += count;
      offset += count;
      if (this.used === this.buffer.length) this.flush();
    }
  }

  add(path, payload) {
    if (path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === "..") || path.includes("\0")) {
      throw new Error("Invalid publication path: " + path);
    }
    let name = path, prefix = "";
    if (Buffer.byteLength(path) > 100) {
      const parts = path.split("/");
      name = parts.pop();
      prefix = parts.join("/");
      if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error("Path exceeds ustar limit: " + path);
    }
    const header = Buffer.alloc(block);
    header.write(name, 0, 100);
    header.write("0000644\0" + "0000000\0" + "0000000\0", 100, "ascii");
    header.write(payload.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write("00000000000\0", 136, "ascii");
    header.fill(32, 148, 156);
    header.write("0", 156, "ascii");
    header.write("ustar\0" + "00", 257, "ascii");
    header.write(prefix, 345, 155);
    let sum = 0;
    for (const value of header) sum += value;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    this.append(header);
    this.append(payload);
    this.append(emptyBlocks.subarray(0, (block - payload.length % block) % block));
  }

  finish() {
    this.append(emptyBlocks);
    this.flush();
    closeSync(this.fd);
  }
}
