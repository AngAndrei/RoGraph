import {createHash} from 'node:crypto';
export const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export function canonical(v:unknown):string {if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(v)??'null';}
export class RoGraphError extends Error {constructor(public code:string,message:string){super(message);}}
