// 本番をreadOnlyで読むだけ。すべての取込は:memory:で実行する。
const fs=require('node:fs');const crypto=require('node:crypto');const assert=require('node:assert/strict');const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');const {openDb}=require('../src/db');const {importExcel}=require('../src/excelImporter');
function hashFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function snapshot(db){
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
 return Object.fromEntries(tables.map(({name})=>{
  if(!/^[a-z_]+$/.test(name))throw new Error('Unexpected table name');
  return [name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()];
 }));
}
function clone(source){
 const db=openDb(':memory:');db.exec('PRAGMA foreign_keys=OFF; BEGIN');
 try{
  for(const [table,rows] of Object.entries(source)){
   db.prepare(`DELETE FROM "${table}"`).run();
   if(!rows.length)continue;
   const columns=Object.keys(rows[0]);const stmt=db.prepare(`INSERT INTO "${table}"(${columns.map(c=>'"'+c+'"').join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
   for(const row of rows)stmt.run(...columns.map(c=>row[c]));
  }
  db.exec('COMMIT; PRAGMA foreign_keys=ON;');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);return db;
 }catch(error){db.exec('ROLLBACK');db.close();throw error;}
}
async function main(){
 const [dbPath,yahooFile,mappingFile,rakumaFile,...flags]=process.argv.slice(2);
 if(!rakumaFile)throw new Error('Usage: node scripts/validate-excel-imports.js DB YAHOO_XLSX MAPPING_XLSX RAKUMA_XLSX [--join-yahoo-title-price] [--legacy-zero-as-only]');
 const beforeHash=hashFile(dbPath);const production=new DatabaseSync(dbPath,{readOnly:true});
 production.exec('BEGIN');const baseline=snapshot(production);production.exec('ROLLBACK');production.close();
 const db=clone(baseline);const baselineIds=baseline.products.map(p=>p.id);
 const options={mappingBuffer:fs.readFileSync(mappingFile),mappingFilename:path.basename(mappingFile),joinByTitlePrice:flags.includes('--join-yahoo-title-price'),legacyZeroAsOnly:flags.includes('--legacy-zero-as-only')};
 const report={baselineProducts:baselineIds.length,runs:[]};
 try{
  for(let run=1;run<=2;run++){
   for(const [site,file,opt]of [['yahoo',yahooFile,options],['rakuma',rakumaFile,{}]]){
    const batchId=await importExcel(db,site,fs.readFileSync(file),path.basename(file),opt);
    const summary=JSON.parse(db.prepare('SELECT summary_json FROM import_batches WHERE id=?').get(batchId).summary_json);
    const {mappingAudit,...counts}=summary;
    const reviews=db.prepare("SELECT r.reason_code,count(*) n FROM import_review_items r JOIN import_rows i ON i.id=r.import_row_id WHERE i.batch_id=? GROUP BY r.reason_code").all(batchId);
    const unresolved=db.prepare("SELECT row_number,reason,parsed_json FROM import_rows WHERE batch_id=? AND outcome='review'").all(batchId).map(r=>({row:r.row_number,title:JSON.parse(r.parsed_json)?.site_title,reason:r.reason}));
    report.runs.push({run,site,batchId,summary:counts,reviews,unresolved});
    assert.equal(counts.errors,0,'Parse errors');
    assert.equal(counts.total,counts.newListings+counts.updated+counts.unchanged+counts.review+counts.excluded);
    if(run===2){assert.equal(counts.newProducts,0);assert.equal(counts.newListings,0);assert.equal(counts.updated,0);}
   }
   const actual=db.prepare(`SELECT * FROM products WHERE id IN(${baselineIds.map(()=>'?').join(',')}) ORDER BY id`).all(...baselineIds);
   assert.deepEqual(actual,baseline.products);
   assert.deepEqual(db.prepare("SELECT * FROM listings WHERE site='mercari' ORDER BY id").all(),baseline.listings.filter(l=>l.site==='mercari'));
   if(run===1)report.afterFirst={products:db.prepare('SELECT count(*) n FROM products').get().n,listings:db.prepare('SELECT count(*) n FROM listings').get().n};
   else assert.deepEqual({products:db.prepare('SELECT count(*) n FROM products').get().n,listings:db.prepare('SELECT count(*) n FROM listings').get().n},report.afterFirst);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  report.finalSites=db.prepare('SELECT site,status,count(*) n FROM listings GROUP BY site,status').all();
  const after=new DatabaseSync(dbPath,{readOnly:true});after.exec('BEGIN');assert.deepEqual(snapshot(after),baseline);after.exec('ROLLBACK');after.close();assert.equal(hashFile(dbPath),beforeHash);
  report.productionUnchanged=true;report.existingMastersUnchanged=true;console.log(JSON.stringify(report,null,2));
 }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
