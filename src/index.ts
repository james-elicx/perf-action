import * as core from '@actions/core';

import { benchmark } from './benchmark';

benchmark().catch((e: Error) => core.setFailed(e.message));
