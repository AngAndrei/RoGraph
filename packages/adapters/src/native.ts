import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const projectRoot=resolve(process.env.ROGRAPH_ROOT??fileURLToPath(new URL('../../../',import.meta.url)));
export function toolPath(tool:string){return resolve(projectRoot,'build','bin',`${tool}${process.platform==='win32'?'.exe':''}`);}
export async function runNative<T>(tool:string,request:unknown,signal?:AbortSignal):Promise<T>{
 signal?.throwIfAborted();
 return new Promise((accept,reject)=>{
  const child=spawn(toolPath(tool),[],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';let error='';let finished=false;
  const finish=(e?:unknown,value?:T)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(e)reject(e);else accept(value!);};
  const abort=()=>{child.kill();finish(signal?.reason??new Error('Analysis canceled'));};
  const timer=setTimeout(()=>{child.kill();finish(new Error('Native helper timed out'));},120000);
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',e=>finish(new Error(`Cannot start ${tool}: ${e.message}. Run npm run build:native.`)));
  child.stdout.on('data',data=>{output+=data;if(Buffer.byteLength(output)>256*1024*1024){child.kill();finish(new Error('Native output limit exceeded'));}});
  child.stderr.on('data',data=>{error=(error+data).slice(-8192);});
  child.on('close',code=>{if(finished)return;try{const value=JSON.parse(output);if(value.error)finish(new Error(value.error));else if(code!==0)finish(new Error(error||`Native helper failed (${code})`));else finish(undefined,value);}catch{finish(new Error(error||'Native helper returned invalid JSON'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request)+'\n');
 });
}
