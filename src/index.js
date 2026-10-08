import { basename, extname } from 'node:path';
import YAML from 'yaml';
import * as TOML from 'smol-toml';
import * as ENV from './env.js';

// The formats cfgconv can read and write
export const FORMATS = ['json', 'yaml', 'toml', 'env'];

// Alternative names accepted for --from / --to and file extensions
const ALIASES = { yml: 'yaml', dotenv: 'env' };

// Normalises a user-supplied format name ("YML" -> "yaml"); returns undefined if unknown
export function normaliseFormat(name) {
    if (!name) return undefined;
    const f = String(name).toLowerCase().replace(/^\./, '');
    const resolved = ALIASES[f] || f;
    return FORMATS.includes(resolved) ? resolved : undefined;
}

// Guesses the format from a file name: package.json, config.yml, Cargo.toml, .env, .env.local, prod.env
export function detectFormat(filename) {
    if (!filename) return undefined;
    const base = basename(filename).toLowerCase();
    if (base === '.env' || base.startsWith('.env.')) return 'env';
    return normaliseFormat(extname(base));
}

// Returns a copy of the data without null values, walking nested objects and arrays. TOML has no null,
// so these are dropped (reporting each one through warn) instead of failing
function stripNulls(value, path, warn) {
    if (Array.isArray(value)) {
        return value.filter((v, i) => {
            if (v === null || v === undefined) { warn(`dropped null at ${path}[${i}] (TOML has no null)`); return false; }
            return true;
        }).map((v, i) => stripNulls(v, `${path}[${i}]`, warn));
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const p = path ? `${path}.${k}` : k;
            if (v === null || v === undefined) { warn(`dropped null at ${p} (TOML has no null)`); continue; }
            out[k] = stripNulls(v, p, warn);
        }
        return out;
    }
    return value;
}

// Parses file text of the given format into a plain JavaScript value. Throws on invalid input
export function parse(text, format, options = {}) {
    switch (format) {
        case 'json': return JSON.parse(text.replace(/^﻿/, ''));
        case 'yaml': {
            const docs = YAML.parseAllDocuments(text);
            if (docs.length > 1) throw new Error(`YAML input has ${docs.length} documents; only single-document files are supported`);
            const doc = docs[0];
            if (!doc) return null;
            if (doc.errors.length) throw doc.errors[0];
            return doc.toJS();
        }
        case 'toml': return TOML.parse(text);
        case 'env': return ENV.parse(text, options);
        default: throw new Error(`Unknown input format "${format}"`);
    }
}

// Writes a JavaScript value out as text in the given format. Lossy changes (e.g. dropped nulls) go to options.onWarning
// The function decides which format to write. It doesn't write anything itself; it hands the work to the right writer: 
// JSON.stringify for JSON, YAML.stringify from the yaml package for YAML, TOML.stringify from smol-toml for TOML,
// and ENV.stringify for .env.
export function stringify(data, format, options = {}) {
    const indent = options.indent ?? 2;
    const warn = options.onWarning || (() => {});
    switch (format) {
        case 'json': return JSON.stringify(data, null, indent) + '\n';
        case 'yaml': return YAML.stringify(data, { indent });
        case 'toml': {
            if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('TOML output needs a top-level object (tables can\'t be a list or a single value)');
            }
            return TOML.stringify(stripNulls(data, '', warn)) + '\n';
        }
        case 'env': return ENV.stringify(data, options);
        default: throw new Error(`Unknown output format "${format}"`);
    }
}

// Converts file text from one format to another in one step: parse, then stringify
export function convert(text, { from, to, ...options }) {
    return stringify(parse(text, from, options), to, options);
}
