import type {Input,Graph} from '../../contracts/src/model.js';import type {GraphStore} from './store.js';
import type {ParsedSource} from '../../contracts/src/protocol.js';import {tmpdir} from 'node:os';import {join} from 'node:path';import {importPlace} from './import.js';import {buildRojoSnapshot} from './rojo-import.js';import {createParseCache} from './cache.js';import {WorkerClient} from './worker-client.js';
export interface Progress {stage:string;completed:number;total:number}
export interface AnalyzeOptions {cacheDir?:string;onParse?:(hit:boolean)=>void;onProgress?:(progress:Progress)=>void}
export async function analyze(input:Input,store:GraphStore,signal?:AbortSignal,options:AnalyzeOptions={}):Promise<Graph>{
 const report=(stage:string,completed=0,total=1)=>{options.onProgress?.({stage,completed,total});signal?.throwIfAborted();};
 report('import');const snapshot=input.kind==='place'?await importPlace(input.path,signal):await buildRojoSnapshot(input.projectPath,signal);report('import',1);
 const cache=createParseCache(options.cacheDir??join(tmpdir(),'rograph-parse-cache-v1'),{onParse:options.onParse}),parsed:ParsedSource[]=[];
 for(const source of snapshot.sources){report('parse',parsed.length,snapshot.sources.length);parsed.push(await cache.parseCached(source,signal));}report('parse',parsed.length,parsed.length);
 report('resolve');const worker=new WorkerClient();const abort=()=>{void worker.terminate();};signal?.addEventListener('abort',abort,{once:true});let graph:Graph;
 try{graph=await worker.call<Graph>('resolve',[snapshot,parsed],signal);}finally{signal?.removeEventListener('abort',abort);await worker.terminate();}
 report('persist');await store.save(graph,signal);report('persist',1);signal?.throwIfAborted();if(!graph.coverage.partialImport)await store.publish(graph.analysisId);options.onProgress?.({stage:'complete',completed:1,total:1});return graph;
}
