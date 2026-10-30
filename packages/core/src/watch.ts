import type {Input} from '../../contracts/src/model.js';
import {watch} from 'node:fs';import {dirname,resolve} from 'node:path';import {inventoryDirectory,contained} from '../../adapters/src/capture.js';
export async function watchProject(projectPath:string,onChange:(input:Input)=>Promise<void>,signal:AbortSignal,excludedRoots:string[]=[]):Promise<void>{
 if(signal.aborted)return;const root=dirname(projectPath);let dirty=true,running=false,previous='',timer:ReturnType<typeof setTimeout>|undefined,finished=false;
 await new Promise<void>((accept,reject)=>{const watcher=watch(root,{recursive:true},(event,name)=>{if(name&&excludedRoots.some(ex=>contained(resolve(ex),resolve(root,String(name)))))return;if(name&&String(name).split(/[\\/]/).some(p=>p==='.git'||p==='.rograph'))return;dirty=true;schedule();});
  const close=(error?:unknown)=>{if(finished)return;finished=true;clearTimeout(timer);watcher.close();signal.removeEventListener('abort',abort);error?reject(error):accept();};const abort=()=>{if(!running)close();else dirty=false;};
  const pump=async()=>{if(running||finished)return;running=true;try{while(dirty&&!signal.aborted){dirty=false;const hash=(await inventoryDirectory(root,signal,excludedRoots)).manifestHash;if(hash!==previous){previous=hash;await onChange({kind:'rojo',projectPath});if(!signal.aborted&&(await inventoryDirectory(root,signal,excludedRoots)).manifestHash!==previous)dirty=true;}}}catch(e){if(!signal.aborted)close(e);}finally{running=false;if(signal.aborted)close();else if(dirty)schedule();}};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{void pump();},500);};watcher.on('error',close);signal.addEventListener('abort',abort,{once:true});void pump();
 });
}
