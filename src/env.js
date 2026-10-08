// .env parsing and writing.
//
// Parsing follows the common dotenv rules: KEY=VALUE lines, optional `export`, # comments,
// single quotes are literal, double quotes support \n \r \t \" \\ escapes, and quoted values
// may span several lines. Variables like ${OTHER} are kept as plain text (no expansion).

// A valid .env key: starts with a letter or _, then letters, digits, _ . -
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;
// Values made only of these characters can be written without quotes
const SAFE_WITHOUT_QUOTES = /^[A-Za-z0-9_\-.,/:@+%]*$/;
// A plain JSON-style number (no leading zeros, hex or underscores), used by --infer
const LOOKS_LIKE_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

// Reads .env text line by line into a flat list of entries, without building an object or converting types.
// Returns [{ key, value, quoted, line }] in file order (later duplicates win when building objects)
export function parseEntries(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const entries = [];

    for (let n = 0; n < lines.length; n++) {
        const lineNo = n + 1;
        const trimmed = lines[n].trim();

        // Skip blank lines and comments
        if (trimmed === '' || trimmed.startsWith('#')) continue;

        // Split KEY=VALUE at the first =, and drop an optional `export ` in front of the key
        const eq = lines[n].indexOf('=');
        if (eq === -1) fail(lineNo, `expected KEY=VALUE, got "${trimmed}"`);
        const key = lines[n].slice(0, eq).trim().replace(/^export\s+/, '');
        if (!VALID_KEY.test(key)) fail(lineNo, `invalid key "${key}"`);
        let rest = lines[n].slice(eq + 1).trimStart();

        // Unquoted value: everything up to an inline comment
        const quote = rest[0];
        if (quote !== '"' && quote !== "'" && quote !== '`') {
            entries.push({ key, value: stripComment(rest), quoted: false, line: lineNo });
            continue;
        }

        // Quoted value: add the following lines until the closing quote turns up
        let end = findClosingQuote(rest, quote);
        while (end === -1) {
            n++;
            if (n >= lines.length) fail(lineNo, `unterminated ${quote} quote for ${key}`);
            rest += '\n' + lines[n];
            end = findClosingQuote(rest, quote);
        }

        // Only whitespace or a comment may follow the closing quote
        const after = rest.slice(end + 1).trim();
        if (after && !after.startsWith('#')) fail(n + 1, `unexpected text after quoted value: "${after}"`);

        let value = rest.slice(1, end);
        if (quote === '"') value = value.replace(/\\([nrt"\\])/g, (_, c) => ESCAPES[c]);
        entries.push({ key, value, quoted: true, line: lineNo });
    }
    return entries;
}

// Escapes understood inside double quotes (\n, \r, \t, \", \\)
const ESCAPES = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

// Throws an error that points at a line of the file
function fail(lineNo, msg) {
    throw new Error(`.env line ${lineNo}: ${msg}`);
}

// Cuts an inline comment off an unquoted value. The # needs a space or tab before it, so URL#fragment stays intact
function stripComment(raw) {
    const hash = raw.search(/[ \t]#/);
    return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

// Returns where the quote that opened the text (at position 0) closes, or -1 if it doesn't close yet.
// Inside double quotes a backslash skips the next character, so \" doesn't count as the closing quote
function findClosingQuote(s, quote) {
    for (let i = 1; i < s.length; i++) {
        if (s[i] === '\\' && quote === '"') i++;
        else if (s[i] === quote) return i;
    }
    return -1;
}

// --infer: turns "true"/"false"/"null"/numbers into real booleans, null and numbers; anything else stays a string
function inferType(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (LOOKS_LIKE_NUMBER.test(value)) {
        const n = Number(value);
        // Keep huge integers as strings rather than silently losing precision
        if (Number.isSafeInteger(n) || !Number.isInteger(n)) return n;
    }
    return value;
}

// --nest: arrays are written to .env as KEY__0, KEY__1..., so turn objects whose keys are exactly 0..n-1
// back into arrays, recursively
function restoreArrays(node) {
    if (node === null || typeof node !== 'object') return node;
    for (const k of Object.keys(node)) node[k] = restoreArrays(node[k]);
    const keys = Object.keys(node);
    if (keys.length && keys.every((k, idx) => k === String(idx))) return keys.map(k => node[k]);
    return node;
}

// Parses .env text into an object. With nest, keys are split on the separator into nested objects
// (DB__HOST=x -> { DB: { HOST: 'x' } }), and keys that clash with each other throw an error
export function parse(text, { nest = false, separator = '__', infer = false } = {}) {
    const result = {};
    for (const { key, value, quoted, line } of parseEntries(text)) {
        const v = infer && !quoted ? inferType(value) : value;
        if (!nest) { result[key] = v; continue; }

        const path = key.split(separator).filter(Boolean);
        let node = result;
        for (let p = 0; p < path.length - 1; p++) {
            const seg = path[p];
            if (node[seg] === undefined) node[seg] = {};
            else if (typeof node[seg] !== 'object' || node[seg] === null) {
                throw new Error(`.env line ${line}: ${key} conflicts with ${path.slice(0, p + 1).join(separator)}, which already has a value`);
            }
            node = node[seg];
        }
        const last = path[path.length - 1];
        if (node[last] !== null && typeof node[last] === 'object') {
            throw new Error(`.env line ${line}: ${key} conflicts with nested keys under the same name`);
        }
        node[last] = v;
    }
    return nest ? restoreArrays(result) : result;
}

// Writes one value for the right-hand side of KEY=VALUE: bare if safe, otherwise single- or double-quoted
function formatValue(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) v = v.toISOString();
    const s = String(v);
    if (SAFE_WITHOUT_QUOTES.test(s)) return s;
    // Single quotes are literal everywhere (no $ expansion), so prefer them when possible
    if (!s.includes("'") && !s.includes('\n') && !s.includes('\r')) return `'${s}'`;
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

// Makes one part of a key safe for .env: invalid characters become _, and it's upper-cased unless keepCase
function normaliseKey(k, keepCase) {
    return keepCase ? k.replace(/[^A-Za-z0-9_.\-]/g, '_') : k.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
}

// Writes an object as .env text, one KEY=VALUE line per value. Nested objects and arrays are flattened
// with the separator (DB: { HOST: 'x' } -> DB__HOST=x)
export function stringify(data, { separator = '__', keepCase = false } = {}) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('.env output needs a top-level object (key/value pairs)');
    }
    const lines = [];
    const seen = new Map(); // env key -> original path, to catch collisions like "a-b" and "a_b"

    // Goes down through nested objects/arrays, and writes a line for each value it reaches, keyed by its path
    const walk = (value, path) => {
        if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
            const keys = Array.isArray(value) ? value.map((_, idx) => String(idx)) : Object.keys(value);
            for (const k of keys) walk(value[k], [...path, k]);
            return;
        }
        let key = path.map(p => normaliseKey(p, keepCase)).join(separator);
        if (/^[0-9]/.test(key)) key = '_' + key;
        const original = path.join('.');
        if (seen.has(key)) throw new Error(`.env key collision: "${seen.get(key)}" and "${original}" both become ${key}`);
        seen.set(key, original);
        lines.push(`${key}=${formatValue(value)}`);
    };
    walk(data, []);
    return lines.join('\n') + (lines.length ? '\n' : '');
}
