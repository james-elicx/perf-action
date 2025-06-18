import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as core from '@actions/core';
import * as github from '@actions/github';

import { benchmarkHtml } from './benchmark.template';
import { Git } from './git';
import type { PerfMeasurements } from './perf';
import { perf } from './perf';

export type RawConfig = {
	binary: `perf-0.6.0-${string}`;
	baseline?: string;
	config: {
		warmup?: boolean;
		duration?: number;
		allowFailures?: boolean;
		commands: { name: string; command: string }[];
	};
	output?: {
		branch?: string;
		json?: string;
		html?: string;
		limit?: number;
	};
};

type DeepNonNullable<T> = T extends object
	? { [P in keyof T]-?: DeepNonNullable<NonNullable<T[P]>> }
	: T;

export type Config = DeepNonNullable<RawConfig>;

export type Result = {
	name: string;
	command: string;

	iterations: number;
	warmup: boolean;

	measurements: PerfMeasurements;
};

export type Benchmark = {
	hash: string;
	timestamp: string;
	results: Result[];
};

const getConfig = async (): Promise<Config & { git: Git }> => {
	const workspace = process.env.GITHUB_WORKSPACE;
	if (!workspace) throw new Error(`Failed to read workspace "$GITHUB_WORKSPACE"`);

	const configPath = join(workspace, core.getInput('config') || '.perf.json');
	if (!existsSync(configPath)) throw new Error(`Config file ${configPath} not found`);

	const rawConfig: RawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

	return {
		git: new Git(await core.getIDToken()),
		binary: rawConfig.binary,
		baseline: rawConfig.baseline ?? 'main',
		config: {
			warmup: !!rawConfig.config.warmup,
			duration: rawConfig.config.duration ?? 5000,
			allowFailures: !!rawConfig.config.allowFailures,
			commands: rawConfig.config.commands,
		},
		output: {
			branch: rawConfig.output?.branch ?? 'gh-pages',
			json: rawConfig.output?.json ?? 'benchmarks.json',
			html: rawConfig.output?.html ?? 'benchmarks.html',
			limit: rawConfig.output?.limit ?? -1,
		},
	};
};

const getExistingBenchmarks = (benchmarkFile: string) => {
	if (!existsSync(benchmarkFile)) return [];
	const results: Benchmark[] = JSON.parse(readFileSync(benchmarkFile, 'utf-8'));

	if (!Array.isArray(results)) {
		throw new Error(`Corrupted benchmark file, ${benchmarkFile} is not a JSON array`);
	}

	return results;
};

const run = async () => {
	const { git, binary, baseline, config, output } = await getConfig();

	const benchmark: Benchmark = {
		hash: git.hash,
		timestamp: new Date().toISOString(),
		results: [],
	};

	for (const { name, command } of config.commands) {
		core.debug(`Starting benchmark: ${name}`);

		const res = await perf(command, { ...config, binary });

		// const count = res.times?.length ?? 0;
		// delete res.times;

		benchmark.results.push({
			name,
			command,

			iterations: res.sample_count,
			warmup: config.warmup,

			measurements: res.measurements,
		});
	}

	const isBaselineBranch = `refs/heads/${baseline}` === github.context.ref;

	core.debug(`Checkout output branch: ${output.branch}`);
	git.init();
	git.fetch();

	try {
		git.checkout(output.branch);
	} catch (e) {
		core.warning(`Failed to checkout output branch ${output.branch}, skipping comparision`);
		return;
	}

	const existing = getExistingBenchmarks(output.json);
	existing.unshift(benchmark);
	while (output.limit > 0 && existing.length > output.limit) existing.pop();

	writeFileSync(output.json, JSON.stringify(existing, null, 2));

	if (isBaselineBranch) {
		const htmlExists = existsSync(output.html);
		if (!htmlExists) {
			writeFileSync(output.html, benchmarkHtml({ output }));
			git.add(output.html);
		}

		core.debug(`Pushing changes to branch ${output.branch}`);
		git.add(output.json);
		git.commit(`benchmark publish for ${git.hash}`);
		git.push(output.branch);
	} else {
		core.debug('Skipping publish');
	}
};

export { run as benchmark };
