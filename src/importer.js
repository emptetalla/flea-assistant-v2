const crypto=require('node:crypto');const {parseMercari}=require('./mercari');
const fields=['site_title','site_description','site_hashtags_text','price','status','source_status','listed_at','ended_at'];
function importMercari(db,buffer,filename){
 const summary={total:0,newProducts:0,newListings:0,updated:0,unchanged:0,review:0,errors:0};let rows,parseError;
 try{rows=parseMercari(buffer);}catch(error){parseError=error.message;rows=[];}
 db.exec('BEGIN IMMEDIATE');
 try{
  const batchId=Number(db.prepare('INSERT INTO import_batches(site,filename,file_hash,status) VALUES(?,?,?,?)').run('mercari',filename,crypto.createHash('sha256').update(buffer).digest('hex'),parseError?'failed':'completed').lastInsertRowid);
  if(parseError){summary.errors=1;db.prepare('INSERT INTO import_rows(batch_id,row_number,raw_json,outcome,reason) VALUES(?,?,?,?,?)').run(batchId,0,'{}','error',parseError);}
  for(const row of rows){
   summary.total++;
   const rowId=Number(db.prepare('INSERT INTO import_rows(batch_id,row_number,raw_json,parsed_json,outcome,reason) VALUES(?,?,?,?,?,?)').run(batchId,row.rowNumber,JSON.stringify(row.raw),row.data?JSON.stringify(row.data):null,row.reason?'review':'unchanged',row.reason).lastInsertRowid);
   if(row.reason){summary.review++;db.prepare('INSERT INTO import_review_items(import_row_id,reason_code,reason) VALUES(?,?,?)').run(rowId,row.code,row.reason);continue;}
   const data=row.data;const existing=db.prepare("SELECT * FROM listings WHERE site='mercari' AND site_item_id=?").get(data.site_item_id);
   let productId,listingId,outcome;
   if(existing){
    productId=existing.product_id;listingId=existing.id;
    for(const [key,present]of [['site_description','description'],['site_hashtags_text','hashtags'],['price','price'],['listed_at','listed'],['ended_at','ended']])if(!row.present[present])data[key]=existing[key];
    const changed=fields.some(k=>existing[k]!==data[k]);outcome=changed?'updated':'unchanged';summary[outcome]++;
    if(changed)db.prepare(`UPDATE listings SET ${fields.map(k=>k+'=?').join(',')},last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),import_row_id=? WHERE id=?`).run(...fields.map(k=>data[k]),rowId,listingId);
    else db.prepare("UPDATE listings SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(listingId);
   }else{
    productId=Number(db.prepare('INSERT INTO products(master_title,master_description,hashtags_text,lifecycle_status) VALUES(?,?,?,?)').run(data.site_title,data.site_description,data.site_hashtags_text,data.status==='sold'?'sold':data.status==='ended'?'withdrawn':'active').lastInsertRowid);
    listingId=Number(db.prepare(`INSERT INTO listings(product_id,site,site_item_id,${fields.join(',')},import_row_id,link_method) VALUES(?,'mercari',?,${fields.map(()=>'?').join(',')},?,'mercari_initial')`).run(productId,data.site_item_id,...fields.map(k=>data[k]),rowId).lastInsertRowid);
    summary.newProducts++;summary.newListings++;outcome='new';
   }
   db.prepare('UPDATE import_rows SET outcome=?,product_id=?,listing_id=? WHERE id=?').run(outcome,productId,listingId,rowId);
  }
  db.prepare('UPDATE import_batches SET summary_json=?,error_message=? WHERE id=?').run(JSON.stringify(summary),parseError||null,batchId);
  db.exec('COMMIT');return batchId;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={importMercari};
