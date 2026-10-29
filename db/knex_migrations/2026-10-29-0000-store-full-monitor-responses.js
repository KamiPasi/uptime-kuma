exports.up = async function (knex) {
    await knex.schema.alterTable("monitor", function (table) {
        table.integer("response_max_length").notNullable().defaultTo(0).alter();
    });

    // Replace the old default while preserving other configured limits.
    await knex("monitor").where("response_max_length", 1024).update({ response_max_length: 0 });

    // SQLite TEXT already stores large responses without a length limit.
    if (knex.client.config.client === "mysql2") {
        await knex.schema.alterTable("heartbeat", function (table) {
            table.text("response", "longtext").nullable().defaultTo(null).alter();
        });
    }
};

exports.down = async function (knex) {
    await knex.schema.alterTable("monitor", function (table) {
        table.integer("response_max_length").notNullable().defaultTo(1024).alter();
    });

    // Keep existing limits and the larger response column to avoid losing saved data.
};

// SQLite must disable foreign keys outside a transaction while rebuilding monitor.
// Otherwise ON DELETE CASCADE would remove the monitor's existing heartbeats.
exports.config = { transaction: false };
