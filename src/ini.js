// .ini parsing and writing, following PHP's rules (php.ini, parse_ini_file).
//
// Parsing: [section] headers, key = value lines, ; comments (and # at the start of a line),
// key[] = value for lists and key[name] = value for named entries. Unquoted values end at a ; comment,
// double quotes support \" \\ \$ and may span several lines, single quotes are literal.
// Constants (E_ALL & ~E_NOTICE) and ${VAR} are kept as plain text (no expansion).

// Values made only of these characters (single spaces between words allowed) can be written without quotes
const SAFE_WITHOUT_QUOTES = /^[A-Za-z0-9_\-.,/:@+%]+(?: +[A-Za-z0-9_\-.,/:@+%]+)*$/;
// A PHP constant expression like E_ALL & ~E_DEPRECATED, which PHP only evaluates when it's unquoted
const CONSTANT_EXPRESSION = /^[A-Z_][A-Z0-9_]*(?:\s*[&|^]\s*~?\s*[A-Z_][A-Z0-9_]*)+$/;
// A plain JSON-style number (no leading zeros, hex or underscores), used by --infer
const LOOKS_LIKE_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
// Unquoted words PHP turns into true/false/null, so strings with these values must be quoted
const RESERVED_WORDS = ['true', 'on', 'yes', 'false', 'off', 'no', 'none', 'null'];
// A key, optionally followed by [] (add to a list) or [name] (named entry): "extension[]", "opts[mode]"
const KEY_WITH_INDEX = /^([^\[\]"';=]+?)\s*(?:\[([^\[\]]*)\])?$/;
// Characters PHP doesn't allow in key names
const INVALID_KEY_CHARS = /[=;\[\]"'?{}|&~!()^#\r\n]/;

// Parses .ini text into an object: keys before the first [section] at the top level, each section as an object.
// With infer, unquoted on/yes/true, off/no/false/none, null and numbers become real types (like PHP's INI_SCANNER_TYPED)
export function parse(text, { infer = false } = {}) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const result = {};
    let target = result; // where keys go: the current [section], or the top level before the first one

    for (let n = 0; n < lines.length; n++) {
        const lineNo = n + 1;
        const trimmed = lines[n].trim();

        // Skip blank lines and comments
        if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

        // [section] header: the keys that follow go into that section
        if (trimmed.startsWith('[')) {
            const close = trimmed.indexOf(']');
            const name = close === -1 ? '' : trimmed.slice(1, close).trim();
            if (!name) fail(lineNo, `invalid section header "${trimmed}"`);
            const after = trimmed.slice(close + 1).trim();
            if (after && !after.startsWith(';')) fail(lineNo, `unexpected text after section header: "${after}"`);
            if (!isObject(result[name])) result[name] = {};
            target = result[name];
            continue;
        }

        // Split key = value at the first =, and split key[index] into the key and the index
        const eq = lines[n].indexOf('=');
        if (eq === -1) fail(lineNo, `expected key = value, got "${trimmed}"`);
        const rawKey = lines[n].slice(0, eq).trim();
        const keyMatch = rawKey.match(KEY_WITH_INDEX);
        if (!keyMatch) fail(lineNo, `invalid key "${rawKey}"`);
        const [, key, index] = keyMatch; // index: undefined for "key", '' for "key[]", 'name' for "key[name]"
        let rest = lines[n].slice(eq + 1).trimStart();

        let value;
        const quote = rest[0];
        if (quote === '"' || quote === "'") {
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
            if (after && !after.startsWith(';')) fail(n + 1, `unexpected text after quoted value: "${after}"`);

            value = rest.slice(1, end);
            if (quote === '"') value = value.replace(/\\(["\\$])/g, '$1');
        } else {
            // Unquoted value: everything up to a ; comment
            const semi = rest.indexOf(';');
            value = (semi === -1 ? rest : rest.slice(0, semi)).trim();
            if (infer) value = inferType(value);
        }

        if (index === undefined) {
            target[key] = value;
        } else if (index === '') {
            if (!Array.isArray(target[key])) target[key] = [];
            target[key].push(value);
        } else {
            if (!isObject(target[key])) target[key] = {};
            target[key][index.trim()] = value;
        }
    }
    return result;
}

// Writes an object as .ini text: plain values first as key = value, then each object as a [section].
// Lists of plain values become key[] = item lines; anything nested deeper gets a dotted key (a.b = 1),
// since INI has no syntax for it
export function stringify(data, { onWarning = () => {} } = {}) {
    if (!isObject(data)) throw new Error('INI output needs a top-level object (key = value pairs and [sections])');
    const top = [];
    const sections = [];

    for (const [key, value] of Object.entries(data)) {
        if (!isObject(value)) { writeKey(top, key, value, key, onWarning); continue; }
        if (!key.trim() || /[\]\r\n]/.test(key)) throw new Error(`INI section name "${key}" can't be blank or contain ] or line breaks`);
        const lines = [`[${key}]`];
        for (const [k, v] of Object.entries(value)) writeKey(lines, k, v, `${key}.${k}`, onWarning);
        sections.push(lines.join('\n'));
    }

    const blocks = top.length ? [top.join('\n'), ...sections] : sections;
    return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

// Adds the lines for one key: key = value, key[] = item for a list of plain values, or dotted keys
// (key.sub = value) for anything nested deeper. path is the full location, for error and warning messages
function writeKey(lines, key, value, path, warn) {
    if (Array.isArray(value) && value.every(isPlainValue)) {
        if (!value.length) warn(`dropped empty list at ${path} (INI can't hold an empty list)`);
        checkKey(key, path);
        for (const item of value) lines.push(`${key}[] = ${formatValue(item)}`);
    } else if (!isPlainValue(value)) {
        const entries = Object.entries(value); // arrays too, as index/value pairs
        if (!entries.length) warn(`dropped empty object at ${path} (INI can't hold an empty object)`);
        for (const [k, v] of entries) writeKey(lines, `${key}.${k}`, v, `${path}.${k}`, warn);
    } else {
        checkKey(key, path);
        lines.push(`${key} = ${formatValue(value)}`);
    }
}

// Throws if PHP wouldn't accept the key: reserved characters, a reserved word, or blank
function checkKey(key, path) {
    if (!key.trim() || INVALID_KEY_CHARS.test(key) || RESERVED_WORDS.includes(key.toLowerCase())) {
        throw new Error(`INI can't use "${key}" as a key (at ${path}): it's blank, a reserved word, or contains one of = ; [ ] " ' ? { } | & ~ ! ( ) ^ #`);
    }
}

// Writes one value for the right-hand side of key = value: numbers, booleans and null as they are,
// strings bare if PHP would read them back unchanged, otherwise in double quotes
function formatValue(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    if (v instanceof Date) v = v.toISOString();
    const s = String(v);
    if (SAFE_WITHOUT_QUOTES.test(s) && !RESERVED_WORDS.includes(s.toLowerCase())) return s;
    if (CONSTANT_EXPRESSION.test(s)) return s;
    return '"' + s.replace(/[\\"$]/g, '\\$&') + '"';
}

// --infer: turns PHP's on/yes/true and off/no/false/none into booleans, null into null, and numbers into
// numbers; anything else stays a string
function inferType(value) {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === 'on' || lower === 'yes') return true;
    if (lower === 'false' || lower === 'off' || lower === 'no' || lower === 'none') return false;
    if (lower === 'null') return null;
    if (LOOKS_LIKE_NUMBER.test(value)) {
        const n = Number(value);
        // Keep huge integers as strings rather than silently losing precision
        if (Number.isSafeInteger(n) || !Number.isInteger(n)) return n;
    }
    return value;
}

// True for values written as a single key = value (anything but objects and arrays)
function isPlainValue(v) {
    return v === null || typeof v !== 'object' || v instanceof Date;
}

// True for objects that become sections or named entries (not arrays, dates or null)
function isObject(v) {
    return !isPlainValue(v) && !Array.isArray(v);
}

// Throws an error that points at a line of the file
function fail(lineNo, msg) {
    throw new Error(`.ini line ${lineNo}: ${msg}`);
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
