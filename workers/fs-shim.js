/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// node:fs for the Workers build, read-only, over the files bundled by scripts/build-workers.js (dist/workers/vfs.js).
// The app reads its pages, scripts and package.json with absolute paths built from import.meta.url; whatever that
// resolves to inside the bundle, the part from "public/" (or the name package.json) identifies the file.
// Writing is not supported: the platform never writes to disk while serving requests.
import { Readable } from "node:stream";
import vfs from "../dist/workers/vfs.js";
import build from "../dist/workers/build.json";

const MTIME = new Date(build.builtAt);
const dirs = new Set();
for (const key of Object.keys(vfs)) {
  const parts = key.split("/");
  for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
}

function keyOf(p) {
  const s = String(p instanceof URL ? p.pathname : p).replace(/\\/g, "/").replace(/\/+$/, "");
  const i = s.lastIndexOf("/public/");
  if (i >= 0) return `public/${s.slice(i + 8)}`;
  if (s.endsWith("/public") || s === "public") return "public";
  if (s === "package.json" || s.endsWith("/package.json")) return "package.json";
  return null;
}

const enoent = (p, syscall) => Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`),
  { code: "ENOENT", errno: -2, syscall, path: String(p) });

const bytes = new Map();
function content(key) {
  if (!bytes.has(key)) {
    const [kind, data] = vfs[key];
    bytes.set(key, kind === "t" ? Buffer.from(data, "utf8") : Buffer.from(data, "base64"));
  }
  return bytes.get(key);
}

function makeStat(key, isDir) {
  const size = isDir ? 0 : content(key).length;
  return {
    size, mtime: MTIME, mtimeMs: MTIME.getTime(), ctime: MTIME, atime: MTIME, birthtime: MTIME,
    ino: 0, dev: 0, mode: isDir ? 0o40555 : 0o100444, nlink: 1, uid: 0, gid: 0, blksize: 4096, blocks: Math.ceil(size / 512),
    isDirectory: () => isDir, isFile: () => !isDir, isSymbolicLink: () => false,
    isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false,
  };
}

export function existsSync(p) {
  const k = keyOf(p);
  return Boolean(k && (vfs[k] || dirs.has(k)));
}

export function statSync(p, opts) {
  const k = keyOf(p);
  if (k && vfs[k]) return makeStat(k, false);
  if (k && dirs.has(k)) return makeStat(k, true);
  if (opts?.throwIfNoEntry === false) return undefined;
  throw enoent(p, "stat");
}
export const lstatSync = statSync;

export function readFileSync(p, opts) {
  const k = keyOf(p);
  if (!k || !vfs[k]) throw enoent(p, "open");
  const enc = typeof opts === "string" ? opts : opts?.encoding;
  const buf = content(k);
  return enc ? buf.toString(enc) : Buffer.from(buf);
}

export function readdirSync(p, opts) {
  const k = keyOf(p);
  if (!k || !dirs.has(k)) throw enoent(p, "scandir");
  const prefix = `${k}/`;
  const names = new Map();
  for (const key of [...Object.keys(vfs), ...dirs]) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const name = rest.split("/")[0];
    if (!names.has(name)) names.set(name, rest.includes("/") || dirs.has(prefix + name));
  }
  const sorted = [...names.keys()].sort();
  if (!opts?.withFileTypes) return sorted;
  return sorted.map((name) => ({ name, parentPath: String(p), path: String(p),
    isDirectory: () => names.get(name), isFile: () => !names.get(name), isSymbolicLink: () => false }));
}

export function realpathSync(p) {
  if (!existsSync(p)) throw enoent(p, "realpath");
  return String(p);
}

const cb = (fn) => (...args) => {
  const done = args.pop();
  try { const r = fn(...args); queueMicrotask(() => done(null, r)); } catch (e) { queueMicrotask(() => done(e)); }
};
export const stat = cb(statSync);
export const lstat = cb(lstatSync);
export const readFile = cb(readFileSync);
export const readdir = cb(readdirSync);
export const access = (p, ...rest) => { const done = rest.pop(); queueMicrotask(() => done(existsSync(p) ? null : enoent(p, "access"))); };

// Libraries test `stream instanceof fs.ReadStream` (destroy, used by Express), so these classes must exist.
export class ReadStream extends Readable {
  constructor(p, opts = {}) {
    super();
    this.path = String(p);
    const k = keyOf(p);
    if (!k || !vfs[k]) { this.chunk = null; queueMicrotask(() => this.destroy(enoent(p, "open"))); return; }
    const buf = content(k);
    this.chunk = buf.subarray(opts.start ?? 0, (opts.end ?? buf.length - 1) + 1);
  }
  _read() { const c = this.chunk; this.chunk = null; this.push(c && c.length ? c : null); if (c && c.length) this.push(null); }
}
export class WriteStream {}

export const createReadStream = (p, opts) => new ReadStream(p, opts);

const readonly = (name) => () => { throw Object.assign(new Error(`${name}: نظام الملفات للقراءة فقط في Workers`), { code: "EROFS" }); };
export const writeFileSync = readonly("writeFileSync");
export const mkdirSync = readonly("mkdirSync");
export const rmSync = readonly("rmSync");
export const unlinkSync = readonly("unlinkSync");
export const createWriteStream = readonly("createWriteStream");

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
export const promises = {
  readFile: async (...a) => readFileSync(...a),
  stat: async (...a) => statSync(...a),
  lstat: async (...a) => statSync(...a),
  readdir: async (...a) => readdirSync(...a),
  access: async (p) => { if (!existsSync(p)) throw enoent(p, "access"); },
};

export default {
  existsSync, statSync, lstatSync, readFileSync, readdirSync, realpathSync, stat, lstat, readFile, readdir, access,
  createReadStream, ReadStream, WriteStream, writeFileSync, mkdirSync, rmSync, unlinkSync, createWriteStream, constants, promises,
};
