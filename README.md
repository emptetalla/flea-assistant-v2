# フリマ運営アプリ V2 — 第1実装

Node.js 24以上 / SQLite (`node:sqlite`) / Express / EJS。
旧アプリ・旧DBには接続しません。V2は独立した商品マスターです。

## 起動

```powershell
cd C:\Users\en-86\Downloads\flea-assistant-v2
npm ci
npm start
```

http://127.0.0.1:3211 にアクセス。旧アプリ3210と別ポートです。
`PORT`環境変数で変更可能。127.0.0.1だけで待ち受けます。
初回起動で `data/flea-v2.db` と保存先フォルダを作成します。
`.env`はGit除外ですが自動読込は行いません。

## 構成とDB

- `src/schema.sql`: 初版スキーマ。`PRAGMA user_version=1`で管理。
- `src/db.js`: 新DB接続・初期カテゴリ・FM-ID表示。
- `src/mercari.js`: ヘッダーによるCSV解析。
- `src/importer.js`: トランザクションによる取込。
- `src/app.js`, `src/server.js`: 商品管理と取込画面・起動。
- `views/`, `public/`: 日本語UI、コピー機能。
- `test/`: 本番DBを使わないin-memoryテスト。
- `data/`, `imports/{mercari,yahoo,rakuma}/`, `backups/`: Git対象外。

### テーブル

- products: master_title / master_description / hashtags_text / category_id / organization_status / lifecycle_status / timestamps。
- management_categories: 管理用カテゴリ10種類。
- listings: product_id / site / site_item_id / site_title / site_description / site_hashtags_text / price / status / source_status / listed_at / ended_at / last_seen_at / timestamps / import_row_id / link_method。
- product_photos: filenameのみ、絶対パス不可。写真機能は未実装。
- legacy_product_links: source_system + legacy_product_idを一意とし、product_idに紐付け。複数旧IDから1つのV2商品へ対応可能。自動移行はしない。
- import_batches / import_rows / import_review_items: 履歴、元行、要確認の隔離。
- yahoo_initial_mappings: Yahoo対応表の土台のみ。

FM-IDはproducts.idを `FM` + 最小5桁で表示。旧FM-IDとは別物。AUTOINCREMENTで再利用を防止。物理削除UIなし。
整理状態はunorganized/ready、販売状態はactive/sold/withdrawnの独立2軸。
listingのactiveはサイトで出品中、productのactiveは現役。整理状態とは無関係。
同一productの同一サイトlisting複数可。`UNIQUE(site,site_item_id)`。

## 商品UI

一覧・詳細・タイトルだけ新規登録・編集・カテゴリ/状態2軸。
タイトル、説明文、hashtags_text、全部（空欄を除き空行区切り）をコピー。
カテゴリ×サイト出品中listingなし等で絞り込み可能。
詳細に3サイトの全listing履歴と旧ID対応を表示。

## Mercari CSV

UTF-8（BOMあり可）、20MB上限。引用符付きカンマや改行に対応。
必須は `商品ID` と `商品名`（英語 `site_item_id`/`title` 等も対応）。
サイトIDは `m` + 数字。タイトルの一致・類似では統合しません。

| 項目 | 主な対応ヘッダー |
|---|---|
| 商品ID | 商品ID / item_id / site_item_id / id |
| 商品タイトル | 商品名 / タイトル / title / name / site_title |
| 説明 | 商品説明 / 商品の説明 / 説明文 / description / item_description |
| タグ文章 | ハッシュタグ / hashtags / hashtags_text |
| 状態 | 出品状態 / 出品ステータス / ステータス / status / 販売状況 |
| 価格 | 商品代金 / 価格 / 販売価格 / 商品価格 / price |
| 日時 | 出品日時 / 購入日時 / 終了日時、listed_at / purchased_at / ended_at |

説明・タグ列がない場合は新規マスターを空欄で作成。説明文からタグを勝手に抽出しません。
状態列がない旧形式は購入日時あり=sold、なし=unknownと判定し根拠をsource_statusに保存。公開中と公開停止をこの形式では判別できないため、activeとは推定しません。products.lifecycle_statusの現役(active)とは独立した扱いです。
取込元日時は元表記のまま保持。アプリ管理日時はUTC。
商品状態列（傷・汚れ等）は販売statusとは別なので使用しません。

初回は1出品=1product+1listing。全て未整理、soldは売却済、endedは取扱終了、他は現役で初期化。
再取込はsite+site_item_idで照合。**既存productsにはUPDATEしない**ため、原稿・カテゴリ・状態を全て保持。
listingのサイト情報だけ更新。CSVにない任意列は既存値を保持。
同一内容でもlast_seen_atのみ更新し、サマリーは変更なし。
CSVにない既存出品は終了させません。新サイトIDを過去商品へ自動推定しません。

列ずれ・ID欠落・CSV内ID重複（全該当行）・状態不明・矛盾等は要確認に隔離し、products/listingsを作成・変更しません。
ファイル解析失敗はエラー1件（商品登録なし）。DB障害はバッチ全体をROLLBACK。
インポート結果は入力、新規product、新規listing、更新、変更なし、要確認、エラー。
正常解析時は入力行数=新規listing+更新+変更なし+要確認。
アップロードファイル本体はメモリで処理し保存せず、元行をDBに記録。原本は利用者がimports/へ保管できます。
要確認画面は閲覧のみ。解決/除外操作は後続フェーズ。再取込時も以前の要確認履歴は残ります。

## 検証

```powershell
npm run build
npm run lint
npm test
```

build/lintはJavaScript構文・EJSコンパイル検査（バンドルやスタイルlintではありません）。
HTTP・DB・CSVの自動テストはin-memory DBのみ。

## 後続フェーズ

写真、リネーム、再出品UI、売上、AI、季節性、ニュースは未実装。Yahoo/Rakumaインポートは下記の追加仕様に対応。
写真ルート候補は `C:\Users\en-86\Pictures\flea-products`、今回フォルダへの操作なし。
旧FM-ID対応はテーブル土台のみ、CSVから推定しない。初期Yahoo対応表は別途確認が必要。
稼働中DBの単純コピーは避け、整合性のあるSQLiteバックアップを次フェーズで追加。

## 第1実装の検証記録（2026-09-16）

指定の `mercari_listing_20260916_142027.csv` を読み取り、in-memory DBで検証。548行から548商品・548出品を作成、要確認0・エラー0。同じCSVの2回目は新規0、変更なし548、外部キー違反0。原本の書換え、本番V2 DBへの投入はしていません。
実CSVには説明文・ハッシュタグ列なし。購入日時に基づく状態推定を使用。
ブラウザで本番V2の商品一覧表示を確認。テスト用サーバーの詳細画面へのブラウザ接続は失敗したため、コピーは自動テスト（Clipboard APIモック）で確認。実ブラウザでの詳細画面コピー操作は未確認。


## Yahoo / Rakuma 初期インポート（本番投入前）

### 入力・ID抽出

`src/excelListings.js` が通常表形式とWebコピー縦形式を読み取ります。ExcelJSでセルの実際のhyperlinkを読むため、商品名の表示文字にURLがなくても対応します。
`src/siteItemIds.js` にYahooとRakumaのURL抽出を分離。Yahooは `paypayfleamarket.yahoo.co.jp/item/z数字`、Rakumaは `item.fril.jp/32桁16進ID`。他ドメイン・ページ送り・ヘルプのリンクは商品扱いしません。
ID列の有効値を優先し、空欄ならハイパーリンク、リテラルHYPERLINK式、直接URLを確認。複数IDや不正なID列は自動修復せず要確認。
.xlsxのみ。複数シートはフォームで対象シート名を指定。Webコピーの公開時刻からactiveを推定しません。SOLD OUT等の明示状態だけ反映します。

### Yahoo対応表

標準列: `yahoo_site_item_id`, `decision`, `mercari_site_item_id`。
matchedはMercari IDから既存productへ追加、yahoo_onlyだけ新規product作成、holdは要確認、excludeは対象外。
対応表なし・未記載・参照先欠落・既存関連との矛盾は保留。タイトル類似でMercariに紐付けません。

旧対応表向けの2つのオプション（デフォルトOFF）:
- Yahoo IDもURLもない場合に、Yahoo一覧側と対応表側の商品名完全一致＋価格一致が両方で一意のときのみ対応表を結ぶ。
- メルカリID=0かつOnly=0を、確認済みYahoo-onlyとして扱う。
この2点は今回の実データについて利用者が承認済み。別の対応表で自動的に同じ意味とみなさないでください。
不正なIDが入力された行をタイトルで救済しません。行順をキーにしません。

### Rakuma

既知のsite+site_item_idを優先。新しいIDはmaster_title（前後空白除去後、内部表記は変換せず）の完全一致が1商品なら追加。0件・複数なら保留。listing数ではなくproduct数で判定します。

### データ保護と監査

既存productsをUPDATEせず、Mercari listingも変更しません。新規productはYahoo-onlyだけ。
更新は同じsite+site_item_idのサイト情報のみ。再取込によるproduct/listing増殖なし。既存の関連付けを黙って変更しません。
import_rows.raw_jsonにはシート名・元行・セル値・元URL、parsed_jsonには抽出ID・抽出経路・対応表・判定・候補IDを保存。
対応表全行の監査情報とファイルハッシュはimport_batches.summary_jsonに保持。確定した対応はyahoo_initial_mappingsにも保存。
既存DBの構造変更はありません。excludeは既存outcome制約と互換の `outcome=unchanged` とし、`parsed_json.decision=exclude`・理由・専用集計により明確に区別します。画面では「対象外」と表示し「変更なし」件数には含めません。
hold/未確定行はimport_review_itemsに保存し、listingsには混ぜません。再取込時も保留履歴はバッチごとに残ります。

### 実データ検証手順

`scripts/validate-excel-imports.js` は本番DBをreadOnlyで読み込み、:memory:へ全テーブルを複製して処理します。本番ファイルと全行の前後一致、既存products・Mercari listingの全カラム一致、再取込で商品/出品が増えないことをassertします。

```powershell
node scripts/validate-excel-imports.js data/flea-v2.db ../flea-assistant/imports/260916_YahooURLList320.xlsx ../flea-assistant/imports/260916_YahooList320mercariID.xlsx ../flea-assistant/imports/260916_ラクマ出品中URL.xlsx --join-yahoo-title-price --legacy-zero-as-only
```

検証結果: Yahoo320件=matched233+Yahoo-only86+要確認1。Rakuma26件=完全一致25+要確認1。ハイパーリンク取得はそれぞれ320/26。
Yahoo対応表の残り1行（ハローキティ平皿2枚セット）とYahoo一覧の残り1商品（マスク37枚）は別物のため保留。RakumaはSOLD OUTのニット商品の完全一致がなく保留。
Rakumaファイル冒頭には53件という表示がありますが、実際の収録は26商品。全53件の検証ではありません。
再取込はYahoo319件・Rakuma25件が変更なし、新規0、要確認は各1件。最終テストDBは634 products / 892 listings。本番は548 products / 548 Mercari listingsのまま。
本番へのYahoo/Rakuma投入、起動中本番サーバーの再起動、コミット・pushは未実施。
