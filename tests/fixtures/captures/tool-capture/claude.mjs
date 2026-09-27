import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const base=resolve('reports/tool-capture/claude');
const project=resolve(base,'project');const config=resolve(base,'config');
mkdirSync(project,{recursive:true});mkdirSync(config,{recursive:true});
const raw=resolve(base,'raw.jsonl');
if(existsSync(raw))throw Error('capture exists');
const target=resolve(project,'intent.md');
const recorder=resolve(base,'record.mjs');
writeFileSync(recorder,`import {appendFileSync} from 'node:fs';let text='';for await (const chunk of process.stdin) text+=chunk;appendFileSync(process.argv[2],JSON.stringify(JSON.parse(text))+'\\n');\n`);
const command={type:'command',command:'node',args:[recorder,raw]};
writeFileSync(resolve(base,'settings.json'),JSON.stringify({hooks:{PreToolUse:[{matcher:'Write',hooks:[command]}],PostToolUse:[{matcher:'Write',hooks:[command]}]}},null,2));
let turns=0;
const server=createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;
 const value=JSON.parse(body||'{}');
 if(req.url.includes('count_tokens')){res.setHeader('Content-Type','application/json');res.end('{"input_tokens":100}');return;}
 if(!req.url.startsWith('/v1/messages')){res.writeHead(404).end();return;}
 const use=turns++===0;
 writeFileSync(resolve(base,'request-summary.json'),JSON.stringify({tools:value.tools?.map(t=>t.name),stream:value.stream,turns}));
 const content=use?[{type:'tool_use',id:'toolu_vouch_capture_write',name:'Write',input:{file_path:target,content:'---\nstatus: draft\n---\n# Capture only\n'}}]:[{type:'text',text:'Local fixture exercise completed.'}];
 const msg={id:`msg_capture_${turns}`,type:'message',role:'assistant',model:value.model,content,stop_reason:use?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:20}};
 if(!value.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(msg));return;}
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const emit=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
 emit('message_start',{message:{...msg,content:[],stop_reason:null}});
 if(use){emit('content_block_start',{index:0,content_block:{...content[0],input:{}}});emit('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(content[0].input)}});}
 else {emit('content_block_start',{index:0,content_block:{type:'text',text:''}});emit('content_block_delta',{index:0,delta:{type:'text_delta',text:content[0].text}});}
 emit('content_block_stop',{index:0});emit('message_delta',{delta:{stop_reason:msg.stop_reason,stop_sequence:null},usage:{output_tokens:20}});emit('message_stop',{});res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|windir|temp|tmp|userprofile|comspec)$/i.test(k)));
Object.assign(env,{CLAUDE_CONFIG_DIR:config,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'local-fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
const cli=spawn('C:/Users/saedg/.local/bin/claude.exe',['--print','Exercise the Write tool in the isolated fixture project.','--restricted','--strict-mcp-config','--no-session-persistence','--settings',resolve(base,'settings.json'),'--tools','Write','--allowedTools','Write','--permission-mode','acceptEdits','--max-turns','2'],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let out='',err='';cli.stdout.on('data',x=>out+=x);cli.stderr.on('data',x=>err+=x);
const timer=setTimeout(()=>cli.kill(),45000);
const code=await new Promise(r=>cli.on('exit',r));clearTimeout(timer);server.close();
writeFileSync(resolve(base,'stdout.log'),out);writeFileSync(resolve(base,'stderr.log'),err);
console.log({code,turns,captured:existsSync(raw)?readFileSync(raw,'utf8'):'none',written:existsSync(target)});
