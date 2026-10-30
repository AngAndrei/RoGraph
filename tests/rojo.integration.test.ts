import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {buildRojoSnapshot,attachRojoProvenance} from '../packages/core/src/rojo-import.js';
import {captureProject} from '../packages/adapters/src/capture.js';
import {runRojoBuild} from '../packages/adapters/src/rojo.js';
import {importPlace} from '../packages/core/src/import.js';
import {fixturePath} from './support/fixtures.js';
it('builds a real Rojo project and distinguishes generated config from source files',async()=>{const s=await buildRojoSnapshot(fixturePath('rojo/default.project.json'));expect(s.input.kind).toBe('rojo');expect(s.sources).toHaveLength(4);expect(s.sources.find(v=>v.text.includes('Shield'))!.origin.kind).toBe('generated');expect(s.sources.find(v=>v.text.includes('Service.TryPurchase'))!.origin.kind).toBe('file');expect(s.coverage.partialImport).toBe(false);});
it('refuses a mixed build and map pair',async()=>{const c=await captureProject(fixturePath('rojo/default.project.json')),b=await runRojoBuild(c),s=await importPlace(b.placePath);await writeFile(b.sourcemapPath,(await readFile(b.sourcemapPath,'utf8'))+' ');await expect(attachRojoProvenance(s,b,c)).rejects.toThrow(/Stale|mixed/);});
