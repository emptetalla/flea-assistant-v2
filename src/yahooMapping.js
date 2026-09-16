const {loadSheet,headerAt,text,rowUrls,snapshot,money}=require('./excelListings');
const {extractItemId}=require('./siteItemIds');
const decisions=new Set(['matched','yahoo_only','hold','exclude']);
function parseMappingSheet(sheet,listings,options={}) {
  const header=headerAt(sheet,true);if(!header)throw new Error('Yahoo対応表のヘッダーを認識できません');
  const records=[];
  sheet.eachRow((row,n)=>{
    if(n<=header.number)return;
    const get=key=>header.columns[key]?text(row.getCell(header.columns[key]).value).trim():'';
    const extraction=extractItemId('yahoo',get('id'),rowUrls(row));
    const record={rowNumber:n,raw:{sheet:sheet.name,rows:[snapshot(row)]},id:extraction.id,extraction,
      decision:get('decision'),mercariId:get('mercari'),title:get('title'),price:money(get('price')),canJoin:!get('id')&&rowUrls(row).length===0,reason:null,joinMethod:'site_item_id'};
    if(!record.decision){
      if(/^m\d+$/.test(record.mercariId))record.decision='matched';
      else if(record.mercariId==='0'&&get('only')==='0'&&options.legacyZeroAsOnly===true)record.decision='yahoo_only';
      else record.decision='hold';
    }
    if(!decisions.has(record.decision))record.reason='対応表の判定値が不正です';
    if(record.decision==='matched'&&!/^m\d+$/.test(record.mercariId))record.reason='matchedにはMercari商品IDが必要です';
    records.push(record);
  });
  // 同一Yahoo一覧と対応表の照合のみ。Mercari商品名との名寄せには使わない。
  if(options.joinByTitlePrice===true){
    for(const r of records){
      if(r.id||!r.canJoin||!r.title||r.price===null||Number.isNaN(r.price))continue;
      const peers=records.filter(p=>p.title===r.title&&p.price===r.price);
      const found=listings.filter(p=>p.data.site_title===r.title&&p.data.price===r.price&&p.data.site_item_id&&!p.reason);
      if(peers.length===1&&found.length===1){r.id=found[0].data.site_item_id;r.joinMethod='unique_yahoo_title_price';r.joinedListingRow=found[0].rowNumber;}
    }
  }
  for(const r of records)if(!r.id)r.reason=r.reason||'対応表にYahoo IDがなく、一意な照合もできません';
  const byId=new Map();
  for(const r of records)if(r.id){if(byId.has(r.id)){r.reason='対応表でYahoo商品IDが重複しています';byId.get(r.id).reason=r.reason;}else byId.set(r.id,r);}
  return {records,byId};
}
async function parseYahooMapping(buffer,listings,options={}) {
  if(!buffer)return {records:[],byId:new Map()};
  return parseMappingSheet(await loadSheet(buffer,options.mappingSheet),listings,options);
}
module.exports={parseYahooMapping,parseMappingSheet};
