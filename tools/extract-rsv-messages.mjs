#!/usr/bin/env node
// Extracts the controller message texts (M1 ... M9999) from the teach-pendant JAR for the backend.
// The controller only sends message numbers; the texts live in the pendant software. The backend uses them
// for message numbers that are missing in the handbook reference (backend/src/data/rsv_errors.json).
//
//   node tools/extract-rsv-messages.mjs /path/to/RSVPCXBDO.jar [output file]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const jar = process.argv[2];
if (!jar) {
    console.error("Usage: node tools/extract-rsv-messages.mjs /path/to/RSVPCXBDO.jar [output file]");
    process.exit(1);
}
const out = process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "backend", "src", "data", "rsv_messages.json");

const FILES = { en: "Library.properties", de: "Library_de.properties" };

function parseProperties(source) {
    const result = {};
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        // continuation lines end with an odd number of backslashes
        while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].trimStart();
        const match = /^\s*(M\d+)\s*[=:]\s*(.*)$/.exec(line);
        if (!match) continue;
        result[match[1]] = match[2]
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\(.)/g, "$1");
    }
    return result;
}

const catalog = {};
for (const [lang, file] of Object.entries(FILES)) {
    const source = execFileSync("unzip", ["-p", jar, `de/reisrobotics/rsv/rsvigui/resources/${file}`], {
        encoding: "latin1",
        maxBuffer: 64 * 1024 * 1024,
    });
    catalog[lang] = parseProperties(source);
    console.log(`${lang}: ${Object.keys(catalog[lang]).length} messages`);
}

mkdirSync(dirname(out), { recursive: true });
// the backend only shows German texts
writeFileSync(out, JSON.stringify({ de: catalog.de }));
console.log(`Written to ${out}`);
