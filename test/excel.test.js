const test=require('node:test');const assert=require('node:assert/strict');const ExcelJS=require('exceljs');
const {openDb}=require('../src/db');const {parseExcelListings}=require('../src/excelListings');const {parseYahooMapping}=require('../src/yahooMapping');const {importExcel}=require('../src/excelImporter');
const {yahooIdFromUrl,rakumaIdFromUrl}=require('../src/siteItemIds');
const rid=n=>String(n).padStart(32,'a');
async function workbook(rows){const w=new ExcelJS.Workbook();const s=w.addWorksheet('data');for(const row of rows)s.addRow(row);return Buffer.from(await w.xlsx.writeBuffer());}
function dbFor(t){const db=openDb(':memory:');t.after(()=>db.close());db.prepare("INSERT INTO products(master_title,master_description,hashtags_text,organization_status) VALUES('商品A','編集済説明','#保持','ready')").run();db.prepare("INSERT INTO listings(product_id,site,site_item_id,site_title,status) VALUES(1,'mercari','m1','商品A','unknown')").run();return db;}
const summary=(db,id)=>JSON.parse(db.prepare('SELECT summary_json FROM import_batches WHERE id=?').get(id).summary_json);
const products=db=>db.prepare('SELECT * FROM products ORDER BY id').all();
const mercari=db=>db.prepare("SELECT * FROM listings WHERE site='mercari' ORDER BY id").all();
test('サイトURL: 商品パスのみ、偽ドメインと他サイトを拒否',()=>{
 assert.equal(yahooIdFromUrl('https://paypayfleamarket.yahoo.co.jp/item/z123?x=1'),'z123');
 assert.equal(yahooIdFromUrl('https://paypayfleamarket.yahoo.co.jp.evil.test/item/z123'),null);
 assert.equal(yahooIdFromUrl('https://paypayfleamarket.yahoo.co.jp/my/item/selling?page=2'),null);
 assert.equal(rakumaIdFromUrl('https://item.fril.jp/'+rid(1)),rid(1));
 assert.equal(rakumaIdFromUrl('https://evil.test/'+rid(1)),null);
});
test('Excelセル実リンク・直接URL・ID優先・ID欠落・HYPERLINK式',async()=>{
 const data=await workbook([['商品ID','商品名','価格'],
 ['z11',{text:'商品A',hyperlink:'https://paypayfleamarket.yahoo.co.jp/item/z99'},100],
 ['',{text:'商品B',hyperlink:'https://paypayfleamarket.yahoo.co.jp/item/z12'},200],
 ['','商品C',300],
 ['',{formula:'HYPERLINK("https://paypayfleamarket.yahoo.co.jp/item/z13","商品D")',result:'商品D'},400]]);
 const rows=await parseExcelListings(data,'yahoo');assert.equal(rows[0].data.site_item_id,'z11');assert.equal(rows[0].extraction.method,'id_column');assert.equal(rows[1].data.site_item_id,'z12');assert.equal(rows[1].extraction.method,'hyperlink');assert.ok(rows[2].reason);assert.equal(rows[3].data.site_item_id,'z13');
 const direct=await parseExcelListings(await workbook([['商品名','URL','価格'],['商品A','https://item.fril.jp/'+rid(1),100]]),'rakuma');assert.equal(direct[0].data.site_item_id,rid(1));assert.equal(direct[0].extraction.method,'url_text');
 assert.ok(rows[1].raw.rows[0].cells.some(c=>c.value.hyperlink));
});
test('Yahoo縦形式: 数式連番・タイトルリンク・ページリンク除外',async()=>{
 const b=await workbook([[{formula:'1+0',result:1},{text:'商品A',hyperlink:'https://paypayfleamarket.yahoo.co.jp/item/z1'}],[2,{text:'1,000円',hyperlink:'https://paypayfleamarket.yahoo.co.jp/item/z1'}],[3,0],[4,0],[5,0],[6,'公開停止中'],[7,''],[8,{text:'次へ',hyperlink:'https://paypayfleamarket.yahoo.co.jp/my/item/selling?page=2'}]]);
 const rows=await parseExcelListings(b,'yahoo');assert.equal(rows.length,1);assert.equal(rows[0].data.status,'paused');assert.equal(rows[0].data.price,1000);
});
test('Rakuma縦形式: SOLD OUTは商品名ではなく状態、リンク欠落も保留',async()=>{
 const u='https://item.fril.jp/'+rid(1);const rows=await parseExcelListings(await workbook([['商品一覧'],[{text:'SOLD OUT',hyperlink:u}],[{text:'商品A',hyperlink:u}],['¥ 500'],[],['商品B'],['¥ 600']]),'rakuma');
 assert.equal(rows.length,2);assert.equal(rows[0].data.site_title,'商品A');assert.equal(rows[0].data.status,'sold');assert.equal(rows[0].rowNumber,3);assert.ok(rows[1].reason);
});
test('Yahoo matched/only/hold/exclude、原稿・Mercari不変、再取込増殖なし',async t=>{
 const db=dbFor(t),before=products(db),beforeMercari=mercari(db);
 const file=await workbook([['商品ID','商品名','価格'],['z1','サイト原稿',100],['z2','Yahooのみ',200],['z3','保留',300],['z4','除外',400]]);
 const mapping=await workbook([['yahoo_site_item_id','decision','mercari_site_item_id'],['z1','matched','m1'],['z2','yahoo_only',''],['z3','hold',''],['z4','exclude','']]);
 const options={mappingBuffer:mapping};const first=summary(db,await importExcel(db,'yahoo',file,'y.xlsx',options));
 assert.equal(first.matched,1);assert.equal(first.only,1);assert.equal(first.hold,1);assert.equal(first.excluded,1);assert.equal(first.review,1);assert.equal(first.newProducts,1);assert.equal(first.newListings,2);
 assert.deepEqual(products(db).slice(0,1),before);assert.deepEqual(mercari(db),beforeMercari);
 const second=summary(db,await importExcel(db,'yahoo',file,'y.xlsx',options));assert.equal(second.newProducts,0);assert.equal(second.newListings,0);assert.equal(second.unchanged,2);assert.equal(products(db).length,2);
 const excluded=db.prepare("SELECT * FROM import_rows WHERE batch_id=1 AND row_number=5").get();assert.equal(JSON.parse(excluded.parsed_json).decision,'exclude');assert.equal(excluded.listing_id,null);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('Yahoo対応表なし・不存在Mercari・既存関連の矛盾は要確認',async t=>{
 const db=dbFor(t);const file=await workbook([['商品ID','商品名','価格'],['z1','商品A',100]]);
 assert.equal(summary(db,await importExcel(db,'yahoo',file,'no-map.xlsx')).review,1);
 const bad=await workbook([['商品ID','decision','メルカリID'],['z1','matched','m999']]);assert.equal(summary(db,await importExcel(db,'yahoo',file,'bad.xlsx',{mappingBuffer:bad})).review,1);
 db.prepare("INSERT INTO products(master_title) VALUES('別商品')").run();db.prepare("INSERT INTO listings(product_id,site,site_item_id,site_title,status) VALUES(2,'yahoo','z1','別商品','unknown')").run();
 const good=await workbook([['商品ID','decision','メルカリID'],['z1','matched','m1']]);assert.equal(summary(db,await importExcel(db,'yahoo',file,'conflict.xlsx',{mappingBuffer:good})).review,1);assert.equal(db.prepare("SELECT product_id FROM listings WHERE site='yahoo'").get().product_id,2);
});
test('Rakumaは完全一致1商品のみ、0/複数/類似は保留、既知IDは編集後も保持',async t=>{
 const db=dbFor(t);db.prepare("INSERT INTO products(master_title) VALUES('重複'),('重複')").run();
 const file=await workbook([['商品ID','商品名','価格'],[rid(1),'商品A',100],[rid(2),'商品 A',100],[rid(3),'重複',100],[rid(4),'なし',100]]);
 const first=summary(db,await importExcel(db,'rakuma',file,'r.xlsx'));assert.equal(first.exact,1);assert.equal(first.review,3);assert.equal(first.newProducts,0);
 db.prepare("UPDATE products SET master_title='編集後',master_description='変更原稿',hashtags_text='#変更' WHERE id=1").run();const before=products(db);
 const second=summary(db,await importExcel(db,'rakuma',file,'r.xlsx'));assert.equal(second.newListings,0);assert.equal(second.unchanged,1);assert.equal(second.known,1);assert.deepEqual(products(db),before);
});
test('ID重複行を隔離し、空Excel・破損Excelは失敗履歴へ',async t=>{
 const db=dbFor(t);const dup=await workbook([['商品ID','商品名','価格'],[rid(1),'商品A',100],[rid(1),'商品A',100]]);
 assert.equal(summary(db,await importExcel(db,'rakuma',dup,'dup.xlsx')).review,2);
 assert.equal(summary(db,await importExcel(db,'rakuma',Buffer.from('broken'),'broken.xlsx')).errors,1);
 assert.equal(db.prepare("SELECT count(*) n FROM listings WHERE site='rakuma'").get().n,0);
});
test('旧Yahoo対応表は明示オプション時のみ一意な同名同価格で照合',async()=>{
 const rows=await parseExcelListings(await workbook([['商品ID','商品名','価格'],['z1','商品A',100],['z2','商品B',200]]),'yahoo');
 const input=await workbook([['商品画像','price','メルカリID','Only'],['商品A',100,'m1',1],['商品B',200,0,0]]);
 const strict=await parseYahooMapping(input,rows);assert.equal(strict.byId.size,0);
 const joined=await parseYahooMapping(input,rows,{joinByTitlePrice:true});assert.equal(joined.byId.get('z2').decision,'hold');
 const confirmed=await parseYahooMapping(input,rows,{joinByTitlePrice:true,legacyZeroAsOnly:true});assert.equal(confirmed.byId.get('z2').decision,'yahoo_only');assert.equal(confirmed.byId.get('z1').decision,'matched');
});
test('途中DB障害はYahoo-only商品と取込履歴もロールバック',async t=>{
 const db=dbFor(t);db.exec("CREATE TRIGGER stop_yahoo BEFORE INSERT ON listings WHEN NEW.site='yahoo' BEGIN SELECT RAISE(ABORT,'test'); END;");
 const f=await workbook([['商品ID','商品名','価格'],['z1','新規',100]]),m=await workbook([['商品ID','decision'],['z1','yahoo_only']]);
 await assert.rejects(importExcel(db,'yahoo',f,'rollback.xlsx',{mappingBuffer:m}));assert.equal(products(db).length,1);assert.equal(db.prepare('SELECT count(*) n FROM import_batches').get().n,0);
});

test('タイトル+リンク列だけの表にも対応、不正な対応表IDはタイトルで救済しない',async()=>{
 const listing=await workbook([['商品名','URL'],['商品A','https://paypayfleamarket.yahoo.co.jp/item/z1']]);
 const rows=await parseExcelListings(listing,'yahoo');assert.equal(rows[0].data.site_item_id,'z1');
 const onlyTitle=await workbook([['商品名'],[{text:'商品A',hyperlink:'https://item.fril.jp/'+rid(1)}]]);assert.equal((await parseExcelListings(onlyTitle,'rakuma'))[0].data.site_item_id,rid(1));
 const bad=await workbook([['商品ID','商品名','価格','decision'],['bad','商品A',100,'yahoo_only']]);
 const source=await parseExcelListings(await workbook([['商品ID','商品名','価格'],['z1','商品A',100]]),'yahoo');
 const result=await parseYahooMapping(bad,source,{joinByTitlePrice:true});assert.equal(result.byId.size,0);assert.ok(result.records[0].reason);
});


test('latest normal listings active, explicit sold/paused retained, anomalous status unknown',async()=>{for(const site of ['yahoo','rakuma']){const ids=site==='yahoo'?['z901','z902','z903','z904']:[rid(901),rid(902),rid(903),rid(904)];const rows=await parseExcelListings(await workbook([['商品ID','商品名','status'],[ids[0],'通常',''],[ids[1],'売却','SOLD OUT'],[ids[2],'停止','paused'],[ids[3],'異常','???']]),site);assert.deepEqual(rows.map(r=>r.data.status),['active','sold','paused','unknown']);}});
