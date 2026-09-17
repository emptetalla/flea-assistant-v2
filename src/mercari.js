const {parse}=require('csv-parse/sync');
const aliases={
 id:['商品ID','商品id','item_id','site_item_id','id'],
 title:['商品名','タイトル','title','name','site_title'],
 description:['商品説明','商品の説明','説明文','description','item_description'],
 hashtags:['ハッシュタグ','hashtags','hashtags_text'],
 status:['出品状態','出品ステータス','ステータス','status','販売状況'],
 price:['価格','販売価格','商品価格','商品代金','price'],
 listed:['出品日時','出品日','listed_at','出品時間'],
 purchased:['購入日時','購入日','売却日時','purchased_at','購入時間'],
 ended:['終了日時','ended_at']
};
const states=new Map([
 ['出品中','active'],['公開中','active'],['販売中','active'],['active','active'],['on_sale','active'],
 ['公開停止','paused'],['公開停止中','paused'],['出品停止中','paused'],['paused','paused'],['stop','paused'],
 ['売却','sold'],['売却済','sold'],['売却済み','sold'],['売り切れ','sold'],['sold','sold'],['sold_out','sold'],['SOLD OUT','sold'],['sold out','sold'],
 ['終了','ended'],['削除済み','ended'],['ended','ended']
]);
function parseMercari(buffer){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
 const records=parse(text,{bom:true,skip_empty_lines:true,relax_column_count:true});
 if(!records.length)throw new Error('CSVが空です');
 const headers=records.shift().map(s=>s.trim());const columns={};
 for(const [key,names]of Object.entries(aliases)){
  const found=headers.map((h,i)=>names.includes(h)?i:-1).filter(i=>i>=0);
  if(found.length>1)throw new Error(`同じ意味の列が複数あります: ${key}`);
  columns[key]=found.length?found[0]:-1;
 }
 if(columns.id<0||columns.title<0)throw new Error('商品ID・商品名の列が必要です。対応ヘッダーはREADMEを確認してください');
 const rows=records.map((raw,i)=>{
  const get=k=>columns[k]<0?'':String(raw[columns[k]]??'');
  const r={rowNumber:i+2,raw,data:null,reason:null,code:null};
  const fail=(code,reason)=>Object.assign(r,{code,reason});
  if(raw.length!==headers.length)return fail('column_count',`列数不一致（${raw.length}/${headers.length}）。自動補正せず確認してください`);
  const id=get('id').trim(),title=get('title').trim();
  if(!/^m\d+$/.test(id))return fail('item_id','Mercari商品IDが欠落または形式不明です（m + 数字が必要）');
  if(!title)return fail('title','商品名が空です');
  const source=get('status').trim();let status=states.get(source);
  // 最新掲載リストの正常な通常商品は出品中。売却・停止などの明示状態は優先する。
  if(!status&&!source)status=get('purchased').trim()?'sold':'active';
  if(!status)return fail('status','出品状態を判定できません。status列または購入日時列を確認してください');
  if(get('purchased').trim()&&status!=='sold')return fail('status_conflict','購入日時と出品状態が矛盾しています');
  const priceText=get('price').trim().replace(/[¥￥,]/g,'');const price=priceText===''?null:Number(priceText);
  if(price!==null&&(!Number.isSafeInteger(price)||price<0))return fail('price','価格が不正です');
  r.data={site_item_id:id,site_title:title,site_description:get('description'),site_hashtags_text:get('hashtags'),price,status,
   source_status:source||(status==='sold'?'購入日時あり':'最新掲載リスト'),listed_at:get('listed').trim()||null,ended_at:get('ended').trim()||get('purchased').trim()||null};
  r.present={description:columns.description>=0,hashtags:columns.hashtags>=0,price:columns.price>=0,listed:columns.listed>=0,ended:columns.ended>=0||columns.purchased>=0};
  return r;
 });
 const ids=new Map();records.forEach(raw=>{const id=String(raw[columns.id]??'').trim();if(id)ids.set(id,(ids.get(id)||0)+1);});
 rows.forEach(r=>{const id=String(r.raw[columns.id]??'').trim();if((ids.get(id)||0)>1){r.code='duplicate_id';r.reason='同じCSV内で商品IDが重複しています。全該当行を要確認にしました';}});
 return rows;
}
module.exports={parseMercari};
