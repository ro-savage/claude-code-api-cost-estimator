import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate } from "./aggregate.mjs";
import { buildMatrix } from "./matrix.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC    = resolve(join(__dirname, "..", "public"));
const PRICING   = join(__dirname, "..", "pricing.json");
const PORT      = Number(process.env.PORT ?? 3000);
// Single-user local tool: only accept loopback connections, never the LAN.
const HOST      = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Map a request path to a file inside PUBLIC, or null if it would escape it.
function safeStaticPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); }
  catch { return null; } // malformed percent-encoding
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC, rel); // collapses any ../ segments
  if (filePath !== PUBLIC && !filePath.startsWith(PUBLIC + sep)) return null;
  return filePath;
}

async function serveStatic(res, filePath) {
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}

function json(res, data) {
  const body = JSON.stringify(data);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/api/matrix") {
    try {
      const [usage, pricingRaw] = await Promise.all([
        aggregate(),
        readFile(PRICING, "utf8").then(JSON.parse),
      ]);
      const matrix = buildMatrix(usage, pricingRaw);
      console.log(`Scanned ${matrix.scannedFiles} files · ${matrix.totals.messages.toLocaleString()} messages`);
      return json(res, matrix);
    } catch (err) {
      console.error(err);
      res.writeHead(500); res.end(String(err));
    }
    return;
  }

  if (url === "/api/pricing") {
    try {
      const raw = await readFile(PRICING, "utf8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
    } catch {
      res.writeHead(500); res.end("Could not read pricing.json");
    }
    return;
  }

  const filePath = safeStaticPath(url);
  if (!filePath) { res.writeHead(403); res.end("Forbidden"); return; }
  await serveStatic(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
