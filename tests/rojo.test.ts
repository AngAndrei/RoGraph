import {it,expect} from 'vitest';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {captureProject} from '../packages/adapters/src/capture.js';
import {withWorkspace} from './support/workspace.js';
it('rejects paths escaping a selected project before invoking Rojo',async()=>withWorkspace(async root=>{await writeFile(join(root,'default.project.json'),JSON.stringify({name:'bad',tree:{$className:'DataModel',Shared:{$path:'../outside'}}}));await expect(captureProject(join(root,'default.project.json'))).rejects.toThrow(/outside|escape/i);}));
it('captures immutable file contents and directory membership',async()=>withWorkspace(async root=>{await mkdir(join(root,'src'));await writeFile(join(root,'default.project.json'),' {"name":"test","tree":{"$className":"DataModel","ReplicatedStorage":{"$path":"src"}}}');await writeFile(join(root,'src','A.luau'),'return 1\r\n');const c=await captureProject(join(root,'default.project.json'));await writeFile(join(root,'src','A.luau'),'return 2');expect(await readFile(join(c.root,'src','A.luau'),'utf8')).toBe('return 1\r\n');expect(c.files).toHaveLength(2);}));
