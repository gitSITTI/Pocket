// A small stand-in for "an app with a private API and no documentation".
//
// It serves a web page that talks to a JSON API, the way many web apps do. Nothing here is
// documented anywhere: the demo recovers the API by watching the page use it.
//
//   node app/server.mjs [--port 4010]

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE_SIZE_DEFAULT = 3;

// Fixed so the committed capture matches what the app does. Not a secret: the whole app is a demo.
export const DEMO_USER = { username: "demo", password: "demo-password", token: "demo-session-token" };

function seed() {
  return [
    { id: 1, title: "Welcome", body: "First note in the notebook.", tags: ["intro"], updated: "2026-01-02" },
    { id: 2, title: "Release plan", body: "Ship on Friday after the checklist.", tags: ["work", "release"], updated: "2026-01-05" },
    { id: 3, title: "Groceries", body: "Milk, eggs, coffee.", tags: ["home"], updated: "2026-01-06" },
    { id: 4, title: "Retry policy", body: "Back off exponentially, add jitter.", tags: ["work"], updated: "2026-01-09" },
    { id: 5, title: "Reading list", body: "Two books to finish this month.", tags: ["home"], updated: "2026-01-12" },
    { id: 6, title: "Incident review", body: "Write the timeline first.", tags: ["work", "release"], updated: "2026-01-15" },
    { id: 7, title: "Trip ideas", body: "Somewhere with trains.", tags: ["home"], updated: "2026-01-20" },
  ];
}

export function startApp({ port = 0 } = {}) {
  const notes = seed();
  let nextId = notes.length + 1;
  const events = [];

  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error("bad json"));
        }
      });
    });
  const summary = ({ id, title, tags, updated }) => ({ id, title, tags, updated });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && !path.startsWith("/api/")) {
      const file = path === "/" ? "index.html" : path.slice(1);
      if (!/^[a-z.]+$/.test(file)) return send(res, 404, { error: "not_found" });
      let content;
      try {
        content = readFileSync(join(here, "public", file));
      } catch {
        return send(res, 404, { error: "not_found" }); // for example the browser asking for /favicon.ico
      }
      const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
      res.writeHead(200, { "content-type": type });
      return res.end(content);
    }

    try {
      if (req.method === "POST" && path === "/api/session") {
        const body = await readJson(req);
        if (body.username !== DEMO_USER.username || body.password !== DEMO_USER.password) return send(res, 401, { error: "bad_credentials" });
        return send(res, 200, { token: DEMO_USER.token, user: { id: 1, name: "Demo User" } });
      }

      // Analytics beacon the page sends on every action. A connector should ignore it.
      if (req.method === "POST" && path === "/api/events") {
        events.push(await readJson(req));
        return send(res, 204);
      }

      if (req.headers.authorization !== `Bearer ${DEMO_USER.token}`) return send(res, 401, { error: "unauthorized" });

      if (req.method === "GET" && path === "/api/me") return send(res, 200, { id: 1, name: "Demo User", plan: "free" });

      if (req.method === "GET" && path === "/api/notes") {
        const tag = url.searchParams.get("tag");
        const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "", 10) || PAGE_SIZE_DEFAULT, 50);
        const start = Number.parseInt(url.searchParams.get("cursor") ?? "0", 10) || 0;
        const matching = notes.filter((n) => !tag || n.tags.includes(tag));
        const items = matching.slice(start, start + limit).map(summary);
        const next = start + limit < matching.length ? String(start + limit) : null;
        return send(res, 200, { items, next_cursor: next, total: matching.length });
      }

      const one = /^\/api\/notes\/(\d+)$/.exec(path);
      if (one) {
        const index = notes.findIndex((n) => n.id === Number(one[1]));
        if (index === -1) return send(res, 404, { error: "not_found" });
        if (req.method === "GET") return send(res, 200, notes[index]);
        if (req.method === "DELETE") {
          notes.splice(index, 1);
          return send(res, 204);
        }
      }

      if (req.method === "POST" && path === "/api/notes") {
        const body = await readJson(req);
        if (typeof body.title !== "string" || body.title.trim() === "") return send(res, 422, { error: "title_required" });
        const note = { id: nextId++, title: body.title, body: String(body.body ?? ""), tags: Array.isArray(body.tags) ? body.tags.map(String) : [], updated: "2026-02-01" };
        notes.push(note);
        return send(res, 201, note);
      }

      return send(res, 404, { error: "not_found" });
    } catch {
      return send(res, 400, { error: "bad_request" });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://127.0.0.1:${actual}`,
        events,
        notes,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--port");
  const port = index === -1 ? 4010 : Number.parseInt(process.argv[index + 1], 10);
  const app = await startApp({ port });
  console.log(`demo app on ${app.url} (log in as ${DEMO_USER.username} / ${DEMO_USER.password})`);
}
