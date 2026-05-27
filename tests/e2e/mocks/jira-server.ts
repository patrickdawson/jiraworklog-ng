import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type MockExpectation = {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type ReceivedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type JiraMockHandle = {
  port: number;
  stop(): Promise<void>;
};

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload =
    typeof body === "string" ? body : JSON.stringify(body ?? {});
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload).toString(),
    ...headers,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function defaultResponse(method: string, path: string): { status: number; body: unknown } {
  if (method === "GET" && path === "/rest/api/2/myself") {
    return {
      status: 200,
      body: { displayName: "Test User", accountId: "test-account" },
    };
  }
  if (method === "POST" && /^\/rest\/api\/2\/issue\/[^/]+\/worklog$/.test(path)) {
    return { status: 201, body: { id: "1", self: "" } };
  }
  return { status: 404, body: { error: "no default for this route" } };
}

export function startJiraMock(port: number): Promise<JiraMockHandle> {
  const expectations: MockExpectation[] = [];
  const received: ReceivedRequest[] = [];

  const server: Server = createServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const url = req.url ?? "/";
    const path = url.split("?")[0];
    const body = await readBody(req);

    // Admin endpoints — control plane for tests.
    if (path === "/__mock/expect" && method === "POST") {
      const exp = JSON.parse(body) as MockExpectation | MockExpectation[];
      const list = Array.isArray(exp) ? exp : [exp];
      expectations.push(...list);
      send(res, 200, { ok: true, queued: list.length });
      return;
    }
    if (path === "/__mock/reset" && method === "POST") {
      expectations.length = 0;
      received.length = 0;
      send(res, 200, { ok: true });
      return;
    }
    if (path === "/__mock/received" && method === "GET") {
      send(res, 200, { received });
      return;
    }

    received.push({ method, path, headers: req.headers, body });

    // FIFO match for queued expectations on method+path.
    const idx = expectations.findIndex(
      (e) => e.method.toUpperCase() === method && e.path === path,
    );
    if (idx !== -1) {
      const [exp] = expectations.splice(idx, 1);
      send(res, exp.status ?? 200, exp.body ?? {}, exp.headers);
      return;
    }

    const fallback = defaultResponse(method, path);
    send(res, fallback.status, fallback.body);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        stop: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
