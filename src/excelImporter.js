const crypto=require('node:crypto');
const {parseExcelListings}=require('./excelListings');const {parseYahooMapping}=require('./yahooMapping');
const fields=['site_title','site_description','site_hashtags_text','price','status','source_status'];
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
async function importExcel(db,site,buffer,filename,options={}) {
  if(!['yahoo','rakuma'].includes(site))throw new Error('未対応サイトです');
  let rows=[],mapping={records:[],byId:new Map()},parseError=null;
  try{
    rows=await parseExcelListings(buffer,site,options.sheetName);
    if(site==='yahoo')mapping=await parseYahooMapping(options.mappingBuffer,rows,options);
  }catch(error){parseError=error.message;}
  const summary={total:0,newProducts:0,newListings:0,updated:0,unchanged:0,review:0,errors:0,
    matched:0,only:0,exact:0,known:0,excluded:0,hold:0,hyperlinkIds:0,urlTextIds:0,idColumnIds:0,
    mappingReview:mapping.records.filter(r=>r.reason).length,
    mappingFilename:options.mappingFilename||null,mappingHash:options.mappingBuffer?digest(options.mappingBuffer):null,
    mappingAudit:mapping.records};
  db.exec('BEGIN IMMEDIATE');
  try{
    const batchId=Number(db.prepare('INSERT INTO import_batches(site,filename,file_hash,status) VALUES(?,?,?,?)').run(site,filename,digest(buffer),parseError?'failed':'completed').lastInsertRowid);
    if(parseError){summary.errors=1;db.prepare('INSERT INTO import_rows(batch_id,row_number,raw_json,outcome,reason) VALUES(?,?,?,?,?)').run(batchId,0,'{}','error',parseError);}
    else for(const row of rows){
      summary.total++;
      if(row.extraction.id){if(['hyperlink','formula_hyperlink'].includes(row.extraction.method))summary.hyperlinkIds++;else if(row.extraction.method==='url_text')summary.urlTextIds++;else if(row.extraction.method==='id_column')summary.idColumnIds++;}
      const data={...row.data};const entry=site==='yahoo'?mapping.byId.get(data.site_item_id):null;
      const audit={...data,extraction:row.extraction,mapping:entry||null,decision:null,candidateProductIds:[]};
      const rowId=Number(db.prepare('INSERT INTO import_rows(batch_id,row_number,raw_json,parsed_json,outcome) VALUES(?,?,?,?,?)').run(batchId,row.rowNumber,JSON.stringify(row.raw),JSON.stringify(audit),'unchanged').lastInsertRowid);
      const finish=(outcome,decision,reason,productId=null,listingId=null)=>{
        audit.decision=decision;
        db.prepare('UPDATE import_rows SET outcome=?,parsed_json=?,reason=?,product_id=?,listing_id=? WHERE id=?').run(outcome,JSON.stringify(audit),reason,productId,listingId,rowId);
      };
      const review=(reason,code='review',candidates=[])=>{
        summary.review++;if(code==='hold')summary.hold++;audit.candidateProductIds=candidates;
        finish('review',code,reason);
        db.prepare('INSERT INTO import_review_items(import_row_id,reason_code,reason,candidate_product_ids_json) VALUES(?,?,?,?)').run(rowId,code,reason,JSON.stringify(candidates));
      };
      if(row.reason){review(row.reason,'input');continue;}
      if(entry?.reason){review(entry.reason,'mapping');continue;}
      if(entry?.decision==='hold'){review('Yahoo対応表でhold（保留）に指定されています','hold');continue;}
      if(entry?.decision==='exclude'){
        summary.excluded++;
        // 既存CHECK制約と互換: 非変更をoutcomeに、明確な除外判定をparsed_jsonに保存。
        finish('unchanged','exclude','Yahoo対応表でexclude（今回の対象外）に指定されています');continue;
      }
      const existing=db.prepare('SELECT * FROM listings WHERE site=? AND site_item_id=?').get(site,data.site_item_id);
      let productId=existing?.product_id,method=existing?.link_method,decision='known_site_id';
      if(site==='yahoo'){
        if(entry?.decision==='matched'){
          const target=db.prepare("SELECT product_id FROM listings WHERE site='mercari' AND site_item_id=?").get(entry.mercariId);
          if(!target){review('対応表のMercari商品IDがV2にありません','missing_mercari');continue;}
          if(existing&&existing.product_id!==target.product_id){review('既存Yahoo出品の関連付けと対応表が矛盾します','conflict');continue;}
          productId=target.product_id;method='yahoo_mapping';decision='matched';
        }else if(entry?.decision==='yahoo_only'){
          const stored=db.prepare('SELECT * FROM yahoo_initial_mappings WHERE yahoo_site_item_id=?').get(data.site_item_id);
          if(existing&&(!stored||stored.decision!=='yahoo_only'||stored.product_id!==existing.product_id)){
            review('既存Yahoo出品はYahoo-onlyとして登録されたものではありません','conflict');continue;
          }
          decision='yahoo_only';method='yahoo_mapping';
        }else if(!existing){review('Yahoo対応表で確定していません','mapping_missing');continue;}
        if(entry){
          const stored=db.prepare('SELECT * FROM yahoo_initial_mappings WHERE yahoo_site_item_id=?').get(data.site_item_id);
          if(stored&&(stored.decision!==entry.decision||(stored.mercari_site_item_id||'')!==(entry.decision==='matched'?entry.mercariId:''))){review('保存済み対応表と今回の指定が矛盾します','conflict');continue;}
        }
      }else if(!existing){
        const candidates=db.prepare('SELECT id FROM products WHERE master_title=? COLLATE BINARY').all(data.site_title);
        audit.candidateProductIds=candidates.map(p=>p.id);
        if(candidates.length!==1){review(candidates.length?'商品タイトルの完全一致が複数商品あります':'商品タイトルの完全一致がありません',candidates.length?'multiple_exact':'no_exact',audit.candidateProductIds);continue;}
        productId=candidates[0].id;method='rakuma_exact';decision='exact';
      }
      if(!productId){
        // Yahoo-onlyで確定した行だけ商品を新規作成。既存productsへのUPDATEは一切しない。
        if(site!=='yahoo'||decision!=='yahoo_only')throw new Error('未確定商品の作成を拒否');
        productId=Number(db.prepare('INSERT INTO products(master_title,master_description,hashtags_text,lifecycle_status) VALUES(?,?,?,?)').run(data.site_title,data.site_description,data.site_hashtags_text,data.status==='sold'?'sold':data.status==='ended'?'withdrawn':'active').lastInsertRowid);
        summary.newProducts++;
      }
      let listingId=existing?.id,outcome;
      if(existing){
        for(const [field,key] of [['site_description','description'],['site_hashtags_text','hashtags'],['price','price']])if(!row.present[key])data[field]=existing[field];
        const changed=fields.some(key=>data[key]!==existing[key]);outcome=changed?'updated':'unchanged';summary[outcome]++;
        if(changed)db.prepare(`UPDATE listings SET ${fields.map(k=>k+'=?').join(',')},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),import_row_id=? WHERE id=?`).run(...fields.map(k=>data[k]),rowId,listingId);
        else db.prepare("UPDATE listings SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(listingId);
        summary.known++;
      }else{
        listingId=Number(db.prepare(`INSERT INTO listings(product_id,site,site_item_id,${fields.join(',')},import_row_id,link_method) VALUES(?,?,?,${fields.map(()=>'?').join(',')},?,?)`).run(productId,site,data.site_item_id,...fields.map(k=>data[k]),rowId,method).lastInsertRowid);
        outcome='new';summary.newListings++;
      }
      if(decision==='matched')summary.matched++;
      if(decision==='yahoo_only')summary.only++;
      if(decision==='exact')summary.exact++;
      finish(outcome,decision,null,productId,listingId);
      if(site==='yahoo'&&entry){
        db.prepare('INSERT INTO yahoo_initial_mappings(yahoo_site_item_id,decision,mercari_site_item_id,product_id,import_row_id,note) VALUES(?,?,?,?,?,?) ON CONFLICT(yahoo_site_item_id) DO NOTHING').run(data.site_item_id,entry.decision,entry.decision==='matched'?entry.mercariId:null,productId,rowId,entry.joinMethod);
      }
    }
    db.prepare('UPDATE import_batches SET summary_json=?,error_message=? WHERE id=?').run(JSON.stringify(summary),parseError,batchId);
    db.exec('COMMIT');return batchId;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={importExcel};
