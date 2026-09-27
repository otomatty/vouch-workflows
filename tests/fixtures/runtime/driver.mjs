// Synthetic transport driver; this is not a product hook or a REG-2 emitter.
import { createAuditStore } from '../../../core/hooks/lib/audit.mjs';
import { readContext } from '../../../core/hooks/lib/env.mjs';
import { createFileStore } from '../../../core/hooks/lib/fs.mjs';
import { run } from '../../../core/hooks/lib/io.mjs';

const mode=process.argv[2];
const context=readContext();
const files=await createFileStore(context.projectRoot);
await run((input,ctx)=>{
  if(mode==='throw')throw new Error('synthetic handler failure');
  if(mode==='deny')return {decision:'deny',reason:'approval required'};
  if(mode==='emit')return {decision:'allow',events:[{
    id:ctx.newId(input.session_id,JSON.stringify(input)),v:1,type:'hook.check',
    ts:'2026-09-27T00:00:00.000Z',actor:'hook',synthetic:true,
    check:'format',result:'pass',duration_ms:0,
  }]};
  return {decision:'allow'};
},{audit:createAuditStore(files,'vouch/audit/events.jsonl')});
