async function copyText(text){
 if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(text);return;}catch(error){/* 手動コピーへフォールバック */}}
 const field=document.createElement('textarea');field.value=text;field.setAttribute('aria-label','コピー対象');document.body.append(field);field.select();
 const ok=document.execCommand('copy');field.remove();if(!ok)throw new Error('copy failed');
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-copy],[data-copy-all]');if(!button)return;
 const keys=button.hasAttribute('data-copy-all')?['title','description','hashtags']:[button.dataset.copy];
 const text=keys.map(key=>document.getElementById('copy-'+key).value).filter(Boolean).join('\n\n');
 const message=document.getElementById('copy-message');
 try{await copyText(text);message.textContent='コピーしました';}catch(error){message.textContent='コピーできませんでした。原稿欄を選択してコピーしてください。';}
});
