#!/usr/bin/env node
// Entry point: binds the shared CLI to this package's disk loader and model assembler.
import process from 'node:process';
import { loadFromDirectory } from '../../model-builder/dist/loader-fs.js';
import { buildBlueprintModel } from '../../model-builder/dist/model/buildModel.js';
import { runRenderCli } from './cli-main.js';

runRenderCli(process.argv.slice(2), { loadFromDirectory, buildBlueprintModel });
