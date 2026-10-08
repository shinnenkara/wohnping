import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DENY_FILES = new Set(["package.json", "package-lock.json"]);
const DENY_PREFIXES = ["test/", "node_modules/", "scripts/", "docs/", "dist/", ".git/"];

function posixJoin(fromFile, ref) {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), ref));
  if (joined.startsWith("../") || path.posix.isAbsolute(joined)) {
    throw new Error(`Package path escapes the extension: ${joined}`);
  }
  return joined;
}

function assertAllowed(rel) {
  if (DENY_FILES.has(rel) || DENY_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
    throw new Error(`Refusing to pack ${rel}`);
  }
}

function localRefs(fromFile, text) {
  const refs = [];
  const add = (ref) => {
    if (!ref || /^(https?:|data:|chrome:|\/\/)/i.test(ref)) return;
    refs.push(posixJoin(fromFile, ref));
  };
  if (fromFile.endsWith(".html")) {
    for (const tag of text.match(/<(?:script|link)\b[^>]*>/gi) || []) {
      const attr = /\b(?:src|href)\s*=\s*"([^"]+)"/i.exec(tag);
      if (attr) add(attr[1]);
    }
  }
  if (fromFile.endsWith(".js")) {
    for (const call of text.match(/importScripts\(([^)]*)\)/g) || []) {
      for (const literal of call.match(/"([^"]+)"|'([^']+)'/g) || []) add(literal.slice(1, -1));
    }
    for (const call of text.match(/chrome\.runtime\.getURL\(\s*["'][^"']+["']\s*\)/g) || []) {
      const ref = path.posix.normalize(call.match(/["']([^"']+)["']/)[1]);
      if (ref.startsWith("../") || path.posix.isAbsolute(ref)) {
        throw new Error(`Package path escapes the extension: ${ref}`);
      }
      refs.push(ref);
    }
  }
  if (fromFile.endsWith(".css")) {
    for (const url of text.match(/url\(\s*["']?[^"')]+["']?\s*\)/g) || []) {
      add(url.replace(/^url\(\s*["']?|["']?\s*\)$/g, ""));
    }
  }
  return refs;
}

function manifestRefs(manifest) {
  const refs = [];
  if (manifest.background && manifest.background.service_worker) refs.push(manifest.background.service_worker);
  if (manifest.action) {
    if (manifest.action.default_popup) refs.push(manifest.action.default_popup);
    for (const icon of Object.values(manifest.action.default_icon || {})) refs.push(icon);
  }
  if (manifest.options_ui && manifest.options_ui.page) refs.push(manifest.options_ui.page);
  for (const icon of Object.values(manifest.icons || {})) refs.push(icon);
  for (const script of manifest.content_scripts || []) {
    for (const file of script.js || []) refs.push(file);
    for (const file of script.css || []) refs.push(file);
  }
  return refs;
}

export function collectPackageFiles(root = ROOT) {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const queue = ["manifest.json", ...manifestRefs(manifest)];
  const files = [];
  const seen = new Set();
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    assertAllowed(rel);
    const abs = path.join(root, ...rel.split("/"));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`Missing package file ${rel}`);
    files.push(rel);
    if (/\.(html|js|css)$/.test(rel)) {
      queue.push(...localRefs(rel, fs.readFileSync(abs, "utf8")));
    }
  }
  files.sort();
  return { manifest, files };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(entry.data.length, 20);
    cen.writeUInt32LE(entry.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, name, entry.data);
    central.push(cen, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

export function writePackage(root = ROOT) {
  const { manifest, files } = collectPackageFiles(root);
  const entries = files.map((name) => ({
    name,
    data: fs.readFileSync(path.join(root, ...name.split("/"))),
  }));
  const outDir = path.join(root, "dist");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "wohnping.zip");
  fs.writeFileSync(outPath, zipStore(entries));
  return { outPath, manifest, files };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = writePackage();
  console.log(result.outPath);
  for (const file of result.files) console.log(file);
}
