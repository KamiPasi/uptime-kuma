const { before, describe, test } = require("node:test");
const assert = require("node:assert/strict");

let prepareResponseBody;
before(async () => {
    ({ prepareResponseBody } = await import("../../src/response-body.mjs"));
});

describe("Response body viewer formatting", () => {
    test("formats nested JSON and supplies matching fold boundaries", () => {
        const result = prepareResponseBody('{"items":[1,{"ok":true}],"empty":{},"last":null}');
        assert.strictEqual(result.isJSON, true);
        assert.strictEqual(
            result.formatted,
            [
                "{",
                '  "items": [',
                "    1,",
                "    {",
                '      "ok": true',
                "    }",
                "  ],",
                '  "empty": {},',
                '  "last": null',
                "}",
            ].join("\n")
        );
        assert.strictEqual(result.lines[0].endLine, 9);
        assert.strictEqual(result.lines[0].itemCount, 3);
        assert.strictEqual(result.lines[1].endLine, 6);
        assert.strictEqual(result.lines[1].itemCount, 2);
        assert.strictEqual(result.lines[3].endLine, 5);
        assert.strictEqual(result.lines[3].itemCount, 1);
    });

    test("preserves integer precision, numeric notation, escapes, and property order", () => {
        const original = String.raw`{"99":900719925474099312345,"1":-0,"float":1.2300e+09,"large":1e999,"escaped":"\u4e2d\n\"\\"}`;
        const result = prepareResponseBody(original);
        assert.ok(result.formatted.includes('"99": 900719925474099312345'));
        assert.ok(result.formatted.includes('"1": -0'));
        assert.ok(result.formatted.includes('"float": 1.2300e+09'));
        assert.ok(result.formatted.includes('"large": 1e999'));
        assert.ok(result.formatted.includes(String.raw`"escaped": "\u4e2d\n\"\\"`));
        assert.ok(result.formatted.indexOf('"99"') < result.formatted.indexOf('"1"'));
    });

    test("handles JSON scalar values and empty containers", () => {
        for (const value of ['"hello"', "false", "null", "0", "[]", "{}", "[[],{},true,false,null]"]) {
            const result = prepareResponseBody(value);
            assert.strictEqual(result.isJSON, true);
            assert.deepStrictEqual(JSON.parse(result.formatted), JSON.parse(value));
        }
    });

    test("retains every entry of a large response", () => {
        const value = {
            items: Array.from({ length: 2000 }, (_, index) => ({ index, text: "中文😀" })),
            end: "response-end",
        };
        const result = prepareResponseBody(JSON.stringify(value));
        assert.deepStrictEqual(JSON.parse(result.formatted), value);
        assert.strictEqual(result.lines[1].itemCount, 2000);
        assert.ok(result.formatted.endsWith('"end": "response-end"\n}'));
    });

    test("plain text, HTML, empty bodies, and invalid JSON stay unchanged", () => {
        for (const value of ["", "  text\nbody  ", '<img src=x onerror="alert(1)">', '{"incomplete":', "{bad}"]) {
            const result = prepareResponseBody(value);
            assert.strictEqual(result.isJSON, false);
            assert.strictEqual(result.formatted, value);
            assert.deepStrictEqual(result.lines, []);
        }
    });
});
