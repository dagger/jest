// jest-report reads the report of one shared `jest --json` run and writes a
// bounded result for each selected test check: an empty file when the test
// passed, otherwise why its check fails.
//
//   node jest-report.cjs --report report.json --stdout stdout.log \
//     --stderr stderr.log --selection selection.json --exit-code N \
//     --output dir
//
// The selection is a list of {path, key, names, discovered}: the test file as
// Jest reports it (absolute, in the test container), as the check keys it
// (relative to the project), its selected test keys, and every key discovery
// found in it. "*" stands for the file's tests whose names its source does not
// hold. The result of selection[i].names[j] is written to <output>/<i>/<j>, so
// names never become file paths. JestTestResults computes the same indices
// from the same selection.
//
// It depends on nothing but Node.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Diagnostics keep the last 32 KiB of each stream, and each result is capped
// at three times that, so no result comes near File.contents' limits however
// large the report is.
const diagnosticLimit = 32 << 10;

function stripAnsi(s) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes.
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

// The last diagnosticLimit bytes of s, marked when anything was dropped.
function tail(s) {
  const bytes = Buffer.from(s, "utf8");
  if (bytes.length <= diagnosticLimit) {
    return s;
  }
  return (
    "[earlier output omitted; showing diagnostic tail]\n" +
    bytes.subarray(bytes.length - diagnosticLimit).toString("utf8")
  );
}

function cap(s) {
  const bytes = Buffer.from(s, "utf8");
  if (bytes.length <= 3 * diagnosticLimit) {
    return s;
  }
  return `${bytes.subarray(0, 3 * diagnosticLimit).toString("utf8")}\n[remaining diagnostics omitted]\n`;
}

function block(s) {
  const text = stripAnsi(s).trim();
  return text === "" ? "" : `\n${text}`;
}

function fullName(assertion) {
  return [...(assertion.ancestorTitles || []), assertion.title].join(" ");
}

function failedTests(result) {
  return (result.assertionResults || []).filter((a) => a.status === "failed");
}

function failing(result) {
  return result.status === "failed" || Boolean(result.testExecError) || failedTests(result).length > 0;
}

// The key standing for a file's tests whose names its source does not hold
// (jest.dang's anyTest).
const anyTest = "*";

function details(assertions) {
  return tail(
    assertions.map((a) => `● ${fullName(a)}\n${(a.failureMessages || []).join("\n")}`).join("\n\n"),
  );
}

// Why a test file failed outside its tests -- it failed to run, or a hook
// threw -- or null.
function outsideFailure(result) {
  if (result.testExecError || (result.status === "failed" && failedTests(result).length === 0)) {
    const message =
      result.message ||
      result.failureMessage ||
      (result.testExecError && (result.testExecError.stack || result.testExecError.message)) ||
      "";
    return `the test file failed outside its tests${block(tail(message))}`;
  }
  return null;
}

function summarize({ report, selections, exitCode, stdout, stderr }) {
  const output = tail(stripAnsi(`${stderr}\n${stdout}`).trim());
  const shown = output === "" ? "" : `:\n${output}`;
  let parsed = null;
  if (report.trim() !== "") {
    try {
      parsed = JSON.parse(report);
    } catch {
      parsed = null;
    }
  }

  const selected = new Set(selections.map((s) => s.path));
  let global = null;
  if (parsed === null || !Array.isArray(parsed.testResults)) {
    // Jest wrote no report: the config failed to load, Jest is not installed,
    // --bail stopped the run, or a global setup or teardown threw.
    global = `jest failed (exit ${exitCode}) without a report${shown}`;
  } else if (parsed.runExecError) {
    const err = parsed.runExecError;
    global = `jest failed (exit ${exitCode}): ${stripAnsi(err.message || "")}${block(tail(err.stack || ""))}${shown}`;
  } else {
    // Only the whole-project run reaches files without a selected check: ones
    // Jest's config finds that static discovery does not. Their failures
    // belong to no check, so they fail every check sharing the run.
    const outside = parsed.testResults.filter((r) => !selected.has(r.name) && failing(r));
    if (outside.length > 0) {
      const names = outside.map((r) => r.name).sort();
      const messages = outside.map((r) => outsideFailure(r) || details(failedTests(r))).join("\n");
      global = `failures in test files without selected test checks: ${names.join(", ")}${block(tail(messages))}`;
    } else if (exitCode !== 0 && !parsed.testResults.some(failing)) {
      global = `jest failed (exit ${exitCode}) with no failing test in its report${shown}`;
    }
  }

  return selections.map((s) => {
    if (global !== null) {
      return s.names.map(() => cap(global));
    }
    const result = parsed.testResults.find((r) => r.name === s.path);
    if (!result) {
      // Discovery listed a file Jest's own config does not run.
      return s.names.map(() => cap(`did not run: jest ran no tests from ${s.key}, though discovery found it`));
    }
    const assertions = result.assertionResults || [];
    const chosen = new Set(s.names);
    const named = new Set(s.discovered.filter((n) => n !== anyTest));
    const rest = chosen.has(anyTest);
    // A failing test with no selected check of its own -- an unnamed one when
    // "*" is not selected, or a named one the name filter could not leave out
    // -- cannot be told apart from the file's selected tests, so it fails all
    // of them.
    const orphans = assertions.filter((a) => {
      if (a.status !== "failed") return false;
      const name = fullName(a);
      if (named.has(name)) return !chosen.has(name);
      return !rest;
    });
    const fileFailure = outsideFailure(result);
    const orphanFailure =
      orphans.length > 0 ? `failed outside a selected test check:\n${details(orphans)}` : null;
    return s.names.map((name) => {
      const own =
        name === anyTest
          ? assertions.filter((a) => !named.has(fullName(a)))
          : assertions.filter((a) => fullName(a) === name);
      const failed = own.filter((a) => a.status === "failed");
      if (failed.length > 0) {
        return cap(`${name === anyTest ? "tests the source does not name" : name} failed:\n${details(failed)}`);
      }
      if (fileFailure) return cap(fileFailure);
      if (orphanFailure) return cap(orphanFailure);
      if (own.length === 0 && name !== anyTest) {
        // Jest ran the file without it: discovery read a test the file does
        // not declare when it runs, such as one inside a condition.
        return cap(`${name} did not run: jest ran ${s.key} without it`);
      }
      // A skipped or todo test, and a "*" with no tests (an empty .each
      // table), pass.
      return "";
    });
  });
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || i + 1 >= argv.length) {
      throw new Error(`bad argument: ${argv[i]}`);
    }
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const opts = args(process.argv.slice(2));
  for (const name of ["report", "stdout", "stderr", "selection", "exit-code", "output"]) {
    if (opts[name] === undefined) {
      throw new Error(`missing --${name}`);
    }
  }
  const results = summarize({
    report: read(opts.report),
    selections: JSON.parse(fs.readFileSync(opts.selection, "utf8")),
    exitCode: Number.parseInt(opts["exit-code"], 10),
    stdout: read(opts.stdout),
    stderr: read(opts.stderr),
  });
  results.forEach((fileResults, i) => {
    const dir = path.join(opts.output, String(i));
    fs.mkdirSync(dir, { recursive: true });
    fileResults.forEach((failure, j) => {
      fs.writeFileSync(path.join(dir, String(j)), failure);
    });
  });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
}

module.exports = { summarize };
