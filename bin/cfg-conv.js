#!/usr/bin/env node
// cfgconv - convert config files between JSON, YAML, TOML, .env and .ini. Detects the input format
// from the file name, reads from a file or stdin, and writes to stdout or a file (-o).
// Copyright (c) 2026 Peter Jedra - MIT License

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { FORMATS, normaliseFormat, detectFormat, parse, stringify } from '../src/index.js';

// Variables
const VERSION = '1.0.0';
let args; // command-line arguments
let indent = 2; // default indent
let text; // file contents
let data, output; // parsed and converted data
// Help message on --help or -h
const HELP = `cfgconv - convert config files between ${FORMATS.join(', ')}

Usage
  cfgconv <file> --to <format> [options]
  cfgconv <file> -o <output-file>
  cat <file> | cfgconv --from <format> --to <format>

Examples
  cfgconv package.json --to toml
  cfgconv .env --to yaml --nest
  cfgconv docker-compose.yml -o docker-compose.json
  cfgconv config.toml --to env > .env
  cfgconv tsconfig.json --to yaml        (comments and trailing commas are fine)
  cfgconv php.ini --to json --infer

Options
  -t, --to <format>       Output format (inferred from -o if omitted)
  -f, --from <format>     Input format (inferred from the file name if omitted)
  -o, --output <file>     Write to a file instead of stdout
  -i, --indent <n>        Indent for JSON/YAML output (default 2)
  -n, --nest              .env input: split keys on the separator into nested objects
                          (DB__HOST=x -> { DB: { HOST: x } })
      --infer             .env/.ini input: turn unquoted true/false/null/numbers into real types
                          (.ini also on/off, yes/no and none, as PHP does)
  -s, --separator <str>   Separator for nested .env keys (default "__")
      --keep-case         .env output: keep key case instead of UPPER_CASING
  -h, --help              Show this help
  -v, --version           Show the version

Formats: json (jsonc, json5), yaml (yml), toml, env (dotenv), ini
`;

// Prints an error message and exits
function fail(msg) {
    process.stderr.write(`cfgconv: ${msg}\n`);
    process.exit(1);
}

// Parse command-line arguments
try {
    args = parseArgs({
        allowPositionals: true,
        options: {
            to: { type: 'string', short: 't' }, // --to/-t
            from: { type: 'string', short: 'f' }, // --from/-f
            output: { type: 'string', short: 'o' }, // --output/-o
            indent: { type: 'string', short: 'i' }, // --indent/-i
            nest: { type: 'boolean', short: 'n' }, // --nest/-n
            infer: { type: 'boolean' }, // --infer
            separator: { type: 'string', short: 's' }, // --separator/-s
            'keep-case': { type: 'boolean' }, // --keep-case
            help: { type: 'boolean', short: 'h' }, // --help/-h
            version: { type: 'boolean', short: 'v' }, // --version/-v
        },
    });
} catch (err) { // If there's an error, print a message
    fail(`${err.message}\nRun "cfgconv --help" for usage.`);
}

// Extract command-line arguments from the parsed object
const { values: opts, positionals } = args;
// Handle --help and --version
if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(pkg.version + '\n');
    process.exit(0);
}
// Handle positional arguments
if (positionals.length > 1) fail(`expected one input file, got ${positionals.length}: ${positionals.join(' ')}`);

// Handle stdin
const input = positionals[0];
const fromStdin = !input || input === '-';
if (fromStdin && process.stdin.isTTY) { process.stdout.write(HELP); process.exit(1); }

// Resolve formats: explicit flags win, otherwise use the file names
const pick = (flag, file, what) => {
    if (flag) {
        const f = normaliseFormat(flag);
        if (!f) fail(`unknown ${what} format "${flag}" (use one of: ${FORMATS.join(', ')})`);
        return f;
    }
    return detectFormat(file);
};
// Resolve input and output formats
const from = pick(opts.from, fromStdin ? undefined : input, 'input');
const to = pick(opts.to, opts.output, 'output');
if (!from) fail(fromStdin ? 'reading from stdin needs --from <format>' : `can't tell the format of "${input}" - pass --from <format>`);
if (!to) fail(opts.output ? `can't tell the format of "${opts.output}" - pass --to <format>` : 'missing --to <format>');

// Handle indent
if (opts.indent !== undefined) { // --indent was passed - we need to check it
    indent = Number(opts.indent);
    if (!Number.isInteger(indent) || indent < 0 || indent > 8) fail('--indent must be a whole number from 0 to 8');
}

// Read the file contents
try {
    text = readFileSync(fromStdin ? 0 : input, 'utf8'); // 0 is stdin
} catch (err) {
    fail(err.code === 'ENOENT' ? `no such file: ${input}` : err.message);
}

// Parse and convert
const options = {
    indent,
    nest: !!opts.nest, // --nest was passed?
    infer: !!opts.infer, // --infer was passed?
    separator: opts.separator || '__', // --separator was passed? default is "__"
    keepCase: !!opts['keep-case'], // --keep-case was passed?
    onWarning: (msg) => process.stderr.write(`cfgconv: warning: ${msg}\n`),
};

// Parse and convert the file contents
const label = fromStdin ? 'stdin' : input;
try { // Parse the from file
    data = parse(text, from, options);
} catch (err) {
    fail(`couldn't parse ${label} as ${from}: ${err.message}`);
}
try { // Convert the parsed data before writing the output
    output = stringify(data, to, options);
} catch (err) {
    fail(`couldn't convert ${label} to ${to}: ${err.message}`);
}

// Write the output
if (opts.output) {
    try {
        writeFileSync(opts.output, output);
    } catch (err) {
        fail(`couldn't write ${opts.output}: ${err.message}`);
    }
    process.stderr.write(`cfgconv: wrote ${opts.output} (${from} -> ${to})\n`);
} else {
    process.stdout.write(output);
}
