import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { login, restoreSqliteSnapshot, screenshot } from "../util-test";

const responseBody = `${"完整响应😀".repeat(1000)}\n<img src=x onerror="window.responseExecuted = true">\nresponse-end`;
const jsonBody = {
    message: "A complete JSON response",
    html: '<img src=x onerror="window.responseExecuted = true">',
    items: Array.from({ length: 80 }, (_, index) => ({ index, message: "完整响应😀".repeat(20), ok: true })),
    endMarker: "response-end",
};
let responseServer;
let responseServerURL;

/**
 * Create an HTTP monitor against the local response fixture.
 * @param {import('@playwright/test').Page} page Browser page.
 * @param {string} endpoint Response fixture endpoint.
 * @returns {Promise<void>} Resolves when the monitor detail page opens.
 */
async function createMonitor(page, endpoint) {
    await page.goto("./add");
    await login(page);
    await page.getByTestId("friendly-name-input").fill(`Response ${endpoint}`);
    await page.getByTestId("url-input").fill(`${responseServerURL}/${endpoint}`);
    await page.getByLabel("Save HTTP Success Response for Notifications").check();
    await expect(page.getByLabel("Response Max Length (bytes)")).toHaveValue("0");
    await page.getByTestId("save-button").click();
    await page.waitForURL("/dashboard/*");
}

/**
 * Open a response from a heartbeat bar's latest heartbeat.
 * @param {import('@playwright/test').Locator} canvas Heartbeat canvas.
 * @param {import('@playwright/test').Page} page Browser page.
 * @returns {Promise<void>} Resolves when the viewer is open.
 */
async function openFromHeartbeat(canvas, page) {
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    await canvas.hover({ position: { x: bounds.width - 8, y: bounds.height / 2 } });
    await page.locator(".tooltip-wrapper").getByRole("button", { name: "View response" }).click();
    await expect(page.getByRole("dialog", { name: "Response body" })).toBeVisible();
    await expect(page.locator(".tooltip-wrapper")).toHaveCount(0);
}

test.describe("Saved heartbeat responses", () => {
    test.beforeAll(async () => {
        responseServer = createServer((request, response) => {
            if (request.url === "/no-response") {
                request.socket.destroy();
                return;
            }
            const json = request.url === "/json";
            response.writeHead(request.url === "/error" ? 503 : 200, {
                "Content-Type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
            });
            response.end(json ? JSON.stringify(jsonBody) : request.url === "/empty" ? "" : responseBody);
        });
        await new Promise((resolve) => responseServer.listen(0, "127.0.0.1", resolve));
        responseServerURL = `http://127.0.0.1:${responseServer.address().port}`;
    });

    test.afterAll(async () => {
        await new Promise((resolve) => responseServer.close(resolve));
    });

    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    test("history, detail heartbeats, and sidebar heartbeats share one on-demand dialog", async ({ page }) => {
        const responseRequests = [];
        page.on("websocket", (socket) => {
            socket.on("framesent", ({ payload }) => {
                if (String(payload).includes('"getHeartbeatResponse"')) {
                    responseRequests.push(payload);
                }
            });
        });
        await createMonitor(page, "success");
        const action = page.locator(".event-response-button").first();
        await expect(action).toBeVisible();
        expect(responseRequests).toHaveLength(0);
        const originalRowHeight = (await page.locator(".event-row").first().boundingBox()).height;
        await action.click();
        const dialog = page.getByRole("dialog", { name: "Response body" });
        await expect(dialog.locator(".response-raw")).toHaveText(responseBody);
        await expect(dialog.locator("img")).toHaveCount(0);
        expect(await page.evaluate(() => window.responseExecuted)).toBeUndefined();
        expect(responseRequests).toHaveLength(1);
        expect((await page.locator(".event-row").first().boundingBox()).height).toBeCloseTo(originalRowHeight, 0);
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await expect(action).toBeFocused();

        // Reload exercises the paginated history endpoint as well as live heartbeats.
        await page.reload();
        await action.click();
        await expect(dialog.locator(".response-raw")).toHaveText(responseBody);
        expect(responseRequests).toHaveLength(2);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();

        await openFromHeartbeat(page.locator(".shadow-box .heartbeat-canvas").first(), page);
        await expect(dialog.locator(".response-raw")).toHaveText(responseBody);
        await page.keyboard.press("Escape");
        await openFromHeartbeat(page.locator(".monitor-list .heartbeat-canvas:visible").first(), page);
        await expect(dialog.locator(".response-raw")).toHaveText(responseBody);
        await expect(page.locator(".response-dialog")).toHaveCount(1);
    });

    test("JSON is formatted, foldable, copied in full, and usable on a narrow screen", async ({
        page,
        context,
    }, testInfo) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await createMonitor(page, "json");
        await page.locator(".event-response-button").first().click();
        const dialog = page.getByRole("dialog", { name: "Response body" });
        await expect(dialog.locator(".response-json")).toContainText('"message": "A complete JSON response"');
        await expect(dialog.locator(".response-fold-summary")).toContainText("80 items");
        await expect(dialog.locator("img")).toHaveCount(0);
        await screenshot(testInfo, page);

        await dialog.getByRole("button", { name: "Collapse all", exact: true }).click();
        await expect(dialog.locator(".response-json-line")).toHaveCount(1);
        await dialog.locator(".response-copy").click();
        await expect(dialog.locator(".response-copy")).toHaveText("Copied");
        const formattedCopy = await page.evaluate(() => navigator.clipboard.readText());
        expect(JSON.parse(formattedCopy)).toEqual(jsonBody);
        expect(formattedCopy).toContain('\n  "message":');

        await dialog.getByRole("button", { name: "Expand all", exact: true }).click();
        await expect(dialog.locator(".response-json")).toContainText('"index": 0');
        expect(await dialog.locator(".response-json-line").count()).toBeLessThan(100);
        await dialog.locator(".response-viewport").evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await expect(dialog.locator(".response-json")).toContainText('"endMarker": "response-end"');

        await dialog.getByRole("button", { name: "Raw", exact: true }).click();
        await expect(dialog.locator(".response-raw")).toHaveText(JSON.stringify(jsonBody));
        // Exercise the clipboard fallback used by HTTP preview deployments.
        await page.evaluate(() => {
            window.testClipboard = navigator.clipboard;
            Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
        });
        await dialog.locator(".response-copy").click();
        await expect(dialog.locator(".response-copy")).toHaveText("Copied");
        expect(await page.evaluate(() => window.testClipboard.readText())).toBe(JSON.stringify(jsonBody));

        await dialog.getByRole("button", { name: "Formatted", exact: true }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        const bounds = await dialog.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
        await screenshot(testInfo, page);
        await page.keyboard.press("Escape");
        const row = await page.locator(".event-row").first().boundingBox();
        expect(row.x + row.width).toBeLessThanOrEqual(390);
    });

    test("failed requests expose their saved error response", async ({ page }) => {
        await createMonitor(page, "error");
        await expect(page.getByTestId("monitor-status")).toHaveText("down", { ignoreCase: true });
        await page.locator(".event-response-button").first().click();
        const dialog = page.getByRole("dialog", { name: "Response body" });
        await expect(dialog.locator(".response-raw")).toHaveText(responseBody);
        await expect(dialog.locator(".response-event-message")).toContainText("503");
    });

    test("an empty response is distinct from a request without a response", async ({ page }) => {
        await createMonitor(page, "empty");
        await page.locator(".event-response-button").first().click();
        await expect(page.getByRole("dialog")).toContainText("The response body is empty.");
        await page.keyboard.press("Escape");

        await page.goto("./add");
        await page.getByTestId("friendly-name-input").fill("No HTTP response");
        await page.getByTestId("url-input").fill(`${responseServerURL}/no-response`);
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");
        await expect(page.getByTestId("monitor-status")).toHaveText("down", { ignoreCase: true });
        await expect(page.locator(".event-response-button")).toHaveCount(0);
    });
});
