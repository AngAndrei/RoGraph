import type {Facts,Expr,Span,Binding,Site} from '../../contracts/src/model.js';
import type {ParsedSource} from '../../contracts/src/protocol.js';
export function lowerAst(parsed:ParsedSource):Facts {
 const f:Facts={scriptId:parsed.scriptId,sourceId:parsed.sourceId,scopes:[],bindings:[],symbols:[],sites:[],exports:[],diagnostics:parsed.diagnostics.map(d=>({...d,ownerId:parsed.scriptId})),members:[],globalAssignments:[],ast:parsed.ast};
 if(!parsed.ast||parsed.diagnostics.some(d=>d.code==='LUAU_PARSE_ERROR'))return f;
 const bindings=new Map<string,Binding>(),functions=new Map<number,string>();
 const fallback:Span={startByte:0,endByte:0,startLine:1,startColumn:1,endLine:1,endColumn:1};
 const loc=(v:any):Span=>v?.span??fallback;
 const bid=(v:any)=>`${f.scriptId}:binding:${loc(v).startByte}:${v?.name??'self'}`;
 const binding=(v:any,scope:string)=>{const id=bid(v);let b=bindings.get(id);if(!b){b={id,scopeId:scope,name:v.name??'self',assignments:[]};bindings.set(id,b);f.bindings.push(b);}return b;};
 const site=(kind:string,e:Expr,ownerId:string)=>{const v:Site={id:`${f.scriptId}:site:${kind}:${e.span.startByte}:${e.span.endByte}`,ownerId,sourceId:f.sourceId,span:e.span,kind,expression:e,status:'unresolved',targetIds:[],assumptions:[],contexts:['unknown']};f.sites.push(v);};
 const expr=(v:any,owner:string,scope:string,mode:'read'|'write'|'callee'|'none'='read',name?:string):Expr=>{
  if(!v)return {kind:'unknown',span:fallback,reason:'MISSING_EXPRESSION'};const span=loc(v),base={span};
  switch(v.type){
   case 'AstExprConstantNil':return {...base,kind:'literal',value:null};
   case 'AstExprConstantBool':case 'AstExprConstantNumber':case 'AstExprConstantInteger':case 'AstExprConstantString':return {...base,kind:'literal',value:v.value};
   case 'AstExprLocal':return {...base,kind:'binding',bindingId:bid(v.local)};
   case 'AstExprGlobal':return {...base,kind:'global',name:v.global,unshadowed:true};
   case 'AstExprGroup':case 'AstExprTypeAssertion':return {...expr(v.expr,owner,scope,mode,name),span};
   case 'AstExprIndexName':case 'AstExprIndexExpr':{const e:Expr={...base,kind:'index',base:expr(v.expr,owner,scope,'none'),key:v.type==='AstExprIndexName'?{kind:'literal',value:v.index,span:loc(v)}:expr(v.index,owner,scope,'read')};if(mode==='read'||mode==='write')site(mode,e,owner);return e;}
   case 'AstExprCall':{const e:Expr={...base,kind:'call',callee:expr(v.func,owner,scope,'callee'),args:(v.args??[]).map((a:any)=>expr(a,owner,scope,'read')),colon:!!v.self};site('call',e,owner);return e;}
   case 'AstExprTable':return {...base,kind:'table',entries:(v.items??[]).map((item:any,n:number)=>({key:item.kind==='List'?String(n+1):(item.key?.value===undefined?null:String(item.key.value)),value:expr(item.value,owner,scope,'read'),span:loc(item.key??item.value)}))};
   case 'AstExprFunction':{
    let id=functions.get(span.startByte);if(id)return {...base,kind:'function',symbolId:id};id=`${f.scriptId}:fn:${span.startByte}`;functions.set(span.startByte,id);
    const childScope=`${f.scriptId}:scope:${span.startByte}`;const symbol={id,ownerId:f.scriptId,name:name??v.debugname??`callback@${span.startLine}`,span,parameters:(v.args??[]).map((a:any)=>a.name),bodyScopeId:childScope};f.symbols.push(symbol);
    for(const a of [v.self,...(v.args??[])].filter(Boolean))binding(a,childScope);
    stat(v.body,id,childScope);return {...base,kind:'function',symbolId:id};
   }
   default:{for(const [key,child]of Object.entries(v)){if(['span','location','luauType','annotation'].includes(key))continue;if(Array.isArray(child)){for(const x of child)if(x?.type?.startsWith('AstExpr'))expr(x,owner,scope);}else if(child&&typeof child==='object'&&(child as any).type?.startsWith('AstExpr'))expr(child,owner,scope);}
    return {...base,kind:'unknown',reason:`UNSUPPORTED_EXPRESSION:${v.type}`};}
  }
 };
 const assign=(target:Expr,value:Expr,owner:string)=>{if(target.kind==='binding'){const b=bindings.get(target.bindingId as string);b?.assignments.push({span:target.span,value});}else if(target.kind==='index')(f.members as any[]).push({target,value,ownerId:owner});else if(target.kind==='global')(f.globalAssignments as any[]).push({name:target.name,value,span:target.span});};
 const stat=(v:any,owner:string,scope:string):void=>{
  if(!v)return;
  switch(v.type){
   case 'AstStatBlock':{const childScope=`${f.scriptId}:scope:${loc(v).startByte}`;f.scopes.push({id:childScope,parentId:scope===childScope?null:scope,startByte:loc(v).startByte,endByte:loc(v).endByte});for(const s of v.body??[])stat(s,owner,childScope);break;}
   case 'AstStatLocal':{for(let n=0;n<v.vars.length;n++){const b=binding(v.vars[n],scope);b.initializer=expr(v.values[n],owner,scope,'read',b.name);}break;}
   case 'AstStatLocalFunction':{const b=binding(v.name,scope);b.initializer=expr(v.func,owner,scope,'read',b.name);break;}
   case 'AstStatFunction':{const target=expr(v.name,owner,scope,'none'),name=target.kind==='index'?String((target.key as Expr).value):String(target.name??'function');assign(target,expr(v.func,owner,scope,'none',name),owner);break;}
   case 'AstStatAssign':{for(let n=0;n<v.vars.length;n++)assign(expr(v.vars[n],owner,scope,'write'),expr(v.values[n],owner,scope),owner);break;}
   case 'AstStatCompoundAssign':{const target=expr(v.var,owner,scope,'write');site('read',target,owner);expr(v.value,owner,scope);if(target.kind==='binding')assign(target,{kind:'unknown',span:loc(v),reason:'COMPOUND_REASSIGNMENT'},owner);break;}
   case 'AstStatExpr':expr(v.expr,owner,scope);break;
   case 'AstStatReturn':{const list=(v.list??[]).map((x:any)=>expr(x,owner,scope));if(owner===f.scriptId){f.returnExpr=list[0];f.exports.push(...list.map((value:Expr)=>({keyPath:[],value,span:value.span})));}break;}
   case 'AstStatTypeAlias':case 'AstStatTypeFunction':case 'AstStatDeclareClass':case 'AstStatDeclareFunction':break;
   default:for(const [key,child]of Object.entries(v)){if(['span','location','luauType','annotation'].includes(key))continue;const walk=(x:any)=>{if(x?.type?.startsWith('AstStat'))stat(x,owner,scope);else if(x?.type?.startsWith('AstExpr'))expr(x,owner,scope);else if(x?.type==='AstLocal')binding(x,scope);};if(Array.isArray(child))child.forEach(walk);else walk(child);}break;
  }
 };
 stat(parsed.ast,f.scriptId,`${f.scriptId}:scope:0`);
 const unique=new Map(f.sites.map(s=>[s.id,s]));f.sites=[...unique.values()];return f;
}
