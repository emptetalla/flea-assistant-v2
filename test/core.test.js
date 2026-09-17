const test=require('node:test');const assert=require('node:assert/strict');
const {openDb,fmId}=require('../src/db');const {importMercari}=require('../src/importer');const {parseMercari}=require('../src/mercari');
function csv(rows,header=['商品ID','商品名','商品説明','ハッシュタグ','status','商品代金']){
 return Buffer.from([header,...rows].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n'));
}
const summary=(db,id)=>JSON.parse(db.prepare('SELECT summary_json FROM import_batches WHERE id=?').get(id).summary_json);
function fresh(t){const db=openDb(':memory:');t.after(()=>db.close());return db;}
test('タイトルのみ登録・状態2軸・FM-ID・旧ID対応・写真制約',t=>{
 const db=fresh(t);const id=Number(db.prepare('INSERT INTO products(master_title) VALUES(?)').run('同名商品').lastInsertRowid);
 const p=db.prepare('SELECT * FROM products WHERE id=?').get(id);
 assert.equal(fmId(id),'FM00001');assert.equal(fmId(1234),'FM01234');assert.equal(fmId(100000),'FM100000');
 assert.equal(p.organization_status,'unorganized');assert.equal(p.lifecycle_status,'active');assert.equal(p.hashtags_text,'');
 assert.throws(()=>db.prepare("INSERT INTO products(master_title) VALUES(' ')").run());
 assert.throws(()=>db.prepare("UPDATE products SET organization_status='sold'").run());
 db.prepare('INSERT INTO legacy_product_links(product_id,legacy_product_id) VALUES(?,?)').run(id,43);
 db.prepare('INSERT INTO legacy_product_links(product_id,legacy_product_id) VALUES(?,?)').run(id,1350);
 assert.throws(()=>db.prepare('INSERT INTO product_photos(product_id,filename) VALUES(?,?)').run(id,'C:\\photos\\x.jpg'));
 db.prepare('INSERT INTO product_photos(product_id,filename) VALUES(?,?)').run(id,'FM00001_01.jpg');
 assert.throws(()=>db.prepare("INSERT INTO yahoo_initial_mappings(yahoo_site_item_id,decision) VALUES('z1','matched')").run());
});
test('同名は別商品・再取込は増殖せず・マスター全項目は保存',t=>{
 const db=fresh(t);const input=csv([['m1','同名','説明\n2行','#タグ','active',100],['m2','同名','','','sold',200]]);
 const first=summary(db,importMercari(db,input,'a.csv'));assert.equal(first.newProducts,2);assert.equal(first.newListings,2);
 assert.equal(db.prepare('SELECT count(*) n FROM products').get().n,2);
 db.prepare("UPDATE products SET master_title='編集済',master_description='手書き',hashtags_text='#保存',organization_status='ready',lifecycle_status='withdrawn',category_id=1 WHERE id=1").run();
 const before=db.prepare('SELECT * FROM products WHERE id=1').get();
 const second=summary(db,importMercari(db,input,'a.csv'));assert.equal(second.unchanged,2);assert.equal(second.newProducts,0);
 const changed=csv([['m1','サイト変更','新説明','#サイト','sold',300]]);
 assert.equal(summary(db,importMercari(db,changed,'b.csv')).updated,1);
 assert.deepEqual(db.prepare('SELECT * FROM products WHERE id=1').get(),before);
 assert.equal(db.prepare('SELECT site_title FROM listings WHERE id=1').get().site_title,'サイト変更');
 assert.equal(db.prepare('SELECT count(*) n FROM listings').get().n,2);
 assert.equal(db.prepare('SELECT status FROM listings WHERE id=2').get().status,'sold');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('列欠落でサイト原稿を消さない・新IDは同名でも別商品',t=>{
 const db=fresh(t);importMercari(db,csv([['m1','同名','説明','#タグ','active',100]]),'a.csv');
 importMercari(db,csv([['m1','同名','active']],['商品ID','商品名','status']),'b.csv');
 const listing=db.prepare('SELECT * FROM listings').get();assert.equal(listing.site_description,'説明');assert.equal(listing.price,100);
 importMercari(db,csv([['m2','同名','active']],['商品ID','商品名','status']),'c.csv');
 assert.equal(db.prepare('SELECT count(*) n FROM products').get().n,2);
});
test('不正ID・数量列ずれ・状態不明・CSV内重複は全て要確認で隔離',t=>{
 const db=fresh(t);const buffer=Buffer.from('商品ID,商品名,status\nm1,同名,active\nm1,同名,active\n,欠落,active\nm2,不明,???\nm3,カンマ,ずれ,active');
 const s=summary(db,importMercari(db,buffer,'bad.csv'));assert.equal(s.total,5);assert.equal(s.review,5);
 assert.equal(db.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM listings').get().n,0);
 assert.equal(db.prepare('SELECT count(*) n FROM import_review_items').get().n,5);
 assert.equal(db.prepare('SELECT count(*) n FROM import_rows WHERE product_id IS NOT NULL OR listing_id IS NOT NULL').get().n,0);
});
test('ファイル解析エラーを記録・取引日時とstatus矛盾を保留',t=>{
 const db=fresh(t);assert.equal(summary(db,importMercari(db,Buffer.from('x,y\n1,2'),'bad.csv')).errors,1);
 assert.equal(summary(db,importMercari(db,Buffer.from('商品ID,商品名,status\nm1,"破損,active'),'broken.csv')).errors,1);
 const rows=parseMercari(csv([['m1','商品','active','2026-09-16']],['商品ID','商品名','status','購入日時']));assert.equal(rows[0].code,'status_conflict');
});
test('従来CSV購入日時判定・BOM・カンマ・改行を保持',t=>{
 fresh(t);
 const input=Buffer.concat([Buffer.from([239,187,191]),csv([['m1','商品,1','説明\n改行','',990],['m2','商品2','','2026-09-16',500]],['商品ID','商品名','商品説明','購入日時','商品代金'])]);
 const rows=parseMercari(input);assert.equal(rows[0].data.status,'active');assert.equal(rows[1].data.status,'sold');assert.equal(rows[0].data.site_title,'商品,1');assert.equal(rows[0].data.site_description,'説明\n改行');assert.equal(rows[0].data.price,990);
});
test('同一商品・同一サイトの複数履歴を許可しサイトID重複は拒否',t=>{
 const db=fresh(t);db.prepare("INSERT INTO products(master_title) VALUES('商品')").run();
 const add=db.prepare("INSERT INTO listings(product_id,site,site_item_id,site_title,status) VALUES(1,'mercari',?,'商品',?)");
 add.run('m1','ended');add.run('m2','active');assert.equal(db.prepare('SELECT count(*) n FROM listings').get().n,2);
 assert.throws(()=>add.run('m2','active'));assert.throws(()=>db.prepare('DELETE FROM products WHERE id=1').run());
});
test('途中DBエラーで商品・出品・取込履歴全てロールバック',t=>{
 const db=fresh(t);db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON listings WHEN NEW.site_item_id='m2' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 assert.throws(()=>importMercari(db,csv([['m1','商品1','','','active',100],['m2','商品2','','','active',200]]),'rollback.csv'));
 for(const table of ['products','listings','import_rows','import_batches'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);
});

test('正常な最新掲載商品はactive・商品は現役・再取込で原稿と商品状態を保持',t=>{
 const db=fresh(t);
 const input=csv([['m1','未確認',''],['m2','売却済','2026-09-16']],['商品ID','商品名','購入日時']);
 assert.equal(summary(db,importMercari(db,input,'unknown.csv')).newListings,2);
 assert.equal(db.prepare('SELECT status FROM listings WHERE id=1').get().status,'active');
 assert.equal(db.prepare('SELECT source_status FROM listings WHERE id=1').get().source_status,'最新掲載リスト');
 assert.equal(db.prepare('SELECT lifecycle_status FROM products WHERE id=1').get().lifecycle_status,'active');
 assert.equal(db.prepare('SELECT status FROM listings WHERE id=2').get().status,'sold');
 assert.equal(db.prepare('SELECT lifecycle_status FROM products WHERE id=2').get().lifecycle_status,'sold');
 db.prepare("UPDATE products SET master_title='編集済',master_description='説明',hashtags_text='#保持',organization_status='ready',lifecycle_status='withdrawn' WHERE id=1").run();
 const before=db.prepare('SELECT * FROM products WHERE id=1').get();
 const result=summary(db,importMercari(db,input,'unknown.csv'));
 assert.equal(result.newProducts,0);assert.equal(result.unchanged,2);
 assert.deepEqual(db.prepare('SELECT * FROM products WHERE id=1').get(),before);
 assert.equal(db.prepare('SELECT status FROM listings WHERE id=1').get().status,'active');
});
test('公開状態・購入日時の列欠落もactive、明示された出品状態は従来どおり',()=>{
 const missing=parseMercari(csv([['m1','商品']],['商品ID','商品名']));assert.equal(missing[0].data.status,'active');
 const explicit=parseMercari(csv([['m1','公開','active'],['m2','停止','paused'],['m3','売却','sold'],['m4','終了','ended']],['商品ID','商品名','status']));
 assert.deepEqual(explicit.map(r=>r.data.status),['active','paused','sold','ended']);
});
