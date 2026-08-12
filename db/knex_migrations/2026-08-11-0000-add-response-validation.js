const EMPTY_RESPONSE_VALIDATION_RULES = '{"version":1,"scenarios":[]}';

exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.boolean("response_validation_enabled").notNullable().defaultTo(false);
        table
            .text("response_validation_rules_json", "longtext")
            .notNullable()
            .defaultTo(EMPTY_RESPONSE_VALIDATION_RULES);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("response_validation_enabled");
        table.dropColumn("response_validation_rules_json");
    });
};
