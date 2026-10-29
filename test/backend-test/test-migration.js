const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { GenericContainer, Wait } = require("testcontainers");
const { MySqlContainer } = require("@testcontainers/mysql");

/**
 * Verify that the default configuration and schema accept responses larger than TEXT.
 * @param {import("knex").Knex} db Test database.
 * @returns {Promise<void>} Resolves after the stored response has been checked.
 */
async function verifyFullResponseStorage(db) {
    await db("monitor").insert({
        name: "Complete response",
        type: "http",
        method: "GET",
        accepted_statuscodes_json: '["200-299"]',
        conditions: "[]",
        response_validation_rules_json: '{"version":1,"scenarios":[]}',
    });
    const monitor = await db("monitor").where({ name: "Complete response" }).first();
    assert.strictEqual(monitor.response_max_length, 0);

    const response = "saved response".repeat(10000);
    await db("heartbeat").insert({
        monitor_id: monitor.id,
        status: 1,
        time: "2026-10-29 00:00:00.000",
        response,
    });
    const heartbeat = await db("heartbeat").where({ monitor_id: monitor.id }).first();
    assert.strictEqual(heartbeat.response, response);
}

describe("Database Migration", () => {
    test("SQLite migrations run successfully from fresh database", async () => {
        const testDbPath = path.join(__dirname, "../../data/test-migration.db");
        const testDbDir = path.dirname(testDbPath);

        // Ensure data directory exists
        if (!fs.existsSync(testDbDir)) {
            fs.mkdirSync(testDbDir, { recursive: true });
        }

        // Clean up any existing test database
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // Use the same SQLite driver as the project
        const Dialect = require("knex/lib/dialects/sqlite3/index.js");
        Dialect.prototype._driver = () => require("@louislam/sqlite3");

        const knex = require("knex");
        const db = knex({
            client: Dialect,
            connection: {
                filename: testDbPath,
            },
            useNullAsDefault: true,
        });

        // Setup R (redbean) with knex instance like production code does
        const { R } = require("redbean-node");
        R.setup(db);

        try {
            // Use production code to initialize SQLite tables (like first run)
            const { createTables } = require("../../db/knex_init_db.js");
            await createTables();

            // Run all migrations like production code does
            await R.knex.migrate.latest({
                directory: path.join(__dirname, "../../db/knex_migrations"),
            });

            const monitorColumns = await R.knex("monitor").columnInfo();
            assert.ok(monitorColumns.response_validation_enabled);
            assert.ok(monitorColumns.response_validation_rules_json);

            const heartbeatColumns = await R.knex("heartbeat").columnInfo();
            assert.ok(heartbeatColumns.response_validation_failed);

            await R.knex("monitor").insert({ name: "Response validation defaults", type: "http" });
            const monitor = await R.knex("monitor").where({ name: "Response validation defaults" }).first();
            assert.strictEqual(monitor.response_max_length, 0);
            assert.strictEqual(Boolean(monitor.response_validation_enabled), false);
            assert.deepStrictEqual(JSON.parse(monitor.response_validation_rules_json), {
                version: 1,
                scenarios: [],
            });

            await R.knex("heartbeat").insert({
                monitor_id: monitor.id,
                status: 1,
                time: "2026-08-11 00:00:00.000",
            });
            const heartbeat = await R.knex("heartbeat").where({ monitor_id: monitor.id }).first();
            assert.strictEqual(Boolean(heartbeat.response_validation_failed), false);
        } finally {
            // Clean up
            await R.knex.destroy();
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }
        }
    });

    test("response storage upgrade replaces the old default and preserves custom limits and saved responses", async () => {
        const Dialect = require("knex/lib/dialects/sqlite3/index.js");
        Dialect.prototype._driver = () => require("@louislam/sqlite3");
        const db = require("knex")({
            client: Dialect,
            connection: { filename: ":memory:" },
            useNullAsDefault: true,
        });
        const migrationOptions = {
            directory: path.join(__dirname, "../../db/knex_migrations"),
            name: "2026-10-29-0000-store-full-monitor-responses.js",
        };

        try {
            await db.raw("PRAGMA foreign_keys = ON");
            await db.schema.createTable("monitor", (table) => {
                table.increments("id");
                table.integer("response_max_length").notNullable().defaultTo(1024);
            });
            await db.schema.createTable("heartbeat", (table) => {
                table.increments("id");
                table.integer("monitor_id").references("id").inTable("monitor").onDelete("CASCADE");
                table.text("response");
            });
            await db("monitor").insert([
                { id: 1, response_max_length: 1024 },
                { id: 2, response_max_length: 4096 },
                { id: 3, response_max_length: 0 },
            ]);
            const response = "saved response".repeat(10000);
            await db("heartbeat").insert({ id: 1, monitor_id: 1, response });

            await db.migrate.up(migrationOptions);
            await db("monitor").insert({ id: 4 });

            assert.deepStrictEqual(await db("monitor").orderBy("id"), [
                { id: 1, response_max_length: 0 },
                { id: 2, response_max_length: 4096 },
                { id: 3, response_max_length: 0 },
                { id: 4, response_max_length: 0 },
            ]);
            assert.strictEqual((await db("heartbeat").where({ id: 1 }).first()).response, response);

            await db.migrate.down(migrationOptions);
            await db("monitor").insert({ id: 5 });
            assert.strictEqual((await db("monitor").where({ id: 5 }).first()).response_max_length, 1024);
            assert.strictEqual((await db("heartbeat").where({ id: 1 }).first()).response, response);
        } finally {
            await db.destroy();
        }
    });

    test(
        "MariaDB migrations run successfully from fresh database",
        {
            skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
        },
        async () => {
            // Start MariaDB container (using MariaDB 12 to match current production)
            const mariadbContainer = await new GenericContainer("mariadb:12")
                .withEnvironment({
                    MYSQL_ROOT_PASSWORD: "root",
                    MYSQL_DATABASE: "kuma_test",
                    MYSQL_USER: "kuma",
                    MYSQL_PASSWORD: "kuma",
                })
                .withExposedPorts(3306)
                .withWaitStrategy(Wait.forLogMessage("ready for connections", 2))
                .withStartupTimeout(120000)
                .start();

            // Wait a bit more to ensure MariaDB is fully ready
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const knex = require("knex");
            const knexInstance = knex({
                client: "mysql2",
                connection: {
                    host: mariadbContainer.getHost(),
                    port: mariadbContainer.getMappedPort(3306),
                    user: "kuma",
                    password: "kuma",
                    database: "kuma_test",
                    connectTimeout: 60000,
                },
                pool: {
                    min: 0,
                    max: 10,
                    acquireTimeoutMillis: 60000,
                    idleTimeoutMillis: 60000,
                },
            });

            // Setup R (redbean) with knex instance like production code does
            const { R } = require("redbean-node");
            R.setup(knexInstance);

            try {
                // Use production code to initialize MariaDB tables
                const { createTables } = require("../../db/knex_init_db.js");
                await createTables();

                // Run all migrations like production code does
                await R.knex.migrate.latest({
                    directory: path.join(__dirname, "../../db/knex_migrations"),
                });

                await verifyFullResponseStorage(R.knex);
            } finally {
                // Clean up
                try {
                    await R.knex.destroy();
                } catch (e) {
                    // Ignore cleanup errors
                }
                try {
                    await mariadbContainer.stop();
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        }
    );

    test(
        "MySQL migrations run successfully from fresh database",
        {
            skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
        },
        async () => {
            // Start MySQL 8.0 container (the version mentioned in the issue)
            const mysqlContainer = await new MySqlContainer("mysql:8.0").withStartupTimeout(120000).start();

            const knex = require("knex");
            const knexInstance = knex({
                client: "mysql2",
                connection: {
                    host: mysqlContainer.getHost(),
                    port: mysqlContainer.getPort(),
                    user: mysqlContainer.getUsername(),
                    password: mysqlContainer.getUserPassword(),
                    database: mysqlContainer.getDatabase(),
                    connectTimeout: 60000,
                },
                pool: {
                    min: 0,
                    max: 10,
                    acquireTimeoutMillis: 60000,
                    idleTimeoutMillis: 60000,
                },
            });

            // Setup R (redbean) with knex instance like production code does
            const { R } = require("redbean-node");
            R.setup(knexInstance);

            try {
                // Use production code to initialize MySQL tables
                const { createTables } = require("../../db/knex_init_db.js");
                await createTables();

                // Run all migrations like production code does
                await R.knex.migrate.latest({
                    directory: path.join(__dirname, "../../db/knex_migrations"),
                });

                await verifyFullResponseStorage(R.knex);
            } finally {
                // Clean up
                try {
                    await R.knex.destroy();
                } catch (e) {
                    // Ignore cleanup errors
                }
                try {
                    await mysqlContainer.stop();
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        }
    );
});
