// Builds the static TTF fonts used by the FFmpeg/libass caption export
// (ARCHITECTURE.md §26). libass cannot read the woff2 variable font the
// browser preview uses, so we take Inter's static latin weights (WOFF, from
// the @fontsource/inter dev dependency, SIL OFL 1.1), unwrap them to plain
// TTF, and rewrite the `name` table so each weight has a unique family name
// ("Inter W600") — the ASS file then selects a weight by family name alone,
// with no reliance on font-weight matching.
//
//   node scripts/build-export-fonts.mjs
//
// The generated files in assets/fonts/ are committed; re-run only to regenerate.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
const fontsourceDir = require.resolve("@fontsource/inter/package.json").replace(/package\.json$/, "files/");

function readWoff(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOFF") throw new Error("not a WOFF file");
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const at = 44 + i * 20;
    const tag = buf.toString("latin1", at, at + 4);
    const offset = buf.readUInt32BE(at + 4);
    const compLength = buf.readUInt32BE(at + 8);
    const origLength = buf.readUInt32BE(at + 12);
    const raw = buf.subarray(offset, offset + compLength);
    tables.push({ tag, data: compLength < origLength ? inflateSync(raw) : Buffer.from(raw) });
  }
  return { flavor, tables };
}

function buildNameTable(family) {
  const records = [
    [1, family], // family
    [2, "Regular"], // subfamily
    [3, family], // unique id
    [4, family], // full name
    [6, family.replace(/ /g, "-")], // PostScript name
  ];
  const strings = records.map(([, text]) => Buffer.from(text, "utf16le").swap16());
  const header = Buffer.alloc(6 + records.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(records.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  records.forEach(([nameId], i) => {
    const at = 6 + i * 12;
    header.writeUInt16BE(3, at); // Windows
    header.writeUInt16BE(1, at + 2); // Unicode BMP
    header.writeUInt16BE(0x0409, at + 4); // en-US
    header.writeUInt16BE(nameId, at + 6);
    header.writeUInt16BE(strings[i].length, at + 8);
    header.writeUInt16BE(offset, at + 10);
    offset += strings[i].length;
  });
  return Buffer.concat([header, ...strings]);
}

function checksum(data) {
  let sum = 0;
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function writeSfnt(flavor, tables) {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = tables.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  const dir = Buffer.alloc(12 + n * 16);
  dir.writeUInt32BE(flavor, 0);
  dir.writeUInt16BE(n, 4);
  dir.writeUInt16BE(searchRange, 6);
  dir.writeUInt16BE(entrySelector, 8);
  dir.writeUInt16BE(n * 16 - searchRange, 10);
  let offset = dir.length;
  const bodies = [];
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    dir.write(t.tag, at, "latin1");
    dir.writeUInt32BE(checksum(t.data), at + 4);
    dir.writeUInt32BE(offset, at + 8);
    dir.writeUInt32BE(t.data.length, at + 12);
    const padded = Buffer.concat([t.data, Buffer.alloc((4 - (t.data.length % 4)) % 4)]);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([dir, ...bodies]);
}

mkdirSync("assets/fonts", { recursive: true });
for (const weight of [400, 500, 600, 700, 800, 900]) {
  const { flavor, tables } = readWoff(readFileSync(`${fontsourceDir}inter-latin-${weight}-normal.woff`));
  const withName = tables.filter((t) => t.tag !== "name").concat({ tag: "name", data: buildNameTable(`Inter W${weight}`) });
  const ttf = writeSfnt(flavor, withName);
  writeFileSync(`assets/fonts/Inter-W${weight}.ttf`, ttf);
  console.log(`wrote assets/fonts/Inter-W${weight}.ttf (${ttf.length} bytes)`);
}
