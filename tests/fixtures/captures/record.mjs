import { appendFileSync } from 'node:fs';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const value = JSON.parse(text);
appendFileSync(process.argv[2], JSON.stringify(value) + '\n');
if (value.hook_event_name === 'UserPromptSubmit') {
  process.stderr.write('VOUCH-CAPTURE: recorded; do not send a model request.');
  process.exitCode = 2;
}