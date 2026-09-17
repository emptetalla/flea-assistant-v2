const ExcelJS = require('exceljs');
const { extractItemId, yahooIdFromUrl, rakumaIdFromUrl } = require('./siteItemIds');
const aliases = {
  title: ['商品名','タイトル','site_title','title','商品画像'],
  id: ['商品ID','site_item_id','item_id','Yahoo商品ID','Yahoo ID','YahooID','yahoo_site_item_id','Rakuma商品ID','rakuma_site_item_id'],
  price: ['価格','商品代金','販売価格','price'],
  status: ['status','状態','出品状態','出品ステータス','ステータス'],
  description: ['商品説明','説明文','description','master_description'],
  hashtags: ['ハッシュタグ','hashtags_text'],
  decision: ['decision','判定','判断'],
  mercari: ['メルカリID','Mercari ID','mercari_site_item_id'],
  only: ['Only','only'],
};
function text(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (value.text != null) return String(value.text);
  if (value.richText) return value.richText.map(v => v.text).join('');
  if ('result' in value) return text(value.result);
  return '';
}
function links(cell) {
  const result = [];
  const hyperlink = cell.hyperlink || cell.value?.hyperlink;
  if (hyperlink) result.push({ url: hyperlink, kind: 'hyperlink', cell: cell.address });
  // HYPERLINK関数のリテラルURLに対応。任意式は評価しない。
  const formula = cell.value?.formula;
  const literal = typeof formula === 'string' && formula.match(/^HYPERLINK\(\s*"([^"]+)"\s*[,;]/i);
  if (literal) result.push({ url: literal[1], kind: 'formula_hyperlink', cell: cell.address });
  for (const url of text(cell.value).match(/https?:\/\/[^\s<>"「」]+/g) || []) result.push({ url, kind: 'url_text', cell: cell.address });
  return result;
}
function snapshot(row) {
  const cells = [];
  row.eachCell({ includeEmpty: false }, cell => cells.push({ address: cell.address, value: cell.value, urls: links(cell) }));
  return { row: row.number, cells };
}
function rowUrls(row) { return snapshot(row).cells.flatMap(c => c.urls); }
function headerAt(sheet, mapping = false) {
  for (let n = 1; n <= Math.min(sheet.rowCount, 20); n++) {
    const columns = {};
    sheet.getRow(n).eachCell(cell => {
      const label = text(cell.value).trim();
      for (const [key,names] of Object.entries(aliases)) if (names.includes(label)) {
        if (columns[key]) throw new Error(`列の意味が重複しています: ${key}`);
        columns[key] = cell.col;
      }
    });
    if (columns.title || (mapping && columns.id)) return { number: n, columns };
  }
  return null;
}
function money(value) {
  const str = String(value ?? '').replace(/[¥￥円,\s\u00a0]/g, '');
  if (!str) return null;
  if (!/^\d+$/.test(str) || !Number.isSafeInteger(Number(str))) return NaN;
  return Number(str);
}
const statuses = new Map([['出品中','active'],['公開中','active'],['active','active'],['公開停止中','paused'],['公開停止','paused'],['paused','paused'],['売却済','sold'],['売却済み','sold'],['売却','sold'],['sold','sold'],['sold_out','sold'],['SOLD OUT','sold'],['sold out','sold'],['売り切れ','sold'],['終了','ended'],['ended','ended'],['unknown','unknown'],['不明','unknown']]);
function record(site, sheet, sourceRows, fields, explicitId = '', identityUrls) {
  const raw = { sheet: sheet.name, rows: sourceRows.map(snapshot) };
  const urls = identityUrls || sourceRows.flatMap(rowUrls);
  const extraction = extractItemId(site, explicitId, urls);
  const sourceStatus = fields.status || '';
  // 最新掲載一覧の通常行はactive。未知の明示状態はunknownのまま保持。
  const normalListing = !sourceStatus || (site==='yahoo' && /^(?:\d+(?:秒|分|時間|日|週間|週|ヶ月|か月|月|年)前|半年以上前)に(?:出品|更新)$/.test(sourceStatus));
  let status = statuses.get(sourceStatus) || (normalListing ? 'active' : 'unknown');
  const title = String(fields.title || '').trim();
  const price = money(fields.price);
  const reason = extraction.reason || (!title || /^https?:\/\//.test(title) ? '商品タイトルがありません' : null) || (Number.isNaN(price) ? '価格が不正です' : null);
  if(reason)status='unknown';
  return { rowNumber: sourceRows[0].number, raw, extraction, reason,
    data: { site_item_id: extraction.id, site_title: title, price: Number.isNaN(price) ? null : price,
      status, source_status: sourceStatus, site_description: fields.description || '', site_hashtags_text: fields.hashtags || '' },
    present: { price: fields.price !== undefined, description: fields.description !== undefined, hashtags: fields.hashtags !== undefined } };
}
function parseListingSheet(sheet, site) {
  const header = headerAt(sheet);
  const rows = [];
  if (header) {
    sheet.eachRow((row,n) => {
      if (n <= header.number) return;
      const get = key => header.columns[key] ? text(row.getCell(header.columns[key]).value).trim() : undefined;
      rows.push(record(site, sheet, [row], { title: get('title'), price: get('price'), status: get('status'), description: get('description'), hashtags: get('hashtags') }, get('id')));
    });
  } else if (site === 'yahoo') {
    // Webコピー形式: A列の1が商品名、2が価格、6が更新表示。計算済み数式値にも対応。
    const starts = [];
    sheet.eachRow((row,n) => { if (text(row.getCell(1).value) === '1' && text(row.getCell(2).value)) starts.push(n); });
    if (!starts.length) throw new Error('Yahoo Excelの表形式を認識できません');
    starts.forEach((n,i) => {
      const end = Math.min((starts[i+1] || sheet.rowCount+1)-1,n+6);
      const sourceRows = []; for (let r=n;r<=end;r++) sourceRows.push(sheet.getRow(r));
      const priceRow = sourceRows.find(r => text(r.getCell(1).value)==='2');
      const updateRow = sourceRows.find(r => text(r.getCell(1).value)==='6');
      const titleRow=sheet.getRow(n);
      rows.push(record(site,sheet,sourceRows,{title:text(titleRow.getCell(2).value),price:priceRow?text(priceRow.getCell(2).value):undefined,status:updateRow?text(updateRow.getCell(2).value):''},'',links(titleRow.getCell(2))));
    });
  } else {
    // Webコピー形式: 商品名セルの次行が価格。リンク欠落でも価格行から商品行を保持。
    const consumed = new Set();
    sheet.eachRow((row,n) => {
      const cell=row.getCell(1);const title=text(cell.value).trim();if(!title||consumed.has(n)||statuses.has(title))return;
      const next=sheet.getRow(n+1);const priceText=text(next.getCell(1).value).trim();
      const hasPrice=/^[¥￥]\s*[\d,]+$/.test(priceText);
      const productLink=links(cell).some(u=>rakumaIdFromUrl(u.url));
      if(!hasPrice&&!productLink)return;
      // 価格行をタイトルとして二重処理しない。
      if(hasPrice)consumed.add(n+1);
      const previous=n>1?sheet.getRow(n-1):null;
      const badge=previous?text(previous.getCell(1).value).trim():'';
      const sourceRows=hasPrice?[row,next]:[row];
      if(statuses.has(badge))sourceRows.unshift(previous);
      const item=record(site,sheet,sourceRows,{title,price:hasPrice?priceText:undefined,status:statuses.has(badge)?badge:''},'',links(cell));
      item.rowNumber=n;rows.push(item);
    });
    if(!rows.length)throw new Error('Rakuma Excelの表形式を認識できません');
  }
  const grouped=new Map();
  for(const row of rows)if(row.data.site_item_id){const key=row.data.site_item_id;grouped.set(key,[...(grouped.get(key)||[]),row]);}
  // 重複行を黙って捨てず、全該当行を保留。履歴に元行を残す。
  for(const group of grouped.values())if(group.length>1)for(const row of group)row.reason='同じExcel内で商品IDが重複しています';
  return rows;
}
async function loadSheet(buffer, sheetName) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  const sheets = workbook.worksheets.filter(s=>s.rowCount>0);
  if(!sheetName && sheets.length!==1)throw new Error('複数シートの場合は対象シート名を指定してください');
  const sheet=sheetName?workbook.getWorksheet(sheetName):sheets[0];
  if(!sheet)throw new Error('対象シートがありません');return sheet;
}
async function parseExcelListings(buffer,site,sheetName) {
  if(!['yahoo','rakuma'].includes(site))throw new Error('未対応サイトです');
  return parseListingSheet(await loadSheet(buffer,sheetName),site);
}
module.exports={parseExcelListings,parseListingSheet,loadSheet,text,links,snapshot,rowUrls,headerAt,money};
