// Native integration fixture: the real shared keyboard controller and stylesheet,
// isolated from accounts, billing and network data. Frame records contain geometry only.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const port = Number(process.env.MEMO_KEYBOARD_QA_PORT || 4198);
const output = process.env.MEMO_KEYBOARD_QA_OUTPUT || 'ios/build/keyboard-motion';
const source = readFileSync('src/components/keyboard-inset.tsx', 'utf8')
  .replace('import { useEffect } from "react";', 'const useEffect = (fn) => { window.disposeKeyboard = fn(); };');
const controller = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext}}).outputText.replace('export function KeyboardInset', 'function KeyboardInset');
const css = readFileSync('src/app/globals.css', 'utf8') + '\n' + readFileSync('src/app/redesign.css', 'utf8');
const html = (chat = false) => `<!doctype html><html data-native lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head>
<body class="memo"><div class="memo-portal">${chat ? `<section class="memo-sheet-full surface memo-note-chat-sheet" role="dialog" aria-label="Chat motion QA"><h2>Chat motion QA</h2><button id="dismiss" class="memo-btn">Dismiss keyboard</button><div class="memo-chat-log memo-scroll"><p>Synthetic chat message</p></div><div class="memo-chat-foot"><form class="memo-chat-input" onsubmit="return false" data-probe><input aria-label="Ask Memo" placeholder="Ask Memo"></form></div></section>` : `<section class="memo-dialog" role="dialog" aria-label="Keyboard motion QA">
<h2>Keyboard motion QA</h2><a href="/chat">Chat composer</a><label>First field<input class="memo-field" aria-label="First field" type="text"></label>
<label>Second field<textarea class="memo-field" aria-label="Second field" data-probe></textarea></label>
<button class="memo-btn" id="dismiss">Dismiss keyboard</button></section>`}</div>
<script>${controller}
KeyboardInset();
const records=[]; let until=0, raf=0;
function record(){
 const frame=window.memoNative?.keyboardFrame;
 const field=document.querySelector('[data-probe]');
 const sheet=document.querySelector('[role=dialog]');
 const button=document.querySelector('#dismiss');
 records.push({mode:'${chat ? 'chat' : 'form'}',time:performance.now(),native:frame,cssInset:parseFloat(document.documentElement.style.getPropertyValue('--memo-keyboard'))||0,fieldBottom:field.getBoundingClientRect().bottom,buttonBottom:button.getBoundingClientRect().bottom,sheetTop:sheet.getBoundingClientRect().top,viewport:visualViewport.height,focus:document.activeElement?.tagName});
 if(performance.now()<until)raf=requestAnimationFrame(record);else raf=0;
}
window.addEventListener('memo:keyboard',()=>{until=performance.now()+450;if(!raf)raf=requestAnimationFrame(record)});
document.querySelector('#dismiss').onclick=()=>{document.activeElement?.blur();setTimeout(()=>fetch('/frames',{method:'POST',body:JSON.stringify(records)}),1500)};
</script></body></html>`;
createServer((req,res)=>{
 if(req.url==='/frames'&&req.method==='POST') {let body='';req.on('data',d=>body+=d);req.on('end',()=>{writeFileSync(output+'-'+(JSON.parse(body)[0]?.mode === 'chat' ? 'chat' : 'form')+'-frames.json',body);res.end('saved')});return;}
 res.writeHead(200,{'content-type':'text/html'});res.end(html(req.url==='/chat'));
}).listen(port,'127.0.0.1',()=>console.log('Keyboard fixture on http://localhost:'+port));
