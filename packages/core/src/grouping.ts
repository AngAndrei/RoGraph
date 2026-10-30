import type {Node} from '../../contracts/src/model.js';
export function groupNodes(nodes:Node[],ancestors:Map<string,Node>,by:'service'|'folder'='service'){
 const groups=new Map<string,{id:string;label:string;nodeIds:string[]}>();
 for(const node of nodes){let current=node,group:Node|undefined;const seen=new Set<string>();while(current.ownerId&&!seen.has(current.id)){seen.add(current.id);const parent=ancestors.get(current.ownerId);if(!parent)break;current=parent;const cls=String(parent.attributes.className??'');if(by==='folder'&&cls==='Folder'){group=parent;break;}if(cls.endsWith('Service')||['ReplicatedStorage','StarterPlayer','Workspace','ReplicatedFirst','StarterGui','StarterPack','ServerStorage'].includes(cls))group=parent;}
  group??=current;const entry=groups.get(group.id)??{id:group.id,label:group.label,nodeIds:[]};entry.nodeIds.push(node.id);groups.set(group.id,entry);
 }return[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
