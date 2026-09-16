const express=require('express');const multer=require('multer');const crypto=require('node:crypto');const path=require('node:path');
const {fmId}=require('./db');const {importMercari}=require('./importer');
const {importExcel}=require('./excelImporter');
function createApp(db){
 const app=express();const csrf=crypto.randomBytes(32).toString('hex');
 app.disable('x-powered-by');app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));
 app.use((req,res,next)=>{
  if(!['127.0.0.1','localhost','[::1]'].includes(req.hostname))return res.status(403).send('ローカル接続のみ利用できます');
  res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.set('X-Content-Type-Options','nosniff');next();
 });
 app.use(express.static(path.join(__dirname,'../public')));app.use(express.urlencoded({extended:false,limit:'1mb'}));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:5}});
 const guard=(req,res,next)=>req.body._csrf===csrf?next():res.status(403).send('画面を再読み込みして再送信してください');
 app.use((req,res,next)=>{
  res.locals.fmId=fmId;res.locals.csrf=csrf;
  res.locals.labels={unorganized:'未整理',ready:'整理済',active:'現役',sold:'売却済',withdrawn:'取扱終了',paused:'公開停止',ended:'終了',unknown:'不明'};
  res.locals.siteLabels={mercari:'Mercari',yahoo:'Yahoo!フリマ',rakuma:'Rakuma'};
  res.locals.categories=db.prepare('SELECT * FROM management_categories WHERE is_active=1 ORDER BY sort_order').all();next();
 });
 app.get('/health',(req,res)=>res.json({status:'ok',version:'0.1.0'}));
 app.get('/',(req,res)=>res.redirect('/products'));
 app.get('/products',(req,res)=>{
  const where=[],params=[];
  const f={q:String(req.query.q||''),organization:String(req.query.organization||''),lifecycle:String(req.query.lifecycle||''),category:String(req.query.category||''),missing:String(req.query.missing||'')};
  if(f.q){where.push("(p.master_title LIKE ? OR ('FM'||printf('%05d',p.id))=?)");params.push('%'+f.q+'%',f.q.toUpperCase());}
  if(['unorganized','ready'].includes(f.organization)){where.push('p.organization_status=?');params.push(f.organization);}
  if(['active','sold','withdrawn'].includes(f.lifecycle)){where.push('p.lifecycle_status=?');params.push(f.lifecycle);}
  if(/^\d+$/.test(f.category)){where.push('p.category_id=?');params.push(Number(f.category));}
  if(['mercari','yahoo','rakuma'].includes(f.missing)){where.push("NOT EXISTS(SELECT 1 FROM listings l WHERE l.product_id=p.id AND l.site=? AND l.status='active')");params.push(f.missing);}
  const products=db.prepare(`SELECT p.*,c.name category_name FROM products p LEFT JOIN management_categories c ON c.id=p.category_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY p.id DESC`).all(...params);
  res.render('products',{products,f});
 });
 app.get('/products/new',(req,res)=>res.render('form',{p:{master_title:'',master_description:'',hashtags_text:'',organization_status:'unorganized',lifecycle_status:'active',category_id:null},error:null}));
 function save(req,res){
  const id=req.params.id?Number(req.params.id):null;
  if(req.params.id&&(!Number.isSafeInteger(id)||id<=0))return res.status(404).send('商品がありません');
  if(id&&!db.prepare('SELECT id FROM products WHERE id=?').get(id))return res.status(404).send('商品がありません');
  const p={id,master_title:String(req.body.master_title||'').trim(),master_description:String(req.body.master_description||''),hashtags_text:String(req.body.hashtags_text||''),category_id:req.body.category_id?Number(req.body.category_id):null,organization_status:String(req.body.organization_status||'unorganized'),lifecycle_status:String(req.body.lifecycle_status||'active')};
  let error=null;
  if(!p.master_title||p.master_title.length>1000)error='タイトルは1〜1000文字で入力してください';
  if(!['unorganized','ready'].includes(p.organization_status)||!['active','sold','withdrawn'].includes(p.lifecycle_status))error='状態を選び直してください';
  if(p.category_id!==null&&(!Number.isSafeInteger(p.category_id)||!db.prepare('SELECT id FROM management_categories WHERE id=? AND is_active=1').get(p.category_id)))error='カテゴリを選び直してください';
  if(error)return res.status(400).render('form',{p,error});
  const args=[p.master_title,p.master_description,p.hashtags_text,p.category_id,p.organization_status,p.lifecycle_status];
  if(id)db.prepare("UPDATE products SET master_title=?,master_description=?,hashtags_text=?,category_id=?,organization_status=?,lifecycle_status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(...args,id);
  const newId=id||Number(db.prepare('INSERT INTO products(master_title,master_description,hashtags_text,category_id,organization_status,lifecycle_status) VALUES(?,?,?,?,?,?)').run(...args).lastInsertRowid);
  res.redirect(303,'/products/'+newId);
 }
 app.post('/products',guard,save);app.post('/products/:id',guard,save);
 app.get('/products/:id/edit',(req,res)=>{const p=db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);if(!p)return res.status(404).send('商品がありません');res.render('form',{p,error:null});});
 app.get('/products/:id',(req,res)=>{
  const p=db.prepare('SELECT p.*,c.name category_name FROM products p LEFT JOIN management_categories c ON c.id=p.category_id WHERE p.id=?').get(req.params.id);
  if(!p)return res.status(404).send('商品がありません');
  res.render('detail',{p,listings:db.prepare('SELECT * FROM listings WHERE product_id=? ORDER BY site,id DESC').all(p.id),legacy:db.prepare('SELECT * FROM legacy_product_links WHERE product_id=?').all(p.id)});
 });
 app.get('/imports',(req,res)=>res.render('imports',{batches:db.prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT 100').all()}));
 app.post('/imports/mercari',upload.single('csv'),guard,(req,res,next)=>{
  if(!req.file)return res.status(400).send('CSVファイルを選択してください');
  try{const id=importMercari(db,req.file.buffer,path.basename(req.file.originalname));res.redirect(303,'/imports/'+id);}catch(error){next(error);}
 });
 const excelUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:2,fields:10}});
 app.post('/imports/excel/:site',excelUpload.fields([{name:'listings',maxCount:1},{name:'mapping',maxCount:1}]),guard,async(req,res,next)=>{
  const site=req.params.site;if(!['yahoo','rakuma'].includes(site))return res.status(400).send('未対応サイトです');
  const file=req.files?.listings?.[0],mapping=req.files?.mapping?.[0];
  if(!file)return res.status(400).send('出品一覧Excelを選択してください');
  try{
   const id=await importExcel(db,site,file.buffer,path.basename(file.originalname),{
    mappingBuffer:mapping?.buffer,mappingFilename:mapping?path.basename(mapping.originalname):null,
    sheetName:req.body.sheetName||undefined,mappingSheet:req.body.mappingSheet||undefined,
    joinByTitlePrice:req.body.joinByTitlePrice==='yes',legacyZeroAsOnly:req.body.legacyZeroAsOnly==='yes'
   });res.redirect(303,'/imports/'+id);
  }catch(error){next(error);}
 });
 app.get('/imports/:id',(req,res)=>{
  const batch=db.prepare('SELECT * FROM import_batches WHERE id=?').get(req.params.id);if(!batch)return res.status(404).send('履歴がありません');
  res.render('result',{batch,summary:JSON.parse(batch.summary_json),rows:db.prepare('SELECT * FROM import_rows WHERE batch_id=? ORDER BY row_number').all(batch.id)});
 });
 app.get('/reviews',(req,res)=>res.render('reviews',{rows:db.prepare('SELECT r.*,i.batch_id,i.row_number,i.raw_json FROM import_review_items r JOIN import_rows i ON i.id=r.import_row_id ORDER BY r.id DESC').all()}));
 app.use((req,res)=>res.status(404).send('ページがありません'));
 app.use((error,req,res,next)=>{console.error(error.message);res.status(error instanceof multer.MulterError?400:500).send(error instanceof multer.MulterError?'ファイルのサイズ・数が上限を超えています':'処理に失敗しました。インポート中のDBエラーは全件ロールバックされます。');});
 return app;
}
module.exports={createApp};
