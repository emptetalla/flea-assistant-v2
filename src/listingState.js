const sites=['mercari','yahoo','rakuma'];
const stateLabels={active:'出品中',unknown:'状態未確認',missing:'未出品',past:'過去出品あり'};
// Rank is shared by list filters and detail summaries: active > unknown > history > absent.
function listingState(items){return items.some(l=>l.status==='active')?'active':items.some(l=>l.status==='unknown')?'unknown':items.length?'past':'missing';}
const stateColumns=sites.map(site=>`CASE COALESCE((SELECT MAX(CASE l.status WHEN 'active' THEN 3 WHEN 'unknown' THEN 2 ELSE 1 END) FROM listings l WHERE l.product_id=p.id AND l.site='${site}'),0) WHEN 3 THEN 'active' WHEN 2 THEN 'unknown' WHEN 1 THEN 'past' ELSE 'missing' END AS ${site}_state`).join(',');
module.exports={sites,stateLabels,listingState,stateColumns};
