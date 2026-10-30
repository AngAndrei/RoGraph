import type {GraphStore,StoreSelection} from './store.js';import type {Query,QueryResult} from '../../contracts/src/query.js';
import {z} from 'zod';import {relationTypes,type Node} from '../../contracts/src/model.js';import {hash,canonical,RoGraphError} from './util.js';import {traverse} from './traversal.js';import {groupNodes} from './grouping.js';
export interface QueryEngine {run(q:Query,signal?:AbortSignal):Promise<QueryResult>}
export const querySchema=z.object({op:z.enum(['search','inspect','source','dependencies','impact','trace','overview','coverage','tree']),analysisId:z.string().min(1).max(128),nodeId:z.string().max(2048).optional(),sourceId:z.string().max(2048).optional(),text:z.string().max(256).optional(),fromId:z.string().max(2048).optional(),toId:z.string().max(2048).optional(),parentId:z.string().max(2048).nullable().optional(),groupBy:z.enum(['service','folder']).optional(),depth:z.number().int().nonnegative().max(100).optional(),limit:z.number().int().positive().max(100000).optional(),cursor:z.string().max(2048).optional(),relationTypes:z.array(z.enum(relationTypes)).max(20).optional(),statuses:z.array(z.enum(['saved','resolved','candidate','unresolved'])).max(4).optional(),contexts:z.array(z.enum(['client','server','unknown'])).max(3).optional(),classes:z.array(z.string().max(64)).max(50).optional(),startByte:z.number().int().nonnegative().optional(),endByte:z.number().int().nonnegative().optional()});
export function createQueryEngine(store:GraphStore):QueryEngine{return{async run(input,signal){
 const q=querySchema.parse(input) as Query;signal?.throwIfAborted();const {cursor,...shape}=q,fingerprint=hash(canonical(shape));let offset:string|undefined;
 if(cursor)try{const c=JSON.parse(Buffer.from(cursor,'base64url').toString());if(c.fingerprint!==fingerprint||!Number.isSafeInteger(c.offset)||c.offset<0)throw Error();offset=String(c.offset);}catch{throw new RoGraphError('INVALID_CURSOR','Cursor belongs to different filters or analysis');}
 const limit=Math.min(q.limit??(q.op==='overview'?300:1000),q.op==='overview'?300:1000);let r=await store.select({op:'manifest',analysisId:q.analysisId,limit});
 const select=(s:Omit<StoreSelection,'analysisId'|'limit'> & Record<string,unknown>)=>store.select({...s,analysisId:q.analysisId,limit,classes:q.classes,contexts:q.contexts,statuses:q.statuses} as StoreSelection);
 const mergeMeta=(part:QueryResult)=>{r.meta.truncated||=part.meta.truncated;Object.assign(r.meta.omittedCounts,part.meta.omittedCounts);};
 if(q.op==='search')r=await select({op:'search',text:q.text??'',cursor:offset});
 else if(q.op==='tree')r=await select({op:'children',parentId:q.parentId??null,cursor:offset});
 else if(q.op==='source'){if(!q.sourceId)throw new RoGraphError('INVALID_QUERY','Choose a source');r=await select({op:'sources',ids:[q.sourceId],startByte:q.startByte,endByte:q.endByte});if(!r.sources.length)throw new RoGraphError('SOURCE_NOT_FOUND','Source is not in this analysis');if(r.sources.some(s=>s.omittedBytes)){r.meta.truncated=true;r.meta.omittedCounts.sourceBytes=r.sources.reduce((n,s)=>n+s.omittedBytes,0);}}
 else if(['dependencies','impact','trace'].includes(q.op)){
  const root=q.op==='trace'?q.fromId:q.nodeId;if(!root)throw new RoGraphError('INVALID_QUERY','Choose a starting node');let roots=[root],targets=q.toId?[q.toId]:[];
  const rootNodes=await select({op:'nodes',ids:roots});if(!rootNodes.nodes.length)throw new RoGraphError('NODE_NOT_FOUND','Node is not in this analysis');
  if(rootNodes.nodes[0].attributes.sourceId){const m=await select({op:'members',ownerIds:roots});roots.push(...m.nodes.filter(n=>n.kind==='function').map(n=>n.id));mergeMeta(m);}
  if(q.op==='trace'&&!q.toId)throw new RoGraphError('INVALID_QUERY','Choose a destination node');
  if(q.toId){const m=await select({op:'members',ownerIds:[q.toId]});targets.push(...m.nodes.map(n=>n.id));}
  await traverse(store,q,r,roots.slice(0,limit),targets,limit,signal);
 }else if(q.op==='inspect'||q.op==='overview'){
  const initial=q.op==='overview'?await select({op:'overview',groupBy:q.groupBy,cursor:offset}):await select({op:'nodes',ids:q.nodeId?[q.nodeId]:[]});r=initial;
  const members=await select({op:'members',ownerIds:r.nodes.map(n=>n.id)});mergeMeta(members);const nodeMap=new Map([...r.nodes,...members.nodes].slice(0,limit).map(n=>[n.id,n]));
  if(r.nodes.length+members.nodes.length>limit){r.meta.truncated=true;r.meta.omittedCounts.memberNodesAtLeast=1;}
  const outgoing=await select({op:'adjacent',nodeIds:[...nodeMap.keys()],direction:'out',relationTypes:q.relationTypes});const incoming=q.op==='inspect'?await select({op:'adjacent',nodeIds:[...nodeMap.keys()],direction:'in',relationTypes:q.relationTypes}):{...r,relations:[],meta:{...r.meta,truncated:false}};
  mergeMeta(outgoing);mergeMeta(incoming);const rels=[...new Map([...outgoing.relations,...incoming.relations].map(v=>[v.id,v])).values()];
  const endpoints=await select({op:'nodes',ids:[...new Set(rels.flatMap(e=>[e.source,e.target]))]});for(const n of endpoints.nodes)if(nodeMap.size<limit||nodeMap.has(n.id))nodeMap.set(n.id,n);
  r.nodes=[...nodeMap.values()];r.relations=rels.filter(e=>nodeMap.has(e.source)&&nodeMap.has(e.target));if(r.relations.length<rels.length){r.meta.truncated=true;r.meta.omittedCounts.relations=rels.length-r.relations.length;}
  const sites=await select({op:'sites',ownerIds:[...nodeMap.keys()]});r.sites=sites.sites;mergeMeta(sites);
  if(q.op==='overview'){const ancestors=new Map(nodeMap);let pending=r.nodes.map(n=>n.ownerId).filter(Boolean) as string[];for(let i=0;i<256&&pending.length;i++){const a=await store.select({op:'nodes',analysisId:q.analysisId,ids:[...new Set(pending)].filter(id=>!ancestors.has(id)),limit:1000});if(!a.nodes.length)break;for(const n of a.nodes)ancestors.set(n.id,n);pending=a.nodes.map(n=>n.ownerId).filter(Boolean) as string[];}r.groups=groupNodes(r.nodes,ancestors,q.groupBy);}
 }
 if(r.relations.length&&!r.evidence.length){const e=await store.select({op:'evidence',analysisId:q.analysisId,relationIds:r.relations.map(e=>e.id),limit:5000});r.evidence=e.evidence.filter(e=>(!q.statuses?.length||q.statuses.includes(e.status))&&(!q.contexts?.length||e.contexts.some(c=>q.contexts!.includes(c))));mergeMeta(e);const supported=new Set(r.evidence.map(e=>e.relationId));r.relations=r.relations.filter(e=>supported.has(e.id));}
 if(q.op!=='source'){
  const ids=[...new Set(r.evidence.map(e=>e.sourceId).filter(Boolean) as string[])];for(const id of ids.slice(0,5)){const ev=r.evidence.find(e=>e.sourceId===id)!;const s=await store.select({op:'sources',analysisId:q.analysisId,ids:[id],limit:1,startByte:Math.max(0,ev.span!.startByte-120),endByte:ev.span!.endByte+240});r.sources.push(...s.sources);}
  if(ids.length>5){r.meta.truncated=true;r.meta.omittedCounts.sourceDocuments=ids.length-5;}
 }
 if(r.meta.nextCursor)r.meta.nextCursor=Buffer.from(JSON.stringify({fingerprint,offset:Number(r.meta.nextCursor)})).toString('base64url');
 r.meta.limits={...r.meta.limits,nodes:limit,depth:Math.min(q.depth??3,6),evidence:5000,paths:5};
 if(['dependencies','impact','trace'].includes(q.op)&&!r.relations.length)r.diagnostics.push({code:'NO_MODELED_CONNECTIONS',severity:'info',message:'No modeled connections within these filters and bounds. Unresolved references, runtime behavior, and import coverage limit completeness.'});
 signal?.throwIfAborted();return r;
 }};}
