import { expect, test } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";
import sqlite3 from "@louislam/sqlite3";
import { resolve } from "node:path";

/**
 * Seed the disposable e2e database without starting real network monitors.
 * @returns {Promise<void>}
 */
async function seedDashboard() {
    const db = new sqlite3.Database(resolve("data/playwright-test/kuma.db"));
    const run = (sql, params = []) =>
        new Promise((done, reject) => db.run(sql, params, (error) => (error ? reject(error) : done())));
    try {
        await run("BEGIN");
        for (let id = 1; id <= 191; id++) {
            await run("INSERT INTO monitor(id,name,user_id,type,active,interval,url) VALUES(?,?,1,'http',0,60,?)", [
                id,
                `Dashboard monitor ${String(id).padStart(3, "0")}`,
                `http://127.0.0.1/monitor/${id}`,
            ]);
            for (let beat = 0; beat < 3; beat++) {
                await run("INSERT INTO heartbeat(monitor_id,status,time,ping,duration) VALUES(?,1,?,10,60)", [
                    id,
                    `2026-10-30 00:00:0${beat}.000`,
                ]);
            }
        }
        await run("COMMIT");
    } finally {
        await new Promise((done, reject) => db.close((error) => (error ? reject(error) : done())));
    }
}

test("loads monitor summaries first and requests history only for visible rows", async ({ page }) => {
    await restoreSqliteSnapshot();
    await seedDashboard();
    const requested = [];
    let summaries;
    let latest;
    page.on("websocket", (socket) => {
        socket.on("framesent", ({ payload }) => {
            const match = String(payload).match(/^42\d*\["getHeartbeatHistory",(\d+)/);
            if (match) {
                requested.push(Number(match[1]));
            }
        });
        socket.on("framereceived", ({ payload }) => {
            const text = String(payload);
            if (text.startsWith('42["monitorList",')) {
                summaries = JSON.parse(text.slice(2))[1];
            }
            if (text.startsWith('42["heartbeatLists",')) {
                latest = JSON.parse(text.slice(2))[1];
            }
        });
    });

    await page.goto("./dashboard");
    await login(page);
    await expect(page.locator(".monitor-list .draggable-item").first()).toBeVisible();
    await expect.poll(() => latest && Object.keys(latest).length).toBe(191);
    expect(Object.keys(summaries)).toHaveLength(191);
    expect(Object.values(summaries).every((monitor) => !("body" in monitor) && !("headers" in monitor))).toBe(true);
    expect(Object.values(latest).every((beats) => beats.length === 1)).toBe(true);
    expect(await page.locator(".monitor-list .draggable-item").count()).toBeLessThan(40);
    await expect.poll(() => requested.length).toBeGreaterThan(0);
    expect(requested.length).toBeLessThan(30);
    expect(requested).not.toContain(191);

    await page.getByTestId("monitor-list").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    const lastMonitor = page.locator(".monitor-list a.item", { hasText: "Dashboard monitor 191" });
    await lastMonitor.scrollIntoViewIfNeeded();
    await expect.poll(() => requested.includes(191)).toBe(true);

    await page.getByTestId("monitor-search").fill("Dashboard monitor 005");
    await expect(page.locator(".monitor-list a.item")).toHaveCount(1);
    await expect(page.locator(".monitor-list a.item")).toContainText("Dashboard monitor 005");

    const beforeReconnect = requested.length;
    await page.evaluate(() => {
        const root = document.querySelector("#app").__vue_app__._container._vnode.component.proxy;
        root.getSocket().io.engine.close();
    });
    await expect.poll(() => requested.length, { timeout: 15000 }).toBeGreaterThan(beforeReconnect);
    await expect(page.locator(".monitor-list a.item")).toContainText("Dashboard monitor 005");
});
