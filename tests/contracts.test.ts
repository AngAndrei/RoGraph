import { describe,it,expect } from 'vitest';
import { validateGraph } from '../packages/contracts/src/model.js';
const node=(id:string)=>({id,kind:'instance',label:'Duplicate',contexts:['unknown'],attributes:{}});
const graph=()=>({analysisId:'a',snapshotId:'s',versions:{schema:'1'},importManifest:{},nodes:[node('one'),node('two')],relations:[{id:'r',source:'one',target:'two',type:'REFERENCES'}],evidence:[{id:'e',relationId:'r',instanceId:'one',propertyName:'Value',rule:'serialized',status:'candidate',assumptions:[],contexts:['unknown']}],sites:[],sources:[],diagnostics:[],coverage:{importedInstances:2,discoveredScripts:0,parsedScripts:0,discoveredSites:0,resolvedSites:0,candidateSites:0,unresolvedSites:0,partialImport:false,limitations:[]}});
describe('graph boundary',()=>{
it('rejects evidence without a source/property locator',()=>{const g=graph();expect(()=>validateGraph(g)).not.toThrow();delete (g.evidence[0] as any).propertyName;expect(()=>validateGraph(g)).toThrow();});
it('keeps duplicate names distinct and rejects colliding identities',()=>{expect(validateGraph(graph()).nodes).toHaveLength(2);const g=graph();g.nodes[1].id='one';expect(()=>validateGraph(g)).toThrow();});
it('accepts categorical uncertainty without invented percentages',()=>{expect(validateGraph(graph()).evidence[0].status).toBe('candidate');});
it('rejects a relation with a nonexistent endpoint',()=>{const g=graph();g.relations[0].target='missing';expect(()=>validateGraph(g)).toThrow();});
});
