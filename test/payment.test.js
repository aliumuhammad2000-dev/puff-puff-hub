const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { after, before, describe, it } = require("node:test");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paystackSecret = "paystack-test-secret";
const flutterwaveSecret = "flutterwave-test-secret";
const flutterwaveHash = "flutterwave-webhook-hash";
let app;
let provider;
let appPort;
let providerPort;
let tempDir;
const providerState = {
    paystackVerify: null,
    flutterwaveVerify: null,
    paystackVerifyCount: 0,
    flutterwaveVerifyCount: 0,
    paystackDeferred: null,
    paystackInitializeDeferred: null,
    flutterwaveInitializeDeferred: null,
    paystackInitializeFailure: false
};

function jsonResponse(response, status, payload) {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
}

function request(port, rawPath, options = {}) {
    const { body, ...requestOptions } = options;
    return new Promise((resolve, reject) => {
        const request = http.request({ host: "127.0.0.1", port, path: rawPath, ...requestOptions }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks)
            }));
        });
        request.on("error", reject);
        request.end(body);
    });
}

function jsonRequest(port, rawPath, payload, method = "POST", headers = {}) {
    const body = JSON.stringify(payload);
    return request(port, rawPath, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body
    });
}

async function createOrder(providerName) {
    const cartId = `${providerName}-cart`;
    await jsonRequest(appPort, `/api/cart/${cartId}`, { items: [{ id: "maltina", quantity: 2 }] }, "PUT");
    const result = await jsonRequest(appPort, "/api/checkout", {
        cartId,
        customer: { name: "Test Customer", email: "test@example.com", phone: "08000000000" },
        deliveryLocation: "Oyingbo",
        provider: providerName
    });
    assert.equal(result.status, 200);
    return JSON.parse(result.body.toString()).order;
}

async function startPausedCheckout(providerName) {
    const cartId = `${providerName}-paused-cart-${Date.now()}-${Math.random()}`;
    await jsonRequest(appPort, `/api/cart/${encodeURIComponent(cartId)}`, { items: [{ id: "maltina", quantity: 2 }] }, "PUT");
    const checkoutRequest = jsonRequest(appPort, "/api/checkout", {
        cartId,
        customer: { name: "Race Customer", email: "race@example.com", phone: "08000000000" },
        deliveryLocation: "Oyingbo",
        provider: providerName
    });
    const deferred = providerName === "paystack" ? providerState.paystackInitializeDeferred : providerState.flutterwaveInitializeDeferred;
    await waitFor(() => deferred.length === 1);
    const orders = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"));
    const order = Object.values(orders).find(candidate => candidate.provider === providerName && !candidate.payment);
    assert.ok(order);
    return { checkoutRequest, order };
}

function paystackSignature(rawBody) {
    return crypto.createHmac("sha512", paystackSecret).update(rawBody).digest("hex");
}

async function waitFor(condition) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for deferred provider requests.");
}

before(async () => {
    provider = http.createServer(async (request, response) => {
        const chunks = [];
        request.on("data", chunk => chunks.push(chunk));
        await once(request, "end");
        const body = Buffer.concat(chunks);

        if (request.method === "POST" && request.url === "/transaction/initialize") {
            if (providerState.paystackInitializeDeferred) {
                return new Promise(resolve => providerState.paystackInitializeDeferred.push(() => {
                    if (providerState.paystackInitializeFailure) jsonResponse(response, 503, { status: false, message: "initialization unavailable" });
                    else jsonResponse(response, 200, { status: true, data: { authorization_url: "https://mock.paystack/checkout" } });
                    resolve();
                }));
            }
            return jsonResponse(response, 200, { status: true, data: { authorization_url: "https://mock.paystack/checkout" } });
        }
        if (request.method === "GET" && request.url.startsWith("/transaction/verify/")) {
            providerState.paystackVerifyCount += 1;
            if (providerState.paystackDeferred) {
                return new Promise(resolve => providerState.paystackDeferred.push(payload => {
                    jsonResponse(response, 200, payload);
                    resolve();
                }));
            }
            if (!providerState.paystackVerify) return jsonResponse(response, 503, { status: false, message: "provider unavailable" });
            return jsonResponse(response, 200, providerState.paystackVerify);
        }
        if (request.method === "POST" && request.url === "/v3/payments") {
            if (providerState.flutterwaveInitializeDeferred) {
                return new Promise(resolve => providerState.flutterwaveInitializeDeferred.push(() => {
                    jsonResponse(response, 200, { status: "success", data: { link: "https://mock.flutterwave/checkout" } });
                    resolve();
                }));
            }
            return jsonResponse(response, 200, { status: "success", data: { link: "https://mock.flutterwave/checkout" } });
        }
        if (request.method === "GET" && request.url.startsWith("/v3/transactions/") && request.url.endsWith("/verify")) {
            providerState.flutterwaveVerifyCount += 1;
            if (!providerState.flutterwaveVerify) return jsonResponse(response, 503, { status: "error", message: "provider unavailable" });
            return jsonResponse(response, 200, providerState.flutterwaveVerify);
        }
        jsonResponse(response, 404, { error: "not found" });
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    providerPort = provider.address().port;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puff-puff-hub-payment-"));
    appPort = 6200 + Math.floor(Math.random() * 200);
    app = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env: {
            ...process.env,
            PORT: String(appPort),
            DATA_DIR: tempDir,
            PUBLIC_BASE_URL: "https://shop.example",
            PAYSTACK_SECRET_KEY: paystackSecret,
            FLW_SECRET_KEY: flutterwaveSecret,
            FLW_SECRET_HASH: flutterwaveHash,
            PAYSTACK_API_BASE_URL: `http://127.0.0.1:${providerPort}`,
            FLW_API_BASE_URL: `http://127.0.0.1:${providerPort}`
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    await once(app.stdout, "data");
});

after(() => {
    app.kill();
    provider.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("payment verification", () => {
    it("verifies Paystack callback details before marking an order paid", async () => {
        const order = await createOrder("paystack");
        providerState.paystackVerify = {
            status: true,
            data: { id: 101, reference: order.id, status: "success", amount: order.total * 100, currency: "NGN" }
        };

        const result = await request(appPort, `/api/payment/verify?order=${order.id}&token=${order.callbackToken}&reference=${order.id}`);
        assert.equal(result.status, 200);
        assert.equal(JSON.parse(result.body.toString()).paymentStatus, "paid");
    });

    it("verifies Flutterwave callbacks and rejects mismatched amounts", async () => {
        const order = await createOrder("flutterwave");
        providerState.flutterwaveVerify = {
            status: "success",
            data: { id: 202, tx_ref: order.id, status: "successful", amount: order.total, currency: "NGN" }
        };
        const success = await request(appPort, `/api/payment/verify?order=${order.id}&token=${order.callbackToken}&tx_ref=${order.id}&transaction_id=202`);
        assert.equal(JSON.parse(success.body.toString()).paymentStatus, "paid");

        const mismatched = await createOrder("flutterwave");
        providerState.flutterwaveVerify = {
            status: "success",
            data: { id: 203, tx_ref: mismatched.id, status: "successful", amount: mismatched.total - 1, currency: "NGN" }
        };
        const failed = await request(appPort, `/api/payment/verify?order=${mismatched.id}&token=${mismatched.callbackToken}&transaction_id=203`);
        assert.equal(failed.status, 400);
        assert.equal(JSON.parse(failed.body.toString()).paymentStatus, "pending");
    });

    it("keeps provider outages and non-success statuses pending or failed", async () => {
        const pending = await createOrder("paystack");
        providerState.paystackVerify = null;
        const unavailable = await request(appPort, `/api/payment/verify?order=${pending.id}&token=${pending.callbackToken}&reference=${pending.id}`);
        assert.equal(unavailable.status, 502);
        assert.equal(JSON.parse(unavailable.body.toString()).paymentStatus, "pending");

        providerState.paystackVerify = {
            status: true,
            data: { id: 303, reference: pending.id, status: "failed", amount: pending.total * 100, currency: "NGN" }
        };
        const failed = await request(appPort, `/api/payment/verify?order=${pending.id}&token=${pending.callbackToken}&reference=${pending.id}`);
        assert.equal(JSON.parse(failed.body.toString()).paymentStatus, "failed");
    });

    it("rejects incorrect references and currencies", async () => {
        const wrongReference = await createOrder("paystack");
        const referenceResult = await request(appPort, `/api/payment/verify?order=${wrongReference.id}&token=${wrongReference.callbackToken}&reference=forged-reference`);
        assert.equal(referenceResult.status, 400);
        assert.equal(JSON.parse(referenceResult.body.toString()).paymentStatus, "pending");

        const wrongProvider = await createOrder("paystack");
        const providerResult = await request(appPort, `/api/payment/verify?order=${wrongProvider.id}&token=${wrongProvider.callbackToken}&provider=flutterwave&reference=${wrongProvider.id}`);
        assert.equal(providerResult.status, 400);
        assert.equal(JSON.parse(providerResult.body.toString()).paymentStatus, "pending");

        const wrongCurrency = await createOrder("flutterwave");
        providerState.flutterwaveVerify = {
            status: "success",
            data: { id: 999, tx_ref: wrongCurrency.id, status: "successful", amount: wrongCurrency.total, currency: "NGN" }
        };
        const currencyResult = await request(appPort, `/api/payment/verify?order=${wrongCurrency.id}&token=${wrongCurrency.callbackToken}&transaction_id=304`);
        assert.equal(currencyResult.status, 400);
        assert.equal(JSON.parse(currencyResult.body.toString()).paymentStatus, "pending");

        providerState.flutterwaveVerify = {
            status: "success",
            data: { id: 304, tx_ref: wrongCurrency.id, status: "successful", amount: wrongCurrency.total, currency: "USD" }
        };
        const wrongCurrencyAgain = await request(appPort, `/api/payment/verify?order=${wrongCurrency.id}&token=${wrongCurrency.callbackToken}&transaction_id=304`);
        assert.equal(wrongCurrencyAgain.status, 400);
        assert.equal(JSON.parse(wrongCurrencyAgain.body.toString()).paymentStatus, "pending");
    });

    it("rejects forged callbacks and processes authenticated Paystack webhooks idempotently", async () => {
        const order = await createOrder("paystack");
        const payload = JSON.stringify({ event: "charge.success", data: { id: 404, reference: order.id } });
        const forged = await request(appPort, "/api/webhooks/paystack", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-paystack-signature": "forged" },
            body: payload
        });
        assert.equal(forged.status, 401);

        providerState.paystackVerify = {
            status: true,
            data: { id: 404, reference: order.id, status: "success", amount: order.total * 100, currency: "NGN" }
        };
        const headers = { "Content-Type": "application/json", "x-paystack-signature": paystackSignature(payload) };
        const first = await request(appPort, "/api/webhooks/paystack", { method: "POST", headers, body: payload });
        assert.equal(first.status, 200);
        const count = providerState.paystackVerifyCount;
        const duplicate = await request(appPort, "/api/webhooks/paystack", { method: "POST", headers, body: payload });
        assert.equal(duplicate.status, 200);
        assert.equal(providerState.paystackVerifyCount, count);
    });

    it("preserves successful details when a late pending verification overlaps a webhook", async () => {
        const order = await createOrder("paystack");
        const webhookPayload = JSON.stringify({ event: "charge.success", data: { id: 601, reference: order.id } });
        const webhookHeaders = { "Content-Type": "application/json", "x-paystack-signature": paystackSignature(webhookPayload) };
        providerState.paystackDeferred = [];

        const callbackRequest = request(appPort, `/api/payment/verify?order=${order.id}&token=${order.callbackToken}&reference=${order.id}`);
        const webhookRequest = request(appPort, "/api/webhooks/paystack", { method: "POST", headers: webhookHeaders, body: webhookPayload });
        await waitFor(() => providerState.paystackDeferred.length === 2);
        providerState.paystackDeferred.shift()({ status: true, data: { id: 601, reference: order.id, status: "success", amount: order.total * 100, currency: "NGN" } });
        providerState.paystackDeferred.shift()({ status: true, data: { id: 601, reference: order.id, status: "pending", amount: order.total * 100, currency: "NGN" } });
        const results = await Promise.all([callbackRequest, webhookRequest]);
        providerState.paystackDeferred = null;

        assert.deepEqual(results.map(result => result.status).sort(), [200, 200]);
        assert.ok(results.every(result => JSON.parse(result.body.toString()).paymentStatus === "paid"));
        const saved = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[order.id];
        assert.equal(saved.paymentStatus, "paid");
        assert.equal(saved.paymentVerification.providerStatus, "success");
        assert.equal(saved.paymentVerification.transactionId, 601);
    });

    it("preserves a paid order when a late failed verification overlaps a callback", async () => {
        const order = await createOrder("paystack");
        providerState.paystackDeferred = [];
        const callbackRequest = request(appPort, `/api/payment/verify?order=${order.id}&token=${order.callbackToken}&reference=${order.id}`);
        const webhookPayload = JSON.stringify({ event: "charge.success", data: { id: 602, reference: order.id } });
        const webhookRequest = request(appPort, "/api/webhooks/paystack", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-paystack-signature": paystackSignature(webhookPayload) },
            body: webhookPayload
        });
        await waitFor(() => providerState.paystackDeferred.length === 2);
        providerState.paystackDeferred.shift()({ status: true, data: { id: 602, reference: order.id, status: "success", amount: order.total * 100, currency: "NGN" } });
        providerState.paystackDeferred.shift()({ status: true, data: { id: 602, reference: order.id, status: "failed", amount: order.total * 100, currency: "NGN" } });
        const results = await Promise.all([callbackRequest, webhookRequest]);
        providerState.paystackDeferred = null;

        assert.deepEqual(results.map(result => result.status).sort(), [200, 200]);
        assert.ok(results.every(result => JSON.parse(result.body.toString()).paymentStatus === "paid"));
        const saved = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[order.id];
        assert.equal(saved.paymentStatus, "paid");
        assert.equal(saved.paymentVerification.providerStatus, "success");
        assert.equal(saved.paymentVerification.transactionId, 602);
    });

    it("does not overwrite successful verification details on duplicate webhooks", async () => {
        const order = await createOrder("paystack");
        const payload = JSON.stringify({ event: "charge.success", data: { id: 603, reference: order.id } });
        providerState.paystackVerify = {
            status: true,
            data: { id: 603, reference: order.id, status: "success", amount: order.total * 100, currency: "NGN" }
        };
        const headers = { "Content-Type": "application/json", "x-paystack-signature": paystackSignature(payload) };
        await request(appPort, "/api/webhooks/paystack", { method: "POST", headers, body: payload });
        const first = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[order.id].paymentVerification;
        await new Promise(resolve => setTimeout(resolve, 10));
        const duplicate = await request(appPort, "/api/webhooks/paystack", { method: "POST", headers, body: payload });
        const second = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[order.id].paymentVerification;
        assert.equal(duplicate.status, 200);
        assert.deepEqual(second, first);
    });

    it("does not let delayed Paystack or Flutterwave initialization overwrite a paid order", async () => {
        for (const providerName of ["paystack", "flutterwave"]) {
            if (providerName === "paystack") providerState.paystackInitializeDeferred = [];
            else providerState.flutterwaveInitializeDeferred = [];

            const { checkoutRequest, order } = await startPausedCheckout(providerName);
            const transactionId = providerName === "paystack" ? 701 : 702;
            if (providerName === "paystack") {
                providerState.paystackVerify = {
                    status: true,
                    data: { id: transactionId, reference: order.id, status: "success", amount: order.total * 100, currency: "NGN" }
                };
            } else {
                providerState.flutterwaveVerify = {
                    status: "success",
                    data: { id: transactionId, tx_ref: order.id, status: "successful", amount: order.total, currency: "NGN" }
                };
            }

            const payload = providerName === "paystack"
                ? JSON.stringify({ event: "charge.success", data: { id: transactionId, reference: order.id } })
                : JSON.stringify({ event: "charge.completed", data: { id: transactionId, tx_ref: order.id } });
            const webhook = await request(appPort, `/api/webhooks/${providerName}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(providerName === "paystack" ? { "x-paystack-signature": paystackSignature(payload) } : { "verif-hash": flutterwaveHash })
                },
                body: payload
            });
            assert.equal(webhook.status, 200);
            const paidBeforeInitialization = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[order.id];
            assert.equal(paidBeforeInitialization.paymentStatus, "paid");

            const deferred = providerName === "paystack" ? providerState.paystackInitializeDeferred : providerState.flutterwaveInitializeDeferred;
            deferred.shift()();
            const checkout = await checkoutRequest;
            assert.equal(checkout.status, 200);
            const checkoutBody = JSON.parse(checkout.body.toString());
            assert.equal(checkoutBody.order.paymentStatus, "paid");
            assert.equal(checkoutBody.checkoutUrl, undefined);
            assert.equal(checkoutBody.order.payment?.checkoutUrl, undefined);
            assert.deepEqual(checkoutBody.order.paymentVerification, paidBeforeInitialization.paymentVerification);

            const saved = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[order.id];
            assert.equal(saved.paymentStatus, "paid");
            assert.deepEqual(saved.paymentVerification, paidBeforeInitialization.paymentVerification);
            if (providerName === "paystack") providerState.paystackInitializeDeferred = null;
            else providerState.flutterwaveInitializeDeferred = null;
        }
    });

    it("returns an independently paid order when initialization later fails", async () => {
        providerState.paystackInitializeDeferred = [];
        const { checkoutRequest, order } = await startPausedCheckout("paystack");
        providerState.paystackVerify = {
            status: true,
            data: { id: 705, reference: order.id, status: "success", amount: order.total * 100, currency: "NGN" }
        };
        const payload = JSON.stringify({ event: "charge.success", data: { id: 705, reference: order.id } });
        const webhook = await request(appPort, "/api/webhooks/paystack", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-paystack-signature": paystackSignature(payload) },
            body: payload
        });
        assert.equal(webhook.status, 200);

        providerState.paystackInitializeFailure = true;
        providerState.paystackInitializeDeferred.shift()();
        const checkout = await checkoutRequest;
        assert.equal(checkout.status, 200);
        assert.equal(JSON.parse(checkout.body.toString()).order.paymentStatus, "paid");
        providerState.paystackInitializeFailure = false;
        providerState.paystackInitializeDeferred = null;
    });

    it("rejects malformed callbacks against paid orders without changing successful details", async () => {
        const paystack = await createOrder("paystack");
        providerState.paystackVerify = {
            status: true,
            data: { id: 703, reference: paystack.id, status: "success", amount: paystack.total * 100, currency: "NGN" }
        };
        await request(appPort, `/api/payment/verify?order=${paystack.id}&token=${paystack.callbackToken}&reference=${paystack.id}`);
        const paystackBefore = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[paystack.id];
        const forgedPaystack = await request(appPort, `/api/payment/verify?order=${paystack.id}&token=${paystack.callbackToken}&reference=forged-reference`);
        assert.equal(forgedPaystack.status, 400);
        assert.equal(JSON.parse(forgedPaystack.body.toString()).paymentStatus, "paid");
        const paystackAfter = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[paystack.id];
        assert.deepEqual(paystackAfter.paymentVerification, paystackBefore.paymentVerification);

        const flutterwave = await createOrder("flutterwave");
        providerState.flutterwaveVerify = {
            status: "success",
            data: { id: 704, tx_ref: flutterwave.id, status: "successful", amount: flutterwave.total, currency: "NGN" }
        };
        await request(appPort, `/api/payment/verify?order=${flutterwave.id}&token=${flutterwave.callbackToken}&transaction_id=704`);
        const flutterwaveBefore = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[flutterwave.id];
        const forgedFlutterwave = await request(appPort, `/api/payment/verify?order=${flutterwave.id}&token=${flutterwave.callbackToken}&transaction_id=999`);
        assert.equal(forgedFlutterwave.status, 400);
        assert.equal(JSON.parse(forgedFlutterwave.body.toString()).paymentStatus, "paid");
        const flutterwaveAfter = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"))[flutterwave.id];
        assert.deepEqual(flutterwaveAfter.paymentVerification, flutterwaveBefore.paymentVerification);

        const duplicate = await request(appPort, `/api/payment/verify?order=${flutterwave.id}&token=${flutterwave.callbackToken}&transaction_id=704`);
        assert.equal(duplicate.status, 200);
        assert.equal(JSON.parse(duplicate.body.toString()).paymentStatus, "paid");
    });

    it("requires the Flutterwave webhook secret and independently verifies the transaction", async () => {
        const order = await createOrder("flutterwave");
        const payload = JSON.stringify({ event: "charge.completed", data: { id: 505, tx_ref: order.id } });
        const invalid = await request(appPort, "/api/webhooks/flutterwave", {
            method: "POST",
            headers: { "Content-Type": "application/json", "verif-hash": "wrong" },
            body: payload
        });
        assert.equal(invalid.status, 401);

        providerState.flutterwaveVerify = {
            status: "success",
            data: { id: 505, tx_ref: order.id, status: "successful", amount: order.total, currency: "NGN" }
        };
        const valid = await request(appPort, "/api/webhooks/flutterwave", {
            method: "POST",
            headers: { "Content-Type": "application/json", "verif-hash": flutterwaveHash },
            body: payload
        });
        assert.equal(valid.status, 200);
        assert.equal(JSON.parse(valid.body.toString()).paymentStatus, "paid");
    });

    it("rejects oversized webhook bodies", async () => {
        const body = Buffer.alloc(256 * 1024 + 1, "x");
        const result = await request(appPort, "/api/webhooks/paystack", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": body.length },
            body
        });
        assert.equal(result.status, 413);
    });

    it("does not authorize a payment status request with a missing or wrong callback token", async () => {
        const order = await createOrder("paystack");
        const result = await request(appPort, `/api/payment/verify?order=${order.id}&token=wrong&reference=${order.id}`);
        assert.equal(result.status, 404);
    });

    it("never marks mock-mode orders as paid", async () => {
        const file = path.join(tempDir, "orders.json");
        const orders = JSON.parse(fs.readFileSync(file, "utf8"));
        orders["mock-order"] = {
            id: "mock-order",
            callbackToken: "mock-token",
            provider: "paystack",
            paymentStatus: "pending",
            payment: { mock: true }
        };
        fs.writeFileSync(file, JSON.stringify(orders));

        const result = await request(appPort, "/api/payment/verify?order=mock-order&token=mock-token&reference=mock-order");
        assert.equal(result.status, 502);
        assert.equal(JSON.parse(result.body.toString()).paymentStatus, "pending");
    });

    it("returns only an authorized receipt with trusted order data", async () => {
        const order = await createOrder("paystack");
        const checkoutPage = await request(appPort, "/checkout.html");
        assert.equal(checkoutPage.headers["cache-control"], "no-store");
        assert.equal(checkoutPage.headers["referrer-policy"], "no-referrer");
        const authorized = await request(appPort, `/api/orders/${order.id}/receipt`, {
            headers: { Authorization: `Bearer ${order.callbackToken}` }
        });
        assert.equal(authorized.status, 200);
        assert.equal(authorized.headers["cache-control"], "no-store");
        assert.equal(authorized.headers["referrer-policy"], "no-referrer");
        const receipt = JSON.parse(authorized.body.toString());
        assert.deepEqual(Object.keys(receipt).sort(), ["createdAt", "deliveryFee", "items", "orderId", "paymentStatus", "provider", "subtotal", "total"].sort());
        assert.equal(receipt.orderId, order.id);
        assert.deepEqual(receipt.items, [{ name: "Maltina", quantity: 2, price: 600 }]);
        assert.equal(receipt.subtotal, 1200);
        assert.equal(receipt.deliveryFee, 500);
        assert.equal(receipt.total, 1700);
        assert.equal(receipt.paymentStatus, "pending");
        assert.equal("customer" in receipt, false);
        assert.equal("callbackToken" in receipt, false);
        assert.equal("payment" in receipt, false);

        const missing = await request(appPort, `/api/orders/${order.id}/receipt`);
        const invalid = await request(appPort, `/api/orders/${order.id}/receipt`, { headers: { Authorization: "Bearer invalid" } });
        assert.equal(missing.status, 404);
        assert.equal(invalid.status, 404);
        assert.deepEqual(JSON.parse(missing.body.toString()), JSON.parse(invalid.body.toString()));
    });

    it("returns persisted receipt status for paid, failed, and mock orders", async () => {
        const paid = await createOrder("paystack");
        const ordersFile = path.join(tempDir, "orders.json");
        const orders = JSON.parse(fs.readFileSync(ordersFile, "utf8"));
        orders[paid.id].paymentStatus = "paid";
        orders[paid.id].paymentVerification = { providerStatus: "success" };
        orders["failed-receipt"] = { id: "failed-receipt", callbackToken: "failed-token", createdAt: "2026-01-01T00:00:00.000Z", items: paid.items, subtotal: paid.subtotal, deliveryFee: paid.deliveryFee, total: paid.total, provider: "flutterwave", paymentStatus: "failed" };
        orders["mock-receipt"] = { id: "mock-receipt", callbackToken: "mock-receipt-token", createdAt: "2026-01-01T00:00:00.000Z", items: paid.items, subtotal: paid.subtotal, deliveryFee: paid.deliveryFee, total: paid.total, provider: "paystack", paymentStatus: "pending", payment: { mock: true } };
        fs.writeFileSync(ordersFile, JSON.stringify(orders));

        for (const [id, token, status] of [[paid.id, paid.callbackToken, "paid"], ["failed-receipt", "failed-token", "failed"], ["mock-receipt", "mock-receipt-token", "pending"]]) {
            const result = await request(appPort, `/api/orders/${id}/receipt`, { headers: { Authorization: `Bearer ${token}` } });
            assert.equal(result.status, 200);
            assert.equal(JSON.parse(result.body.toString()).paymentStatus, status);
        }
    });
});
