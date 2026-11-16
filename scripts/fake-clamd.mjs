// TEST DOUBLE ONLY (never a substitute for ClamAV): speaks the clamd INSTREAM protocol and flags the harmless EICAR test string.
// Lets CI and local e2e runs exercise the real scan-before-store code path without installing an antivirus engine.
import net from "node:net";
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const port = Number(process.env.CLAMD_PORT ?? 3310);
net.createServer((sock) => {
  let buf = Buffer.alloc(0), started = false; const parts = [];
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!started) { const i = buf.indexOf(0); if (i < 0) return; const cmd = buf.subarray(0, i).toString(); buf = buf.subarray(i + 1); if (cmd === "zPING") { sock.end("PONG\0"); return; } if (cmd !== "zINSTREAM") { sock.end("UNKNOWN COMMAND\0"); return; } started = true; }
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (len === 0) { sock.end((Buffer.concat(parts).toString("latin1").includes(EICAR) ? "stream: Eicar-Test-Signature FOUND" : "stream: OK") + "\0"); return; }
      if (buf.length < 4 + len) return; parts.push(buf.subarray(4, 4 + len)); buf = buf.subarray(4 + len);
    }
  });
  sock.on("error", () => {});
}).listen(port, "127.0.0.1", () => console.log(`fake clamd (test double) listening on ${port}`));
