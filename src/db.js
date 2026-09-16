const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');const path=require('node:path');
function openDb(filename){
 const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version>1){db.close();throw new Error('このアプリより新しいDBです');}
 if(version===0){db.exec('BEGIN IMMEDIATE');try{
  db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  const stmt=db.prepare('INSERT INTO management_categories(name,sort_order) VALUES(?,?)');
  ['ゲーム','アニメ・キャラクター','スポーツ','衣類','本・雑誌','食器','家電','雑貨','コレクション','その他'].forEach((name,i)=>stmt.run(name,i));
  db.exec('PRAGMA user_version=1; COMMIT');
 }catch(error){db.exec('ROLLBACK');db.close();throw error;}}
 return db;
}
const fmId=id=>'FM'+String(id).padStart(5,'0');
module.exports={openDb,fmId};
