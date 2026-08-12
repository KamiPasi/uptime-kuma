exports.up = function (knex) {
    return knex.schema.alterTable("heartbeat", function (table) {
        table.boolean("response_validation_failed").notNullable().defaultTo(false);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("heartbeat", function (table) {
        table.dropColumn("response_validation_failed");
    });
};
