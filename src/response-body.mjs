/**
 * Format JSON without rewriting numbers, escaped strings, or property order.
 * Non-JSON bodies are returned unchanged.
 * @param {string} response Saved response body.
 * @returns {object} Formatted text and flat, foldable JSON lines.
 */
export function prepareResponseBody(response) {
    try {
        JSON.parse(response);
    } catch {
        return { isJSON: false, formatted: response, lines: [] };
    }

    const tokens = response.match(
        /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g
    );
    const lines = [];
    const containers = [];
    let depth = 0;
    let parts = [];

    const punctuation = (text) => ({ text, type: "punctuation" });
    const addLine = (properties = {}) => {
        const line = { id: lines.length, depth, parts, ...properties };
        lines.push(line);
        parts = [];
        return line;
    };

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token === "{" || token === "[") {
            parts.push(punctuation(token));
            const closing = token === "{" ? "}" : "]";
            if (tokens[index + 1] === closing) {
                parts.push(punctuation(closing));
                index++;
            } else {
                containers.push(addLine({ endLine: null, itemCount: 1 }));
                depth++;
            }
        } else if (token === "}" || token === "]") {
            if (parts.length) {
                addLine();
            }
            depth--;
            parts.push(punctuation(token));
            containers.pop().endLine = addLine().id;
        } else if (token === ",") {
            if (parts.length) {
                parts.push(punctuation(token));
                addLine();
            } else {
                lines[lines.length - 1].parts.push(punctuation(token));
            }
            containers[containers.length - 1].itemCount++;
        } else if (token === ":") {
            parts.push(punctuation(": "));
        } else {
            let type = "number";
            if (token.startsWith('"')) {
                type = tokens[index + 1] === ":" ? "key" : "string";
            } else if (token === "true" || token === "false") {
                type = "boolean";
            } else if (token === "null") {
                type = "null";
            }
            parts.push({ text: token, type });
        }
    }
    if (parts.length) {
        addLine();
    }

    return {
        isJSON: true,
        lines,
        formatted: lines
            .map((line) => "  ".repeat(line.depth) + line.parts.map((part) => part.text).join(""))
            .join("\n"),
    };
}
