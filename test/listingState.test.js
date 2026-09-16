const test=require('node:test');const assert=require('node:assert/strict');const {openDb}=require('../src/db');const {createApp}=require('../src/app');
test('all sites: state precedence, combined filters and read-only pages',async t=>{
 const db=openDb(':memory:');const statuses=[[],['sold','ended','paused'],['unknown','sold'],['active','unknown','ended']];
 for(let i=0;i<4;i++){db.prepare('INSERT INTO products(master_title,category_id) VALUES(?,1)').run('fixture '+i);for(const site of ['mercari','yahoo','rakuma'])for(const status of statuses[i])db.prepare('INSERT INTO listings(product_id,site,site_item_id,site_title,status) VALUES(?,?,?,?,?)').run(i+1,site,site+i+status,'listing',status);}
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));db.close();});const base='http://127.0.0.1:'+server.address().port;
 const snapshot=()=>JSON.stringify([db.prepare('SELECT * FROM products').all(),db.prepare('SELECT * FROM listings').all()]);const before=snapshot();
 const get=async url=>{const res=await fetch(base+url);assert.equal(res.status,200);return res.text();};
 const ids=html=>[...html.matchAll(/>FM(\d+)<\/a>/g)].map(m=>Number(m[1]));
 for(const site of ['mercari','yahoo','rakuma'])for(const [state,id] of [['missing',1],['past',2],['unknown',3],['active',4]]){const html=await get('/products?'+site+'='+state);assert.deepEqual(ids(html),[id]);assert.match(html,new RegExp('value="'+state+'" selected'));}
 for(const [id,label] of [[1,'未出品'],[2,'過去出品あり'],[3,'状態未確認'],[4,'出品中']]){const html=await get('/products/'+id);assert.equal(html.split(label+' · 履歴').length-1,3);assert.doesNotMatch(html,/現在出品なし|現役/);assert.match(html,/販売対象/);}
 assert.deepEqual(ids(await get('/products?mercari=unknown&yahoo=unknown&rakuma=unknown&category=1&organization=unorganized&lifecycle=active&q=fixture')),[3]);
 assert.deepEqual(ids(await get('/products?mercari=missing&yahoo=active')),[]);
 assert.deepEqual(ids(await get('/products?rakuma=missing&category=1')),[1]);
 assert.deepEqual(ids(await get('/products?missing=mercari')),[1]);
 assert.equal(ids(await get('/products?mercari=invalid')).length,4);
 const html=await get('/products');for(const label of ['Mercari','Yahoo!フリマ','Rakuma','出品中','状態未確認','未出品','過去出品あり'])assert.ok(html.includes(label));assert.equal(snapshot(),before);
});
