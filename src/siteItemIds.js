// サイト別のURL解析。ネットワークアクセスやリダイレクト追跡はしない。
function urlObject(value) {
  try { const url = new URL(String(value).trim()); return /^https?:$/.test(url.protocol) ? url : null; }
  catch { return null; }
}
function yahooIdFromUrl(value) {
  const url = urlObject(value);
  if (!url || url.hostname !== 'paypayfleamarket.yahoo.co.jp') return null;
  return url.pathname.match(/^\/item\/(z\d+)\/?$/)?.[1] || null;
}
function rakumaIdFromUrl(value) {
  const url = urlObject(value);
  if (!url || url.hostname !== 'item.fril.jp') return null;
  return url.pathname.match(/^\/([a-f0-9]{32})\/?$/i)?.[1].toLowerCase() || null;
}
function validId(site, value) {
  const text = String(value ?? '').trim();
  if (site === 'yahoo') return /^z\d+$/.test(text) ? text : null;
  if (site === 'rakuma') return /^[a-f0-9]{32}$/i.test(text) ? text.toLowerCase() : null;
  return null;
}
function extractItemId(site, explicit, urls) {
  const fromUrl = site === 'yahoo' ? yahooIdFromUrl : rakumaIdFromUrl;
  if (String(explicit ?? '').trim()) {
    return { id: validId(site, explicit), method: 'id_column', urls,
      reason: validId(site, explicit) ? null : 'ID列の値がサイト商品IDの形式ではありません' };
  }
  const found = urls.map(u => ({ ...u, id: fromUrl(u.url) })).filter(u => u.id);
  const ids = [...new Set(found.map(u => u.id))];
  if (ids.length !== 1) return { id: null, method: null, urls,
    reason: ids.length ? '同じ商品行に複数の商品URLがあります' : '商品IDを取得できません（ID列・リンク先・URL文字列を確認）' };
  return { id: ids[0], method: found.some(u => u.kind === 'hyperlink') ? 'hyperlink' : found[0].kind, urls, reason: null };
}
module.exports = { yahooIdFromUrl, rakumaIdFromUrl, validId, extractItemId };
