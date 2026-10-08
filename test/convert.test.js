import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convert, detectFormat, normaliseFormat, parse, stringify } from '../src/index.js';
import * as ENV from '../src/env.js';

const CLI = fileURLToPath(new URL('../bin/cfgconv.js', import.meta.url));

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
    assert.equal(normaliseFormat('yml'), 'yaml');
    assert.equal(normaliseFormat('dotenv'), 'env');
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

test('clear errors for unsupported shapes', () => {
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
