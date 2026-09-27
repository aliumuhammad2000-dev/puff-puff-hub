const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "checkout.js"), "utf8");

function response(payload, ok = true, status = ok ? 200 : 500) {
    return { ok, status, async json() { return payload; } };
}

function createHarness(checkoutResult, search = "", receiptResult = null, storedToken = null, verificationStatus = 200, sharedSessionValues = null) {
    const elements = new Map();
    const listeners = new Map();
    const calls = [];
    const controls = [{ disabled: false }, { disabled: false }];
    const sessionValues = sharedSessionValues || new Map(storedToken ? [[`puffPuffReturn:${new URLSearchParams(search).get("order")}`, JSON.stringify({ token: storedToken })]] : []);

    function createElement(id) {
        const element = {
            id,
            innerHTML: "",
            textContent: "",
            className: "",
            disabled: false,
            attributes: {},
            children: [],
            setAttribute(name, value) { this.attributes[name] = value; },
            querySelectorAll() { return controls; },
            replaceChildren(...children) { this.children = children; },
            append(...children) { this.children.push(...children); },
            addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); }
        };
        elements.set(id, element);
        return element;
    }

    ["checkout-form", "checkout-message", "checkout-items", "subtotal", "delivery-fee", "total"].forEach(createElement);
    const context = {
        URLSearchParams,
        FormData: class MockFormData {
            constructor() {
                this.values = { name: "Test Customer", email: "test@example.com", phone: "08000000000", deliveryLocation: "Oyingbo", provider: "paystack" };
            }
            [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
        },
        localStorage: { getItem() { return "test-cart"; } },
        window: { location: { search, href: undefined } },
        document: { getElementById(id) { return elements.get(id) || null; } },
        sessionStorage: {
            values: sessionValues,
            getItem(key) { return this.values.get(key) || null; },
            setItem(key, value) { this.values.set(key, value); }
        },
        fetch: async (url, options = {}) => {
            calls.push({ url, options });
            if (options.method === "POST") return response(checkoutResult);
            if (url.startsWith("/api/payment/verify")) return response({ paymentStatus: "pending" }, verificationStatus < 400, verificationStatus);
            if (url.startsWith("/api/orders/")) return response(receiptResult || { orderId: "existing", createdAt: "2026-01-01T00:00:00.000Z", items: [], subtotal: 0, deliveryFee: 0, total: 0, provider: "paystack", paymentStatus: "pending" });
            return response([{ id: "maltina", name: "Maltina", price: 600, quantity: 2 }]);
        },
        console
    };
    context.document = {
        getElementById(id) { return elements.get(id) || null; },
        createElement(id) { return createElement(id); }
    };

    vm.createContext(context);
    context.window.history = { replaceState(_state, _title, url) { context.window.location.search = url.includes("?") ? url.slice(url.indexOf("?")) : ""; } };
    vm.runInContext(`${source}\nthis.testApi = { elements: this.__elements, listeners: this.__listeners, calls: this.__calls, window: this.window, controls: this.__controls, sessionStorage: this.sessionStorage };`, Object.assign(context, { __elements: elements, __listeners: listeners, __calls: calls, __controls: controls }));
    return context.testApi;
}

async function ready(api) {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    return api;
}

async function submit(api) {
    await api.listeners.get("checkout-form:submit")({ preventDefault() {} });
}

describe("checkout payment state handling", () => {
    it("confirms a paid order instead of redirecting when checkoutUrl exists", async () => {
        const api = await ready(createHarness({ order: { id: "paid-url", paymentStatus: "paid", deliveryFee: 500 }, checkoutUrl: "https://provider.example/pay" }));
        await submit(api);
        assert.match(api.elements.get("checkout-message").textContent, /Payment confirmed/);
        assert.equal(api.window.location.href, undefined);
    });

    it("confirms a paid order without treating a missing checkoutUrl as mock mode", async () => {
        const api = await ready(createHarness({ order: { id: "paid-no-url", paymentStatus: "paid", deliveryFee: 500 } }));
        await submit(api);
        assert.match(api.elements.get("checkout-message").textContent, /Payment confirmed/);
        assert.doesNotMatch(api.elements.get("checkout-message").textContent, /mock/i);
    });

    it("shows mock mode only when the response explicitly says mock", async () => {
        const api = await ready(createHarness({ order: { id: "mock-order", paymentStatus: "pending", deliveryFee: 500 }, mock: true }));
        await submit(api);
        assert.match(api.elements.get("checkout-message").textContent, /mock mode/i);
    });

    it("redirects an unpaid order with a valid checkoutUrl", async () => {
        const api = await ready(createHarness({ order: { id: "unpaid", paymentStatus: "pending", deliveryFee: 500 }, checkoutUrl: "https://provider.example/pay" }));
        await submit(api);
        assert.equal(api.window.location.href, "https://provider.example/pay");
    });

    it("disables and blocks checkout submission while verifying an existing order", async () => {
        const api = await ready(createHarness({ paymentStatus: "pending" }, "?order=existing&token=token"));
        assert.equal(api.controls.every(control => control.disabled), true);
        const postCount = api.calls.filter(call => call.options.method === "POST").length;
        await submit(api);
        assert.equal(api.calls.filter(call => call.options.method === "POST").length, postCount);
    });

    it("displays the authorized receipt while verification is temporarily unavailable", async () => {
        const receipt = { orderId: "pending-order", createdAt: "2026-01-01T00:00:00.000Z", items: [{ name: "Maltina", quantity: 2, price: 600 }], subtotal: 1200, deliveryFee: 500, total: 1700, provider: "paystack", paymentStatus: "pending" };
        const api = await ready(createHarness({}, "?order=pending-order&token=token", receipt, null, 502));
        assert.match(api.elements.get("checkout-message").textContent, /temporarily unavailable/i);
        assert.equal(api.elements.get("subtotal").textContent, 1200);
        assert.equal(api.elements.get("total").textContent, 1700);
    });

    it("renders receipt product names as text and remains safe on reload", async () => {
        const receipt = { orderId: "safe-order", createdAt: "2026-01-01T00:00:00.000Z", items: [{ name: "<img src=x onerror=alert(1)>", quantity: 1, price: 600 }], subtotal: 600, deliveryFee: 0, total: 600, provider: "paystack", paymentStatus: "pending" };
        const api = await ready(createHarness({}, "?order=safe-order&token=token&reference=safe-order", receipt));
        const itemName = api.elements.get("checkout-items").children[0].children[0];
        assert.equal(itemName.textContent, "<img src=x onerror=alert(1)> × 1");
        assert.equal(api.window.location.search, "?order=safe-order");

        const reloaded = await ready(createHarness({}, "?order=safe-order", receipt, "token"));
        assert.equal(reloaded.elements.get("total").textContent, 600);
        assert.equal(reloaded.calls.filter(call => call.options.method === "POST").length, 0);
    });

    it("preserves the Flutterwave transaction ID and retries it after a pending reload", async () => {
        const sessionValues = new Map();
        const pendingReceipt = { orderId: "flutterwave-order", createdAt: "2026-01-01T00:00:00.000Z", items: [], subtotal: 0, deliveryFee: 0, total: 0, provider: "flutterwave", paymentStatus: "pending" };
        const first = await ready(createHarness({}, "?order=flutterwave-order&token=token&tx_ref=flutterwave-order&transaction_id=777", pendingReceipt, null, 200, sessionValues));
        const firstVerification = first.calls.find(call => call.url.startsWith("/api/payment/verify"));
        assert.match(firstVerification.url, /transaction_id=777/);
        assert.equal(first.window.location.search, "?order=flutterwave-order");

        const paidReceipt = { ...pendingReceipt, paymentStatus: "paid" };
        const reloaded = await ready(createHarness({}, "?order=flutterwave-order", paidReceipt, null, 200, sessionValues));
        const retryVerification = reloaded.calls.find(call => call.url.startsWith("/api/payment/verify"));
        assert.match(retryVerification.url, /transaction_id=777/);
        assert.match(reloaded.elements.get("checkout-message").textContent, /confirmed/i);
    });

    it("clearly reports a missing Flutterwave transaction ID while pending", async () => {
        const receipt = { orderId: "missing-transaction", createdAt: "2026-01-01T00:00:00.000Z", items: [], subtotal: 0, deliveryFee: 0, total: 0, provider: "flutterwave", paymentStatus: "pending" };
        const api = await ready(createHarness({}, "?order=missing-transaction&token=token", receipt));
        assert.match(api.elements.get("checkout-message").textContent, /did not return a transaction ID/i);
    });
});
