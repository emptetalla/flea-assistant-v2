const bulkForm=document.getElementById('bulk-category');
if(bulkForm){
 const boxes=[...bulkForm.querySelectorAll('input[name="product_ids"]')];
 let anchor=null;
 const update=()=>{const count=boxes.filter(b=>b.checked).length;document.getElementById('selected-count').textContent=count+'件選択';const dock=document.getElementById('bulk-dock');if(dock)dock.hidden=count===0;};
 const selectAll=checked=>{boxes.forEach(b=>{b.checked=checked;});anchor=null;update();};
 bulkForm.querySelector('[data-select-all]').addEventListener('click',()=>selectAll(true));
 bulkForm.querySelector('[data-clear-all]').addEventListener('click',()=>selectAll(false));
 boxes.forEach((box,index)=>{
  box.addEventListener('click',event=>{
   // Native click toggles checked before this handler; use that new state for the range.
   if(event.shiftKey&&anchor!==null){const checked=box.checked;for(let i=Math.min(anchor,index);i<=Math.max(anchor,index);i++)boxes[i].checked=checked;}
   anchor=index;update();
  });
  box.addEventListener('change',update);
 });
 bulkForm.addEventListener('submit',event=>{if(!boxes.some(b=>b.checked)){event.preventDefault();document.getElementById('selected-count').textContent='商品を選択してください';}});
 update();
}
