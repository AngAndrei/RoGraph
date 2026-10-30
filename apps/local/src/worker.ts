import {parentPort} from 'node:worker_threads';
import {lowerAst} from '../../../packages/core/src/ast-lowering.js';import {resolveInstances} from '../../../packages/core/src/resolve-instances.js';import {resolveCalls} from '../../../packages/core/src/resolve-calls.js';import {resolveConfig} from '../../../packages/core/src/resolve-config.js';import {resolveEvents} from '../../../packages/core/src/resolve-events.js';import {assembleGraph} from '../../../packages/core/src/assemble.js';
import {openStore,type GraphStore} from '../../../packages/core/src/store.js';import {createQueryEngine} from '../../../packages/core/src/query.js';
import {diffGraphs} from '../../../packages/core/src/diff.js';
let store:GraphStore|undefined;const controllers=new Map<number,AbortController>();
parentPort!.on('message',async request=>{
 if(request.op==='cancel'){controllers.get(request.id)?.abort();return;}
 const controller=new AbortController();controllers.set(request.id,controller);
 try{const a=request.args??[];let value:any;
  switch(request.op){
   case'resolve':{const snapshot=a[0],facts=a[1].map(lowerAst),instances=resolveInstances(snapshot,facts),calls=resolveCalls(snapshot,facts,instances);value=assembleGraph(snapshot,facts,[instances,calls,resolveConfig(snapshot,facts,instances,calls),resolveEvents(snapshot,facts,instances,calls)]);break;}
   case'open':store=await openStore(a[0]);value=true;break;
   case'query':value=await createQueryEngine(store!).run(a[0],controller.signal);break;
   case'diff':value=diffGraphs(await store!.readGraph(a[0]),await store!.readGraph(a[1]));break;
   case'save':value=await store!.save(a[0],controller.signal);break;
   case'publish':value=await store!.publish(a[0]);break;
   case'current':value=await store!.current();break;
   case'listAnalyses':value=await store!.listAnalyses(a[0],a[1]);break;
   case'readGraph':value=await store!.readGraph(a[0]);break;
   case'select':value=await store!.select(a[0]);break;
   case'close':await store?.close();value=true;break;
   default:throw new Error('Unknown worker request');
  }parentPort!.postMessage({id:request.id,value});
 }catch(error){const e=error as any;parentPort!.postMessage({id:request.id,error:{code:controller.signal.aborted?'CANCELED':e.code??'WORKER_ERROR',message:e.message??String(e)}});}finally{controllers.delete(request.id);}
});
