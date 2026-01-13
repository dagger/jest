import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const external = (id) =>
	id.startsWith("@opentelemetry/") ||
	// also keep Node builtins external for a library
	id === "node:fs" ||
	id === "node:path" ||
	id === "node:crypto" ||
	id === "fs" ||
	id === "path" ||
	id === "crypto" ||
	id === "jest-environment-node" ||
	id === "require-in-the-middle";

const nodeEnvironmentConfig = {
	input: "src/node-environment.ts",
	plugins: [
		typescript({
			tsconfig: "./tsconfig.json",
			declaration: false,
			declarationMap: false,
		}),
		json(),
		resolve({ preferBuiltins: true }),
		commonjs(),
	],
	external,
	output: [
		{
			file: "dist/cjs/node-environment.cjs",
			format: "cjs",
			exports: "named",
			sourcemap: true,
		},
		{
			file: "dist/esm/node-environment.mjs",
			format: "es",
			sourcemap: true,
		},
	],
};

const registerConfig = {
	input: "src/register.ts",
	plugins: [
		typescript({
			tsconfig: "./tsconfig.json",
			declaration: false,
			declarationMap: false,
		}),
		json(),
		resolve({ preferBuiltins: true }),
		commonjs(),
	],
	external,
	output: [
		{
			file: "dist/cjs/register.cjs",
			format: "cjs",
			exports: "named",
			sourcemap: true,
		},
		{
			file: "dist/esm/register.mjs",
			format: "es",
			sourcemap: true,
		},
	],
};

export default [nodeEnvironmentConfig, registerConfig];
