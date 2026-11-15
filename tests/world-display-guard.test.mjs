import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {createWorldDisplayGuard} from '../src/world-display-guard.mjs';
const {JSDOM}=createRequire(process.env.JSDOM_DIR||'/tmp/jsd/')('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,0));
const setup=()=>{const dom=new JSDOM('<select id="world_editor_select"><option>A</option><option>B</option></select><div id="world_popup_entries_list"></div>');const doc=dom.window.document,list=doc.getElementById('world_popup_entries_list'),guard=createWorldDisplayGuard(doc);guard.start();return {dom,doc,list,guard};};
function row(doc,uid,value='same'){const node=doc.createElement('div');node.className='world_entry';node.setAttribute('uid',uid);const field=doc.createElement('textarea');field.name='comment';field.value=value;node.append(field);return node;}
test('只隐藏相同UID与字段的重复显示，保留原节点和值，销毁可还原',async()=>{
 const {dom,doc,list,guard}=setup(),a=row(doc,'0'),b=row(doc,'0');let clicks=0;a.onclick=()=>clicks++;list.append(a,b);await tick();
 assert.equal(list.children.length,2);assert.equal(a.classList.contains('tvrm-world-duplicate'),false);assert.equal(b.classList.contains('tvrm-world-duplicate'),true);a.click();await tick();assert.equal(clicks,1);assert.equal(b.querySelector('textarea').value,'same');
 guard.destroy();assert.equal(b.className,'world_entry');dom.window.close();
});
test('同名不同UID、不同字段和编辑中的条目不能被误隐藏',async()=>{
 const {dom,doc,list,guard}=setup();const rows=[row(doc,'1','title'),row(doc,'2','title'),row(doc,'1','edited')];list.append(...rows);await tick();assert.equal(list.querySelectorAll('.tvrm-world-duplicate').length,0);
 const focused=row(doc,'2','title');list.append(focused);focused.querySelector('textarea').focus();await tick();assert.equal(focused.classList.contains('tvrm-world-duplicate'),false);assert.equal(rows[1].classList.contains('tvrm-world-duplicate'),true);guard.destroy();dom.window.close();
});
test('原生换页和列表重建后重新判定，不把上一页的隐藏带过去',async()=>{
 const {dom,doc,list,guard}=setup();list.append(row(doc,'1'),row(doc,'1'));await tick();const old=list.lastElementChild;
 list.replaceChildren(row(doc,'1'),row(doc,'2'));await tick();assert.equal(list.querySelectorAll('.tvrm-world-duplicate').length,0);assert.equal(old.classList.contains('tvrm-world-duplicate'),false);
 const next=doc.createElement('div');next.id=list.id;list.replaceWith(next);next.append(row(doc,'3'),row(doc,'3'));await tick();assert.equal(next.querySelectorAll('.tvrm-world-duplicate').length,1);guard.destroy();dom.window.close();
});
