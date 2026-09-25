// Minimal RSVCMD XML client for the tools in this folder (no dependencies).
// The controller answers every command before it accepts the next one, so commands are sent
// strictly one after another and the next complete response always belongs to the pending
// command. That way error responses, which carry no clientStamp, are matched as well.

import net from "node:net";

const RESPONSE_END = "</RSVRES>";

export const escapeXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function connect({
    host = process.env.ROBOT_HOST || "192.168.2.1",
    port = parseInt(process.env.ROBOT_PORT || "80"),
    timeoutMs = 60000, // initSymbolTable and getProg can take several seconds
} = {}) {
    const socket = net.connect(port, host);
    socket.setEncoding("latin1");

    let buffer = "";
    let pending = null;
    let queue = Promise.resolve();
    let stamp = 1;

    socket.on("data", (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf(RESPONSE_END)) !== -1) {
            const response = buffer.slice(0, end + RESPONSE_END.length);
            buffer = buffer.slice(end + RESPONSE_END.length);
            pending?.resolve(response);
            pending = null;
        }
    });
    socket.on("close", () => pending?.reject(new Error("Connection closed by the controller")));

    await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
    });
    socket.on("error", (err) => pending?.reject(err));
    // the manual names RSVCMD_SESSION, but the controller at the WRI only answers to SYMTABLE_SESSION
    socket.write(`${process.env.RSV_SESSION || "SYMTABLE_SESSION"} / \n`);

    function sendNow(body) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending = null;
                reject(new Error(`No response within ${timeoutMs / 1000} s`));
            }, timeoutMs);
            pending = {
                resolve: (r) => { clearTimeout(timer); resolve(r); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            };
            socket.write(`<RSVCMD><clientStamp>${stamp++}</clientStamp>${body}</RSVCMD>`);
        }).then((response) => {
            const errors = [...response.matchAll(/<error>([\s\S]*?)<\/error>/g)].map((m) => m[1].trim());
            if (errors.length) throw new Error("Controller error: " + errors.join(" "));
            return response;
        });
    }

    // serialize all commands, a failed one must not block the following ones
    const send = (body) => {
        const result = queue.then(() => sendNow(body));
        queue = result.catch(() => {});
        return result;
    };

    return {
        send,
        close: () => socket.end(),
        initSymbolTable: () => send("<symbolApi><initSymbolTable/></symbolApi>"),
        async read(name) {
            const r = await send(`<symbolApi><readSymbolValue><name>${escapeXml(name)}</name></readSymbolValue></symbolApi>`);
            return /<value>([\s\S]*?)<\/value>/.exec(r)?.[1]?.trim();
        },
        write: (name, value) =>
            send(`<symbolApi><writeSymbolValue><name>${escapeXml(name)}</name><value>${escapeXml(value)}</value></writeSymbolValue></symbolApi>`),
        bitsetOr: (name, mask) =>
            send(`<awpApi><bitsetVar><name>${escapeXml(name)}</name><or>${Number(mask)}</or></bitsetVar></awpApi>`),
        bitsetAnd: (name, mask) =>
            send(`<awpApi><bitsetVar><name>${escapeXml(name)}</name><and>${Number(mask)}</and></bitsetVar></awpApi>`),
    };
}
