const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {DatabaseSync}=require('node:sqlite');const {openDb}=require('./db');
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
function createBackupManager(dbPath,dir){
 let current=openDb(dbPath);fs.mkdirSync(dir,{recursive:true});
 const db=new Proxy({}, {get:(_,key)=>{const value=current[key];return typeof value==='function'?value.bind(current):value;}});
 function target(name){if(typeof name!=='string'||path.basename(name)!==name||!name.endsWith('.db')||name.includes('..'))throw new Error('バックアップ名が不正です');const file=path.join(dir,name);if(fs.lstatSync(file).isSymbolicLink())throw new Error('リンクファイルは利用できません');return file;}
 function inspect(name){const file=target(name);let source;try{source=new DatabaseSync(file,{readOnly:true});if(source.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||source.prepare('PRAGMA foreign_key_check').all().length)throw new Error('整合性検査に失敗しました');if(source.prepare('PRAGMA user_version').get().user_version!==1||JSON.stringify(schema(source))!==JSON.stringify(schema(current)))throw new Error('V2のDB構造と一致しません');return {name,createdAt:fs.statSync(file).mtime.toISOString(),products:source.prepare('SELECT count(*) n FROM products').get().n,listings:source.prepare('SELECT count(*) n FROM listings').get().n};}finally{source?.close();}}
 function create(prefix='manual'){const name='flea-v2_'+prefix+'_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomBytes(4).toString('hex')+'.db';current.prepare('VACUUM INTO ?').run(path.join(dir,name));return inspect(name);}
 function list(){return fs.readdirSync(dir).filter(n=>n.endsWith('.db')).map(name=>{try{return inspect(name);}catch(e){return {name,error:'破損または非対応のバックアップ',createdAt:null};}}).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));}
 function restore(name){
  inspect(name);const safety=create('before-restore');const file=target(name);let attached=false,inTransaction=false;
  try{
   current.prepare('ATTACH DATABASE ? AS restore_source').run(file);attached=true;
   if(current.prepare('PRAGMA restore_source.integrity_check').get().integrity_check!=='ok')throw new Error('復元対象の整合性検査に失敗しました');
   current.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');inTransaction=true;
   const tables=current.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
   for(const {name:table} of tables){if(!/^[a-z_]+$/.test(table))throw new Error('非対応のテーブル名');current.exec('DELETE FROM main."'+table+'"');current.exec('INSERT INTO main."'+table+'" SELECT * FROM restore_source."'+table+'"');}
   current.exec('DELETE FROM main.sqlite_sequence; INSERT INTO main.sqlite_sequence SELECT * FROM restore_source.sqlite_sequence');
   if(current.prepare('PRAGMA main.foreign_key_check').all().length||current.prepare('PRAGMA main.integrity_check').get().integrity_check!=='ok')throw new Error('復元後の整合性検査に失敗しました');
   current.exec('COMMIT');inTransaction=false;
  }catch(e){if(inTransaction)current.exec('ROLLBACK');throw e;}finally{if(attached)current.exec('DETACH DATABASE restore_source');current.exec('PRAGMA foreign_keys=ON');}
  const fresh=openDb(dbPath);const old=current;current=fresh;old.close();return safety;
 }
 return {db,create,list,inspect,restore,close:()=>current.close()};
}
module.exports={createBackupManager};
