(()=>{
 const form=document.getElementById('bulk-category'),table=document.querySelector('.compact-products');if(!form||!table)return;
 const key='flea-list-position';
 const signature=()=>{const q=new URLSearchParams(location.search);q.delete('updated');for(const [k,v] of [...q])if(!v)q.delete(k);q.sort();return q.toString();};
 form.addEventListener('submit',event=>{if(event.defaultPrevented)return;try{sessionStorage.setItem(key,JSON.stringify({query:signature(),windowY:window.scrollY,top:table.scrollTop,left:table.scrollLeft,time:Date.now()}));}catch{}});
 try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved){sessionStorage.removeItem(key);if(saved.query===signature()&&Date.now()-saved.time<1800000)requestAnimationFrame(()=>{table.scrollTop=saved.top;table.scrollLeft=saved.left;window.scrollTo(0,saved.windowY);});}}catch{}
})();
