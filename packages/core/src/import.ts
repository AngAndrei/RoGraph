import type {Snapshot,Instance,Source,Diagnostic} from '../../contracts/src/model.js';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {runNative} from '../../adapters/src/native.js';
import {hash,RoGraphError} from './util.js';
import {defaultLimits} from './limits.js';
export async function importPlace(path:string,signal?:AbortSignal):Promise<Snapshot>{
 signal?.throwIfAborted();path=resolve(path);
 if(extname(path).toLowerCase()!=='.rbxlx')throw new RoGraphError('UNSUPPORTED_FORMAT','Select an XML Roblox place (.rbxlx).');
 if((await stat(path)).size>defaultLimits.inputBytes)throw new RoGraphError('INPUT_SIZE_LIMIT','Place exceeds the import size limit.');
 const bytes=await readFile(path,{signal});if(bytes.length>defaultLimits.inputBytes)throw new RoGraphError('INPUT_SIZE_LIMIT','Input grew during import.');
 const snapshotId=hash(bytes),blobDir=join(tmpdir(),'rograph-blobs');await mkdir(blobDir,{recursive:true});const blobPath=join(blobDir,snapshotId+'.rbxlx');await writeFile(blobPath,bytes,{signal});
 const raw=await runNative<any>('rbx-import',{protocolVersion:1,requestId:snapshotId,operation:'import',path:blobPath},signal);
 signal?.throwIfAborted();if(raw.instances.length>defaultLimits.instances+1)throw new RoGraphError('INSTANCE_LIMIT','Too many saved objects.');
 const idMap=new Map<string,string>(raw.instances.map((i:any,n:number)=>[i.id,`${snapshotId}/i/${n}`]));
 const siblings=new Map<string,number>();const sources:Source[]=[];const diagnostics:Diagnostic[]=[...raw.diagnostics];let totalSource=0;
 const instances:Instance[]=raw.instances.map((v:any)=>{
  const id=idMap.get(v.id)!,parentId=v.parentId?idMap.get(v.parentId)!:null,key=parentId??'root',siblingOrdinal=siblings.get(key)??0;siblings.set(key,siblingOrdinal+1);
  const properties=structuredClone(v.properties);
  for(const p of Object.values(properties) as any[])if(p.type==='Ref'&&p.value)p.value=idMap.get(p.value)??null;
  const i:Instance={id,parentId,name:v.name,className:v.className,siblingOrdinal,synthetic:v.synthetic,properties,...(v.originalReferent?{originalReferent:v.originalReferent}:{})};
  if(['Script','LocalScript','ModuleScript'].includes(i.className)){
   const text=properties.Source?.value;
   if(typeof text==='string'){
    const size=Buffer.byteLength(text);totalSource+=size;if(size>defaultLimits.scriptBytes||totalSource>defaultLimits.totalSourceBytes)throw new RoGraphError('SOURCE_SIZE_LIMIT','Saved script text exceeds analysis limits.');
    i.sourceId=id+':source';sources.push({id:i.sourceId,scriptId:id,text,sha256:hash(text),origin:{kind:'place',path}});
   }else diagnostics.push({code:'MISSING_SOURCE',severity:'warning',message:`${i.name} has no readable saved source`,ownerId:id});
  }return i;
 });
 return {snapshotId,input:{kind:'place',path},versions:{schema:'1',importer:raw.importerVersion,reflection:'roblox-741'},instances,sources,diagnostics,coverage:{importedInstances:instances.filter(i=>!i.synthetic).length,discoveredScripts:instances.filter(i=>['Script','LocalScript','ModuleScript'].includes(i.className)).length,parsedScripts:0,discoveredSites:0,resolvedSites:0,candidateSites:0,unresolvedSites:0,partialImport:diagnostics.some(d=>['UNKNOWN_PROPERTY_TYPE','DANGLING_REFERENT','INVENTORY_MISMATCH','MISSING_SOURCE'].includes(d.code)),limitations:['One saved place; runtime-created objects, external asset code, and dynamic dispatch may be absent.']},inventory:{items:raw.inventory.items,rawInput:{sha256:snapshotId,byteLength:bytes.length,blobPath}}};
}
