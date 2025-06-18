import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type PerfMetric<Unit extends 'nanoseconds' | 'bytes' | 'count'> = {
	q1: number;
	median: number;
	q3: number;
	min: number;
	max: number;
	mean: number;
	std_dev: number;
	outlier_count: number;
	sample_count: number;
	unit: Unit;
};

export type PerfMeasurements = {
	wall_time: PerfMetric<'nanoseconds'>;
	peak_rss: PerfMetric<'bytes'>;
	cpu_cycles: PerfMetric<'count'>;
	instructions: PerfMetric<'count'>;
	cache_references: PerfMetric<'count'>;
	cache_misses: PerfMetric<'count'>;
	branch_misses: PerfMetric<'count'>;
};

export type PerfResult = {
	raw_cmd: string;
	argv: string[];
	measurements: PerfMeasurements;
	sample_count: number;
};

const findPerf = (binary: string) => {
	const cmd = `./static/${binary}`;
	if (existsSync(cmd)) return cmd;

	const altCmd = join(__dirname, '..', cmd);
	if (existsSync(altCmd)) return altCmd;

	throw new Error(`Failed to open perf at ${cmd}`);
};

export const perf = async (
	cmd: string,
	opts: { binary?: string; duration?: number; warmup?: boolean; allowFailures?: boolean },
) => {
	const outputFile = `./${randomBytes(10).toString('hex')}.json`;

	execSync(
		[
			'sudo',
			findPerf(opts.binary ?? 'perf-0.6.0-x86-linux'),
			`--export-json ${outputFile}`,
			opts.duration && `--duration ${opts.duration}`,
			opts.warmup && '--warmup',
			`'${cmd}'`,
		]
			.filter(Boolean)
			.join(' '),
		{ stdio: 'pipe' },
	);

	try {
		const res: PerfResult[] = JSON.parse(readFileSync(outputFile, 'utf-8'));
		return res[0]!;
	} finally {
		rmSync(outputFile);
	}
};
