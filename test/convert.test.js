import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convert, detectFormat, normaliseFormat, parse, stringify } from '../src/index.js';
import * as ENV from '../src/env.js';
import * as INI from '../src/ini.js';

const CLI = fileURLToPath(new URL('../bin/cfg-conv.js', import.meta.url));

// smol-toml returns prototype-less objects, so compare plain copies
const plain = (v) => JSON.parse(JSON.stringify(v));

const sample = {
    name: 'my-app',
    port: 8080,
    debug: false,
    database: { host: 'localhost', port: 5432 },
    features: ['auth', 'billing'],
};

test('detects formats from file names', () => {
    assert.equal(detectFormat('package.json'), 'json');
    assert.equal(detectFormat('ci/config.YML'), 'yaml');
    assert.equal(detectFormat('Cargo.toml'), 'toml');
    assert.equal(detectFormat('.env'), 'env');
    assert.equal(detectFormat('.env.production'), 'env');
    assert.equal(detectFormat('prod.env'), 'env');
    assert.equal(detectFormat('README'), undefined);
    assert.equal(detectFormat('settings.jsonc'), 'json');
    assert.equal(detectFormat('config.json5'), 'json');
    assert.equal(detectFormat('php.ini'), 'ini');
    assert.equal(normaliseFormat('yml'), 'yaml');
    assert.equal(normaliseFormat('dotenv'), 'env');
    assert.equal(normaliseFormat('jsonc'), 'json');
    assert.equal(normaliseFormat('xml'), undefined);
});

test('JSON, YAML and TOML round-trip without loss', () => {
    for (const via of ['yaml', 'toml']) {
        const there = stringify(sample, via);
        assert.deepEqual(plain(parse(there, via)), sample, `via ${via}`);
    }
    const yaml = convert(JSON.stringify(sample), { from: 'json', to: 'yaml' });
    assert.deepEqual(JSON.parse(convert(yaml, { from: 'yaml', to: 'json' })), sample);
});

test('.env output flattens, upper-cases and quotes safely', () => {
    const out = stringify({ ...sample, secret: 'p@ss word', note: "it's\nfine", empty: null }, 'env');
    assert.equal(out, [
        'NAME=my-app',
        'PORT=8080',
        'DEBUG=false',
        'DATABASE__HOST=localhost',
        'DATABASE__PORT=5432',
        'FEATURES__0=auth',
        'FEATURES__1=billing',
        "SECRET='p@ss word'",
        'NOTE="it\'s\\nfine"',
        'EMPTY=',
        '',
    ].join('\n'));
});

test('.env output round-trips back to the same structure with --nest --infer', () => {
    const env = stringify(sample, 'env', { keepCase: true });
    assert.deepEqual(parse(env, 'env', { nest: true, infer: true }), sample);
});

test('.env parsing handles quotes, comments, export and multi-line values', () => {
    const text = [
        '# comment',
        'export A=1',
        'URL=https://x.io/a#frag   # trailing comment',
        'DQ="a\\nb \\"q\\""',
        "SQ='raw \\n $HOME'",
        'ML="one',
        'two"',
        'EMPTY=',
        '',
    ].join('\r\n');
    assert.deepEqual(ENV.parse(text), {
        A: '1',
        URL: 'https://x.io/a#frag',
        DQ: 'a\nb "q"',
        SQ: 'raw \\n $HOME',
        ML: 'one\ntwo',
        EMPTY: '',
    });
});

test('.env --infer only converts unquoted values', () => {
    assert.deepEqual(ENV.parse('A=true\nB="true"\nC=42\nD=007\nE=1.5\nF=null\nG=12345678901234567890', { infer: true }), {
        A: true, B: 'true', C: 42, D: '007', E: 1.5, F: null, G: '12345678901234567890',
    });
});

test('JSON input accepts comments and trailing commas', () => {
    const text = '\uFEFF{\n  // line comment\n  "a": 1, /* block */\n  "b": [1, 2,],\n}\n';
    assert.deepEqual(parse(text, 'json'), { a: 1, b: [1, 2] });
    assert.equal(stringify({ a: 1 }, 'json'), '{\n  "a": 1\n}\n');
});

test('.ini parsing follows PHP: sections, comments, lists, named entries and quotes', () => {
    const text = [
        '; comment',
        'top = 1',
        '[PHP]',
        'engine = On ; trailing comment',
        'error_reporting = E_ALL & ~E_DEPRECATED',
        'extension[] = curl',
        'extension[] = mbstring',
        'opts[mode] = fast',
        'path = "C:\\php\\ext"',
        'quoted = "say \\"hi\\" for \\$5"',
        "single = 'raw \\n ; not a comment'",
        'multi = "one',
        'two"',
        'empty =',
        '[mail function]',
        'SMTP = localhost',
        '',
    ].join('\r\n');
    assert.deepEqual(INI.parse(text), {
        top: '1',
        PHP: {
            engine: 'On',
            error_reporting: 'E_ALL & ~E_DEPRECATED',
            extension: ['curl', 'mbstring'],
            opts: { mode: 'fast' },
            path: 'C:\\php\\ext',
            quoted: 'say "hi" for $5',
            single: 'raw \\n ; not a comment',
            multi: 'one\ntwo',
            empty: '',
        },
        'mail function': { SMTP: 'localhost' },
    });
});

test('.ini --infer converts PHP booleans, null and numbers, but not quoted values', () => {
    assert.deepEqual(INI.parse('a = On\nb = off\nc = yes\nd = none\ne = null\nf = 42\ng = "On"\nh = 128M', { infer: true }), {
        a: true, b: false, c: true, d: false, e: null, f: 42, g: 'On', h: '128M',
    });
});

test('.ini output writes sections, lists and dotted keys, and round-trips with --infer', () => {
    const out = stringify({ ...sample, reporting: 'E_ALL & ~E_NOTICE', mode: 'on', note: 'a "b" ${c}' }, 'ini');
    assert.equal(out, [
        'name = my-app',
        'port = 8080',
        'debug = false',
        'features[] = auth',
        'features[] = billing',
        'reporting = E_ALL & ~E_NOTICE',
        'mode = "on"',
        'note = "a \\"b\\" \\${c}"',
        '',
        '[database]',
        'host = localhost',
        'port = 5432',
        '',
    ].join('\n'));
    assert.deepEqual(INI.parse(out, { infer: true }), {
        ...sample, reporting: 'E_ALL & ~E_NOTICE', mode: 'on', note: 'a "b" ${c}',
    });
    assert.equal(stringify({ app: { db: { host: 'x', ports: [1, 2] } } }, 'ini'),
        '[app]\ndb.host = x\ndb.ports[] = 1\ndb.ports[] = 2\n');
});

test('clear errors for unsupported shapes', () => {
    assert.throws(() => stringify([1, 2], 'ini'), /top-level object/);
    assert.throws(() => stringify({ 'a=b': 1 }, 'ini'), /can't use "a=b" as a key/);
    assert.throws(() => INI.parse('[PHP]\nnot a pair'), /line 2: expected key = value/);
    assert.throws(() => INI.parse('a = "open'), /unterminated/);
    assert.throws(() => stringify([1, 2], 'toml'), /top-level object/);
    assert.throws(() => stringify('x', 'env'), /top-level object/);
    assert.throws(() => stringify({ 'a-b': 1, a_b: 2 }, 'env'), /collision/);
    assert.throws(() => ENV.parse('A=1\nA__B=2', { nest: true }), /conflicts/);
    assert.throws(() => ENV.parse('A="open'), /unterminated/);
    assert.throws(() => parse('a: 1\n---\nb: 2\n', 'yaml'), /2 documents/);
});

test('TOML output drops nulls with a warning', () => {
    const warnings = [];
    const out = stringify({ a: 1, b: null, c: [1, null] }, 'toml', { onWarning: w => warnings.push(w) });
    assert.deepEqual(plain(parse(out, 'toml')), { a: 1, c: [1] });
    assert.equal(warnings.length, 2);
});

test('CLI converts stdin to stdout and reports errors with exit code 1', () => {
    const out = execFileSync('node', [CLI, '--from', 'json', '--to', 'yaml'], { input: '{"a":{"b":1}}' }).toString();
    assert.equal(out, 'a:\n  b: 1\n');

    const bad = spawnSync('node', [CLI, '--from', 'json', '--to', 'yaml'], { input: '{bad' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr.toString(), /couldn't parse stdin as json/);

    const noTo = spawnSync('node', [CLI, '--from', 'json'], { input: '{}' });
    assert.equal(noTo.status, 1);
    assert.match(noTo.stderr.toString(), /missing --to/);
});
