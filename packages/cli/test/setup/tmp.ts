import { afterAll } from 'vitest';
import { cleanupTmpDirs } from '../helpers/tmp.js';

afterAll(cleanupTmpDirs);
