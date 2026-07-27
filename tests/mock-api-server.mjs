import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.BYOK_TEST_PORT ?? 43127);
const root = fileURLToPath(new URL(".", import.meta.url));

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(body));
}

function translationsFromRequest(body) {
  const prompt = body?.messages?.at(-1)?.content ?? "";
  const sourceLine = prompt.trim().split("\n").at(-1);
  const source = JSON.parse(sourceLine);
  return Object.fromEntries(
    Object.entries(source).map(([id, text]) => [id, `译：${text}`])
  );
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      });
      response.end();
      return;
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const body = await readRequestBody(request);
      if (request.headers.authorization !== "Bearer test-token") {
        json(response, 401, { error: { message: "invalid token" } });
        return;
      }
      if (body.model === "rate-limit") {
        json(response, 429, { error: { message: "rate limited" } });
        return;
      }
      if (body.model === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      const content =
        body.model === "invalid-response"
          ? "{\"wrong_id\":\"bad\"}"
          : JSON.stringify(translationsFromRequest(body));
      json(response, 200, {
        choices: [{ message: { role: "assistant", content } }]
      });
      return;
    }

    const relativePath =
      request.url === "/" ? "fixtures/article.html" : request.url.slice(1);
    const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = join(root, safePath);
    const data = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream"
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Mock translator listening at http://${host}:${port}`);
});
