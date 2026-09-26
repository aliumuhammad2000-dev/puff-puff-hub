const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { once } = require("node:events");
const { after, before, describe, it } = require("node:test");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
let child;
let port;

function request(rawPath, options = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request({ host: "127.0.0.1", port, path: rawPath, ...options }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks)
            }));
        });
        request.on("error", reject);
        request.end();
    });
}

before(async () => {
    port = 5600 + Math.floor(Math.random() * 200);
    child = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"]
    });
    await once(child.stdout, "data");
});

after(() => child.kill());

describe("secure static file serving", () => {
    it("serves the website's allowlisted assets", async () => {
        for (const asset of [
            "/",
            "/index.html",
            "/combo.html",
            "/checkout.html",
            "/index.html?cache=1&next=../private",
            "/output.css",
            "/scripts/hero.js",
            "/data/products.js",
            "/images/dough.png"
        ]) {
            const result = await request(asset);
            assert.equal(result.status, 200, asset);
            assert.ok(result.body.length > 0, asset);
        }
    });

    it("denies private project files", async () => {
        for (const privatePath of [
            "/server.js",
            "/package.json",
            "/.env",
            "/data/orders.json",
            "/data/carts.json",
            "/.git/config"
        ]) {
            const result = await request(privatePath);
            assert.equal(result.status, 404, privatePath);
            assert.equal(result.body.toString(), "Not found");
            assert.ok(!result.body.toString().includes("const http"), privatePath);
        }
    });

    it("denies encoded and alternate-separator traversal attempts", async () => {
        for (const traversalPath of [
            "/%2e%2e/server.js",
            "/%2e%2e%2fserver.js",
            "/scripts/%2e%2e/server.js",
            "/%5c..%5cserver.js",
            "/data/%2e%2e/index.html",
            "/scripts/%2e%2e/combo.html",
            "/data/../index.html",
            "/scripts/../combo.html",
            "/malformed/%E0%A4%A.html"
        ]) {
            const result = await request(traversalPath);
            assert.equal(result.status, 404, traversalPath);
            assert.equal(result.body.toString(), "Not found");
        }
    });

    it("keeps the cart API available", async () => {
        const result = await request("/api/cart/security-test-empty");
        assert.equal(result.status, 200);
        assert.equal(result.headers["content-type"], "application/json");
        assert.deepEqual(JSON.parse(result.body.toString()), []);
    });

    it("keeps checkout API validation available", async () => {
        const result = await request("/api/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        assert.equal(result.status, 400);
        assert.deepEqual(JSON.parse(result.body.toString()), { error: "Your cart is empty." });
    });
});
