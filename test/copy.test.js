const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function setup(denied=false,fallback=true){
 const elements={'copy-title':{value:'タイトル'},'copy-description':{value:'説明\n次の行'},'copy-hashtags':{value:'#タグ'},'copy-message':{textContent:''}};
 const state={copied:null,removed:false};let handler;
 const document={addEventListener:(name,fn)=>{handler=fn;},getElementById:id=>elements[id],body:{append:()=>{}},createElement:()=>({value:'',setAttribute:()=>{},select(){state.copied=this.value;},remove:()=>{state.removed=true;}}),execCommand:()=>fallback};
 vm.runInNewContext(fs.readFileSync('public/copy.js','utf8'),{document,window:{isSecureContext:true},navigator:{clipboard:{writeText:async text=>{if(denied)throw Error('denied');state.copied=text;}}}});
 return {state,elements,click:async key=>handler({target:{closest:()=>({hasAttribute:()=>key==='all',dataset:{copy:key}})}})};
}
test('コピー: 個別の原稿をそのまま、全部は空行区切り',async()=>{
 const s=setup();await s.click('description');assert.equal(s.state.copied,'説明\n次の行');
 await s.click('all');assert.equal(s.state.copied,'タイトル\n\n説明\n次の行\n\n#タグ');assert.equal(s.elements['copy-message'].textContent,'コピーしました');
 s.elements['copy-description'].value='';await s.click('all');assert.equal(s.state.copied,'タイトル\n\n#タグ');
});
test('コピー: Clipboard API拒否時の代替と失敗表示',async()=>{
 const s=setup(true);await s.click('title');assert.equal(s.state.copied,'タイトル');assert.equal(s.state.removed,true);
 const failed=setup(true,false);await failed.click('title');assert.match(failed.elements['copy-message'].textContent,/コピーできませんでした/);
});
