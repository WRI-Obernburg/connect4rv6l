#!/usr/bin/env node
// Reads robot programs as source code from the RV6L controller via the RSVCMD XML interface.
// Read only: sends nothing but initSymbolTable, getSymbolList and getProg.
//
// Usage (on a machine that may talk to the controller, see OP_XML_PASS in the controller config):
//   node read-robot-programs.mjs                 list all programs and download those in S:/PROG/
//   node read-robot-programs.mjs S:/PROG/1       download only the given programs
// Options via environment: ROBOT_HOST (default 192.168.2.1), ROBOT_PORT (default 80), OUT_DIR (default ./robot-programs)

import fs from "node:fs";
import path from "node:path";
import { connect, escapeXml } from "./rsvcmd.mjs";

const OUT_DIR = process.env.OUT_DIR || "./robot-programs";

const robot = await connect().catch((err) => {
    console.error(`Connection error: ${err.message}`);
    process.exit(1);
});

async function listPrograms() {
    const response = await robot.send("<symbolApi><getSymbolList><program/></getSymbolList></symbolApi>");
    return [...response.matchAll(/<symbol>\s*<name>([\s\S]*?)<\/name>\s*<prog>([\s\S]*?)<\/prog>/g)]
        .map((m) => m[2].trim() + m[1].trim());
}

async function downloadProgram(name) {
    const response = await robot.send(`<awpApi><getProg><name>${escapeXml(name)}</name><src/></getProg></awpApi>`);
    const base64 = /<src>([\s\S]*?)<\/src>/.exec(response)?.[1]?.replace(/\s/g, "");
    if (!base64) throw new Error("No source in the response");
    const file = path.join(OUT_DIR, name.replace(/^[A-Za-z]:\//, "").replace(/[\\/:$]/g, "_") + ".txt");
    fs.writeFileSync(file, Buffer.from(base64, "base64"));
    return file;
}

try {
    console.log("Connected, initializing symbol table ...");
    await robot.initSymbolTable();

    const programs = await listPrograms();
    console.log(`\n${programs.length} programs on the controller:`);
    programs.forEach((p) => console.log("  " + p));

    const wanted = process.argv.slice(2).length
        ? process.argv.slice(2)
        : programs.filter((p) => p.toUpperCase().startsWith("S:/PROG/"));

    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`\nDownloading ${wanted.length} programs to ${OUT_DIR}:`);
    for (const name of wanted) {
        try {
            console.log(`  ${name} -> ${await downloadProgram(name)}`);
        } catch (err) {
            console.log(`  ${name} failed: ${err.message}`);
        }
    }
} catch (err) {
    console.error(err.message);
    process.exitCode = 1;
}
robot.close();
