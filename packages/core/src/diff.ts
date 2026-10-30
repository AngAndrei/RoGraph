import type {Graph,Node} from '../../contracts/src/model.js';import {canonical,hash} from './util.js';
export interface GraphDiff {addedRelationIds:string[];removedRelationIds:string[];changedRelations:{beforeId:string;afterId:string;reason:string}[];ambiguousMatches:{beforeIds:string[];afterIds:string[];reason:string}[]}
export function diffGraphs(before:Graph,after:Graph):GraphDiff{
 const result:GraphDiff={addedRelationIds:[],removedRelationIds:[],changedRelations:[],ambiguousMatches:[]},matched=new Map<string,string>(),used=new Set<string>();
 const aNodes=new Map(before.nodes.map(n=>[n.id,n])),bNodes=new Map(after.nodes.map(n=>[n.id,n]));
 const path=(n:Node,map:Map<string,Node>):string=>{const parts:unknown[]=[];let node:Node|undefined=n;const seen=new Set<string>();while(node&&!seen.has(node.id)){seen.add(node.id);parts.unshift([node.attributes.className??node.kind,node.label]);node=node.ownerId?map.get(node.ownerId):undefined;}return canonical(parts);};
 const groups=(nodes:Node[],key:(n:Node)=>string)=>{const map=new Map<string,Node[]>();for(const n of nodes){const k=key(n),list=map.get(k)??[];list.push(n);map.set(k,list);}return map;};
 const match=(left:Node[],right:Node[],ak:(n:Node)=>string,bk:(n:Node)=>string,ambiguous:boolean)=>{const a=groups(left.filter(n=>!matched.has(n.id)),ak),b=groups(right.filter(n=>!used.has(n.id)),bk);for(const[k,x]of a){const y=b.get(k);if(!y)continue;if(x.length===1&&y.length===1){matched.set(x[0].id,y[0].id);used.add(y[0].id);}else if(ambiguous)result.ambiguousMatches.push({beforeIds:x.map(n=>n.id),afterIds:y.map(n=>n.id),reason:'Multiple objects share this hierarchy/class or content signature; no forced correspondence.'});}};
 const ai=before.nodes.filter(n=>n.kind==='instance'),bi=after.nodes.filter(n=>n.kind==='instance');match(ai,bi,n=>path(n,aNodes),n=>path(n,bNodes),false);
 const signature=(g:Graph,n:Node)=>{const source=g.sources.find(s=>s.scriptId===n.id);return hash(canonical([n.attributes.className,source?.sha256??Object.fromEntries(Object.entries((n.attributes.properties??{}) as object).filter(([k])=>!['Name','Source'].includes(k)))]));};
 match(ai,bi,n=>signature(before,n),n=>signature(after,n),false);
 match(ai,bi,n=>path(n,aNodes),n=>path(n,bNodes),true);
 const semantic=(g:Graph,n:Node,old:boolean)=>{const source=g.sources.find(s=>s.id===n.attributes.sourceId),owner=String(n.attributes.scriptId??source?.scriptId??n.ownerId??'');const logical=old?matched.get(owner)??`unmatched:${owner}`:owner;
  if(n.kind==='external')return'external:'+n.id;
  if(n.kind==='field')return canonical(['field',logical,n.attributes.fieldPath??n.label]);
  if(n.kind==='function'){const script=(old?aNodes:bNodes).get(owner),name=n.label.startsWith((script?.label??'')+'.')?n.label.slice(script!.label.length+1):n.label;return canonical(['function',logical,name,n.attributes.parameters]);}
  const span=n.attributes.span as any,text=source&&span?Buffer.from(source.text).subarray(span.startByte,span.endByte).toString():n.label;return canonical([n.kind,logical,n.label,hash(text)]);
 };
 match(before.nodes.filter(n=>n.kind!=='instance'),after.nodes.filter(n=>n.kind!=='instance'),n=>semantic(before,n,true),n=>semantic(after,n,false),true);
 const key=(r:Graph['relations'][number],old:boolean)=>canonical([r.type,old?matched.get(r.source)??'removed:'+r.source:r.source,old?matched.get(r.target)??'removed:'+r.target:r.target]);
 const oldKeys=new Map(before.relations.map(r=>[key(r,true),r])),newKeys=new Map(after.relations.map(r=>[key(r,false),r]));
 const removed=before.relations.filter(r=>!newKeys.has(key(r,true))),added=after.relations.filter(r=>!oldKeys.has(key(r,false)));result.removedRelationIds=removed.map(r=>r.id);result.addedRelationIds=added.map(r=>r.id);
 for(const old of removed){const candidates=added.filter(r=>r.type===old.type&&r.source===matched.get(old.source));if(candidates.length===1&&removed.filter(r=>r.type===old.type&&matched.get(r.source)===candidates[0].source).length===1)result.changedRelations.push({beforeId:old.id,afterId:candidates[0].id,reason:'Same matched owner and relation type now target a different object or symbol.'});}
 return result;
}
