function categoryCandidate(title,categories){const match=/^(?:\[([^\]]+)\]|【([^】]+)】)/.exec(title);return match?categories.find(c=>c.name===(match[1]||match[2]))||null:null;}
function selection(db,body){
 const raw=Array.isArray(body.product_ids)?body.product_ids:body.product_ids?[body.product_ids]:[];
 if(!raw.length||raw.length>5000||raw.some(id=>!/^\d+$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)<=0))throw new Error('商品を選択してください（最大5000件）');
 const ids=[...new Set(raw.map(Number))];const category=db.prepare('SELECT * FROM management_categories WHERE id=? AND is_active=1').get(String(body.category_id||''));if(!category)throw new Error('変更先カテゴリを選択してください');
 const get=db.prepare('SELECT id,master_title,category_id FROM products WHERE id=?');const products=ids.map(id=>get.get(id));if(products.some(p=>!p))throw new Error('選択した商品が存在しません。一覧から選び直してください');return {ids,category,products};
}
function updateCategory(db,body){db.exec('BEGIN IMMEDIATE');try{const selected=selection(db,body);const update=db.prepare('UPDATE products SET category_id=? WHERE id=?');for(const id of selected.ids)update.run(selected.category.id,id);db.exec('COMMIT');return selected.ids.length;}catch(e){db.exec('ROLLBACK');throw e;}}
module.exports={categoryCandidate,selection,updateCategory};
